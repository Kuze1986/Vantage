# Vantage — Canonical Feature Inventory

> **This file is the authoritative source of truth for what is built and what is planned.**
> Update it whenever a feature ships, changes, or is removed. The Phase 3A/3B plan below
> moves to the "Implemented" sections as each item lands.

---

## Table of Contents

1. [Authentication & Access](#1-authentication--access)
2. [Brand Voice](#2-brand-voice)
3. [Source Pipeline](#3-source-pipeline)
4. [Content Generation — Kuze](#4-content-generation--kuze)
5. [Content Audit — Ilita](#5-content-audit--ilita)
6. [Queue & Status Machine](#6-queue--status-machine)
7. [Publishing Adapters](#7-publishing-adapters)
8. [Cadence Engine](#8-cadence-engine)
9. [BioLoop Learning](#9-bioloop-learning)
10. [Channel Management](#10-channel-management)
11. [Webhook Receivers](#11-webhook-receivers)
12. [Newsletter Subscribers](#12-newsletter-subscribers)
13. [Music Library](#13-music-library)
14. [DemoForge Video Pipeline](#14-demoforge-video-pipeline)
15. [Dashboard](#15-dashboard)
16. [Content Queue Page](#16-content-queue-page)
17. [Settings Page](#17-settings-page)
18. [Activity Logging](#18-activity-logging)
19. [Database Infrastructure](#19-database-infrastructure)
20. [Social Kit](#20-social-kit)
21. [Sound Effects + Audio Mixer](#21-sound-effects--audio-mixer)
22. [Campaign Builder](#22-campaign-builder)
23. [Strategic Intelligence](#23-strategic-intelligence)
24. [Audience Model](#24-audience-model)
25. [BioLoop Virality Signals](#25-bioloop-virality-signals)
26. [Phase 3A — Gaps & Fixes](#phase-3a--gaps--fixes)
27. [Phase 3B — New Capabilities](#phase-3b--new-capabilities)
28. [Phase 3C — Creative Studio](#phase-3c--creative-studio)
29. [Phase 4 — SaaS Readiness](#phase-4--saas-readiness)

---

## Implemented Features

---

### 1. Authentication & Access

**What it does:**
Users sign in with email and password via Supabase Auth. On successful login the Supabase
session token (JWT) is stored in the browser. Every API call attaches it as a
`Bearer` token. The API's `authMiddleware` verifies it against the Supabase project's
JWT secret and rejects unauthenticated requests with 401.

**Multi-tenant (Phase 1/2a — see [Phase 4 — SaaS Readiness](#phase-4--saas-readiness)).**
The app is multi-tenant: data is partitioned by **workspace**. After authentication,
`workspaceGuard` resolves the request's workspace — from a validated, owned `x-workspace-id`
header, or the caller's default workspace if absent — and exposes it as `c.get("workspaceId")`
to every route. Authorization is by **membership**: `vantage.workspace_members` maps users to
workspaces with a role (`owner` / `admin` / `editor` / `viewer`), exposed as
`c.get("workspaceRole")`. Changing the header to a workspace the user is not a member of is
rejected with 403 (IDOR-safe). A user's first request lazily provisions a workspace, an owner
membership, and that workspace's nine channel rows.

Row-level security on all Supabase tables is enforced through the `authenticated` and
`service_role` Postgres roles, with workspace-scoped policies as a defense-in-depth backstop.
The `vantage-api` service uses the `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS; the API itself is
the enforcement point via `workspaceGuard` + per-query `workspace_id` scoping); the web app uses
the anon/user key which is RLS-restricted.

> Optional single-user lockdown: setting `BRANDON_USER_ID` pins the API to one Supabase user.
> **Unset it for any multi-user / multi-tenant deployment** or all other users get 403.

**Files:**
- `apps/api/src/lib/auth.ts` — JWT verification + `workspaceGuard` (membership-based)
- `apps/api/src/lib/workspace.ts` — workspace/membership provisioning, `getMembershipRole`, channel seeding
- `apps/api/src/routes/workspaces.ts` — `/v1/workspaces/me` + member management routes
- `apps/web/src/lib/WorkspaceContext.tsx` — fetches/creates the workspace, sends `x-workspace-id`
- `apps/web/src/lib/supabase.ts` — supabase-js singleton used by the web app
- `apps/web/src/pages/LoginPage.tsx` — email/password login form

**Configuration:** No env vars needed in the web app beyond `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. The API needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

---

### 2. Brand Voice

**What it does:**
A single-row configuration that defines NEXUS's brand identity and is injected into every
Kuze generation call. It shapes tone, topics to avoid, and per-channel style.

Fields:
- `name` — brand name (e.g. "NEXUS")
- `description` — one-paragraph identity statement
- `per_channel_tone` — JSONB object keyed by channel slug with tone instructions per platform
- `off_topics` — array of subjects Kuze must never write about

The configuration is saved to `vantage.brand_voice` and upserted on save (exactly one row
**per workspace** — `brand_voice` carries a `workspace_id` with a unique index). On every
generation call, the workspace's row is loaded and serialized to JSON, then passed to Kuze as
part of the user prompt.

**Files:**
- `apps/web/src/pages/VoicePage.tsx` — form UI
- `apps/api/src/routes/generate.ts` — loads brand_voice before calling Kuze
- `supabase/migrations/20260601000000_vantage_schema.sql` — table definition

**Configuration:** None required beyond Supabase credentials.

---

### 3. Source Pipeline

**What it does:**
Ingests topics from three sources into `vantage.topics` for Kuze to generate content from.
Each source has its own deduplication logic keyed on `source_ref`. The deduplication window
is configurable in Settings (default 30 days).

#### 3a. Shift (shift.questions)
Queries the `shift.questions` Postgres schema (separate Supabase project or schema).
Reads up to 500 rows, extracts topic text, vertical, and source ID from flexible column
naming (supports `question_text`, `body`, `text`, `title`, etc.). Topics are inserted with
`source_product = 'shift'` and `priority = 0`.

Can be filtered by active verticals — when a vertical allow-list is set in Settings, rows
whose vertical field doesn't match are skipped.

#### 3b. Scripta (scripta.lessons)
Queries the `scripta` Postgres schema. Tries multiple table names in order:
`lessons`, `lesson_content`, `items`, `content`. Uses the first table that returns rows.
Scripta topics get `priority = 1` (higher than Shift) because lesson content is
considered higher-quality source material. Can be disabled entirely via Settings.

#### 3c. Pulse Reactor
An external signal intake that pulls trending topics from three sources in parallel:
- **Hacker News** (top 30 stories): engagement score = `post_score + 2 × comments`,
  priority = `min(10, floor(engagement / 200))`
- **Reddit** (`r/all` + configured subreddits): engagement = `upvotes + 2 × comments`,
  priority = `min(10, floor(engagement / 1000))`. Filters out NSFW posts.
- **NewsAPI** (optional, requires `NEWS_API_KEY`): fixed priority 3
All signals get vertical inference via keyword matching across 12 verticals, 30-day dedup,
and are inserted with `source_product = 'pulse'`. Pulse topics are tagged visually in the
dashboard topic list with a ⚡ badge.

**Files:**
- `apps/api/src/services/source.ts` — Shift + Scripta
- `apps/api/src/services/pulse.ts` — Pulse Reactor
- `apps/api/src/routes/source.ts` — `/v1/source/refresh` and `/v1/source/pulse`
- `apps/api/src/lib/settings.ts` — dedup_days, active_verticals, scripta_enabled

**Configuration:** `NEWS_API_KEY` (optional for NewsAPI). Scripta/Shift require the
respective Postgres schemas to be accessible from the same Supabase instance.

---

### 4. Content Generation — Kuze

**What it does:**
Kuze is the AI copywriter. It takes a topic, the brand voice, and (optionally) BioLoop
performance weights, and returns a channel-formatted JSON content payload via the workspace's
configured LLM provider (Claude, GPT-4o, or Grok — see [Pluggable LLM Providers](#4-8--pluggable-llm-providers)).

**Supported formats and output schemas:**

| Channel | Format | Key fields |
|---|---|---|
| X | `tweet` | `body` (≤280 chars) |
| LinkedIn | `linkedin_post` | `body`, `headline` (optional) |
| Reddit | `reddit_thread` | `title`, `body`, `is_link_post` |
| Threads | `threads_post` | `body` (≤500 chars) |
| Bluesky | `bluesky_post` | `body` (≤300 chars) |
| Email | `email_newsletter` | `subject`, `preview_text`, `body` (HTML) |
| TikTok | `tiktok_script` | `hook`, `script`, `on_screen_text`, `instructions` |
| Instagram | `instagram_caption` | `caption`, `hashtags[]`, `alt_text`, `instructions` |
| Facebook | `facebook_post` | `text`, `instructions` |

**Generation weights:** Before each generation, Kuze loads up to 10 pattern weights ≥ 1.1
from `vantage.generation_weights` for the target channel. These are appended to the user
prompt as: `"Current performance weights (bias toward high-weighted patterns): <key>: <weight> (n=<samples>)"`.
Claude is instructed to favor patterns with higher weights.

**A/B variants:** The `variants` parameter (1–3) generates multiple pieces from the same
topic, all sharing a `variant_group_id` UUID. Each piece goes through the standard
auditing pipeline independently. Returns a different response shape when `variants > 1`.

**Image generation:** When `generate_image: true` is passed, after text generation,
DALL-E 3 is called with a prompt derived from the topic and vertical. The image URL is
stored in `content_pieces.image_url` and in `content_payload.image_url`. Aspect ratio
is chosen per channel: landscape (1792×1024) for X/LinkedIn/Facebook, square (1024×1024)
for Instagram/Reddit, portrait (1024×1792) for TikTok.

**UTM tagging:** After the piece is inserted (so the `piece.id` is known), all URL-like
strings in `content_payload` are tagged with `utm_source=<channel>`, `utm_medium=social`,
`utm_campaign=vantage`, `utm_content=<piece_id>`. The `tagUrls()` regex matches URLs
inside HTML `href` attributes (stops at `"`) so email HTML bodies are correctly tagged
at the adapter level before sending via Resend.

**Files:**
- `apps/api/src/services/kuze.ts` — main generation logic, weight loading
- `apps/api/src/lib/llm.ts` — per-task provider resolution (`resolveProvider("generate", …)`)
- `apps/api/src/services/imageGen.ts` — DALL-E 3 integration
- `apps/api/src/routes/generate.ts` — `POST /v1/generate/:channel`
- `packages/prompts/src/index.ts` — system and user prompt builders, format schemas
- `apps/api/src/lib/utm.ts` — URL tagging utility

**Configuration:** Kuze runs on the workspace's chosen generation provider (default Anthropic).
At least one provider key must be set — `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`,
default `claude-sonnet-4-6`), `OPENAI_API_KEY` (+ `OPENAI_MODEL`), and/or `GROK_API_KEY`. Image
generation additionally requires `OPENAI_API_KEY`. See [Pluggable LLM Providers](#4-8--pluggable-llm-providers).

---

### 5. Content Audit — Ilita

**What it does:**
Ilita is the AI brand-safety reviewer. It takes a content piece, its format, and the brand
voice, then calls the workspace's configured **audit** provider (Claude, GPT-4o, or Grok —
chosen independently of Kuze's generation provider) to assess whether the content passes NEXUS
brand guidelines.

Returns one of:
- `"pass"` — content is approved, moves to `approved` status
- `"fail"` — content is rejected; feedback string explains why

In the auto-approve pipeline, a fail triggers one automatic regeneration with the feedback
appended to the topic prompt. If the second attempt also fails, the piece is marked
`rejected`. The number of audit attempts is tracked in `audit_iterations`.

**Files:**
- `apps/api/src/services/ilita.ts` — audit logic (`auditContent` takes `workspace_id` to resolve the provider)
- `apps/api/src/lib/llm.ts` — `resolveProvider("audit", workspaceId)`
- `apps/api/src/routes/audit.ts` — `POST /v1/audit`

**Configuration:** Uses whichever provider is selected for the audit task (defaults to Anthropic).
See [Pluggable LLM Providers](#4-8--pluggable-llm-providers).

---

### 6. Queue & Status Machine

**What it does:**
Every content piece moves through a defined status machine stored in `content_pieces.status`:

```
draft → auditing → approved → queued → publishing → published
                └→ rejected              ↑   └→ (re)queued (retry / rate-limit)
                                          └→ failed (on publish error / retries exhausted)
```

- **draft** — generated but not yet audited (not used in current flow; pieces enter as `auditing`)
- **auditing** — pending Ilita review
- **approved** — passed audit, waiting for operator approval or auto-approve
- **queued** — approved and scheduled (`scheduled_for` timestamp set), waiting for cadence tick
- **publishing** — transient claim state (Phase 2c): a worker atomically claimed the piece
  (`queued → publishing` compare-and-swap) and is posting it. Released back to `queued` on
  retry/rate-limit or advanced to `published`/`failed`. A reaper re-queues pieces stuck here
  (stale `locked_at`) after a crashed worker.
- **published** — successfully sent to platform; `published_at` and `external_post_id` set
- **rejected** — failed audit twice in auto-approve, or manually rejected
- **failed** — publish attempt threw an error / retries exhausted; error stored in `audit_notes`

The `scheduled_for` field controls when the cadence tick will attempt publishing. It is
set either by the manual schedule endpoint or automatically by the auto-approve pipeline
based on the channel's `posting_hours` config.

**Files:**
- `apps/api/src/routes/schedule.ts` — `POST /v1/schedule`
- `apps/api/src/routes/audit.ts` — `POST /v1/audit` (transitions auditing → approved/rejected)
- `apps/api/src/routes/publish.ts` — `POST /v1/publish/:channel`
- `apps/api/src/routes/queue.ts` — `GET /v1/queue`

---

### 7. Publishing Adapters

**What it does:**
Each channel has an adapter that takes a `content_payload` and posts it to the platform.

> **Per-tenant credentials (Phase 2b).** Every adapter is scoped by `workspaceId`: OAuth
> tokens (and Bluesky's app-password session) live on the workspace's own `channels` row (keyed
> `(workspace_id, slug)`, in `auth_state.tokens`), and the email adapter sends only to that
> workspace's subscribers. Platform **app** credentials (client ids/secrets, `RESEND_API_KEY`)
> remain global env. The unauthenticated OAuth callback resolves which workspace a flow belongs
> to by matching the pending OAuth `state` across channel rows.

#### X (Twitter)
Posts via Twitter API v2 `POST /2/tweets`. Uses OAuth 2.0 access token stored in
`vantage.channels` (`access_token`, `refresh_token`, `token_expiry`). Handles the
PKCE OAuth flow. Returns the tweet `id`.

#### LinkedIn
Posts via LinkedIn UGC Posts API (`POST /v2/ugcPosts`). Constructs a `SHARE` post with
`specificContent.com.linkedin.ugc.ShareContent`. Supports optional headline. Returns
the post URN as ID.

#### Reddit
Posts via Reddit OAuth API (`POST /api/submit`). Routes to a configured subreddit.
Supports text posts (`kind: "self"`) and link posts (`kind: "link"`). Returns the post
`id`. Subreddit selection currently uses random choice from configured list.

#### Threads
Posts via the Meta Threads API (Graph-based). OAuth 2.0 with a short-lived → long-lived
(~60-day) token exchange and auto-refresh. Publishing is two-step: create a text media
container (`POST /{user-id}/threads`), then publish it (`POST /{user-id}/threads_publish`).
Returns the media `id`. Text capped at 500 chars.

#### Bluesky
Posts via the AT Protocol (not OAuth). The workspace connects with a handle + **app password**
(`com.atproto.server.createSession`); the session JWTs are stored on the channel row and
refreshed on expiry. Publishing writes an `app.bsky.feed.post` record via
`com.atproto.repo.createRecord`. Returns the post rkey. Text capped at 300 chars.

#### Email
Sends via Resend API to the workspace's active subscribers (where `workspace_id` matches and
`unsubscribed_at IS NULL`).
Fetches subscriber list, sends one email per subscriber via Resend's single-send endpoint.
Runs `tagUrls()` on the HTML body before sending so all `<a href="...">` links carry UTM
parameters. Returns the Resend message ID.

#### TikTok / Instagram / Facebook (manual)
No direct API publish. These adapters package the `content_payload` into a structured
object with platform-specific fields and upload instructions. The piece is marked
`manual: true` in the publish response. The operator pastes the external URL after
manual upload; this URL is stored as `external_post_id`.

**Files:**
- `apps/api/src/adapters/x.ts`
- `apps/api/src/adapters/linkedin.ts`
- `apps/api/src/adapters/reddit.ts`
- `apps/api/src/adapters/threads.ts`
- `apps/api/src/adapters/bluesky.ts`
- `apps/api/src/adapters/email.ts`
- `apps/api/src/adapters/tiktok.ts`
- `apps/api/src/adapters/instagram.ts`
- `apps/api/src/adapters/facebook.ts`
- `apps/api/src/routes/publish.ts`

**Configuration:** Channel-specific OAuth tokens stored in `vantage.channels`. Resend
requires `RESEND_API_KEY`. Email sender configured via `RESEND_FROM_EMAIL`.

---

### 8. Cadence Engine

**What it does:**
A scheduler that runs four recurring ticks in a single Node.js process. Started at API
boot via `startCadenceEngine()`. Every tick **iterates all workspaces** and operates per-tenant
(loading that workspace's channels/voice/settings, scoping every query by `workspace_id`).

#### Cadence tick (every 60 seconds)
For each workspace, queries `content_pieces` for pieces with `status = 'queued'` and
`scheduled_for ≤ now`. Before publishing, it **atomically claims** each piece
(`queued → publishing` compare-and-swap, Phase 2c) so a slow tick or a second API instance can
never double-publish; a reaper first re-queues pieces left in `publishing` past a stale lock
window. For each claimed piece, calls the appropriate channel adapter. On success: status →
`published`, records `published_at` and `external_post_id`. On retry/rate-limit: released back
to `queued` with backoff. On exhausted retries: `failed`. Processes up to 20 pieces per
workspace per tick.

#### Auto-generate tick (every 5 minutes)
For each enabled channel with `auto_approve: true`, calculates the deficit between
`posts_per_day` and pieces already published today. Generates up to 3 pieces per channel
per tick to fill the deficit. Each piece is:
1. Generated by Kuze
2. Audited by Ilita
3. If pass: marked `queued` with `scheduled_for` set from `posting_hours` config
4. If fail: regenerated once with feedback; second result is `approved` or `rejected`

#### Pulse tick (every 30 minutes)
Calls `refreshTopicsFromPulse()` — fetches HN, Reddit, and optionally NewsAPI signals,
deduplicates, and inserts new pulse topics. Loads subreddit list from the Reddit channel's
`cadence_config`.

#### BioLoop (Supabase Edge Function — daily at 02:00 UTC)
Runs as `supabase/functions/bioloop/index.ts` on a pg_cron schedule. Iterates every workspace
and runs `runBioLoop()` + `identifyEvergreenTopics()` for each whose `bioloop_enabled` setting
is true. Can also be triggered manually (for the caller's workspace) via the Dashboard 🧬
BioLoop button or `POST /v1/bioloop/run`.

**Files:**
- `apps/api/src/services/scheduler.ts`

---

### 9. BioLoop Learning

**What it does:**
A closed-loop feedback system that updates `vantage.generation_weights` based on
engagement data, biasing future Kuze generations toward patterns that perform well.

**Pattern extraction** (13 signals per piece):
- `length_short` / `length_medium` / `length_long` (body char count buckets: <150 / 150-400 / >400)
- `has_question` — body contains `?`
- `has_cta` — body contains action words (try, join, click, visit, learn, etc.)
- `has_numbers` — body contains digits
- `has_hashtags` — body contains `#` or hashtags array is populated
- `opener_emotional` — first 40 chars match emotional hooks (imagine, what if, did you know, etc.)
- `opener_question` — body starts with interrogative (what, how, why, when, etc.)
- `opener_number` — body starts with a digit
- `tweet_punchy` — tweet format and body < 120 chars
- `linkedin_has_headline` — LinkedIn post has a headline field
- `tiktok_strong_hook` — TikTok script has a hook field
- `angle_how_to` — body contains instructional language (tip, trick, step, guide, how to)
- `angle_data_driven` — body contains research language (stat, data, study, report, survey)
- `angle_personal_story` — body contains personal narrative language (story, when I, my, I learned)

**Weight calculation:**
1. For each channel, compute baseline engagement rate (% of published pieces with any engagement events in 7d)
2. For each pattern, compute `engaged_rate = pieces_with_pattern_AND_engagement / pieces_with_pattern`
3. `raw_weight = engaged_rate / baseline_rate` (clamped to 0.5–2.0)
4. Apply EWMA smoothing: `weight = 0.3 × raw_weight + 0.7 × existing_weight`
5. Skip patterns with fewer than 2 sample pieces
6. Upsert into `generation_weights` with `sample_size` and `last_updated`

Patterns with weight ≥ 1.1 are loaded by Kuze and appended to the generation prompt.
Claude is instructed to bias toward these patterns.

**Manual trigger:** Dashboard has a 🧬 BioLoop button that calls `POST /v1/bioloop/run`.
Weights can be inspected via `GET /v1/bioloop/weights?channel=<slug>`.

**Files:**
- `apps/api/src/services/bioloop.ts`
- `apps/api/src/routes/bioloop.ts`

---

### 10. Channel Management

**What it does:**
Manages the nine distribution channels and their per-channel configuration.

**OAuth channels** (X, LinkedIn, Reddit, Threads): Full OAuth 2.0 flow (X uses PKCE).
- `POST /v1/channels/:slug/auth/start` — generates the authorization URL (+ code verifier for X)
- `GET /v1/channels/:slug/auth/callback` — dispatches by slug, exchanges code for tokens, stores
  them in the workspace's `channels` row under `auth_state.tokens`
- `connected` status = whether `auth_state.tokens` is present (falls back to the legacy
  `access_token_hash` column)

**App-password channel** (Bluesky): No OAuth redirect. The workspace connects with a handle +
app password via `POST /v1/channels/:slug/connect`; the AT Protocol session is stored under
`auth_state.tokens` and refreshed on expiry.

**API key channel** (Email): No OAuth; credentials are server-side env vars only. The
email channel row in `vantage.channels` tracks `enabled` and `cadence_config` but has no
stored token.

**Manual channels** (TikTok, Instagram, Facebook): No authentication. Channel exists in
`vantage.channels` to hold cadence config. Content is generated but posted manually.

**Cadence config** (per channel):
- `posts_per_day` — target daily volume for auto-generate
- `posting_hours` — array of UTC hours to schedule posts (e.g. `[9, 12, 17]`)
- `auto_approve` — when true, Ilita-passing content goes straight to publish queue
- `subreddits` — array of subreddit names (Reddit only)
- `newsletter_day` — day of week for email newsletters (Email only)

**Files:**
- `apps/api/src/routes/channels.ts`
- `apps/api/src/routes/oauth-callback.ts`
- `apps/web/src/pages/ChannelsPage.tsx`

---

### 11. Webhook Receivers

**What it does:**
Receives platform engagement events and stores them in `vantage.engagement_events`,
linking to `content_pieces` via `external_post_id` ↔ `content_piece_id`.

> **Workspace attribution (Phase 1).** Webhooks are unauthenticated, so each handler derives
> the `workspace_id` from the matched content piece (via `external_post_id`) and stamps the
> engagement row with it. Events that match no piece are acknowledged (200) but **not** written,
> since `engagement_events` is workspace-scoped and an unattributable event has no owner.

#### X webhook (`GET /v1/webhooks/x`)
Handles the CRC challenge-response required by Twitter's Account Activity API.
Computes `HMAC-SHA256(crc_token, X_WEBHOOK_SECRET)` and returns as `response_token`.

#### X webhook (`POST /v1/webhooks/x`)
Verifies the `x-twitter-webhooks-signature` header: `sha256=HMAC-SHA256(X_CONSUMER_SECRET, rawBody)`.
Rejects unverified payloads with 401. Parses the payload, extracts `event_type` and
`tweet_id`, looks up the matching content piece, and inserts into `engagement_events`.

#### LinkedIn webhook (`GET /v1/webhooks/linkedin`)
Echoes back `challengeCode` for LinkedIn subscription verification.

#### LinkedIn webhook (`POST /v1/webhooks/linkedin`)
Verifies `x-li-signature` header: `HMAC-SHA256(LINKEDIN_WEBHOOK_SECRET, body)` as base64.
Extracts `shareId`, looks up content piece, inserts engagement event.

#### Reddit webhook (`POST /v1/webhooks/reddit`)
No signature verification (Reddit has no native webhook push). Accepts manually
forwarded events or events from third-party Reddit monitoring services. Inserts event.

#### Email webhook (`POST /v1/webhooks/email`)
Verifies Resend/Svix signature: `HMAC-SHA256(RESEND_WEBHOOK_SECRET, "${timestamp}.${body}")`.
Handles multiple signatures in the `svix-signature` header (space-separated).
Inserts email delivery/open/click events.

**Files:**
- `apps/api/src/routes/webhooks.ts`

**Configuration:** `X_WEBHOOK_SECRET` (or `X_CLIENT_SECRET`), `LINKEDIN_WEBHOOK_SECRET`,
`RESEND_WEBHOOK_SECRET`.

---

### 12. Newsletter Subscribers

**What it does:**
Manages the email distribution list for the email channel.

- `GET /v1/subscribers` — lists all subscribers, ordered by `subscribed_at` descending
- `POST /v1/subscribers` — adds or reactivates a subscriber (upsert on email; sets
  `unsubscribed_at = null` if previously unsubscribed). Accepts `email`, `name`, `tags[]`.
- `DELETE /v1/subscribers/:id` — soft delete; sets `unsubscribed_at` to now.
  The subscriber row is retained for audit purposes.

Active subscribers (where `unsubscribed_at IS NULL`) are the send list when the email
adapter publishes a newsletter piece.

The subscriber management UI lives in the Channels page — it appears when the Email
channel tile is expanded, below the CadenceForm.

**Files:**
- `apps/api/src/routes/subscribers.ts`
- `apps/web/src/pages/ChannelsPage.tsx` — `SubscribersPanel` component
- `supabase/migrations/20260603000000_newsletter_subscribers.sql`

---

### 13. Music Library

**What it does:**
A registry of royalty-free background music tracks used by DemoForge video generation.
Tracks are stored as records in `vantage.music_tracks`; the actual audio files live in
the `vantage-media` Supabase Storage bucket at the path specified in `storage_path`.

Fields per track: `title`, `artist`, `mood` (upbeat / calm / inspirational / corporate /
energetic / ambient), `use_case` (intro / background / outro / general), `duration_secs`,
`bpm`, `storage_path`.

Tracks are manually uploaded to Supabase Storage and registered via `POST /v1/music`.
Can be filtered by mood and use_case. DemoForge jobs reference a `music_track_id` and
the processor downloads the file from Storage for mixing.

**Files:**
- `apps/api/src/routes/music.ts`
- `supabase/migrations/20260604000000_phase2.sql`

---

### 14. DemoForge Video Pipeline

**What it does:**
A separate Railway service (`apps/demoforge`) that produces platform-formatted marketing
videos from a structured script + URL input. The pipeline is a full creative studio:
overlays, auto-captions, color grading, intro/outro sequences, and timeline controls are
all applied in post-processing by FFmpeg before upload.

**Pipeline steps:**
1. **Timeline pre-pass** — if `timeline_config.target_duration_sec` is set, all script step
   `ms` values are scaled proportionally so the recording hits the target length before
   Playwright is invoked.
2. **Record** — Playwright launches a headless Chromium browser at the target URL,
   executes script steps (navigate / click / fill / wait / scroll / narrate), and
   records the session as a WebM video.
3. **Synthesize** — a pluggable `TtsProvider` (see below) converts all `narration` fields
   into audio + per-word timing data. Word timings feed the auto-caption generator.
   Provider is selectable per job (`tts_provider`) or via `DEMOFORGE_TTS_PROVIDER`
   (default `elevenlabs`); voice/profile is configurable per job.
4. **Caption generation** — if `caption_config.enabled`, an ASS subtitle file is produced
   from the word timings. Supports per-word karaoke highlight, font/size/color/position,
   and optional background box.
5. **Mix** — FFmpeg `complexFilter` chain:
   - Trim (`trim=start/end + setpts=PTS-STARTPTS`) if `trim_start_sec`/`trim_end_sec` set.
   - Scale + pad to platform dimensions (always in `complexFilter`, not `-vf`, to allow chaining).
   - Global speed (`setpts=PTS/N` on video; chained `atempo` on audio) if multiplier ≠ 1.
   - Text overlays (`drawtext`) and logo overlays (`overlay`) from `overlays[]`.
   - Caption burn (`subtitles=captions.ass`) if caption file generated.
   - Color grade (`eq` + `colorbalance` preset or custom) if `color_grade` set.
   - Audio mix: narration + background music + sound effects → amix → master volume.
   - Outputs to platform dimensions:
     - TikTok: 1080×1920 (9:16 portrait)
     - Instagram Reels: 1080×1920 (9:16 portrait)
     - LinkedIn: 1920×1080 (16:9 landscape)
6. **Intro/Outro concat** — if `intro_clip_id` or `outro_clip_id` set, clips are downloaded
   from storage, normalized to match the main video's dimensions/codecs, and concatenated
   using FFmpeg `concat` filter.
7. **Keyframe extraction** — 5 frames are extracted at evenly-spaced timestamps and uploaded
   to storage as PNG previews (`demoforge/frames/<job_id>/frame-N.png`).
8. **Upload** — final MP4 uploaded to `vantage-media` at `demoforge/<format>/<job_id>.mp4`.

**Job lifecycle:** `pending → recording → synthesizing → mixing → done / failed`.
Processing is sequential (one job at a time) to avoid overloading the Railway worker.

**Script step types:**
- `navigate` — load a URL
- `click` — click a CSS selector
- `fill` — type into a field
- `wait` — pause N milliseconds (scalable via target duration)
- `scroll` — scroll down 300px
- `narrate` — pause for narration (audio-only, no browser action)
- `eval` — run arbitrary JS via `addInitScript` (fires on every navigation)

Each step supports `speed_multiplier` (0.5–2×) when `timeline_config.per_step_speed` is enabled.

---

#### 14-P1 — Video Overlays ✅ Shipped

Text and logo/image overlays burned into the video at configurable positions and times.

**`input_payload.overlays[]`** — up to 10 overlays per job:
- `type: "text"` — content, font (mono/sans/display), size, color, optional semi-transparent box; position by anchor (left/center/right × top/center/bottom) + pixel offset; optional start/end seconds.
- `type: "image"` — references a Brand Kit by `brand_kit_id`; logo is downloaded from Supabase Storage and scaled to `width`; same position + timing controls.

**Brand Kits** (`vantage.brand_kits`, `GET/POST/PATCH/DELETE /v1/brand-kits`): workspace-scoped logo, primary/secondary/accent colors, heading/body font preferences. Used by image overlays and as a workspace default.

**Frontend:** `OverlayEditor.tsx` — collapsible panel, per-overlay row, count badge.

**Files:**
- `apps/demoforge/src/jobs/processor.ts` — `buildTextOverlayFilter()`, `buildImageOverlayFilter()`, logo download, complexFilter chain
- `apps/api/src/routes/brand-kits.ts` — brand kit CRUD
- `apps/web/src/creative/OverlayEditor.tsx`
- `supabase/migrations/20260715000000_brand_kits.sql`

---

#### 14-P2 — Auto-Captions ✅ Shipped

Narration-synced subtitles burned into the video as ASS format.

**`input_payload.caption_config`:**
- `enabled: boolean` — master toggle
- `font_family` — `"mono"` | `"sans"`
- `font_size` — default 56px portrait / 40px landscape
- `primary_color`, `outline_color` — hex
- `background` — semi-transparent box behind text
- `position` — `"top"` | `"center"` | `"bottom"`
- `word_highlight` — karaoke-style current-word color via ASS `\kf` tags
- `highlight_color` — hex, default `#FFFF00`
- `max_words_per_line` — default 4 portrait / 6 landscape

Word timings depend on the TTS provider: **ElevenLabs** returns real character-level
timing (`textToSpeech.convertWithTimestamps()` → `charAlignmentToWordTimings()` groups
characters into word boundaries); **Voicebox** returns none, so `evenWordTimings()`
approximates them by spreading words across each line's known duration (weighted by
word length). Either way `generateCaptionASS()` writes the `.ass` file and FFmpeg
`subtitles=` burns it in.

**Frontend:** `CaptionStyler.tsx` — enable toggle, font/color/position/background/highlight controls, live mini-preview bar.

**Files:**
- `apps/demoforge/src/jobs/processor.ts` — `synthesizeNarration()`, `charAlignmentToWordTimings()`, `evenWordTimings()`, `hexToAssColor()`, `formatAssTime()`, `generateCaptionASS()`
- `apps/web/src/creative/CaptionStyler.tsx`

---

#### 14-P6 — Pluggable TTS Providers ✅ Shipped

Narration synthesis goes through a `TtsProvider` interface, selectable per job
(`input_payload.tts_provider`) or via the `DEMOFORGE_TTS_PROVIDER` env var (default
`elevenlabs`).

- **`ElevenLabsProvider`** (cloud) — `textToSpeech.convertWithTimestamps()`, real
  character-level timings, voice via `voice_id`. The production/cloud path.
- **`VoiceBoxProvider`** (local, self-hosted **Qwen3-TTS voice cloning**) — calls the
  Voicebox FastAPI server (`VOICEBOX_API_URL`, default `http://127.0.0.1:17493`):
  `POST /generate` → poll `GET /generate/{id}/status` → `GET /audio/{id}`. Voices are
  **profiles** (`VOICEBOX_PROFILE_ID`); no timing data, so captions use `evenWordTimings()`.
  Local/self-hosted deployments only (server binds to localhost).

**Prerequisites for Voicebox:** the app must be running with a model downloaded + loaded
(`GET /health → model_loaded:true`) and at least one voice profile created. If the server
is unreachable or the model isn't loaded, DemoForge logs a warning and produces a silent
video (same graceful degradation as ElevenLabs running out of credits).

**Files:**
- `apps/demoforge/src/jobs/processor.ts` — `TtsProvider`, `ElevenLabsProvider`, `VoiceBoxProvider`, `evenWordTimings()`, `getTtsProvider()`
- `apps/demoforge/src/jobs/queue.ts`, `apps/demoforge/src/index.ts`, `apps/api/src/routes/demoforge.ts` — `tts_provider` field

---

#### 14-P3 — Color Grading ✅ Shipped

Named-preset and fully-custom color grade applied after overlays and captions in the filter chain.

**`input_payload.color_grade`:**
- `preset` — `"clean"` | `"warm"` | `"cinematic"` | `"vibrant"` | `"muted"` | `"cool"` | `"dark"`
- `custom` — `brightness` (-1–1), `contrast` (0.5–2), `saturation` (0–3), `red_gain`/`green_gain`/`blue_gain` (-0.5–0.5), `gamma` (0.1–10)

Presets are implemented as `eq` + `colorbalance` FFmpeg filter combinations. Custom values override preset defaults field-by-field. `clean` with no custom values produces no filter (identity pass).

**Frontend:** `ColorGrader.tsx` — 4-column preset tile grid with gradient swatches, expandable 7-slider custom adjustment panel, active override badge in header.

**Files:**
- `apps/demoforge/src/jobs/processor.ts` — `buildColorGradeFilter()`, preset tables `PRESET_EQ` / `PRESET_COLORBALANCE`
- `apps/web/src/creative/ColorGrader.tsx`

---

#### 14-P4 — Intro / Outro Sequences ✅ Shipped

Branded clip bookends prepended/appended to the main recording.

**`input_payload`:** `intro_clip_id?: string`, `outro_clip_id?: string`

Clips live in `vantage.intro_outro_clips` (`type` in/outro/both, `target_format` tiktok/linkedin/instagram/all, `storage_path`, optional `brand_kit_id`, optional `preview_url` GIF). `workspace_id` nullable = global library entry. Each clip is downloaded from storage, normalized to the job's target dimensions via a dedicated `normalizeClip()` pass (scale + guaranteed AAC audio track), then concatenated using FFmpeg `concat=n=N:v=1:a=1`.

**API:** `GET/POST/PATCH/DELETE /v1/intro-outro-clips` — `GET` supports `?format=&type=` and returns workspace clips + global library entries.

**Frontend:** `SequencePicker.tsx` — collapsible panel, intro + outro sections, 4-column clip tile grid, GIF preview support, format-filtered, toggle-to-deselect.

**Files:**
- `apps/demoforge/src/jobs/processor.ts` — `normalizeClip()`, `concatSequences()`
- `apps/api/src/routes/intro-outro-clips.ts`
- `apps/web/src/creative/SequencePicker.tsx`
- `supabase/migrations/20260720000000_intro_outro_clips.sql`

---

#### 14-P5 — Timeline Controls ✅ Shipped

Target duration, trim, and global speed multiplier applied across the full video + audio pipeline.

**`input_payload.timeline_config`:**
- `target_duration_sec` — pre-recording: scales all step `ms` values by `target / Σ(ms)` so the browser recording hits the target length
- `trim_start_sec` — cuts the first N seconds of the recording (`trim=start=N,setpts=PTS-STARTPTS`)
- `trim_end_sec` — keeps only up to this timestamp (`trim=end=N`)
- `global_speed_multiplier` — 0.25–4×; video uses `setpts=PTS/N`; audio uses chained `atempo` (single filter for 0.5–2; chained for extremes)
- `per_step_speed` — enables `speed_multiplier` field on each `ScriptStep` (UI column in Script Steps panel)

**Frontend:** `TimelineEditor.tsx` — target duration input + Best fit button (pre-fills from `Σ(step.ms)/1000`), trim start/end inputs, global speed section with 6 preset buttons (0.5×–2×) + fine-tune slider (0.25–4×), per-step speed opt-in toggle.

**Files:**
- `apps/demoforge/src/jobs/processor.ts` — `applyTargetDuration()`, `buildAtempoChain()`, trim/speed in `mixVideo()`
- `apps/web/src/creative/TimelineEditor.tsx`

---

**API (internal, called via vantage-api proxy):**
- `POST /jobs` — submit a job, returns `job_id` immediately (202)
- `GET /jobs/:id` — poll status

**vantage-api proxy endpoints:**
- `POST /v1/demoforge/jobs`
- `GET /v1/demoforge/jobs/:id`
- `GET /v1/demoforge/jobs` (lists recent jobs from DB)
- `GET/POST/PATCH/DELETE /v1/brand-kits`
- `GET/POST/PATCH/DELETE /v1/intro-outro-clips`

The DemoForge job submission UI lives at `/demoforge` in the web app (`DemoForgePage.tsx`).
Creative studio panels render in order: Overlays → Captions → Color Grade → Intro/Outro → Timeline → Audio Mixer.

**Core files:**
- `apps/demoforge/src/index.ts` — Hono server + job schema validation
- `apps/demoforge/src/jobs/queue.ts` — in-process job queue + all payload types
- `apps/demoforge/src/jobs/processor.ts` — full pipeline orchestration + FFmpeg filter chain
- `apps/demoforge/Dockerfile`
- `apps/api/src/routes/demoforge.ts` — vantage-api proxy
- `apps/api/src/routes/brand-kits.ts` — brand kit CRUD
- `apps/api/src/routes/intro-outro-clips.ts` — clip library CRUD
- `apps/web/src/pages/DemoForgePage.tsx` — main UI
- `apps/web/src/creative/OverlayEditor.tsx`, `CaptionStyler.tsx`, `ColorGrader.tsx`, `SequencePicker.tsx`, `TimelineEditor.tsx`
- `supabase/migrations/20260715000000_brand_kits.sql`
- `supabase/migrations/20260720000000_intro_outro_clips.sql`

**Configuration (DemoForge service):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`ELEVENLABS_API_KEY`, `DEMOFORGE_SECRET` (shared with vantage-api), `PORT`.
**Configuration (vantage-api):** `DEMOFORGE_URL`, `DEMOFORGE_SECRET`.

---

### 15. Dashboard

**What it does:**
The primary operator view. Loads on login and auto-updates via Supabase realtime.

**Stat cards:**
- Published Today — total across all channels vs. combined daily target
- Auditing — pieces awaiting review
- Ready to Post — approved + queued pieces
- Topics Available — unused topics in the pipeline

**Source Pipeline panel (left):**
- 🧬 BioLoop button — manually triggers `POST /v1/bioloop/run`, reports pieces analyzed and weights updated
- ⚡ Pulse Reactor button — manually triggers external signal scan
- Channel selector — pick which channel to generate for (𝕏, in, r/, ✉, ♪, ◉, f)
- `+ Image (DALL·E 3)` checkbox — generates an image alongside text (single variant only)
- Variant selector — `1×` (single), `A/B ×2`, `A/B ×3`; A/B pieces share a `variant_group_id`
- Topic list — shows all loaded topics with vertical tag, ⚡ pulse badge for pulse-sourced
  topics, ♻ evergreen badge for recycled topics, and a per-topic generate button whose label
  reflects the active channel, image, and variant settings

**Live Activity panel (right):**
- Real-time feed of `activity_events` inserted in the last 24h, auto-updated via
  Supabase `postgres_changes` subscription

**Channel Cadence panel:**
- Grid of all configured channels with today's publish count vs. daily target and
  connection status badge

**Queue Breakdown panel:**
- Count of pieces in each status

**Top Pieces — 7d panel:**
- Top 5 published pieces from the last 7 days ranked by engagement event count,
  with channel, date, engagement count, and content preview

**Files:**
- `apps/web/src/pages/DashboardPage.tsx`
- `apps/api/src/routes/dashboard.ts` — `GET /v1/dashboard/overview`

---

### 16. Content Queue Page

**What it does:**
Lists all content pieces with filter tabs by status. Operators review, audit, and
dispatch pieces from this page.

**Filter tabs:** all / auditing / approved / queued / published / rejected / failed

**Per-piece actions:**
- **Audit** — runs Ilita review; transitions auditing → approved or rejected
- **Queue** — schedules an approved piece for cadence dispatch (calls `/v1/schedule`)
- **Publish** — immediately publishes an approved/queued piece for API channels
- **Manual channels** — shows a URL input to paste the post link after manual upload;
  clicking "Mark Published" calls `/v1/publish/:channel` with the URL

**Per-piece display:**
- Content preview (body / text / hook / title / caption depending on format)
- Ilita audit notes
- A/B variant badge (if `variant_group_id` is set)
- Image thumbnail (if `image_url` is set — DALL-E 3 generated)
- **Video script panel** (TikTok / Instagram / Facebook only): expandable section showing
  hook, script, on-screen text, hashtags, and upload instructions. One-click copy-to-clipboard.

**Files:**
- `apps/web/src/pages/QueuePage.tsx`
- `apps/api/src/routes/queue.ts` — `GET /v1/queue`

---

### 17. Settings Page

**What it does:**
Live pipeline configuration. All values are read from and written to `vantage.settings`
via `GET /v1/settings` and `PATCH /v1/settings`. Changes take effect on the next
pipeline tick — no restart required.

**Configurable settings:**

| Setting | Type | Default | Effect |
|---|---|---|---|
| `dedup_days` | integer (1–365) | 30 | Topic deduplication window. A source_ref seen within this many days is skipped on re-pull. |
| `scripta_enabled` | boolean | true | When false, `refreshTopicsFromScripta()` returns immediately without querying the scripta schema. |
| `bioloop_enabled` | boolean | true | When false, the daily BioLoop scheduler tick logs "skipped" and exits without running. |
| `active_verticals` | string[] | [] (all) | When non-empty, Shift topics whose `vertical` field is not in this list are skipped during pull. Pulse topics are not filtered. |
| `llm_provider_generate` | string | "" (inherit) | Provider for content generation (Kuze): `anthropic` \| `openai` \| `grok`, or "" to inherit the `LLM_PROVIDER_GENERATE`/`LLM_PROVIDER` env default. |
| `llm_provider_audit` | string | "" (inherit) | Provider for compliance audit (Ilita): same values, chosen independently of generation. |

The Settings page renders an **AI Providers** panel with a per-task dropdown for each; a provider
is only selectable when its API key is configured server-side (surfaced via
`GET /v1/settings/llm-providers`). See [Pluggable LLM Providers](#4-8--pluggable-llm-providers).

**Non-configurable here (live in Channels page):**
- Auto-approve toggle — per-channel in CadenceForm
- Posting cadence (posts_per_day, posting_hours) — per-channel in CadenceForm

**Files:**
- `apps/web/src/pages/SettingsPage.tsx`
- `apps/api/src/routes/settings.ts`
- `apps/api/src/lib/settings.ts`
- `apps/api/src/lib/llm.ts` + `apps/api/src/lib/llm-providers/*`
- `supabase/migrations/20260605000000_settings.sql`

---

### 18. Activity Logging

**What it does:**
Every meaningful pipeline event writes a row to `vantage.activity_events`. This provides
a complete audit trail visible in the Dashboard live feed and queryable for debugging.

**Fields:**
- `source` — e.g. `"kuze"`, `"ilita"`, `"scheduler"`, `"adapter:x"`, `"bioloop"`
- `source_type` — `"agent"`, `"adapter"`, or `"system"`
- `event_type` — e.g. `"generated"`, `"auto_approved_queued"`, `"cadence_published"`, `"bioloop_complete"`
- `summary` — human-readable one-liner
- `payload` — JSONB with relevant IDs and context
- `drill_uri` — optional relative URL for deep-linking (e.g. `/queue?piece=<id>`)
- `occurred_at` — timestamp

**Files:**
- `apps/api/src/lib/activity.ts` — `logActivity()` helper
- `supabase/migrations/20260601000000_vantage_schema.sql` — table definition

---

### 19. Database Infrastructure

**What it does:**
All application data lives in the `vantage` Postgres schema on Supabase. PostgREST
exposes only the `public` schema by default, so auto-updatable views in `public` proxy
every `vantage.*` table for RLS-compatible read/write access.

**Tenancy:** `vantage.workspaces` is the tenant root and `vantage.workspace_members` maps
users → workspaces with roles. Every core table carries a `workspace_id` (NOT NULL, FK to
`workspaces`), so all tenant data is partitioned by workspace. `channels` is keyed
`(workspace_id, slug)` and `settings` `(workspace_id, key)`; `content_pieces` /
`generation_weights` use composite FKs to `channels`. `music_tracks` and `sound_effects` are a
shared global library (no `workspace_id`).

**Core tables** (all workspace-scoped unless noted):
- `vantage.workspaces` — tenant root (owner, name, slug). (A legacy `llm_provider` column and
  a `preferred_llm_provider` settings key exist from earlier scaffolding but are **not** read by
  the wired path; the active choice lives in the `llm_provider_generate`/`llm_provider_audit`
  settings keys — see [Pluggable LLM Providers](#4-8--pluggable-llm-providers).)
- `vantage.workspace_members` — user↔workspace roles (owner/admin/editor/viewer)
- `vantage.channels` — channel config, per-tenant tokens, cadence — PK `(workspace_id, slug)`
- `vantage.topics` — ingested source topics
- `vantage.content_pieces` — generated content with full status history (+ `locked_at` claim lock)
- `vantage.engagement_events` — platform engagement signals
- `vantage.activity_events` — pipeline audit log (`workspace_id` nullable for system events)
- `vantage.brand_voice` — brand identity config (one row per workspace)
- `vantage.generation_weights` — BioLoop pattern weights
- `vantage.newsletter_subscribers` — email list (unique email per workspace)
- `vantage.music_tracks` — DemoForge music registry (shared/global)
- `vantage.demoforge_jobs` — video generation job queue
- `vantage.settings` — pipeline configuration — PK `(workspace_id, key)`

**Public views:** Each table has a `CREATE OR REPLACE VIEW public.<table> AS SELECT * FROM vantage.<table>`.
Postgres auto-updatable views pass INSERT/UPDATE/DELETE/RETURNING through to the base
table including defaults and FK constraints.

**Migrations:**
- `20260601000000_vantage_schema.sql` — base schema
- `20260601000100_vantage_storage.sql` — Supabase Storage bucket
- `20260602000000_vantage_public_views.sql` — public views for original tables
- `20260603000000_newsletter_subscribers.sql` — subscriber table
- `20260604000000_phase2.sql` — variant_group_id, image_url, music_tracks, demoforge_jobs
- `20260605000000_settings.sql` — settings table
- `20260620000000_workspaces.sql` — workspaces (tenant root)
- `20260630000000_expose_vantage_views.sql` — auto-expose every `vantage` table via a `public`
  view + event trigger (rebuilt after column adds)
- `20260702000000_core_tenancy.sql` — **Phase 1:** add `workspace_id` to all core tables,
  backfill to a default workspace, re-key channels/settings, composite FKs, RLS backstop
- `20260703000000_publish_lock.sql` — **Phase 2c:** `publishing` status + `locked_at`
- `20260704000000_workspace_members.sql` — **Phase 2a:** membership/roles table
- (plus phase3a/3b, email_templates, sound_effects, campaign/intelligence/audience/virality,
  llm_provider_settings, and grant-hardening migrations)

---

### 20. Social Kit

**What it does:**
An in-app social-asset studio at `/social-kit` that produces on-brand graphics for any of the
six BioLoop Nexus modules (Shift, Keystone, Scripta, DemoForge, Crucible, Vantage). It was
ported from the BioLoop Nexus "Social Kit" design prototype into the live app, reusing the
existing `nexus` design system (`--nx-*` tokens, `theme-*` classes, `nx-*` utility classes).

For the selected module it renders three things:

1. **Brand essentials** — logo lockups (on dark / light / stacked), a click-to-copy color
   palette, the type system, and the voice do/don't register.
2. **Caption library** — four on-voice caption cards plus a hashtag bank, each with a
   copy-to-clipboard button. Caption copy is currently static, sourced from `brands.ts`
   (Phase 3C-2 wires this to live AI generation).
3. **Post templates** — six editable, exportable canvases sized to platform specs
   (Instagram 1080², Story/Reel/TikTok 1080×1920, X 1600×900, LinkedIn 1200×627, plus an
   insight-carousel intro square + story). Any text is click-to-edit (`contentEditable`),
   image slots accept click-or-drag photos, and each card exports a clean PNG at 1×/2×/3×.

**Export engine:** `exportCanvasNode()` renders a DOM node to PNG via `html-to-image` at the
chosen pixel ratio. The canvas is authored at native pixel size and visually down-scaled into
a card with a CSS transform; on export the un-scaled node is captured, and an `.kit-exporting`
class strips editing chrome (hover outlines, empty image-slot dashes) from the captured clone.
This export engine + the template-canvas pattern are the **shared foundation** that Phase 3C
(Creative Studio) builds on.

**Controls:** A control bar replaces the prototype's tweak panel — a module switcher, an
"editing guides" toggle (adds/removes the `kit-guides-off` class), and a 1×/2×/3× export-scale
selector. The active `theme-*` class is scoped to the page's wrapper `<div>` (never
`document.body`), so re-theming the kit never disturbs the app shell or sidebar.

**Files:**
- `apps/web/src/pages/SocialKitPage.tsx` — page shell, control bar, theme/guide scoping
- `apps/web/src/pages/socialkit/brands.ts` — typed `BRANDS` + `BRAND_ORDER` data (6 modules)
- `apps/web/src/pages/socialkit/CanvasMark.tsx` — per-module SVG logos (literal hex, export-safe) + `Corners`
- `apps/web/src/pages/socialkit/primitives.tsx` — `EditableText`, `KitImageSlot`, `CopyButton`, `exportCanvasNode`
- `apps/web/src/pages/socialkit/sections.tsx` — hero, brand essentials, caption library, footer
- `apps/web/src/pages/socialkit/templates.tsx` — canvas furniture + 6 templates + gallery
- `apps/web/src/pages/socialkit/socialkit.css` — kit-only styles, scoped to `.vg-socialkit`
- `apps/web/src/App.tsx` — `/social-kit` route + sidebar nav entry

**Configuration:** None. Fully client-side; the only new dependency is `html-to-image`.

---

---

### 21. Sound Effects + Audio Mixer

**What it does:**
An extensible sound effects library and per-track audio mixer for DemoForge video generation.
Operators assign contextual sound effects (UI clicks, transitions, success tones) to script steps
with configurable delay and volume, then use the audio mixer panel to control narration/music/effects
volumes independently before export. The backend processor fetches sound effects from storage,
generates silence-padded audio files to synchronize timing, and builds a complex FFmpeg filter
graph with N audio inputs for final mixing.

**Sound Effects Library:**
Tracks are stored as records in `vantage.sound_effects` with fields: `id`, `title`, `category`,
`duration_ms`, `storage_path`, `use_case`, `created_at`.

Categories: `ui_click`, `transition`, `success`, `error`, `notification`, `custom`.
Use cases: `intro`, `step_transition`, `action_feedback`, `general`.

Effects are manually uploaded to Supabase Storage (`vantage-media` bucket) and registered via
`POST /v1/sound-effects`. Can be filtered by category and use_case.

**API:**
- `GET /v1/sound-effects` — list effects with optional filtering
- `POST /v1/sound-effects` — register new effect
- `DELETE /v1/sound-effects/:id` — remove effect record

**Script Step Extension:**
Each `ScriptStep` now includes an optional `soundEffect: { effectId, delayMs, volumePercent }` field.
- `effectId` — reference to `sound_effects` table
- `delayMs` — offset in milliseconds when effect fires relative to step action
- `volumePercent` — volume scaling 0–100% (default 80)

The DemoForge step editor includes a sound effect dropdown selector (populated from library),
delay input (ms), and volume slider (0–100%). Script text parser supports:
- `Sound: <effectId>`
- `SoundDelay: <N>ms`
- `SoundVolume: <N%>`

**Audio Mixer UI:**
A new mixer panel in `DemoForgePage` below the step editor with:
- Per-track volume sliders for narration, music, and effects
- Mute buttons with visual feedback (red "🔇" when muted)
- Master volume slider (applies to final mix)
- Per-effect individual volume controls (stacked when 2+ effects present)
- Reset button to restore defaults (narration 100%, music 15%, effects 80%, master 100%)

**Backend Processing:**
1. **Sound effect fetching** — queries `vantage.sound_effects` and downloads from Supabase Storage
2. **Silence padding** — generates silence-prepended audio files using FFmpeg's `anullsrc` filter
   to position effects at the correct time in the video
3. **Complex FFmpeg filter graph** — dynamically builds filters for all audio tracks:
   ```
   [1:a]volume=1.0[narr]
   [2:a]volume=0.15[mus]
   [3:a]volume=0.8[eff1]
   [narr][mus][eff1]amix=inputs=3:duration=first[amixed]
   [amixed]volume=1.0[aout]
   ```
4. **Per-track volume control** — applies volume scaling from mixer before mixing
5. **Master volume** — final output volume scaling applied after all tracks mixed

Job submission includes optional `narration_volume`, `music_volume`, and `master_volume` parameters
(each 0–100, defaults 100/15/100 respectively). Effect volumes are stored per-step in
`soundEffect.volumePercent`.

**Files:**
- `supabase/migrations/20260610000000_sound_effects.sql` — table, RLS, public view
- `apps/api/src/routes/sound-effects.ts` — CRUD endpoints
- `apps/api/src/index.ts` — route mounting
- `apps/web/src/components/AudioMixer.tsx` — mixer UI component
- `apps/web/src/pages/DemoForgePage.tsx` — mixer integration, step editor enhancement
- `apps/web/src/api/vantage.ts` — API type updates
- `apps/demoforge/src/jobs/processor.ts` — effect fetching, silence padding, filter graph
- `apps/demoforge/src/jobs/queue.ts` — type definitions

**Configuration:** None required beyond Supabase credentials. Sound effect files are user-uploaded.

---

### 22. Campaign Builder

**What it does:**
Strategic campaign planning and execution engine that enables multi-channel, multi-week content campaigns
with precise daily scheduling, messaging consistency, and KPI tracking. Campaigns bridge high-level
marketing goals (messaging pillars, channel mix, posting cadence) with daily content execution.

**Core concepts:**

**Campaigns** store the campaign metadata, messaging framework, and channel configuration:
- `name` — campaign name (e.g. "Q2 Product Launch")
- `status` — draft / active / paused / archived
- `cadence_config` — JSONB with `posts_per_day`, `posting_hours`, `auto_approve`
- `messaging_pillars` — array of (title, description, guidelines) that shape all generated content
- `channel_mix` — JSONB specifying which channels participate and their relative volume
- `kpi_targets` — goals for engagement, reach, conversion, sentiment

**Campaign timeline** stores one row per day:
- `campaign_id`, `date`
- `content_ideas` — JSONB with AI-suggested content hooks for that day
- `published_pieces` — array of `content_piece_id`s published on that day
- Links to the daily publish count, estimated reach, and performance

**Campaign KPI tracking** aggregates daily metrics:
- Engagement events, reach, conversions per day
- Running total toward campaign goals
- Per-channel and per-pillar breakdowns

**Service functions (`apps/api/src/lib/campaigns.ts`):**
- `generateContentIdeas()` — LLM calls Claude with the campaign's messaging pillars, date context,
  and recent performance to suggest 5–10 specific content hooks for a given day
- `generateTimeline()` — builds the `campaign_timeline` entries for a date range, balancing pillar
  distribution and channel mix
- `generateCampaignSummary()` — produces a narrative executive summary of campaign performance
  and recommendations

**API routes (`apps/api/src/routes/campaigns.ts`):**
- `POST /v1/campaigns` — create campaign with validation (requires name, messaging_pillars, cadence_config)
- `GET /v1/campaigns` — list with optional filtering (status, active date range)
- `GET /v1/campaigns/:id` — fetch campaign details
- `PATCH /v1/campaigns/:id` — update campaign settings (pillars, channel mix, KPI targets)
- `DELETE /v1/campaigns/:id` — archive campaign
- `POST /v1/campaigns/:id/timeline` — create timeline entries for a date range
- `GET /v1/campaigns/:id/timeline` — fetch timeline with suggested content and published pieces
- `GET /v1/campaigns/:id/kpi` — daily + cumulative KPI metrics and progress toward goals

**UI (`apps/web/src/pages/CampaignBuilderPage.tsx`):**
Three-view interface:
- **List view** — all campaigns with status badge, date range, and active engagement count
- **Create view** — form with campaign name, messaging pillar templates (pre-filled from brand voice),
  channel selection, cadence config, and KPI target inputs
- **Details view** — dashboard showing:
  - **Messaging pillars panel** — visual breakdown of each pillar and its content distribution
  - **Timeline panel** — calendar view showing suggested content hooks, published pieces, and
    daily performance metrics
  - **KPI dashboard** — progress cards toward each goal, with trend sparklines
  - **Action panel** — "Generate timeline", "Update KPIs", "Archive campaign" buttons

**Database (`supabase/migrations/20260626000000_campaign_builder.sql`):**
- `vantage.campaigns` — campaign metadata
- `vantage.campaign_timeline` — daily timeline entries
- `vantage.campaign_kpi_tracking` — daily KPI aggregates
- Workspace-scoped with `workspace_id` foreign key

**Configuration:** Requires `ANTHROPIC_API_KEY` for LLM calls (uses pluggable LLM provider system).

---

### 23. Strategic Intelligence

**What it does:**
Competitive landscape monitoring and AI-powered strategic insight generation. Tracks competitor posts,
detects trending topics, analyzes competitive performance, and generates actionable insights for campaign
optimization.

**Core tables:**

**Competitive posts** (`competitive_posts`) — individual posts from monitored accounts/keywords:
- Source: platform (X, LinkedIn, Reddit), account ID, post ID, post content
- Extracted metadata: themes, sentiment (positive/neutral/negative), estimated virality, engagement potential
- Engagement snapshot: impressions, engagements, shares, replies

**Trending content** (`trending_content`) — aggregated trends from multiple posts:
- Trend name, platform, timeframe
- Lifecycle status: emerging → peak → declining → sustained
- Key characteristics: dominant messaging, sentiment, engagement rate
- Sample posts that exemplify the trend
- Momentum score (is it accelerating or decelerating?)

**Intelligence insights** (`intelligence_insights`) — AI-generated strategic recommendations:
- Type: competitive_gap, opportunity, optimization, threat, strength
- Confidence score (0-1)
- Description, actionable recommendations, supporting evidence
- Campaign/segment applicability flags

**Competitive benchmarks** (`competitive_benchmarks`) — periodic snapshots for gap analysis:
- Competitor aggregate metrics (avg engagement, posting frequency, optimal posting hours)
- Performance gap vs. our current metrics
- Recommended tactics to close each gap

**Monitoring sources** (`monitoring_sources`) — configuration for what to track:
- Account handles, keyword phrases, subreddits, hashtags
- Platform, update frequency, priority

**Service functions (`apps/api/src/lib/intelligence.ts`):**
- `analyzeCompetitivePost()` — takes post content and metadata, calls Claude to extract themes,
  sentiment, engagement_potential, viral_indicators (hooks, emotional triggers, format)
- `detectTrends()` — queries top posts from the last N days, identifies 2–5 distinct trends with
  lifecycle status, messaging breakdown, and sample posts
- `generateInsights()` — compares trends and competitive performance to brand/campaign context,
  generates 3–5 strategic insights with confidence scoring and actionable next steps
- `generateBenchmarkAnalysis()` — computes performance gaps vs. competitors and suggests tactics
  (content style, posting timing, messaging angle) to close them

**API routes (`apps/api/src/routes/intelligence.ts`):**
- `POST /v1/intelligence/posts` — add or sync competitive post with auto-analysis
- `GET /v1/intelligence/posts` — list posts with filtering (platform, date range, theme)
- `GET /v1/intelligence/trends` — list trends with optional status filtering
- `POST /v1/intelligence/trends/detect` — trigger AI trend detection from recent posts
- `GET /v1/intelligence/insights` — retrieve insights by campaign/type/status with confidence scores
- `GET /v1/intelligence/benchmarks` — fetch latest benchmark snapshot and gap analysis

**UI (`apps/web/src/pages/IntelligencePage.tsx`):**
Four-tab interface:
- **Insights tab** — strategic recommendations displayed as cards with type badge, confidence meter,
  description, supporting evidence links, and an "Apply to campaign" action
- **Trends tab** — detected trends with status indicator (emerging/peak/declining), key messaging,
  sentiment breakdown, and links to exemplifying posts
- **Posts tab** — competitive post list with extracted themes, engagement metrics, and virality indicators
- **Benchmarks tab** — performance comparison vs. competitors with gap analysis and recommended tactics

**Database (`supabase/migrations/20260627000000_strategic_intelligence.sql`):**
- `vantage.competitive_posts` — individual monitored posts
- `vantage.trending_content` — aggregated trends
- `vantage.intelligence_insights` — AI insights
- `vantage.competitive_benchmarks` — performance snapshots
- `vantage.monitoring_sources` — what to track
- Workspace-scoped; indexes on platform, status, generated_at for fast queries

**Configuration:** `ANTHROPIC_API_KEY` for LLM analysis. Monitoring sources configured via UI.

---

### 24. Audience Model

**What it does:**
Behavioral audience segmentation with ML-ready predictive scoring. Segments users by engagement
patterns, calculates lifetime value, predicts churn risk, learns content preferences, and enables
segment-aware personalization across the entire platform.

**Core tables:**

**Segments** (`segments`) — audience segments with metadata and performance:
- `segment_type` — behavioral, demographic, technographic, geographic, custom
- `definition` — JSONB with selection criteria (e.g., engagement_score > 80, purchases_last_90d > 1)
- `engagement_pattern` — JSONB describing how segment typically engages (reply frequency, share rate, etc.)
- `ltv_metrics` — JSONB with `total_value`, `avg_transaction`, `predicted_ltv`, `confidence`
- `churn_risk_baseline` — overall segment churn probability (0-1)

**Segment members** (`segment_members`) — individual users with predictive scores:
- `segment_id`, `external_user_id`
- `profile` — JSONB with metadata (follower count, account age, bio)
- `lifetime_value` — total calculated value using three methods (simple, cohort-based, predicted with churn adjustment)
- `predicted_churn_risk` — ML-ready score (0-1) indicating unsubscribe/disengagement probability
- `engagement_score` — weighted engagement metric used for internal ranking
- `last_seen_at` — timestamp of last engagement

**Segment analytics** (`segment_analytics`) — time-series metrics:
- `segment_id`, `date`
- `active_members`, `new_members`, `churned_members`
- `total_engagements`, `engagement_rate`, `conversions`
- `avg_engagement_score`, `avg_predicted_churn_risk`

**Segment preferences** (`segment_preferences`) — learned content preferences:
- `segment_id`
- `preferred_content_types` — array (e.g., ["video", "carousel", "thought_leadership"])
- `preferred_tones` — array (e.g., ["professional", "witty"])
- `preferred_formats` — array by channel (video, text, image per platform)
- `optimal_posting_times` — JSONB with `best_days`, `best_hours`
- `topic_interests` — array with weight/affinity per topic
- `content_aversion` — topics/formats to avoid

**GA4 sync config** (`ga4_sync_config`) — Google Analytics 4 integration:
- Property ID, connection status, last sync timestamp
- Metrics mapped to segments (e.g., GA4 audience segment → Vantage segment)

**ML inference cache** (`ml_inference_cache`) — caches predictions with TTL:
- Cached churn predictions, LTV estimates, segment membership probabilities
- `expires_at` timestamp for automatic invalidation

**Service functions (`apps/api/src/lib/audience.ts`):**
- `analyzeSegmentCharacteristics()` — LLM analysis of segment engagement patterns, value profile,
  and content recommendations
- `calculateLTV()` — three methods: (1) simple (total_value / lifecycle_days), (2) cohort-based
  (similar users' lifetime average), (3) ML-predicted (current engagement trend + churn adjustment).
  Returns confidence scores for each method.
- `learnSegmentPreferences()` — analyzes top posts from segment, identifies content type preferences,
  optimal posting times, topic affinities using keyword extraction and pattern matching
- `predictChurnRisk()` — ML-ready scoring (0-1) based on inactivity days, engagement trend slope,
  purchase history. Designed for future model integration (currently rule-based).
- `personalizeForSegment()` — generates content recommendations tailored to segment's preferences
  and engagement patterns

**API routes (`apps/api/src/routes/audience.ts`):**
- `POST /v1/audience/segments` — create segment with type, definition, engagement pattern
- `GET /v1/audience/segments` — list segments with member counts and key metrics
- `GET /v1/audience/segments/:id` — fetch segment details with overview cards
- `PATCH /v1/audience/segments/:id` — update definition, engagement pattern, or preferences
- `DELETE /v1/audience/segments/:id` — delete segment
- `POST /v1/audience/segments/:id/members` — add member with profile data
- `GET /v1/audience/segments/:id/members` — list members sorted by engagement/churn/LTV with pagination
- `GET /v1/audience/segments/:id/analytics` — fetch time-series metrics for a date range
- `GET /v1/audience/segments/:id/preferences` — get learned preferences (content types, times, topics)
- `GET /v1/audience/ga4/config` — fetch GA4 sync configuration
- `POST /v1/audience/ga4/config` — update GA4 property ID and mapping
- `POST /v1/audience/ga4/sync` — trigger immediate GA4 sync (imports user data and segments)

**UI (`apps/web/src/pages/AudiencePage.tsx`):**
Three-tab interface:
- **Segments tab** — list of all segments with member count, engagement score, churn risk badge,
  and quick-view LTV
- **Create segment tab** — form for creating new segments: type selector (behavioral/demographic/etc),
  definition builder (dynamic criteria), optional GA4 audience sync
- **Segment details tab** — comprehensive view with:
  - **Overview cards** — member count, total value, avg engagement score, churn risk, LTV (with method confidence)
  - **Top members panel** — sortable list showing engagement score, lifetime value, predicted churn risk,
    last activity timestamp
  - **Analytics chart** — time-series graph of active members, engagement rate, conversions
  - **Preferences panel** — learned content types, tones, optimal posting times, topic interests with affinity weights
  - **GA4 integration panel** — connection status, last sync timestamp, "Sync now" button

**Database (`supabase/migrations/20260628000000_audience_model.sql`):**
- `vantage.segments` — segment definitions
- `vantage.segment_members` — user-segment mapping with predictive scores
- `vantage.segment_analytics` — time-series metrics
- `vantage.segment_preferences` — learned preferences
- `vantage.ga4_sync_config` — GA4 configuration
- `vantage.ml_inference_cache` — ML prediction cache
- Workspace-scoped; indexes on segment_id, engagement_score, predicted_churn_risk

**Configuration:** `GA4_PROPERTY_ID` (optional for GA4 sync). GA4 connection details configured in UI.

---

### 25. BioLoop Virality Signals

**What it does:**
Multi-platform trend detection, viral pattern recognition, and segment-aware virality analysis.
Distinguishes VIRAL growth (exponential, platform-beating) from normal engagement, identifies
replicable viral patterns, and generates segment-specific viral content strategies.

**Core distinction:** Virality ≠ Engagement. A post with 100 likes might be well-engaged (normal).
A post with 500+ likes in the same timeframe on the same account is VIRAL (exceeds platform baseline
by 2–3x+). BioLoop detects the exponential growth signal, not just the absolute engagement number.

**Core tables:**

**Viral signals** (`viral_signals`) — detected posts with unusual growth patterns:
- Platform, source account, post ID, post content
- Engagement metrics: impressions, engagements, likes, reposts, replies
- `virality_score` (0-1) — likelihood of continued exponential growth (not just engagement rate)
- `velocity_metrics` — engagement_rate_per_hour, growth_acceleration, momentum_score
- `engagement_type` — organic_share / reply_driven / algorithm_amplified / community_amplified
- `viral_characteristics` — format (thread/video/image/text), hooks, emotional triggers, controversy level
- `replicability_score` (0-1) — how reproducible is this pattern?
- `segment_affinity` — which segments respond strongly to this content style?

**Virality patterns** (`virality_patterns`) — aggregated replicable viral patterns:
- Platform, timeframe (e.g., "last 7 days"), segment (optional)
- `pattern_name` — e.g., "question_driven_threads", "video_shorts", "contrarian_takes"
- Performance: `avg_virality_score`, `median_engagement_rate`, `percentile_90_virality`
- `reproduction_success_rate` — % of similar posts that achieve viral status
- `confidence_score` — how confident are we in this pattern's replicability?
- `segment_lift_percentage` — does this pattern perform better/worse for a specific segment?
- `characteristics` JSONB — format, hooks, tone, length, timing recommendations
- `success_indicators` — what signals indicate this pattern is working?

**Virality recommendations** (`virality_recommendations`) — AI-generated viral strategies:
- Campaign/segment/type (generated_by LLM: claude/gpt-4o/grok)
- Title, description, and detailed strategy JSONB
- `expected_virality_score`, `expected_engagement_lift`, `expected_reach_lift`
- `implementation_difficulty`, `viral_sustainability` (one_time / short_term / sustained)
- `segment_match_score` — how well does this match the target segment?
- Status tracking: new / reviewed / actioned / tested / dismissed
- Performance feedback JSONB (actual results after testing)

**Platform velocity tracking** (`platform_velocity_tracking`) — real-time platform velocity metrics:
- Platform, date_tracked
- `average_time_to_virality_hours` — how long until posts hit viral threshold on this platform?
- `velocity_acceleration` — posts per hour for viral content in first 24h
- `peak_engagement_hour` — which UTC hour sees peak engagement?
- `engagement_curve` — exponential / linear / plateau / saw_tooth
- `trending_topics` JSONB — current trending topics with mention count and virality correlation
- `segment_velocity` — per-segment virality speed (different segments trend differently)

**Virality boost signals** (`virality_boost_signals`) — early-stage viral detection:
- Post ID, platform, URL, content snippet
- Detected early signals (velocity_spike, engagement_clustering, authority_endorsement, sentiment_shift, cross_platform_spillover)
- `viral_probability` (0-1) — estimated probability post will go viral in next 24h
- `time_to_virality_estimate_hours`
- Recommended action: amplify / watch / participate / feature
- Best segments for amplification with lift potential
- Alert sent status; actual virality and prediction accuracy (filled post-hoc)

**Service functions (`apps/api/src/lib/bioloop.ts`):**
- `analyzeVirality()` — LLM call to distinguish viral growth from engagement. Compares post's engagement
  rate to platform baseline (X: 2.5%, LinkedIn: 1.2%, Reddit: 5%). Returns virality_score, velocity metrics,
  engagement type, viral characteristics (format, hooks, emotional triggers), replicability.
- `recognizeViralPatterns()` — analyzes top viral posts to identify 2–3 replicable patterns. Returns
  pattern name, characteristics, success indicators, reproduction likelihood, optimal timing, risk factors.
- `generateViralRecommendation()` — segment-specific strategy. Takes campaign theme, segment preferences,
  identified patterns. Returns title, strategy, expected virality/engagement lift, implementation difficulty,
  sustainability, critical success factors, risk mitigation.
- `detectEarlyViralSignals()` — five-signal detection (velocity_spike: engagements_last_hour > 3× avg,
  engagement_clustering, authority_endorsement: top engager followers > 2× avg, sentiment_shift, cross_platform).
  Returns signals object and viral_probability (0-1).
- `calculateSegmentViralityLift()` — adjusts base virality score for segment characteristics. Larger
  segments amplify virality; higher-retention segments spread more. Returns adjusted_virality_score,
  lift_percentage, segment_match_strength.

**API routes (`apps/api/src/routes/bioloop.ts`):**
- `POST /v1/bioloop/analyze` — analyze post for virality; returns virality_score, velocity metrics, characteristics
- `GET /v1/bioloop/signals` — list detected viral signals with optional filtering (platform, date, virality_score min)
- `POST /v1/bioloop/patterns/detect` — trigger pattern recognition from recent viral posts
- `GET /v1/bioloop/patterns` — list identified patterns with platform/segment filtering
- `POST /v1/bioloop/recommendations` — generate viral strategy for campaign/segment
- `GET /v1/bioloop/recommendations` — list recommendations with status filtering
- `POST /v1/bioloop/boost-signals/detect` — detect early viral signals from recent posts

**Integration with Audience Model:**
Virality recommendations include `segment_match_score` and `best_segments_for_amplification`.
Early boost signals suggest which segments to target for amplification.

**Database (`supabase/migrations/20260629000000_bioloop_virality.sql`):**
- `vantage.viral_signals` — detected viral posts
- `vantage.virality_patterns` — replicable patterns
- `vantage.virality_recommendations` — AI strategies
- `vantage.platform_velocity_tracking` — platform metrics
- `vantage.virality_boost_signals` — early detection
- Workspace-scoped; indexes on virality_score, viral_probability, platform, status

**Configuration:** Requires pluggable LLM provider (Claude, GPT-4o, Grok configurable per workspace).

---

## Phase 3A — Gaps & Fixes

> Items from the original spec that are missing or incomplete. All are corrections
> to existing functionality, not net-new features.

---

### 3A-1 — X Webhook Signature Verification

**Status:** ✅ Shipped

**Problem:** The `POST /v1/webhooks/x` endpoint accepts all payloads without verifying the
`x-twitter-webhooks-signature` header. X signs every webhook delivery with
`HMAC-SHA256(X_WEBHOOK_SECRET, body)`, base64-encoded, prefixed with `sha256=`.
Any actor who knows the endpoint URL can inject fake engagement events, corrupting
BioLoop weights and engagement counts.

**Implementation:**
- Read `x-twitter-webhooks-signature` header
- Compute `sha256=` + `HMAC-SHA256(X_WEBHOOK_SECRET, rawBody).base64()`
- If header is absent or does not match → 401
- Mirror the pattern already used by the LinkedIn handler

**Files to change:** `apps/api/src/routes/webhooks.ts`

---

### 3A-2 — UTM Tags in Email HTML Bodies

**Status:** ✅ Shipped

**Problem:** The `tagUrls()` utility correctly tags URL strings in flat JSON fields, but the
email adapter sends the `body` HTML directly to Resend without running it through UTM
tagging. Every `<a href="...">` in newsletters goes out without attribution parameters,
making it impossible to attribute newsletter clicks in any analytics tool.

**Implementation:**
- In `apps/api/src/adapters/email.ts`, before calling the Resend API, run the HTML body
  through `tagUrls(html, 'email', pieceId)`. The regex already handles URLs inside
  `href="..."` attributes correctly (the pattern matches up to the closing `"`).
- Pass `pieceId` into the email adapter's send function.

**Files to change:** `apps/api/src/adapters/email.ts`, `apps/api/src/routes/publish.ts`
(to forward `piece.id` to the adapter).

---

### 3A-3 — LinkedIn Image Passthrough

**Status:** ✅ Shipped

**Problem:** When `generate_image: true` is used, DALL-E 3 generates an image and stores the
URL in `content_pieces.image_url` and `content_payload.image_url`. However, the LinkedIn
adapter builds its UGC post without checking for an image. The image is never attached,
even though the LinkedIn API fully supports image posts via `media[]` in the UGC payload.

**Implementation:**
- In `apps/api/src/adapters/linkedin.ts`, read `content_payload.image_url` if present
- If an image URL exists, register the image asset with LinkedIn's media upload API first
  (`POST /v2/assets?action=registerUpload`), upload the image binary, then include the
  `asset` URN in the `media[]` array of the UGC post
- If no image: post as text-only (existing behavior)

**Files to change:** `apps/api/src/adapters/linkedin.ts`

---

### 3A-4 — Subreddit Round-Robin

**Status:** ✅ Shipped

**Problem:** When multiple subreddits are configured, the scheduler uses `Math.random()` to
select which subreddit to post to. This can result in consecutive posts going to the same
subreddit, uneven distribution, and missed subreddits if the random seed is unlucky.

**Implementation:**
- Add a `last_subreddit_index` field to the Reddit channel's `cadence_config` (or track
  in memory on the scheduler), increment modulo the subreddit count on each post
- Alternative: query `content_pieces` for the last published Reddit piece, extract its
  subreddit from `content_payload`, and pick the next one in the list

**Files to change:** `apps/api/src/services/scheduler.ts`, `apps/api/src/adapters/reddit.ts`

---

### 3A-5 — Webhook Event Deduplication

**Status:** ✅ Shipped

**Problem:** Platforms (especially X) may redeliver webhook events. A redelivered event
produces a duplicate row in `engagement_events`, which inflates BioLoop's engagement
counts and corrupts pattern weights. Currently there is no deduplication on insert.

**Implementation:**
- Add a migration: `ALTER TABLE vantage.engagement_events ADD COLUMN IF NOT EXISTS external_event_id text`
  and a unique index: `CREATE UNIQUE INDEX ON vantage.engagement_events (external_event_id) WHERE external_event_id IS NOT NULL`
- In each webhook handler, extract a platform-provided event ID and pass it as
  `external_event_id` on insert. Use `ON CONFLICT DO NOTHING` (or Supabase's `upsert` with
  `ignoreDuplicates: true`)

**Files to change:** `apps/api/src/routes/webhooks.ts`, new migration file

---

### 3A-6 — Retry Logic for Failed Pieces

**Status:** ✅ Shipped

**Problem:** When a publish attempt fails (e.g. rate limit, network error, expired token),
the piece is permanently marked `failed`. There is no mechanism to retry, either
automatically or manually from the queue UI.

**Implementation:**
- Add `retry_count int default 0` and `retry_after timestamptz` columns to `content_pieces`
- On failure in the cadence tick: if `retry_count < 3`, set `status = 'queued'`,
  increment `retry_count`, set `retry_after = now() + (2^retry_count * 5 minutes)` (exponential backoff),
  and log a `publish_retry_scheduled` event. After 3 failures: set `status = 'failed'` permanently.
- In QueuePage: show a "Retry" button for `failed` pieces that calls a new
  `POST /v1/publish/:channel` with a `retry: true` flag to reset the piece to `queued`

**Files to change:** `apps/api/src/services/scheduler.ts`, `apps/api/src/routes/publish.ts`,
`apps/web/src/pages/QueuePage.tsx`, new migration

---

### 3A-7 — Reddit Engagement Polling

**Status:** ✅ Shipped

**Problem:** Reddit has no push webhook API. The webhook route comment says engagement is
"collected via `pollRedditEngagement()` in the scheduler" but this function does not exist.
Reddit-published pieces accumulate zero engagement data, meaning BioLoop has no signal for
the Reddit channel and weights never update.

**Implementation:**
- New function `pollRedditEngagement()` in `apps/api/src/services/reddit-engagement.ts`
- Queries `content_pieces` for Reddit pieces published in the last 30 days with `external_post_id` set
- For each piece, calls Reddit's `GET /api/info?id=<post_id>` (no auth required for public posts)
  to get current `ups`, `num_comments`, `score`
- Computes the delta vs. last polled values (stored in a new `last_engagement_snapshot` JSONB column)
- Inserts `engagement_events` for meaningful changes (upvote delta, new comments)
- Runs on a 2-hour tick in the scheduler

**Files to change/create:** `apps/api/src/services/reddit-engagement.ts` (new),
`apps/api/src/services/scheduler.ts`, new migration (for `last_engagement_snapshot`)

---

### 3A-8 — Per-Vertical Dashboard Breakdown

**Status:** ✅ Shipped

**Problem:** The spec says "Dashboard shows per-channel *and per-vertical* breakdown of
activity and engagement." The dashboard currently has per-channel stats but never
aggregates by vertical. Topics and content pieces both carry a `vertical` field.

**Implementation:**
- In `apps/api/src/routes/dashboard.ts`: join `content_pieces` with `topics` on `topic_id`
  to get the vertical for each piece. Build a `verticalBreakdown` accumulator keyed by
  vertical string, tracking `published_7d`, `queued`, `auditing` counts.
- Also aggregate `engagement_events` by vertical (via content_piece → topic join).
- Add `verticalBreakdown` to the response JSON.
- In `DashboardPage.tsx`: add a "Vertical Breakdown" panel similar to Channel Cadence,
  showing publish counts and engagement per vertical.

**Files to change:** `apps/api/src/routes/dashboard.ts`, `apps/web/src/pages/DashboardPage.tsx`,
`apps/web/src/api/vantage.ts` (update `DashboardOverview` type)

---

---

## Phase 3B — New Capabilities

> Features not in the original spec but recommended additions. Each is independent
> and can ship individually.

---

### 3B-1 — Pipeline Failure Alerting

**Status:** ✅ Shipped

**Problem:** When pieces fail to publish or the scheduler crashes, the only way to know is
to check the dashboard. For an automated pipeline, silent failures can mean days of missed
posts before they're noticed.

**Implementation:**
- New `apps/api/src/lib/alert.ts` with a `sendAlert(subject, body)` function
- On first call it picks the configured alert channel: Resend email (`ALERT_EMAIL`) or
  Slack webhook (`ALERT_SLACK_WEBHOOK`). If neither is set, it logs to console only.
- Call `sendAlert()` from:
  - `publishPiece()` after the 3rd retry failure (permanent fail)
  - `autoGenerateTick()` on repeated generation errors for the same channel
  - Top-level scheduler `catch` blocks
- Throttle: no more than one alert per channel per hour (track `lastAlertSent` per channel in memory)

**Files to create/change:** `apps/api/src/lib/alert.ts` (new), `apps/api/src/services/scheduler.ts`

**Configuration:** `ALERT_EMAIL` (recipient address), `ALERT_SLACK_WEBHOOK` (incoming webhook URL)

---

### 3B-2 — Content Calendar View

**Status:** ✅ Shipped

**Problem:** The queue is a flat list. There is no way to see the distribution of scheduled
posts over time — clustering, gaps, or channel conflicts are invisible.

**Implementation:**
- New `apps/web/src/pages/CalendarPage.tsx`
- Fetches pieces with `status IN ('queued', 'published')` and `scheduled_for` set, from the
  existing `/v1/queue` endpoint (or a new `/v1/calendar?from=<iso>&to=<iso>` endpoint)
- Renders a 7-day week grid: rows = channels, columns = days, cells show piece count with color coding
- Clicking a cell expands to list the pieces scheduled in that slot
- Navigation: previous/next week
- Add to app router and sidebar

**Files to create/change:** `apps/web/src/pages/CalendarPage.tsx` (new),
`apps/api/src/routes/queue.ts` (add date range filter), app router + sidebar

---

### 3B-3 — Engagement Trend Charts

**Status:** ✅ Shipped

**Problem:** The "Top Pieces — 7d" panel shows aggregate counts. There is no time-series
view of engagement — no way to see whether performance is improving, which posting hours
drive the most events, or how channels compare over weeks.

**Implementation:**
- New `GET /v1/analytics/engagement` endpoint:
  - Params: `channel`, `vertical`, `period` (7d / 30d / 90d), `group_by` (day / channel / vertical)
  - Returns time-bucketed engagement counts from `engagement_events` joined to `content_pieces`
- New `GET /v1/analytics/posting-hours` endpoint:
  - Returns engagement rate by UTC hour for each channel
- New `apps/web/src/pages/AnalyticsPage.tsx` with:
  - Line chart: engagement events over time (channel color-coded)
  - Bar chart: engagement by posting hour
  - Bar chart: top 10 verticals by engagement rate
  - Uses a lightweight chart library (recharts or chart.js)

**Files to create/change:** `apps/api/src/routes/analytics.ts` (new),
`apps/web/src/pages/AnalyticsPage.tsx` (new), app router + sidebar

---

### 3B-4 — Platform Rate Limit Handling

**Status:** ✅ Shipped

**Problem:** X API v2 enforces hard posting limits (varies by tier). LinkedIn and Reddit
have their own rate limits. When a publish call returns 429 Too Many Requests, the piece
is currently marked `failed` with a permanent error. It should be rescheduled automatically.

**Implementation:**
- In each adapter's publish function, detect 429 / rate-limit responses
- Extract `Retry-After` header if present; otherwise use a default backoff (15 min for X, 5 min for others)
- Throw a typed `RateLimitError` with `retryAfter: Date`
- In `publishPiece()` in the scheduler: catch `RateLimitError` specifically, set
  `status = 'queued'` with `scheduled_for = retryAfter` (not `failed`), log a
  `rate_limit_rescheduled` activity event. Does not count against the retry limit.

**Files to change:** `apps/api/src/adapters/x.ts`, `apps/api/src/adapters/linkedin.ts`,
`apps/api/src/adapters/reddit.ts`, `apps/api/src/services/scheduler.ts`

---

### 3B-5 — Publish Preview

**Status:** ✅ Shipped

**Problem:** Operators approve raw JSON payloads in the queue. There is no rendered preview
showing how the content will actually look on the platform — character counts,
formatting issues, or broken HTML in email bodies are invisible until after publishing.

**Implementation:**
- New `PreviewModal` component in `apps/web/src/ds/`
- Per-format rendering:
  - `tweet`: renders body in a Twitter-card-style box, live character counter with color
  - `linkedin_post`: renders headline in bold, body with line breaks, character count
  - `reddit_thread`: renders title + body, validates title length
  - `email_newsletter`: renders subject + body HTML in a sandboxed `<iframe>`
  - `tiktok_script` / `instagram_caption` / `facebook_post`: formatted text view
- Opens from a "Preview" button on each queue row (before the Audit/Publish actions)
- Image preview already shown in the queue row — modal shows it at full size

**Files to create/change:** `apps/web/src/ds/PreviewModal.tsx` (new),
`apps/web/src/pages/QueuePage.tsx`

---

### 3B-6 — Topic Recycling / Evergreen Content

**Status:** ✅ Shipped

**Problem:** Topics are marked `used_at` after first generation and never touched again.
High-performing topics — those whose generated content received strong engagement — are
valuable evergreen assets that should be recycled periodically with fresh generation.

**Implementation:**
- Add `recycle_after timestamptz` to `vantage.topics`
- New `identifyEvergreenTopics()` function: queries published pieces from the last 90 days
  with engagement count above a threshold (e.g. ≥ 3 events), joins to their source topic,
  sets `topics.recycle_after = now() + 90 days` for those topics, and resets `used_at = null`
- Run as part of the daily BioLoop tick (or its own weekly tick)
- In `pickNextTopic()`: also include topics where `recycle_after <= now()`
- In DashboardPage topic list: badge recycled topics with a ♻️ indicator
- Settings: add `evergreen_threshold` (min engagement events to qualify) and
  `evergreen_recycle_days` (days before recycling, default 90)

**Files to create/change:** `apps/api/src/services/bioloop.ts` (or new service),
`apps/api/src/services/source.ts`, `apps/web/src/pages/DashboardPage.tsx`,
`apps/api/src/lib/settings.ts`, new migration

---

### 3B-7 — DemoForge Job Submission UI

**Status:** ✅ Shipped

**Problem:** The DemoForge pipeline (Playwright + ElevenLabs + FFmpeg) is fully operational
via API, but there is no page in the web app to create a job. Using DemoForge currently
requires direct API calls.

**Implementation:**
- New `apps/web/src/pages/DemoForgePage.tsx`:
  - URL input for the target website
  - Target format selector (TikTok / LinkedIn / Instagram)
  - Script step editor: ordered list of steps, each with action type, selector (optional),
    text (optional), and narration text. Steps can be added, reordered (drag-to-reorder),
    and deleted.
  - Music track selector: dropdown populated from `GET /v1/music`
  - Submit button → calls `POST /v1/demoforge/jobs`, stores returned `job_id`
  - Job status poller: after submit, polls `GET /v1/demoforge/jobs/:id` every 5 seconds
    and shows a progress indicator (recording → synthesizing → mixing → done)
  - On done: shows video download link and links to the content piece if `content_piece_id` was set
- Add to app router and sidebar, gated by `DEMOFORGE_URL` being configured

**Files to create/change:** `apps/web/src/pages/DemoForgePage.tsx` (new), app router + sidebar

---

---

## Phase 3C — Creative Studio

> A suite of creative-asset tools that extend the [Social Kit](#20-social-kit). Each is
> independent and can ship individually. They share one foundation and split into two value
> tiers: tools that **reuse the Social Kit canvas → PNG export engine** (cheap, mostly
> front-end) and tools that **connect creative output to the live content pipeline** (Kuze,
> the Queue, BioLoop, DemoForge — higher value, some back-end work).
>
> **Recommended build order:** 3C-0 (foundation) → 3C-5, 3C-3, 3C-4, 3C-1 (canvas reuse) →
> 3C-2 (pipeline-connected, high value) → 3C-6 (largest, email-safe HTML).
>
> **Information architecture:** to avoid sidebar bloat, surface these as **tabs inside the
> Social Kit page** (Carousel, Quote) and as **contextual actions** elsewhere (a "Share card"
> action on Queue rows, a "Thumbnail" action on DemoForge jobs). Only the Email/Newsletter
> Builder (3C-6) warrants its own nav entry. The Caption Studio (3C-2) lives in the existing
> Social Kit caption section.

---

### 3C-0 — Creative Foundation (shared refactor)

**Status:** ✅ Shipped

**Problem:** The Social Kit's canvas primitives (`exportCanvasNode`, `EditableText`,
`KitImageSlot`, `CanvasMark`, the `TemplateCard` scaled-canvas wrapper, and the canvas
furniture in `templates.tsx`) are currently private to `pages/socialkit/`. Every Phase 3C
tool needs them. Duplicating would fragment the design and the export behavior.

**Implementation:**
- Promote the reusable pieces into a shared module: `apps/web/src/creative/` (or keep them in
  `socialkit/` and export a barrel `socialkit/index.ts`). Move `primitives.tsx`, `CanvasMark.tsx`,
  and the furniture (`CanvasBG`, `ScopeMark`, `CanvasCorners`, `CanvasWordmark`, `StatusBadge`,
  `CanvasMetric`, `CTAPill`) into it; re-export from `socialkit` so the existing page is unchanged.
- Extract a generic `<ExportCard>` from `TemplateCard` (the scale-into-a-frame + EXPORT button
  shell) that any tool can wrap arbitrary canvas children with, parameterized by `w`, `h`,
  `displayW`, `exportScale`, and `filename`.
- Add a small Storage helper `uploadDataUrl(bucket, path, dataUrl)` wrapping
  `supabase.storage.from('vantage-media').upload(...)` for the tools that persist a PNG
  (3C-3, 3C-4) and return the public URL.

**Files to create/change:** `apps/web/src/creative/` (new module) or `socialkit/index.ts`
barrel, `apps/web/src/pages/socialkit/*` (imports updated), `apps/web/src/lib/storage.ts` (new helper).

**Configuration:** None (Storage bucket `vantage-media` already exists).

---

### 3C-1 — Carousel Builder

**Status:** ✅ Shipped

**Problem:** The Social Kit ships single insight slides, but the highest-performing
Instagram/LinkedIn format is the multi-slide **carousel**. There is no way to compose an
ordered 2–10 slide set and export it as a numbered image sequence.

**Implementation:**
- New `socialkit/carousel.tsx`, surfaced as a "Carousel" tab on the Social Kit page.
- Slide model: `{ id, type, fields }[]` where `type ∈ { cover, point, stat, quote, cta }`.
  Each type is a brand-themed 1080×1080 (or 1080×1350) template built from the shared canvas
  furniture and `EditableText` — reuse the look of `InsightSquare`.
- Slide rail: add / duplicate / reorder (drag) / delete slides; the existing page-indicator
  dots from `InsightStory` become the live progress dots.
- **Seed options:** (a) paste an outline — split on blank lines / numbered list into one slide
  each; (b) generate from a topic via the Caption Studio endpoint (3C-2) extended to return
  `N` slide bodies. Cover + CTA slides are auto-added.
- **Export:** loop `exportCanvasNode()` over each slide node → numbered PNGs
  (`<brand>-carousel-01.png` … `-NN.png`), zipped client-side, **or** assembled into one
  multi-page PDF via `jspdf` (each page = one 1080² image). Offer both.

**Files to create/change:** `apps/web/src/pages/socialkit/carousel.tsx` (new), slide-type
components, `SocialKitPage.tsx` (tab), optionally add `jspdf` + `jszip` deps.

**Configuration:** None (client-side). New optional deps: `jspdf`, `jszip`.

---

### 3C-2 — AI Caption Studio

**Status:** ✅ Shipped

**Problem:** Social Kit captions are static strings in `brands.ts`. The app already has a
first-class AI copywriter (**Kuze**), a **brand voice** config, and **BioLoop** performance
weights — none of which the caption library uses. Captions should be generated fresh,
on-voice, per platform, and biased toward patterns that actually perform.

**Implementation:**
- New back-end surface that generates ephemeral captions **without** creating a `content_piece`
  or consuming a topic (unlike `/v1/generate/:channel`):
  - `apps/api/src/services/kuze.ts` → add `generateCaptions({ prompt, channel, count, tone })`
    that loads `brand_voice` (the existing loader) and the top `generation_weights` for the
    channel (the existing weight-loading path), then asks Claude for `count` distinct caption
    variants, returning plain strings.
  - `packages/prompts/src/index.ts` → a `captionPrompt()` builder (platform length limits,
    voice, weights — mirrors the existing format-schema prompts).
  - `apps/api/src/routes/captions.ts` → `POST /v1/captions` (new), behind `authMiddleware`.
- Front-end: in the Social Kit caption section, add a **"✨ Generate"** panel — a topic/angle
  input, platform select, count, and tone chips. Results render as caption cards with **Copy**
  and **"Use in template →"** (pipes the text into the active editable template). Add
  `vantageApi.generateCaptions(...)` to `apps/web/src/api/vantage.ts`.
- Optional: a "Save as preset" that writes the caption back into a per-brand override table so
  good captions persist.

**Files to create/change:** `apps/api/src/services/kuze.ts`, `apps/api/src/routes/captions.ts`
(new), `packages/prompts/src/index.ts`, `apps/api/src/index.ts` (route mount),
`apps/web/src/api/vantage.ts`, `apps/web/src/pages/socialkit/sections.tsx`.

**Configuration:** `ANTHROPIC_API_KEY` (already required for Kuze).

---

### 3C-3 — OG / Share-Card Generator

**Status:** ✅ Shipped

**Problem:** Every published link (X, LinkedIn, Facebook) renders whatever Open Graph image
the platform scrapes — usually nothing branded. There is no tool to produce a consistent
1200×630 share card per content piece.

**Implementation:**
- A 1200×630 OG template built from the shared canvas furniture, bound to a content piece:
  pre-fills headline/preview/channel from `content_payload` (fetched via `vantageApi.getQueue`),
  with an editable headline and an image slot.
- Entry point: a **"Share card"** action on each Queue row that opens the OG editor in a modal
  (same modal pattern as `PreviewModal`).
- **Two outputs:** (a) **Export PNG** locally via `exportCanvasNode()`; (b) **Attach to piece**
  — `uploadDataUrl('vantage-media', 'og/<piece_id>.png', dataUrl)` then `PATCH` the piece to set
  `content_payload.og_image_url`. The publishing adapters already attach images
  (X/LinkedIn image passthrough — see 3A-3), so an attached card ships with the post.
- New `apps/api/src/routes/queue.ts` patch endpoint (or reuse an existing update path) to set
  `og_image_url` on the piece.

**Files to create/change:** `apps/web/src/pages/creative/OgCard.tsx` (new),
`apps/web/src/pages/QueuePage.tsx` (action + modal), `apps/api/src/routes/queue.ts`
(set `og_image_url`), `apps/web/src/lib/storage.ts` (from 3C-0).

**Configuration:** Supabase Storage (`vantage-media` bucket, already provisioned).

---

### 3C-4 — DemoForge Thumbnail / Cover Frames

**Status:** ✅ Shipped

**Problem:** The DemoForge pipeline renders platform-formatted videos but produces **no cover
art**. A muted autoplay feed needs a strong branded thumbnail; right now there is none.

**Implementation:**
- A thumbnail template sized to the job's `target_format` (1080×1920 portrait for
  TikTok/Instagram, 1920×1080 landscape for LinkedIn), reusing the shared canvas furniture:
  a brand wordmark, an editable title, and a `KitImageSlot` for the background frame.
- Seed the title from the job (or its linked `content_piece`), and let the operator drop a
  captured frame as the background. (Auto-extracting a frame from the rendered MP4 is deferred —
  cross-origin canvas capture from the Storage URL needs CORS config; v1 uses a dropped image.)
- Entry point: a **"Thumbnail"** action on each row of the DemoForge job history in
  `DemoForgePage.tsx`. Export PNG locally; optionally `uploadDataUrl(...)` and store on the job
  (new `demoforge_jobs.thumbnail_url` column + a proxy patch endpoint).

**Files to create/change:** `apps/web/src/pages/creative/Thumbnail.tsx` (new),
`apps/web/src/pages/DemoForgePage.tsx` (action), optional migration for
`demoforge_jobs.thumbnail_url` + `apps/api/src/routes/demoforge.ts`.

**Configuration:** Supabase Storage (existing).

---

### 3C-5 — Pull-Quote Cards

**Status:** ✅ Shipped

**Problem:** Generated content frequently contains a quotable line, but there is no one-click
way to turn it into a shareable graphic. (Cheapest tool — pure canvas reuse — good first build
after the foundation.)

**Implementation:**
- A quote-card template (reuse the `InsightSquare` look): large editable quote text, a brand
  attribution line (`brand.handle`), and the brand mark. 1080² and 1080×1920 variants.
- **Two entry points:** (a) a "Quote" tab in the Social Kit with a paste box; (b) a **"Quotify"**
  action on Queue rows that prefills the card with the selected line — capture the user's text
  selection within a piece's body, or default to the first sentence of `content_payload.body`.
- Export PNG via `exportCanvasNode()`.

**Files to create/change:** `apps/web/src/pages/creative/QuoteCard.tsx` (new),
`SocialKitPage.tsx` (tab), `apps/web/src/pages/QueuePage.tsx` (Quotify action).

**Configuration:** None (client-side).

---

### 3C-6 — Email / Newsletter Template Builder

**Status:** ✅ Shipped

**Problem:** The Email channel sends Kuze's raw HTML `body` straight to Resend with no branded
chrome — no header, hero, styled CTA button, or footer. There is no visual way to build a
reusable, on-brand newsletter layout. This is the **largest** Phase 3C item because the output
is email-client-safe HTML, not a PNG, so the canvas engine does not apply.

**Implementation:**
- A **block-based builder** (`apps/web/src/pages/EmailBuilderPage.tsx`, its own nav entry):
  stackable blocks — header/logo, hero, text, button/CTA, image, divider, footer — each
  brand-themed from the palette in `brands.ts`.
- **Serializer** → table-based, fully inline-styled HTML (no flexbox/grid; web-safe font stack
  with the brand display/mono fonts as progressive enhancement) that survives Gmail/Outlook.
- **Preview** in a sandboxed `<iframe>` (reuse the `email_newsletter` rendering already in
  `PreviewModal`).
- **Persistence:** new `vantage.email_templates` table (`id`, `name`, `blocks` JSONB,
  `created_at`) + `public.email_templates` view + CRUD routes; save/load named templates.
- **Pipeline integration:** a saved template can act as a **wrapper** — a generated
  `email_newsletter` piece's Kuze `body` is injected into the template's text block, so
  automated newsletters inherit branded chrome. The email adapter
  (`apps/api/src/adapters/email.ts`) applies the selected wrapper before `tagUrls()` + send.

**Files to create/change:** `apps/web/src/pages/EmailBuilderPage.tsx` + block components (new),
HTML serializer util, `apps/api/src/routes/email-templates.ts` (new),
`apps/api/src/adapters/email.ts` (apply wrapper), new migration (`email_templates` table + view),
app router + sidebar.

**Configuration:** None beyond the existing Resend setup (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`).

---

## Phase 4 — SaaS Readiness

> Multi-tenancy, real auth, reliability, and test/CI work that turns the single-operator app
> into a sellable multi-tenant SaaS. Plan + status live in `docs/saas-readiness-plan.md`.
> **Migrations note:** `20260702…` and `20260703…` are applied; `20260704…` (workspace_members)
> must be applied before the membership guard works.

---

### 4-1 — Core Multi-Tenancy

**Status:** ✅ Shipped

Every core table carries a NOT-NULL `workspace_id`; every API query is scoped to the request's
workspace and every insert is stamped with it. `channels` re-keyed to `(workspace_id, slug)`,
`settings` to `(workspace_id, key)`, with composite FKs from `content_pieces`/`generation_weights`.
`workspaceGuard` is mandatory on all authed routes and resolves the workspace from a validated,
owned `x-workspace-id` header (or the caller's default). Public proxy views rebuilt so the new
column is visible to PostgREST; workspace-scoped RLS added as a backstop.

**Files:** `supabase/migrations/20260702000000_core_tenancy.sql`, `apps/api/src/lib/auth.ts`,
`apps/api/src/lib/workspace.ts`, every `apps/api/src/routes/*` and `services/*`.

---

### 4-2 — Tenant-Aware Scheduler & Background Jobs

**Status:** ✅ Shipped

The cadence, auto-generate, pulse, and reddit-engagement ticks iterate all workspaces and run
per-tenant; the BioLoop edge function does the same on its daily cron. Shared services
(`source`, `pulse`, `kuze`, `bioloop`, `reddit-engagement`, `settings`, `activity`) thread
`workspaceId` so every read/write is scoped.

**Files:** `apps/api/src/services/scheduler.ts`, `supabase/functions/bioloop/index.ts`.

---

### 4-3 — Workspace Membership & Roles

**Status:** ✅ Shipped

`vantage.workspace_members` maps users to workspaces with `owner`/`admin`/`editor`/`viewer`
roles (existing owners backfilled as `owner`). The guard authorizes by membership and exposes
`c.get("workspaceRole")`. Member-management routes (`GET`/`POST`/`DELETE
/v1/workspaces/:id/members`) are gated to owners/admins and refuse to remove the last owner.

**Files:** `supabase/migrations/20260704000000_workspace_members.sql`,
`apps/api/src/routes/workspaces.ts`, `apps/api/src/lib/workspace.ts`, `apps/api/src/lib/auth.ts`.

---

### 4-4 — Per-Tenant Channel Credentials

**Status:** ✅ Shipped

Adapters (X / LinkedIn / Reddit / Email) thread `workspaceId`, so OAuth tokens and the email
recipient list are scoped to `(workspace_id, slug)`. OAuth start writes the pending state to
the caller's workspace; the unauthenticated callback resolves the workspace by matching that
state across channel rows. Platform app credentials stay global env.

**Files:** `apps/api/src/adapters/{x,linkedin,reddit,email}.ts`, `apps/api/src/routes/channels.ts`,
`apps/api/src/routes/publish.ts`, `apps/api/src/services/scheduler.ts`.

---

### 4-5 — Claim-Based Publish Lock

**Status:** ✅ Shipped

A transient `publishing` status + `locked_at` let a worker atomically claim a queued piece
(`queued → publishing` compare-and-swap) so a slow tick or a second instance can't
double-publish. A reaper re-queues pieces left mid-publish by a crashed worker; the lock is
released on retry/rate-limit. The manual-publish route claims queued pieces too (409 if the
engine already has it).

**Files:** `supabase/migrations/20260703000000_publish_lock.sql`,
`apps/api/src/services/scheduler.ts`, `apps/api/src/routes/publish.ts`.

---

### 4-6 — Test Suite & CI

**Status:** ✅ Shipped

Vitest harness in `@vantage/api` with **42 tests** across the highest-risk paths: publish state
machine (success / retry-backoff / exhausted-fail+alert / rate-limit), cadence claim lock,
auto-generate audit gating (pass→queued, fail→regen→approved/rejected), membership/IDOR guard,
multi-tenant OAuth state resolution, webhook signature verification + workspace attribution, and
utilities. A GitHub Actions workflow runs typecheck + tests + build on every push/PR.

**Files:** `apps/api/vitest.config.ts`, `apps/api/src/**/*.test.ts`, `.github/workflows/ci.yml`.

---

### 4-7 — Billing & Plans

**Status:** ⬜ Planned

Stripe integration + plan tiers + quota/metering enforcement. Needs product decisions (pricing
model, tier boundaries, what to meter). Tracked separately; not yet started.

---

### 4-8 — Pluggable LLM Providers

**Status:** ✅ Shipped

The AI services no longer hard-depend on Anthropic. Kuze (generation) and Ilita (audit) route
through a provider registry (`lib/llm-providers/`) with **Anthropic**, **OpenAI**, and **Grok**
implementations behind one interface. Selection is **per task** and **per workspace**:
`resolveProvider(task, workspaceId)` picks the provider by precedence —
per-workspace setting (`llm_provider_generate` / `llm_provider_audit`) →
`LLM_PROVIDER_GENERATE`/`LLM_PROVIDER_AUDIT` env → `LLM_PROVIDER` env → first provider with a
configured key. A missing/invalid choice never hard-fails while any provider is configured. The
Settings page adds an **AI Providers** panel (per-task dropdowns, unconfigured providers greyed
out); `GET /v1/settings/llm-providers` reports availability. The registry's `generateStructured`
is intentionally not used — the services keep their tuned `@vantage/prompts` schemas and existing
JSON extraction via `generateCompletion`. Anthropic's default model is aligned to
`claude-sonnet-4-6` so behaviour is unchanged when `ANTHROPIC_MODEL` is unset.

> Model choice is per-provider via env (`ANTHROPIC_MODEL`, `OPENAI_MODEL`; Grok pinned in
> `grok.ts`) — the UI selects the provider, not a specific model.

**Files:** `apps/api/src/lib/llm.ts`, `apps/api/src/lib/llm-providers/{index,types,anthropic,openai,grok}.ts`,
`apps/api/src/services/{kuze,ilita}.ts`, `apps/api/src/routes/settings.ts`,
`apps/api/src/lib/settings.ts`, `apps/web/src/pages/SettingsPage.tsx`,
`apps/api/src/routes/{audit,campaigns}.ts`, `apps/api/src/services/scheduler.ts`.

**Configuration:** any subset of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GROK_API_KEY`, with
optional `ANTHROPIC_MODEL` / `OPENAI_MODEL` and the `LLM_PROVIDER*` defaults.

---

### 4-9 — Threads & Bluesky Channels

**Status:** ✅ Shipped

Two new distribution channels bring the total to nine. **Threads** (Meta Graph API) uses the
standard OAuth 2.0 flow — a new `threads.ts` adapter mirrors LinkedIn with a short→long-lived
token exchange and a two-step publish. **Bluesky** (AT Protocol) uses credential auth instead of
an OAuth redirect: the workspace connects with a handle + app password via a new
`POST /v1/channels/:slug/connect` endpoint, and posts via `com.atproto.repo.createRecord`. Both
are wired into the publish route, the cadence scheduler, the per-workspace channel seed, and the
Channels UI; `ChannelSlug` and the generation/audit prompt schemas were extended for both. A
backfill migration adds the two channel rows to existing workspaces.

This work also fixed two pre-existing OAuth defects: the channel list derived `connected` from a
column no adapter writes (`access_token_hash`) — now from `auth_state.tokens`; and the OAuth
callback only dispatched X, so LinkedIn/Reddit callbacks never exchanged tokens — now dispatches
all OAuth channels and logs failures to `activity_events`.

**Files:** `apps/api/src/adapters/{threads,bluesky}.ts`, `apps/api/src/routes/{channels,oauth-callback,publish}.ts`,
`apps/api/src/services/scheduler.ts`, `apps/api/src/lib/workspace.ts`,
`packages/{shared-types,prompts}/src/index.ts`, `apps/web/src/pages/ChannelsPage.tsx`,
`apps/web/src/api/vantage.ts`, `supabase/migrations/20260725000000_threads_bluesky_channels.sql`.

**Configuration:** `THREADS_CLIENT_ID` / `THREADS_CLIENT_SECRET` / `THREADS_REDIRECT_URI` for
Threads; Bluesky needs no app credentials (per-user app passwords; optional `BLUESKY_PDS_URL`).

---

*Last updated: 22 core Vantage features operational. Phase 2 — Campaign Builder (Feature 22): campaign planning, timeline, KPI tracking with LLM-powered content ideation. Phase 3 — Strategic Intelligence (Feature 23): competitive monitoring, trend detection, gap analysis. Phase 4 — Audience Model (Feature 24): behavioral segmentation, LTV calculation, churn prediction, GA4 sync, ML-ready scoring. Phase 5 — BioLoop Virality Signals (Feature 25): viral growth detection, pattern recognition, segment-aware strategies. Workspace-scoped architecture with pluggable LLM providers (Claude/GPT-4o/Grok), now wired end-to-end and selectable **per task** (generation vs audit) per workspace. Nine distribution channels (X, LinkedIn, Reddit, Threads, Bluesky, Email + three manual). Phase 3A (15 gaps/fixes), Phase 3B (5 new capabilities), and Phase 3C — Creative Studio (7 items) all shipped. Social Kit (Feature 20), Sound Effects + Audio Mixer (Feature 21) complete. **Phase 4 — SaaS Readiness: core multi-tenancy, tenant-aware scheduler, workspace membership/roles, per-tenant channel credentials, a claim-based publish lock, pluggable LLM providers (4-8), and Threads + Bluesky channels (4-9) all shipped, with a 42-test Vitest suite + CI; billing is the remaining item.***
