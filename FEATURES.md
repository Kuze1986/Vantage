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
21. [Phase 3A — Gaps & Fixes](#phase-3a--gaps--fixes)
22. [Phase 3B — New Capabilities](#phase-3b--new-capabilities)
23. [Phase 3C — Creative Studio](#phase-3c--creative-studio)

---

## Implemented Features

---

### 1. Authentication & Access

**What it does:**
Users sign in with email and password via Supabase Auth. On successful login the Supabase
session token (JWT) is stored in the browser. Every API call attaches it as a
`Bearer` token. The API's `authMiddleware` verifies it against the Supabase project's
JWT secret and rejects unauthenticated requests with 401.

The app is currently single-tenant — one operator account (Brandon) controls the entire
pipeline. Row-level security on all Supabase tables is enforced through the `authenticated`
and `service_role` Postgres roles. The `vantage-api` service uses the `SUPABASE_SERVICE_ROLE_KEY`
which bypasses RLS for writes; the web app uses the anon/user key which is RLS-restricted.

**Files:**
- `apps/api/src/lib/auth.ts` — Hono middleware that extracts and verifies the JWT
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

The configuration is saved to `vantage.brand_voice` and upserted on save (there is always
exactly one row). On every generation call, the row is loaded and serialized to JSON, then
passed to Kuze as part of the user prompt.

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
performance weights, and returns a channel-formatted JSON content payload via Claude.

**Supported formats and output schemas:**

| Channel | Format | Key fields |
|---|---|---|
| X | `tweet` | `body` (≤280 chars) |
| LinkedIn | `linkedin_post` | `body`, `headline` (optional) |
| Reddit | `reddit_thread` | `title`, `body`, `is_link_post` |
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
- `apps/api/src/services/imageGen.ts` — DALL-E 3 integration
- `apps/api/src/routes/generate.ts` — `POST /v1/generate/:channel`
- `packages/prompts/src/index.ts` — system and user prompt builders, format schemas
- `apps/api/src/lib/utm.ts` — URL tagging utility

**Configuration:** `ANTHROPIC_API_KEY` (required), `ANTHROPIC_MODEL` (optional, default
`claude-sonnet-4-6`), `OPENAI_API_KEY` (required only for image generation).

---

### 5. Content Audit — Ilita

**What it does:**
Ilita is the AI brand-safety reviewer. It takes a content piece, its format, and the brand
voice, then calls Claude to assess whether the content passes NEXUS brand guidelines.

Returns one of:
- `"pass"` — content is approved, moves to `approved` status
- `"fail"` — content is rejected; feedback string explains why

In the auto-approve pipeline, a fail triggers one automatic regeneration with the feedback
appended to the topic prompt. If the second attempt also fails, the piece is marked
`rejected`. The number of audit attempts is tracked in `audit_iterations`.

**Files:**
- `apps/api/src/services/ilita.ts` — audit logic
- `apps/api/src/routes/audit.ts` — `POST /v1/audit`

**Configuration:** Uses `ANTHROPIC_API_KEY` (same client as Kuze).

---

### 6. Queue & Status Machine

**What it does:**
Every content piece moves through a defined status machine stored in `content_pieces.status`:

```
draft → auditing → approved → queued → published
                └→ rejected
                             └→ failed (on publish error)
```

- **draft** — generated but not yet audited (not used in current flow; pieces enter as `auditing`)
- **auditing** — pending Ilita review
- **approved** — passed audit, waiting for operator approval or auto-approve
- **queued** — approved and scheduled (`scheduled_for` timestamp set), waiting for cadence tick
- **published** — successfully sent to platform; `published_at` and `external_post_id` set
- **rejected** — failed audit twice in auto-approve, or manually rejected
- **failed** — publish attempt threw an error; error stored in `audit_notes`

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

#### Email
Sends via Resend API to all active subscribers (where `unsubscribed_at IS NULL`).
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
A scheduler that runs three recurring ticks in a single Node.js process. Started at API
boot via `startCadenceEngine()`.

#### Cadence tick (every 60 seconds)
Queries `content_pieces` for pieces with `status = 'queued'` and `scheduled_for ≤ now`.
For each, calls the appropriate channel adapter to publish. On success: sets status to
`published`, records `published_at` and `external_post_id`. On failure: sets status to
`failed`, records error in `audit_notes`. Processes up to 20 pieces per tick.

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
Runs as `supabase/functions/bioloop/index.ts` on a pg_cron schedule. Calls `runBioLoop()`
and `identifyEvergreenTopics()` in parallel if `bioloop_enabled` is true in settings.
Can also be triggered manually via the Dashboard 🧬 BioLoop button or `POST /v1/bioloop/run`.

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
Manages the seven distribution channels and their per-channel configuration.

**OAuth channels** (X, LinkedIn, Reddit): Full OAuth 2.0 PKCE flow.
- `POST /v1/channels/:slug/auth/start` — generates the authorization URL with code verifier
- `GET /v1/channels/:slug/auth/callback` — exchanges code for tokens, stores in `vantage.channels`
- Tokens stored: `access_token`, `refresh_token`, `token_expiry`, `access_token_hash`
- `connected` status = whether `access_token_hash` is populated

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
videos from a structured script + URL input.

**Pipeline steps:**
1. **Record** — Playwright launches a headless Chromium browser at the target URL,
   executes script steps (navigate / click / fill / wait / scroll / narrate), and
   records the session as a WebM video.
2. **Synthesize** — ElevenLabs text-to-speech converts all `narration` fields from
   the script steps into a single MP3 audio file. Voice ID is configurable per job.
3. **Mix** — FFmpeg combines screen recording + narration audio + optional background
   music track (at 15% volume). Scales to platform dimensions:
   - TikTok: 1080×1920 (9:16 portrait)
   - Instagram Reels: 1080×1920 (9:16 portrait)
   - LinkedIn: 1920×1080 (16:9 landscape)
4. **Upload** — MP4 output is uploaded to `vantage-media` Supabase Storage at
   `demoforge/<format>/<job_id>.mp4`. Returns the public URL.

**Job lifecycle:** Jobs are persisted to `vantage.demoforge_jobs` throughout.
Status transitions: `pending → recording → synthesizing → mixing → done / failed`.
Processing is sequential (one job at a time) to avoid overloading the Railway worker.

**Script step types:**
- `navigate` — load a URL
- `click` — click a CSS selector
- `fill` — type into a field
- `wait` — pause N milliseconds
- `scroll` — scroll down 300px
- `narrate` — pause for narration (audio-only, no browser action)

**API (internal, called via vantage-api proxy):**
- `POST /jobs` — submit a job, returns `job_id` immediately (202)
- `GET /jobs/:id` — poll status

**vantage-api proxy endpoints:**
- `POST /v1/demoforge/jobs`
- `GET /v1/demoforge/jobs/:id`
- `GET /v1/demoforge/jobs` (lists recent jobs from DB)

The DemoForge job submission UI lives at `/demoforge` in the web app (`DemoForgePage.tsx`).
It includes the target URL input, format selector, step editor, music library picker,
job submission, and a 5-second status poller showing pipeline progress.

**Files:**
- `apps/demoforge/src/index.ts` — Hono server
- `apps/demoforge/src/jobs/queue.ts` — in-process job queue
- `apps/demoforge/src/jobs/processor.ts` — pipeline orchestration
- `apps/demoforge/Dockerfile`
- `apps/api/src/routes/demoforge.ts` — vantage-api proxy

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

**Non-configurable here (live in Channels page):**
- Auto-approve toggle — per-channel in CadenceForm
- Posting cadence (posts_per_day, posting_hours) — per-channel in CadenceForm

**Files:**
- `apps/web/src/pages/SettingsPage.tsx`
- `apps/api/src/routes/settings.ts`
- `apps/api/src/lib/settings.ts`
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

**Core tables:**
- `vantage.channels` — channel config, tokens, cadence
- `vantage.topics` — ingested source topics
- `vantage.content_pieces` — generated content with full status history
- `vantage.engagement_events` — platform engagement signals
- `vantage.activity_events` — pipeline audit log
- `vantage.brand_voice` — brand identity config
- `vantage.generation_weights` — BioLoop pattern weights
- `vantage.newsletter_subscribers` — email list
- `vantage.music_tracks` — DemoForge music registry
- `vantage.demoforge_jobs` — video generation job queue
- `vantage.settings` — global pipeline configuration

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

*Last updated: Phase 3A and 3B fully shipped (15 items). Social Kit ported and documented as Feature 20. Phase 3C — Creative Studio fully shipped (7 items): 3C-0 creative foundation, 3C-1 carousel builder, 3C-2 AI caption studio, 3C-3 OG share-card generator, 3C-4 DemoForge thumbnails, 3C-5 pull-quote cards, 3C-6 email template builder. Pre-existing typecheck errors in PreviewModal/QueuePage/DashboardPage also fixed.*
