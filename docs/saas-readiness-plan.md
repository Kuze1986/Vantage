# Vantage SaaS-Readiness Plan

Three structural gaps stand between today's single-operator app and a sellable
multi-tenant SaaS. Ordered by leverage. Each phase is independently shippable.

> Status today: a `workspaces` table + `workspaceGuard` exist, but only the 4
> newest feature areas (campaigns, intelligence, audience, virality) carry
> `workspace_id`. The entire core pipeline is single-tenant, the scheduler runs
> in-process on global tables, and there are no tests/CI.

---

> **Status (updated):**
> - **Phase 1 (1a–1d) ✅** committed (`29eeffa` migration, `8c85d84` app layer).
> - **Phase 2c (publish lock) ✅** committed (`361d25d` engine + migration
>   `20260703000000_publish_lock.sql`, `5751e98` manual-publish claim).
> - **Phase 3 (tests + CI) ✅ started** (`fb49c0e`): Vitest harness + 26 tests
>   (workspace guard / IDOR, parseRetryAfter, engagementKind, tagUrls) + GitHub
>   Actions CI. More suites (publish state machine, full tenancy isolation) still to add.
> - **Pending:** both migrations (`20260702…`, `20260703…`) need manual review +
>   apply to the DB (not DB-tested in-session). **Phase 2a/2b (auth + per-tenant
>   credentials)** is the remaining major work — best done after the migrations
>   are applied and a second workspace exists to test against.

## Phase 1 — Tenancy migration (the blocker)  ✅ done

**Goal:** every row the app touches belongs to exactly one workspace, and every
query is scoped to the caller's workspace. No data path can read or write across
tenants.

### 1a. Schema: add `workspace_id` to core tables
These tables currently have **no** tenant column:

| Table | Notes |
|---|---|
| `brand_voice` | today `limit(1)` returns the one global voice → must become one-per-workspace |
| `channels` | per-tenant OAuth creds + cadence; the hard part (see Phase 2 credentials) |
| `topics` | dedup window must scope per workspace |
| `content_pieces` | the central pipeline table |
| `engagement_events` | |
| `generation_weights` | BioLoop weights are per-tenant |
| `activity_events` | the live feed |
| `settings` | currently one global row |
| `newsletter_subscribers` | |
| `email_templates` | |
| `music_tracks`, `sound_effects` | decide: per-tenant vs. shared library (recommend shared/global → leave alone, or add nullable `workspace_id` for custom uploads) |
| `demoforge_jobs` | |

Migration steps:
1. `ALTER TABLE ... ADD COLUMN workspace_id uuid REFERENCES vantage.workspaces(id)`.
2. Backfill: create one "default" workspace owned by the current operator, set
   all existing rows to it.
3. `ALTER COLUMN workspace_id SET NOT NULL` after backfill (except shared libs).
4. Add composite indexes: `(workspace_id, status)` on `content_pieces`,
   `(workspace_id, used_at)` on `topics`, etc. — every hot query gets one.
5. Regenerate the `public.*` proxy views (the event trigger handles new tables,
   but altered tables may need the view refreshed — verify columns propagate).

### 1b. Defense in depth: RLS
The server uses the service-role key, which **bypasses RLS** — so RLS alone is
not enough, but add it anyway as a backstop for the day a tenant-scoped JWT path
exists. Policy: `workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())`.

### 1c. Application: scope every query
- Make `workspaceGuard` **mandatory** on all `/v1` routes (today it's optional —
  a request with no `x-workspace-id` skips the check entirely). Resolve the
  workspace server-side from the user if the header is absent (e.g. their default
  workspace) rather than leaving it unscoped.
- Introduce a per-request scoped data accessor so a query can't forget the
  filter. Two options:
  - **Helper that injects `.eq("workspace_id", ws)`** on every builder, or
  - a thin repository layer per table.
  Recommend the helper — least churn over the ~18 routes.
- Audit each route in `apps/api/src/routes/*` and add the filter. The 4 newest
  routes (`audience`, `bioloop`, `campaigns`, `intelligence`) already show the
  pattern to copy.
- Every `INSERT` must stamp `workspace_id` from `c.get("workspaceId")`.

### 1d. The scheduler must become tenant-aware
`scheduler.ts` reads `brand_voice limit(1)`, `channels where enabled`, etc.
globally. Rework each tick to **iterate workspaces**:
```
for (const ws of activeWorkspaces) {
  // load that workspace's channels, voice, settings; generate/publish for it
}
```
This couples tightly with Phase 2.

**Exit criteria:** create two workspaces, generate/queue/publish in each, confirm
zero cross-tenant reads (integration test in Phase 3).

---

## Phase 2 — Real auth, per-tenant credentials, scheduler safety

### 2a. Replace the stub auth
`authMiddleware` today: any valid Supabase JWT passes; `BRANDON_USER_ID` pins one
user. Replace with:
- Membership model: `workspace_members(workspace_id, user_id, role)` so a
  workspace can have >1 user and roles (owner/admin/editor/viewer).
- `workspaceGuard` checks **membership**, not just `owner_id`.
- Optional: role checks on mutating routes.

### 2b. Per-tenant channel credentials
Today OAuth tokens / API keys live on global `channels` rows and adapters read
process-env secrets (e.g. one X app, one Resend key). For multi-tenant:
- Move per-tenant secrets into `channels.credentials` (encrypted) keyed by
  workspace, OR a dedicated `channel_credentials` table.
- Adapters (`adapters/x.ts`, `linkedin.ts`, `reddit.ts`, `email.ts`) take creds
  as an argument instead of reading env. The scheduler passes the right
  workspace's creds.
- Encrypt at rest (pgcrypto or app-side envelope encryption). The Instructions
  doc already claims "tokens are stored encrypted" — make that true.

### 2c. Scheduler concurrency / HA safety
Even single-tenant, the current engine can double-publish:
- `cadenceTick` selects `limit(20)` queued pieces but never **claims** them. A
  publish slower than the 60s tick, or a second process, re-grabs the same row.
- Fix with an atomic claim: `UPDATE content_pieces SET status='publishing',
  locked_at=now() WHERE id=... AND status='queued'` and only proceed if the
  update affected the row (compare-and-swap). Add a `publishing` status + a
  stale-lock reaper (re-queue rows stuck in `publishing` > N minutes).
- For horizontal scale: add a leader-election / advisory lock so only one
  instance runs ticks (`pg_try_advisory_lock`), or move ticks to a single worker
  process / Supabase pg_cron + edge function (BioLoop already uses this pattern).

**Exit criteria:** two API instances running simultaneously never publish the
same piece twice; each tenant publishes only with its own credentials.

---

## Phase 3 — Tests + CI (safety net)

Highest risk-to-effort gap: software that auto-posts to real platforms and emails
real people has **zero** automated tests and **no** CI.

### 3a. Tooling
- Add `vitest` to `apps/api`. Wire `pnpm -r test` and a `test` script per package.

### 3b. Priority test targets (state machines first)
1. **Publish state machine** (`scheduler.ts` `publishPiece`): success →
   `published`; failure → retry with correct backoff `[5m,15m,1h]`; rate-limit →
   reschedule without burning a retry; exhausted → `failed` + alert. Mock adapters.
2. **The new claim/lock** from Phase 2c: concurrent ticks claim a piece exactly
   once.
3. **Audit gating** (`autoGenerateTick`): pass → queued; fail → regen once →
   pass=approved / fail=rejected.
4. **Tenancy isolation** (Phase 1): a request scoped to workspace A cannot read
   or mutate workspace B's rows. This is the test that protects the whole sale.
5. **Webhook signature verification + dedup** (already implemented — lock it in).

### 3c. CI
- `.github/workflows/ci.yml`: on PR, run `pnpm install`, `pnpm typecheck`,
  `pnpm lint`, `pnpm -r test`, `pnpm build`. No CI exists today.

**Exit criteria:** green CI gate on every PR; the four state-machine suites plus
the tenancy-isolation test pass.

---

## Smaller fixes (fold in opportunistically)
- `app.onError` returns raw `err.message` to clients (`index.ts`) — log detail,
  return a generic message + request id.
- CORS falls back to `corsOrigins[0]` for disallowed origins instead of rejecting
  — reject unknown origins.
- Add `.claude/` and `supabase/.temp/` to `.gitignore` (currently untracked noise).

---

## Suggested order & rough sizing
1. **Phase 1 (tenancy)** — largest; unblocks everything. Do 1a→1c first, 1d with Phase 2.
2. **Phase 2c (scheduler claim/lock)** — small, high-value; can land before the rest of Phase 2.
3. **Phase 3 (tests/CI)** — start the harness early; write the tenancy + publish tests alongside Phases 1–2 so they guard the migration as it lands.
4. **Phase 2a/2b (auth + per-tenant creds)** — required before onboarding a real second customer.

Billing (Stripe + plan/quota enforcement) is the remaining commercial piece once
the above lands — scoped separately.
