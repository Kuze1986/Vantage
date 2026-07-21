# Vantage — First Campaign Launch Guide

> A complete walkthrough for getting your first automated marketing campaign live.
> Follow every section in order. Each step builds on the last.

---

## Table of Contents

1. [Log In](#1-log-in)
2. [Set Your Brand Voice](#2-set-your-brand-voice)
3. [Configure Your Channels](#3-configure-your-channels)
4. [Set Cadence Per Channel](#4-set-cadence-per-channel)
5. [Configure Pipeline Settings](#5-configure-pipeline-settings)
6. [Add Newsletter Subscribers (Email Channel)](#6-add-newsletter-subscribers-email-channel)
7. [Pull Your First Topics](#7-pull-your-first-topics)
8. [Run a Pulse Reactor Scan](#8-run-a-pulse-reactor-scan)
9. [Generate Content](#9-generate-content)
10. [Preview Your Content](#10-preview-your-content)
11. [Audit Content with Ilita](#11-audit-content-with-ilita)
12. [Queue and Schedule Posts](#12-queue-and-schedule-posts)
13. [Publish](#13-publish)
14. [Monitor the Live Activity Feed](#14-monitor-the-live-activity-feed)
15. [Review the Content Calendar](#15-review-the-content-calendar)
16. [Enable Auto-Pilot (Auto-Approve)](#16-enable-auto-pilot-auto-approve)
17. [Analyze Performance](#17-analyze-performance)
18. [Run BioLoop](#18-run-bioloop)
19. [Identify Evergreen Topics](#19-identify-evergreen-topics)
20. [Create a DemoForge Video](#20-create-a-demoforge-video)
21. [Handle Failed Posts](#21-handle-failed-posts)
22. [Set Up Failure Alerts](#22-set-up-failure-alerts)
23. [Connect Platform Webhooks](#23-connect-platform-webhooks)

---

## 1. Log In

Navigate to your Vantage deployment URL and sign in with your operator email and password.

- Vantage is single-operator — one account controls the entire pipeline.
- Your session is secured with a Supabase JWT. All API calls are authenticated automatically.
- If you see a blank screen for more than a few seconds, check that `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set in your web app environment.

On successful login you land on the **Dashboard**.

---

## 2. Set Your Brand Voice

Before generating any content, define who you are. Every piece Kuze writes is shaped by your brand voice.

1. Click **Voice** in the left sidebar.
2. Fill in the **Brand Name** field (e.g. `NEXUS`).
3. Write a **Description** — one paragraph that defines your brand's identity, mission, and personality. Be specific. This text is injected into every generation prompt.
4. Set **Per-Channel Tone** for each platform you plan to use:
   - **X** — punchy, direct, conversational
   - **LinkedIn** — professional, insight-driven, thought leadership
   - **Reddit** — community-native, genuine, no hard sell
   - **Email** — warm, informative, value-first
   - **TikTok / Instagram / Facebook** — platform-appropriate voice guidance
5. Add **Off-Topics** — subjects Kuze must never write about (competitors, sensitive issues, anything off-brand). Add one per line.
6. Click **Save**.

> Your brand voice is now active. It will be used on every generation call going forward.

---

## 3. Configure Your Channels

Go to **Channels** in the sidebar. You will see tiles for all nine channels: X, LinkedIn, Reddit, Threads, Bluesky, Email, TikTok, Instagram, and Facebook.

### OAuth Channels (X, LinkedIn, Reddit, Threads)

These require connecting a real platform account:

1. Click the channel tile to expand it.
2. Click **Connect** (or the OAuth button).
3. You will be redirected to the platform's authorization page.
4. Approve the permissions requested.
5. You are redirected back to Vantage. The tile will show a **live** badge when connected.

> Each platform's app credentials must be set in the API environment first —
> `X_CLIENT_ID`/`X_CLIENT_SECRET`/`X_REDIRECT_URI`, the matching `LINKEDIN_*`, `REDDIT_*`, and
> `THREADS_*` vars. Tokens are stored server-side per workspace; you do not handle them manually.

### Bluesky Channel (app password)

Bluesky doesn't use an OAuth redirect. Instead:

1. In the Bluesky app, go to **Settings → App Passwords** and create one (do **not** use your main password).
2. In Vantage, expand the **Bluesky** tile and enter your handle (e.g. `you.bsky.social`) and the app password.
3. Click **Connect Bluesky**. The tile shows a **live** badge once the session is established.

### Email Channel

The Email channel does not use OAuth. It sends via **Resend**:

1. Ensure `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are set in your API environment variables.
2. The Email tile will show as enabled without an OAuth flow.

### Manual Channels (TikTok, Instagram, Facebook)

These channels have no direct API publish. Content is generated and formatted for you, but you post it manually:

1. Click the tile to enable the channel.
2. When content is ready, the Queue page will display copy-ready text, hashtags, on-screen captions, and upload instructions.
3. After posting manually, paste the post URL back into Vantage to mark it published.

---

## 4. Set Cadence Per Channel

Still on the **Channels** page, expand each connected channel and configure its cadence. This controls how many posts go out and when.

| Setting | What it does |
|---|---|
| **Posts Per Day** | Target number of pieces to publish daily. The auto-generate engine fills deficits toward this number. |
| **Posting Hours** | UTC hours when posts should be scheduled (e.g. `9, 12, 17` for 9am, noon, and 5pm). |
| **Auto-Approve** | When ON, content that passes Ilita's brand audit goes straight to the publish queue without manual review. Start with this OFF until you're comfortable with output quality. |
| **Subreddits** (Reddit only) | Comma-separated list of subreddit names to post to. Vantage will rotate through them in order — no random selection. |
| **Newsletter Day** (Email only) | Day of the week for newsletter sends. |

Click **Save** after configuring each channel.

---

## 5. Configure Pipeline Settings

Go to **Settings** in the sidebar.

| Setting | Recommended Starting Value | Purpose |
|---|---|---|
| **Dedup Days** | `30` | Topics seen within this many days are not re-imported. Prevents the same topic from flooding your queue. |
| **Scripta Enabled** | ON (if you use Scripta lessons as a content source) | Pulls lesson content from the `scripta` schema as high-priority topics. |
| **BioLoop Enabled** | ON | Runs the daily engagement-learning cycle. Keeps generation improving automatically. |
| **Active Verticals** | Leave blank initially | When set, only topics matching these verticals are imported from Shift. Useful for focusing output once you know which verticals perform. |
| **Evergreen Threshold** | `3` | Minimum engagement events a topic's content must receive to qualify for recycling. |
| **Evergreen Recycle Days** | `90` | How many days after qualifying before a topic is recycled for fresh generation. |

Click **Save**. Settings take effect on the next pipeline tick — no restart needed.

### Choose your AI providers (optional)

Vantage isn't locked to one AI model. In the **AI Providers** panel on the Settings page you can
pick — independently — which model powers each task:

- **Content generation (Kuze)** — writes your posts, threads, and captions.
- **Compliance audit (Ilita)** — reviews each piece before it ships.

Each dropdown offers **Claude (Anthropic)**, **GPT-4o (OpenAI)**, and **Grok (xAI)**, plus
"Inherit default". A provider is only selectable if its API key is configured server-side
(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROK_API_KEY`) — unconfigured ones show greyed out. Leave
a task on "Inherit default" to use the server's `LLM_PROVIDER_GENERATE` / `LLM_PROVIDER_AUDIT`
(or global `LLM_PROVIDER`) environment default. If you change nothing, everything runs on Claude.

> Example: generate with Claude for quality, audit with GPT-4o for a second opinion — set each
> dropdown accordingly and click **Save**. Changes take effect on the next generation/audit.

---

## 6. Add Newsletter Subscribers (Email Channel)

If you are using the Email channel, build your list before your first send.

1. Go to **Channels** and expand the **Email** tile.
2. Scroll down to the **Subscribers** panel.
3. Click **Add Subscriber**.
4. Enter the subscriber's email address, name (optional), and any tags.
5. Click **Add**.
6. Repeat for each subscriber, or import in bulk via the API (`POST /v1/subscribers`).

> Subscribers who unsubscribe are soft-deleted (retained for audit). The active send list is everyone where unsubscribed_at is empty.

---

## 7. Pull Your First Topics

Topics are the raw material Kuze uses to generate content. Vantage pulls from **The Shift** (theshift.bioloopnexus.com questions database) and **Scripta** lesson content.

1. Go to the **Dashboard**.
2. Find the **Source Pipeline** panel on the left.
3. Click **Pull Topics**.
4. Wait for the confirmation message. It will report how many new topics were imported from Shift and Scripta.
5. The **Topics Available** stat card will update.
6. You will see topic cards appear in the list below, tagged with their vertical (e.g. `fintech`, `health`, `saas`).

> Topics are deduplicated automatically. The same topic will not be imported twice within your configured dedup window.

---

## 8. Run a Pulse Reactor Scan

Pulse Reactor supplements your Shift/Scripta topics with real-time trending signals from Hacker News, Reddit, and (optionally) NewsAPI.

1. On the **Dashboard**, in the Source Pipeline panel, click **⚡ Pulse Reactor**.
2. Wait for the scan to complete. It runs three sources in parallel — usually takes 5–15 seconds.
3. The confirmation message shows how many new signals were found and inserted.
4. New topics from Pulse appear in your topic list with a **⚡ pulse** badge.

> Pulse topics are prioritized and scored by engagement (upvotes + comments). High-scoring signals get higher priority in the queue. Pulse also runs automatically every 30 minutes in the background.

---

## 9. Generate Content

Now that you have topics, generate your first pieces of content.

### Single piece

1. On the **Dashboard**, in the Source Pipeline panel, select your target channel using the **GEN FOR** channel selector (e.g. click `𝕏` for X).
2. Optionally check **+ Image** if you want DALL-E 3 to generate an image alongside the text.
3. Find a topic in the list and click **Gen 𝕏** (or whichever channel you selected).
4. Kuze generates the content, Ilita immediately reviews it, and it moves to the Queue.
5. A success message confirms the draft was created.

### A/B Variants

To generate multiple versions of the same topic for testing:

1. Select the channel.
2. Click **A/B ×2** or **A/B ×3** instead of the single generate button.
3. Kuze produces 2 or 3 independent pieces from the same topic. Each goes through the audit pipeline independently.
4. All variants share a `variant_group_id` — they are grouped in the Queue with a variant badge.

### What Kuze produces per channel

| Channel | What you get |
|---|---|
| X | Body text ≤280 characters |
| LinkedIn | Body text + optional headline |
| Reddit | Thread title + body, optional link post |
| Threads | Body text ≤500 characters |
| Bluesky | Body text ≤300 characters |
| Email | Subject line, preview text, full HTML body |
| TikTok | Hook line, full script, on-screen text, upload instructions |
| Instagram | Caption, hashtags (5+), alt text, upload instructions |
| Facebook | Post text, upload instructions |

---

## 10. Preview Your Content

Before auditing or approving anything, see exactly how it will look on the platform.

1. Go to **Queue** in the sidebar.
2. Find a piece in **auditing** or **approved** status.
3. Click the **👁 Preview** button on that row.
4. A modal opens showing a platform-accurate rendering:
   - **X** — Twitter-card style box with live character counter
   - **LinkedIn** — bold headline, formatted body, character count
   - **Reddit** — title + body with title length validation
   - **Email** — subject, preview text, and full HTML body in a sandboxed frame
   - **TikTok / Instagram / Facebook** — formatted script/caption view
5. If the content looks wrong — too long, broken formatting, off-tone — reject it and regenerate.
6. Close the modal when done.

---

## 11. Audit Content with Ilita

Ilita is your AI brand-safety reviewer. It checks every piece against your brand voice before it can be published.

**In the automatic flow** (recommended to start):
- When you click Generate, Ilita runs immediately.
- Pass → piece moves to `approved`.
- Fail → Kuze regenerates once with the failure feedback appended. Second pass → `approved`. Second fail → `rejected`.

**Manual audit from the Queue:**

1. Go to **Queue** and select the **auditing** tab.
2. Find a piece waiting for review.
3. Click **Audit**.
4. Ilita runs and the piece transitions to `approved` or `rejected`.
5. For rejected pieces, the audit notes explain why — use this to refine your Brand Voice off-topics list.

---

## 12. Queue and Schedule Posts

Approved content needs to be scheduled before the cadence engine will publish it.

1. Go to **Queue** and select the **approved** tab.
2. For each piece you want to schedule, click **Queue**.
3. Vantage sets a `scheduled_for` timestamp based on the channel's configured posting hours.
4. The piece moves to **queued** status.
5. The cadence engine will pick it up and publish it at the scheduled time automatically.

> You can also click **Publish** to send it immediately without waiting for the scheduled slot.

---

## 13. Publish

### Automatic (API channels — X, LinkedIn, Reddit, Threads, Bluesky, Email)

Once a piece is in **queued** status with a `scheduled_for` time that has passed, the cadence engine publishes it automatically every 60 seconds. No action needed.

On success: status → `published`, `published_at` and `external_post_id` are recorded.

### Manual (TikTok, Instagram, Facebook)

1. Go to **Queue** and find the piece in **approved** or **queued** status.
2. The piece shows your formatted content: hook, script, hashtags, on-screen text, and upload instructions.
3. Click **Copy** to copy the content to your clipboard.
4. Go to the platform and post manually.
5. Copy the URL of the post you just created.
6. Back in Vantage, paste the URL into the **Post URL** field on that queue row.
7. Click **Mark Published**.

---

## 14. Monitor the Live Activity Feed

The **Dashboard** right panel shows a real-time feed of everything happening in your pipeline.

- Events stream in automatically via Supabase Realtime — no refresh needed.
- Each entry shows the source (`kuze`, `ilita`, `scheduler`, `adapter:x`, `bioloop`), timestamp, and a summary.
- Look for:
  - `cadence_published` — successful publish
  - `auto_approved_queued` — auto-pilot queued a piece
  - `publish_retry_scheduled` — a failed publish is being retried
  - `bioloop_complete` — BioLoop ran and updated weights
  - `evergreen_recycled` — high-performing topics marked for recycling

The **Queue Breakdown** panel shows live counts per status. Watch the `auditing` count drop and `queued` count rise as auto-generation runs.

---

## 15. Review the Content Calendar

Use the Calendar to see the distribution of your scheduled posts over time.

1. Click **Calendar** in the sidebar.
2. The view shows a 7-day week grid: rows are channels, columns are days.
3. Each cell shows how many pieces are scheduled for that channel on that day. Color intensity reflects volume.
4. Click any cell to expand it and see the individual pieces — with their status badge and scheduled time.
5. Use **← Prev** and **Next →** to navigate weeks.
6. Click **Today** to snap back to the current week.

> Use this view to spot gaps (no posts on a channel for a day) or clusters (too many posts at the same time).

---

## 16. Enable Auto-Pilot (Auto-Approve)

Once you have reviewed several pieces and are satisfied with Kuze's output quality, enable fully automated generation and publishing.

1. Go to **Channels** and expand a channel.
2. Toggle **Auto-Approve** to ON.
3. Click **Save**.

With auto-approve active:
- The auto-generate tick runs every 5 minutes.
- It calculates how many pieces are needed to hit today's `posts_per_day` target.
- Generates up to 3 pieces per tick per channel.
- Each piece is audited by Ilita automatically.
- Passing pieces are scheduled using the channel's `posting_hours`.
- The cadence engine publishes them at the scheduled time.

**Your pipeline is now fully autonomous.**

> You can monitor everything from the Dashboard and Calendar. The Queue page remains available for spot-checks.

---

## 17. Analyze Performance

After your first week of posts, use the Analytics page to see what's working.

1. Click **Analytics** in the sidebar.
2. Use the **Period** selector to pick 7d, 30d, or 90d.
3. Use the **Channel** filter to isolate a specific platform or view all.

**What you'll see:**

- **Engagement Over Time** — line chart of daily engagement events, color-coded by channel. Identify which days and channels are trending up.
- **Engagement by Posting Hour** — bar chart showing which UTC hours drive the most engagement. Use this to refine your `posting_hours` cadence config.
- **Top Verticals** — bar chart of engagement rate by content vertical. Identify your strongest topic areas and use the `active_verticals` setting to focus your pipeline on them.
- **Summary stat cards** — total engagement events, top channel, top vertical, and avg events per post.

---

## 18. Run BioLoop

BioLoop is the learning engine that makes your content improve automatically over time. It analyzes which content patterns drive engagement and biases Kuze toward those patterns in future generations.

**It runs daily automatically** if `bioloop_enabled` is ON in Settings.

**To run it manually:**

1. Go to the **Dashboard**.
2. In the Source Pipeline panel, click the **🧬 BioLoop** button.
3. Wait for the confirmation. It will report how many pieces were analyzed and how many pattern weights were updated.

**What BioLoop learns (13 pattern signals):**
- Content length (short / medium / long)
- Whether the post has a question, CTA, or numbers
- Hashtag usage
- Emotional, question, or number-led openers
- Format-specific signals (punchy tweets, LinkedIn headlines, TikTok hooks)
- Content angle (how-to, data-driven, personal story)

**Viewing current weights:**

Call `GET /v1/bioloop/weights?channel=x` (or any channel slug) to see the current pattern weights. Patterns with weight ≥ 1.1 are actively biasing Kuze's output.

---

## 19. Identify Evergreen Topics

High-performing topics — those whose content received strong engagement — are recycled automatically by BioLoop's daily tick.

**How it works:**

1. BioLoop scans published pieces from the last 90 days.
2. Topics whose content received ≥ `evergreen_threshold` engagement events are marked with a `recycle_after` date (now + `evergreen_recycle_days`).
3. The topic's `used_at` is cleared so it can be picked again after the recycle window.
4. Recycled topics appear in your Dashboard topic list with a **♻ evergreen** badge.

**Adjusting thresholds:**

Go to **Settings** and update `evergreen_threshold` and `evergreen_recycle_days` to match your engagement volume and recycling cadence. Lower the threshold if your engagement counts are modest; increase recycle days if you want more time between reuses.

---

## 20. Create a DemoForge Video

DemoForge produces platform-formatted marketing videos from your product's live website — no screen recording software needed. The creative studio panels give you full control over captions, overlays, color grade, and branded bookend sequences.

### Basic setup

1. Click **DemoForge** in the sidebar.
2. Enter the **Target URL** — the page you want to demo (e.g. `https://theshift.bioloopnexus.com`).
3. Select the **Format** — TikTok (9:16 portrait), LinkedIn (16:9 landscape), or Instagram Reels (9:16 portrait).
4. Build your **Script Steps** using the step editor:
   - **navigate** — load a URL
   - **click** — click a CSS selector on the page
   - **fill** — type into an input field
   - **wait** — pause for N milliseconds
   - **scroll** — scroll the page down
   - **narrate** — add a voiceover line (TTS voiceover) without a browser action
5. Add a narration line to each key moment to explain what's happening on screen.
6. Select a **Music Track** from the library (optional).
7. Configure the creative studio panels below (all optional — collapse any you don't need):

> **Voice provider.** Narration is synthesized by **ElevenLabs** (cloud) by default. To use
> **Voicebox** instead — a free, locally-run voice engine — set `DEMOFORGE_TTS_PROVIDER=voicebox`
> (or send `tts_provider: "voicebox"` on the job). Voicebox requires the Voicebox app running
> with a model loaded and a voice profile selected (`VOICEBOX_PROFILE_ID`), and works only on
> local/self-hosted deployments.

---

### Overlays panel

Burns text or logo images directly onto the video at specified positions and times.

- **Text overlay** — enter content, font, size, color, and an optional semi-transparent box. Position with anchor buttons (left/center/right × top/center/bottom) plus pixel offsets. Set start/end seconds to show the overlay only during a specific window.
- **Logo / image overlay** — select a Brand Kit to pull the workspace logo from storage. Set display width and position the same way as text. Timing controls work identically.
- Multiple overlays can be stacked; they render in order (first = lowest layer).

> **Brand Kits** store your workspace logo, color palette, and font preferences. Create one under Settings → Brand Kits before adding image overlays.

---

### Captions panel

Auto-generates synced subtitles burned into the video from narration audio.

- Toggle **Auto-captions** on to enable. No transcript needed — with ElevenLabs, captions use real character-level timing; with Voicebox, they use an even-distribution approximation across each line's duration.
- **Font** — sans-serif or monospace.
- **Size** — default 56px portrait / 40px landscape.
- **Text color / Outline color** — hex pickers.
- **Position** — top, center, or bottom of frame.
- **Background box** — semi-transparent black box behind each line for readability on busy backgrounds.
- **Highlight current word** — karaoke-style yellow highlight tracks the spoken word in real time.
- **Max words per line** — default 4 for portrait (TikTok/Instagram), 6 for landscape (LinkedIn).

> Captions require a narration line on at least one script step. If the TTS provider is unavailable — ElevenLabs credits exhausted, or the Voicebox server unreachable / model not loaded — the video renders silently and captions are skipped.

---

### Color Grade panel

Applies a cinematic color grade to the entire video.

Select one of seven presets:

| Preset | Description |
|---|---|
| **Clean** | No adjustment — identity pass |
| **Warm** | Golden highlights, rich amber tones |
| **Cinematic** | High contrast teal-orange — film look |
| **Vibrant** | Punchy, saturated colors |
| **Muted** | Desaturated, editorial / documentary |
| **Cool** | Blue-shifted, crisp |
| **Dark** | Crushed blacks, moody |

Expand **Custom adjustments** to fine-tune brightness, contrast, saturation, RGB channel gains, and gamma on top of any preset.

---

### Intro / Outro panel

Prepends and/or appends a branded clip to the main recording.

- Clips are filtered to the selected format (TikTok, LinkedIn, Instagram, or All).
- Select an intro tile to prepend it; select an outro tile to append it. Click again to deselect.
- Clips are normalized to match the main video's dimensions and frame rate before concat — no manual matching required.

> Upload intro/outro clips via the admin panel (Settings → Intro/Outro Clips), or ask your developer to upload clips directly to the `vantage-media` storage bucket and register them in the database.

---

### Timeline panel

Controls the duration, speed, and trim of the recording before it enters the mix.

**Target duration** — enter a number of seconds. The system calculates the ratio of target ÷ estimated duration (sum of all step ms values) and rescales every wait/pause step proportionally, so the browser recording hits approximately the target length. The **Best fit** button fills in the current estimated duration as a starting point.

**Trim** — removes footage from the start or end of the raw recording before any other processing:
- *Cut start* — discards the first N seconds (useful to skip a slow page load).
- *Keep until* — drops everything after that timestamp (useful to trim a trailing pause).

**Global speed** — applies a uniform speed multiplier to the entire video and audio track:
- Preset buttons: 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×
- Fine-tune slider: 0.25×–4×
- Values &lt;1 slow the video down; &gt;1 speed it up.
- Audio speed is handled by FFmpeg `atempo` (chained for extreme values).

**Per-step speed** — toggle to enable a per-step speed column in the Script Steps panel. Each step can carry an independent 0.5–2× multiplier for fine-grained pacing control.

---

### Audio Mixer

Adjust relative volumes for narration, background music, and sound effects before submitting.

---

### Submitting and monitoring

Click **Submit Job**. The pipeline progresses through these stages — watch the status indicator:

| Stage | What's happening |
|---|---|
| `recording` | Playwright runs a headless browser, executes your script, records as WebM |
| `synthesizing` | The selected TTS provider (ElevenLabs or Voicebox) converts narration to audio with word-level timings |
| `mixing` | FFmpeg applies overlays → captions → color grade, mixes audio |
| `done` | Intro/outro concat (if set), upload to storage, download link appears |

The job history panel below the form shows all previous jobs with their status and output links.

---

## 21. Handle Failed Posts

Sometimes a publish attempt fails — expired token, network error, or platform downtime. Vantage handles this automatically through retry logic.

**Automatic retries:**

- On first failure: piece is rescheduled after 5 minutes (`retry_count = 1`).
- On second failure: rescheduled after 15 minutes (`retry_count = 2`).
- On third failure: rescheduled after 60 minutes (`retry_count = 3`).
- After three failures: piece is permanently marked `failed` and an alert is sent.

**Rate limit handling:**

If a platform returns 429 (Too Many Requests), Vantage reads the `Retry-After` header and reschedules accordingly. Rate limit reschedules do **not** count against the retry limit.

**Manual retry from the Queue:**

1. Go to **Queue** and select the **failed** tab.
2. Find the piece. The retry count is shown next to the status.
3. Click **↺ Retry** to reset the piece to `queued` with a fresh `scheduled_for`.

> Before retrying, check the audit notes on the piece — they contain the error message. If it's a token expiry, reconnect the channel in the Channels page first.

---

## 22. Set Up Failure Alerts

Vantage can notify you when pieces permanently fail to publish, so silent outages don't go unnoticed.

Set one or both of the following environment variables in your API deployment:

| Variable | Purpose |
|---|---|
| `ALERT_SLACK_WEBHOOK` | Incoming webhook URL for a Slack channel. Failure alerts are posted there. |
| `ALERT_EMAIL` | Email address to receive failure alerts via Resend. Requires `RESEND_API_KEY` to be set. |

**Alert behavior:**

- Triggered when a piece reaches permanent failure (after all retries exhausted).
- Throttled to one alert per channel per hour — you will not get spammed during an outage.
- If neither variable is set, alerts are logged to the API console only.

---

## 23. Connect Platform Webhooks

Webhooks feed engagement data back into Vantage. Without them, BioLoop has no signal to learn from for X, LinkedIn, and Email.

### X (Twitter)

1. In the Twitter Developer Portal, register a webhook URL: `https://your-api-domain/v1/webhooks/x`
2. Set `X_WEBHOOK_SECRET` in your API environment to match the secret in the Developer Portal.
3. X will send a CRC challenge — Vantage handles it automatically.
4. Engagement events (likes, retweets, replies) will flow in and be deduplicated automatically.

### LinkedIn

1. In the LinkedIn Developer App settings, add a webhook URL: `https://your-api-domain/v1/webhooks/linkedin`
2. Set `LINKEDIN_WEBHOOK_SECRET` in your API environment.
3. Vantage verifies every payload signature before processing.

### Email (Resend)

1. In the Resend dashboard, add a webhook endpoint: `https://your-api-domain/v1/webhooks/email`
2. Set `RESEND_WEBHOOK_SECRET` in your API environment.
3. Open, click, and delivery events are recorded automatically.

### Reddit

Reddit has no native webhook API. Vantage polls engagement data directly:

- The Reddit engagement poller runs automatically every 2 hours.
- It fetches current upvote and comment counts for all Reddit pieces published in the last 30 days.
- No configuration needed — it uses Reddit's public JSON API.

> All webhook events are deduplicated using a platform-provided event ID. Redeliveries are silently ignored and will not inflate your engagement counts.

---

## You're Live

At this point your campaign pipeline is fully operational:

- ✅ Brand voice defined — Kuze writes in your voice
- ✅ Channels connected — posts go to real platforms
- ✅ Cadence set — posts go out at the right times
- ✅ Topics flowing — Shift, Scripta, and Pulse feed the queue
- ✅ Auto-approve enabled — pipeline runs hands-free
- ✅ BioLoop running — content improves with every cycle
- ✅ Evergreen recycling — top topics get a second life
- ✅ Alerts configured — you'll know if something breaks
- ✅ Webhooks connected — engagement data closes the loop

Check the **Dashboard** daily for the activity feed and stat cards. Review **Analytics** weekly to spot trends and adjust your vertical focus and posting hours. Let BioLoop and the cadence engine handle the rest.
