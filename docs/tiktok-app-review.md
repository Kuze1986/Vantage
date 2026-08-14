# TikTok App Review — readiness design

Scope: what Vantage must build, configure, write, and film before submitting for first-time
TikTok app review.

**Repo state this was written against (re-verified 2026-08-08):** `main` @ `760af12`, clean
tree. The TikTok adapter's last substantive change is `40faaf9` ("real TikTok and Instagram
posting integrations"); nothing has touched it since. The newest branch carrying relevant
architecture is `origin/cursor/portfolio-marketing-91e2` (2026-07-31, **unmerged**, 3 commits)
— see §1, which is written against it.

Source of truth for requirements (fetched, not from memory):
- [App Review Guidelines](https://developers.tiktok.com/doc/app-review-guidelines/)
- [Content Sharing Guidelines (UX rules)](https://developers.tiktok.com/doc/content-sharing-guidelines/)
- [Content Posting API — Get Started](https://developers.tiktok.com/doc/content-posting-api-get-started/)
- [Direct Post reference](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)
- [Media Transfer Guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide)
- [Token management](https://developers.tiktok.com/doc/oauth-user-access-token-management)

---

## 0a. Build status

| Item | Status |
|------|--------|
| §2 `user.info.basic` actually used (`fetchUserInfo` + Channels account card) | **done** |
| §3a `creator_info/query` + `GET /v1/channels/tiktok/creator-info` | **done** |
| §3b Direct Post compose UI (`TikTokComposeModal`) | **done** |
| §3c Settings persisted on the piece; publish refuses without them | **done** |
| §3d Full `post_info` payload (interactions, disclosure, AIGC, cover) | **done** |
| §3e `is_aigc` toggle | **done** |
| §3f Chunked upload (5–64 MB, ≤1000 chunks) | **done** |
| §3g Publish progress polling + `GET .../publish-status/:id` | **done** |
| §3h Revoke + `DELETE /v1/channels/tiktok/auth` + Disconnect button | **done** |
| §3i Hardening (merge auth_state, expire state, `needs_reauth`) | **done** |
| Caption limit 150 → 2200 | **done** |
| Duration validation against `max_video_post_duration_sec` | **done** |
| §1 `product_slug` on `channels` | **blocked** — needs the fork decision in §7 step 0 |
| §1 Redirect URI moved to the web domain | not started |
| §1/§6 Landing-page footer links + real Terms/Privacy content | not started |
| §4 Sandbox setup, rehearsal, recording | not started |

Verification: `pnpm build` clean, `pnpm test` 367 passed (40 files, incl. 13 new in
`apps/api/src/adapters/tiktok.test.ts`).

## 0. Verdict

The integration started as a *working pipe*, not a *reviewable product*: OAuth + PKCE, token
refresh, `video/init` + `PUT` + status polling existed and the endpoint URLs were correct,
but review is a UX-compliance test rather than a functional one, and it failed on five
counts.

Four of those five are now built (see §0a). The one that remains is B1 — the schema change
that lets more than one product connect a TikTok account — because it depends on a decision
that has not been made (§7 step 0). What is left after that is configuration, legal copy,
and filming.

### The five hard blockers (original assessment)

| # | Blocker | Where |
|---|---------|-------|
| B1 | `channels` PK is `(workspace_id, slug)`, so only one TikTok account can be connected across all six products — the multi-brand claim isn't demonstrable | Migration + `adapters/tiktok.ts`, submission copy, landing page |
| B2 | Direct Post UX guidelines almost entirely unimplemented | `ChannelsPage`, `QueuePage`, adapter |
| B3 | `creator_info/query` is never called | `adapters/tiktok.ts` |
| B4 | `user.info.basic` is requested but never used — unused scopes delay review | `adapters/tiktok.ts:43` |
| B5 | No disconnect/revoke path | `routes/channels.ts` |

---

## 1. B1 — positioning (do this first, it changes what you build)

Two guideline clauses are in tension here, and picking the wrong story trips one of them:

- **"Apps must not be for private or personal use"**
- **"Apps in development/testing won't be approved"**

The portfolio — **The Shift, Keystone, Scripta, DemoForge, Vantage** — are commercial SaaS
businesses, not personal projects. That settles the first clause: this is commercial use, in
the same category as an agency or a multi-brand company's social team. It is not one person
automating their own account.

The residual nuance, worth naming once and then acting on: all five brands roll up to one
owner, so TikTok sees a single operator. That does **not** make it personal use, but it does
mean the safest submission is the one that is verifiably true today.

### Submit as a multi-brand marketing platform, not as purchasable SaaS

I'd previously suggested framing Vantage as a multi-tenant product any customer can buy.
Given the portfolio is real and commercial, that framing is now the *riskier* of the two —
because a reviewer will visit the website, find no signup and no pricing (billing and public
signup are not built), and land on the second clause: *in development/testing*. Claiming a
product that cannot be purchased is a worse failure mode than claiming an in-house
multi-brand platform, which is true, demonstrable, and commercial.

**The story to submit:** Vantage is the marketing operations platform that runs organic
social for a portfolio of five commercial software products. Each brand has its own
workspace, its own connected TikTok account, and its own content pipeline. Nothing about
that requires external customers to exist, and all of it is visible on screen.

The code corroborates it: `workspaces` are first-class with members and owner/admin roles
(`routes/workspaces.ts`), and channel credentials are keyed per workspace
(`channels.auth_state` scoped by `workspace_id`), so five brands genuinely means five
independent TikTok connections.

### One decision this forces — `channels` must become product-scoped

The portfolio is already a first-class concept in the codebase, but **not in the one table
that matters for TikTok.**

The `cursor/portfolio-marketing-91e2` branch (unmerged, 3 commits) establishes the intended
architecture: products are a **`product_slug` column inside a single workspace**, added to
`brand_voice` (unique per `workspace_id, product_slug`), `content_pieces`, `topics`, and a new
`marketing_assets` table, with slugs `shift | keystone | scripta | demoforge | crucible |
vantage` (`lib/products.ts`). It also ships `GET /v1/marketing` — an API that serves brand
packs and approved pieces to sibling apps.

That branch does **not** touch `channels`. And `vantage.channels` is declared
`PRIMARY KEY (workspace_id, slug)` (`20260702000000_core_tenancy.sql:72`), so a workspace can
hold exactly **one** TikTok connection — on `main` and on the portfolio branch alike.

So the multi-brand story is blocked at the schema level: six products, one TikTok account.
The Channels screen will show a single connection no matter which product is selected, and
that is exactly the screen a reviewer scrutinises.

**Recommendation (revised): add `product_slug` to `channels` rather than splitting brands into
workspaces.** An earlier draft of this doc recommended one workspace per brand; that is the
wrong grain now that the portfolio direction is established — it would fight the
`product_slug` architecture everywhere else and orphan the marketing API.

Concretely:

- Migration: add `product_slug` to `vantage.channels`, repoint the PK to
  `(workspace_id, slug, product_slug)`, backfill existing rows to `'vantage'`.
- Every TikTok adapter query currently does
  `.eq("workspace_id", ws).eq("slug", "tiktok").single()` — five call sites in
  `adapters/tiktok.ts` (`savePendingOAuth`, `exchangeCodeForTokens`, `getAccessToken`,
  `refreshAccessToken`, and the revoke path from §3h). All must take a product slug.
  Note `exchangeCodeForTokens` resolves the workspace by scanning for a matching pending
  `state`; it must resolve the **product** the same way, or a reconnect for one brand will
  overwrite another brand's tokens.
- `resolveOrCreateWorkspace`'s default-channel seeding (`lib/workspace.ts`) needs to seed per
  product, or seed lazily on first connect.
- The Channels page needs a product selector, and the compose modal (§3b) must post to the
  channel row for the piece's `product_slug`.

This is the single most important structural change in this document, because it is what
makes the non-personal-use claim visible on camera.

### Required before submission

- Landing page (`apps/web/src/landing/LandingPage.tsx`) must clearly describe what Vantage
  does and who operates it, and carry **visible footer links to `/terms` and `/privacy`**
  (the guidelines specifically call out that these must not be buried). It already lists the
  portfolio under a "NEXUS" footer column (`LandingPage.tsx:520`) — lean into that: naming
  the five products it manages is exactly the evidence that this is not personal use.
- Do **not** advertise pricing or a signup you cannot honour. Describe the platform, not a
  purchase.
- The submitted website URL, the OAuth redirect URI domain, and the domain visible in the
  demo video must all be consistent. Right now `TIKTOK_REDIRECT_URI` points at the **API**
  host (`…/v1/channels/tiktok/auth/callback`) while the UI lives on the **web** host. That
  is legal but means the browser address bar leaves your submitted domain mid-video.
  **Recommendation:** move the callback to the web app (`https://<web>/oauth/tiktok/callback`),
  have it POST the `code`/`state` to the existing API handler, and keep the whole flow on one
  domain. Otherwise verify both domains in the portal and be ready for reviewer questions.
- App name must not reference TikTok or another social company. "Vantage" is fine.

---

## 2. Scope selection — request less

Currently requested: `user.info.basic,video.publish` (`adapters/tiktok.ts:43`).

**Keep exactly those two. Do not add `video.list`, `user.info.stats`, or `user.info.profile`**
unless you build the analytics to justify them — "if you don't need certain products or
scopes, remove them before review, otherwise it will delay the review result." Vantage's
`AnalyticsPage` does not read TikTok metrics today, so Display API should not be selected at
all. Share Kit should not be selected — Vantage server-side posts, it does not hand off to
the TikTok app.

`user.info.basic` must actually be *used* (B4). Fix by calling `GET /v2/user/info/?fields=open_id,union_id,avatar_url,display_name`
after token exchange and rendering the connected account (avatar + display name) on the
Channels page. That gives the reviewer something to see in the video and makes the scope
defensible in one sentence.

**Products to select:** Login Kit, Content Posting API (Direct Post). Nothing else.

---

## 3. Engineering work

### 3a. Creator info query (new — B3)

`POST /v2/post/publish/creator_info/query/` must be called **at the moment the compose UI is
rendered**, not cached. It returns `creator_nickname`, `creator_avatar_url`,
`privacy_level_options`, `comment_disabled`, `duet_disabled`, `stitch_disabled`,
`max_video_post_duration_sec`.

Add to `apps/api/src/adapters/tiktok.ts`:

```ts
export async function fetchCreatorInfo(workspaceId: string): Promise<TikTokCreatorInfo>
```

Expose as `GET /v1/channels/tiktok/creator-info` in `routes/channels.ts`. This drives the
whole compose form; without it, none of §3b is compliant.

### 3b. Direct Post compose UI (new — B2, the big one)

This is the largest single piece of work and it does not exist in any form today. The
guidelines are prescriptive; each bullet is a pass/fail item:

- **Creator nickname displayed** so the user knows which account receives the post.
- **Title/caption field**, user-editable. (Current code slices to 150 chars —
  `adapters/tiktok.ts:174`. Direct Post allows **2200 UTF-16 runes**. Raise the limit;
  150 silently truncates hashtags.)
- **Privacy selector with NO default value.** Options rendered from `privacy_level_options`
  only. The user must actively choose. Current code hardcodes `SELF_ONLY` —
  `adapters/tiktok.ts:177`.
- **Interaction toggles**: comment, duet, stitch. **Default unchecked.** Any that the
  creator's own settings disable must render **greyed out**, driven by
  `comment_disabled`/`duet_disabled`/`stitch_disabled`.
- **Commercial content disclosure toggle, default off.** When on, reveal two sub-options:
  - *Your Brand* → label "Promotional content" → maps to `brand_organic_toggle: true`
  - *Branded Content* → label "Paid partnership" → maps to `brand_content_toggle: true`
  - Branded Content **cannot** be private — if selected with `SELF_ONLY`, either disable
    that privacy option or force public. This is an explicit rule.
- **Compliance declaration text**, varying by selection:
  - Your Brand only → Music Usage Confirmation
  - Branded Content (with or without Your Brand) → Branded Content Policy **and** Music Usage Confirmation
- **Content preview** before publish. `QueuePage` already renders a `<video>` element for
  pieces with `video_url` — reuse it.
- **Duration validation** against `max_video_post_duration_sec` before allowing submit.
- **No Vantage watermark or promotional branding** burned into the video. Check DemoForge's
  render pipeline (`apps/demoforge/`) for any overlay before filming.

Suggested home: a `TikTokComposeModal` in `apps/web/src/pages/QueuePage.tsx`, opened from the
existing Publish button when `channel_slug === 'tiktok'`, replacing the current one-click
`vantageApi.publish(...)` path at `QueuePage.tsx:641-653`.

### 3c. Scheduler reconciliation (design decision)

`services/scheduler.ts` auto-publishes queued pieces with no human present. Direct Post
requires the settings above to be chosen by the user. Resolution used by every compliant
scheduling tool:

1. Capture all Direct Post settings **at approve/schedule time** in the compose modal.
2. Persist them on the content piece (`content_payload.tiktok_post_settings` — no migration
   needed, it is JSONB).
3. At publish time, **re-query `creator_info`** and validate the stored `privacy_level` is
   still in `privacy_level_options`. If not, fail the piece to `failed` with a clear reason
   rather than silently downgrading.
4. If no stored settings exist, refuse to auto-publish TikTok pieces. Do not fall back to a
   default — a default privacy level is itself a guideline violation.

### 3d. `video/init` payload (adapter fix)

Pass the captured settings through. `postTikTokVideo` currently sends `title` and
`privacy_level` only:

```ts
post_info: {
  title, privacy_level,
  disable_comment, disable_duet, disable_stitch,
  video_cover_timestamp_ms,
  brand_content_toggle, brand_organic_toggle,
  is_aigc,               // see 3e
}
```

### 3e. AIGC disclosure

Vantage generates video via DemoForge and scripts/images via LLM. TikTok has an explicit
`is_aigc` flag. Set it truthfully and surface it as a toggle in the compose modal
(pre-checked for DemoForge-rendered assets). Getting caught under-disclosing AI content is a
worse outcome than the checkbox.

### 3f. Chunked upload (correctness fix)

Current code always sends one chunk with `chunk_size = video_size`
(`adapters/tiktok.ts:181-183`). Actual rules:

- Max video size 4 GB
- Chunk min 5 MB, max 64 MB (final chunk may reach 128 MB), max 1000 chunks
- Whole-file single chunk is only correct for videos **under 5 MB**
- `total_chunk_count = floor(video_size / chunk_size)`
- Sequential `PUT`s; expect `206` per chunk and `201` on the last

A 60-second 1080×1920 render will exceed 5 MB routinely, so this path is wrong for most real
posts. Implement proper chunking.

Also note `PULL_FROM_URL` requires domain verification in the portal. The existing comment
in the adapter correctly rejects it for Supabase Storage — but if you ever verify a custom
storage domain, `PULL_FROM_URL` removes the fetch-then-upload round trip entirely.

### 3g. Publish progress in the UI

Guidelines: "poll status APIs so users see publication progress" and "notify users that
processing may take minutes." Today the poll loop is server-side and blocks the HTTP request
for up to 60s (`adapters/tiktok.ts:219`), and the UI shows nothing. Return `publish_id`
immediately, store it, and poll from the client with a visible status line.

### 3h. Disconnect / revoke (B5)

No revoke path exists. Add `DELETE /v1/channels/tiktok/auth` → `POST https://open.tiktokapis.com/v2/oauth/revoke/`
with `client_key`, `client_secret`, `access_token`, then clear `auth_state` and set
`enabled: false`. Wire to a Disconnect button on `ChannelsPage` (there is only a "disconnect
hint" comment at `ChannelsPage.tsx:397` today). Reviewers look for this, and your privacy
policy will promise it.

### 3i. Hardening (not review-gating, but do it)

- `savePendingOAuth` replaces the whole `auth_state`, destroying existing tokens when a user
  starts a reconnect and abandons it. Merge instead of overwrite.
- `pending_oauth.created_at` is written but never checked — expire states after ~10 minutes.
- Refresh tokens expire after 365 days. Nothing handles a dead refresh token; the channel
  will silently stop working. Mark the channel `needs_reauth` on refresh failure.
- Remove the stale "written from general API knowledge, not a fresh docs fetch" header
  comment once §3 lands — a reviewer who reads your repo should not find it.

---

## 4. Sandbox + demo video

First-time review **requires** a sandbox demo. Plan:

1. Create a sandbox in the Developer Portal; it issues its **own** client key/secret.
2. Add your test TikTok account as a sandbox target user.
3. Add a `TIKTOK_SANDBOX=true` style switch (or just a separate Railway environment) so
   `TIKTOK_CLIENT_KEY`/`SECRET`/`REDIRECT_URI` can point at sandbox creds for filming
   without touching production.
4. Sandbox posts land as private regardless of the privacy level chosen — that is expected
   and does not mean the flow is broken. Film it anyway; the compose UI is what is being
   graded.

### Video plan — 2 videos, not 5

**Video 1 — Login Kit + `user.info.basic` (~60s).** Open the browser on your real submitted
domain, address bar visible. Sign in to Vantage → Channels → click Connect on TikTok →
show the TikTok consent screen with the scope list → return to Vantage → show the connected
account card rendering avatar + display name (this is the `user.info.basic` proof, and the
reason §2 says to actually call it) → show the Disconnect button. **Then switch to a second
product and show its Channels screen with a different TikTok account connected.**
That single beat is what proves the app is a multi-brand operations platform and not one
person posting to their own account — it is the cheapest possible answer to B1, so do not
skip it.

**Video 2 — Content Posting API / Direct Post (~90s).** Queue → pick a piece with a rendered
video → open the compose modal → slowly show every required element: creator nickname,
editable caption, privacy selector opened with nothing pre-selected, the three interaction
toggles (including a greyed-out one if your test account has an interaction disabled),
commercial disclosure toggle off → on → Your Brand → Branded Content and the declaration
text changing → the video preview → click Post → the progress indicator polling → completion
→ then cut to the TikTok app showing the post in the account.

Rules that fail videos: domain in the address bar must match the submitted website URL; every
selected product and scope must appear; UI and interactions must be legible. Keep each under
50 MB — 1080p screen capture at a modest bitrate, no 4K.

---

## 5. Submission copy — draft for "explanation of each product and scope"

> **What Vantage is.** Vantage is the marketing operations platform we use to run organic
> social media for our portfolio of commercial software products — The Shift, Keystone,
> Scripta, DemoForge, and Vantage itself. Each product has its own brand voice, its own
> connected social accounts, and its own content pipeline: we draft short-form video and
> written posts for that brand, a team member reviews and approves each one, and Vantage
> publishes the approved post to that brand's connected accounts on the schedule the team
> sets. Each product's credentials and content are kept separate from the others'.
>
> **Login Kit — `user.info.basic`.** Used solely so a team member can connect a brand's TikTok
> account to that brand in Vantage and obtain the access token required for posting. We read
> `open_id`, `display_name`, and `avatar_url` and display them on the Channels screen, so that
> before anyone publishes it is unambiguous which TikTok account is linked to which brand —
> this matters specifically because we operate several accounts and must not post one brand's
> content to another brand's profile. The screen also offers a Disconnect action that revokes
> the token. We do not request or read follower data, video lists, or analytics.
>
> **Content Posting API (Direct Post) — `video.publish`.** This is the core of the
> integration. A brand's vertical short-form video is produced and approved in Vantage, and
> then posted to that brand's own TikTok account without leaving the product. Before the
> posting screen renders we call `creator_info/query` and use the live response to show the
> creator's nickname, offer only the privacy levels that account permits (with no pre-selected
> default), grey out any interaction setting the account has disabled, and validate the video
> against `max_video_post_duration_sec`. The team member writes the caption, chooses privacy,
> sets comment/duet/stitch, and discloses commercial content (Your Brand and/or Branded
> Content) with the corresponding Music Usage Confirmation and Branded Content Policy
> acknowledgements shown inline. Because our posts promote our own software products, the
> commercial disclosure is a routine part of this flow rather than an edge case. Content
> produced with generative tooling is flagged with `is_aigc`. After submission we poll
> `status/fetch` and show live progress, noting that processing can take a few minutes.
>
> **Why this enriches the experience.** Today the workflow is: export a rendered video file,
> move it to a phone, and retype the caption and posting settings by hand for each of several
> brand accounts. That loses the reviewed-and-approved caption, makes consistent scheduling
> impossible, and creates real risk of posting to the wrong brand's profile. Direct Post
> turns an approved draft into a live TikTok in one confirmed step, against an explicitly
> named account, with the same posting controls TikTok itself offers and no watermark or
> added branding on the video.

Two things to adjust before pasting: drop the AIGC sentence if you decide not to flag
content, and make the brand list match whatever is actually connected at review time — do
not name a product whose TikTok account the reviewer cannot see in the video.

---

## 6. Portal + config checklist

- [ ] App name, icon, description filled; no social-brand references
- [ ] `channels` product-scoped, with at least two products' TikTok accounts connected (§1) —
      this is the evidence for the non-personal-use claim
- [ ] Website URL live, with visible Terms and Privacy links in the footer
- [ ] Website describes the platform and names the products it manages; no pricing or signup
      promises that cannot be honoured
- [ ] `/terms` and `/privacy` return real content when **logged out** — they currently render
      from the DB via `legal.ts` and will show "This page has not been published yet" if the
      rows are empty. Write them.
- [ ] Privacy policy explicitly covers: TikTok tokens stored encrypted at rest, what is read
      (`open_id`, display name, avatar), that nothing is posted without explicit user action,
      retention, and how to revoke (§3h)
- [ ] Redirect URI registered and matching `TIKTOK_REDIRECT_URI` exactly
- [ ] Products: Login Kit + Content Posting API only
- [ ] Scopes: `user.info.basic`, `video.publish` only
- [ ] Sandbox created, target user added, flow rehearsed end to end
- [ ] Both demo videos recorded on the submitted domain, each <50 MB

---

## 7. Sequencing

0. **Decide the fate of `cursor/portfolio-marketing-91e2`** — land it or discard it. Every
   product-scoping decision below assumes its `product_slug` model. Doing this review's work
   on top of an architecture that then changes is wasted effort.
1. **Product-scope `channels` and connect ≥2 TikTok accounts** (§1) — gates the landing page,
   the submission copy, and the strongest beat in Video 1.
2. **Adapter work**: `creator_info`, `user/info`, revoke, full `post_info`, chunking (§3a, 3d, 3f, 3h).
3. **Compose modal** (§3b) — largest item, and nothing can be filmed before it exists.
4. **Scheduler settings persistence** (§3c) and progress UI (§3g).
5. **Legal content + landing page footer** (§1, §6).
6. **Sandbox setup, rehearse, record** (§4).
7. Submit.

Steps 2–4 are the real cost. Everything after is a day.
