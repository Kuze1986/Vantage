# Railway deployment checklist

## Shared (both services)

- Repository: this monorepo.
- **Install command** (from repo root):

```bash
corepack enable && pnpm install --frozen-lockfile
```

## API service (`vantage-api`)

- **Build command:**

```bash
pnpm --filter @vantage/shared-types build && pnpm --filter @vantage/prompts build && pnpm --filter @vantage/api build
```

- **Start command:**

```bash
pnpm --filter @vantage/api start
```

- **Environment variables**


| Variable                    | Purpose                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| `SUPABASE_URL`              | nexus-core URL                                                            |
| `SUPABASE_ANON_KEY`         | JWT verification                                                          |
| `SUPABASE_SERVICE_ROLE_KEY` | server writes to `vantage` + `shift` reads                                |
| `CORS_ORIGIN`               | exact SPA origin (no trailing slash mismatch)                             |
| `WEB_APP_URL`               | single origin the OAuth callback bounces back to; falls back to first `CORS_ORIGIN` entry |
| `PORT`                      | Railway injects                                                           |

### LLM providers

At least one API key is required. Each AI task resolves to an ordered chain of
`provider:model` slots and fails over automatically when a slot errors — rate
limited, out of credits, overloaded, or unreachable. Failovers are recorded as
`llm.failover` activity events; a run where every slot failed logs
`llm.chain_exhausted` with each attempt and why it failed.

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Claude — default for Ilita (audit) |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | GPT — default for Kuze (generation) |
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) / `GEMINI_MODEL` | Gemini, via Google's OpenAI-compat endpoint |
| `XAI_API_KEY` (or `GROK_API_KEY`) / `XAI_MODEL` | Grok |
| `KIMI_API_KEY` (or `MOONSHOT_API_KEY`) / `KIMI_MODEL` | Kimi / Moonshot |
| `*_BASE_URL` | per-provider endpoint override (proxy, region, self-host) |
| `LLM_POOL_GENERATE` / `LLM_POOL_AUDIT` | per-task failover chain, e.g. `openai:gpt-4o,anthropic` |
| `LLM_PROVIDER_GENERATE` / `LLM_PROVIDER_AUDIT` | per-task single provider (legacy form, still honoured) |
| `LLM_POOL` / `LLM_PROVIDER` | global fallback for both tasks |
| `LLM_MAX_ATTEMPTS` | slots tried before giving up (default 3) |

> **Leave `LLM_PROVIDER` unset.** It pins *both* tasks to one provider and
> overrides the per-task defaults (Kuze → OpenAI, Ilita → Anthropic). Earlier
> versions of `.env.local.example` shipped `LLM_PROVIDER=anthropic`; if that was
> copied into Railway, per-task settings will appear to have no effect.

Per-workspace choices in **Settings → AI Providers** outrank all of these.
`GET /v1/settings/llm-resolution` returns the chain each task actually resolves to.

Every OAuth channel takes the same three vars. The redirect URI must match the
provider app's registered callback **exactly** — lowercase slug, no trailing slash
— and is sent twice (authorize + token exchange), so a mismatch fails *after*
consent with a confusing error.

| Channel   | Variables                                                            | Callback path                            |
| --------- | -------------------------------------------------------------------- | ---------------------------------------- |
| X         | `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`                    | `…/v1/channels/x/auth/callback`          |
| LinkedIn  | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI` | `…/v1/channels/linkedin/auth/callback`   |
| Reddit    | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_REDIRECT_URI`     | `…/v1/channels/reddit/auth/callback`     |
| Threads   | `THREADS_CLIENT_ID`, `THREADS_CLIENT_SECRET`, `THREADS_REDIRECT_URI`  | `…/v1/channels/threads/auth/callback`    |
| TikTok    | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`    | `…/v1/channels/tiktok/auth/callback`     |
| Instagram | `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET`, `INSTAGRAM_REDIRECT_URI` | `…/v1/channels/instagram/auth/callback` |
| Facebook  | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`, `FACEBOOK_REDIRECT_URI` | `…/v1/channels/facebook/auth/callback`  |

Per-provider gotchas:

- **Instagram + Facebook** share one Meta app and one authorize endpoint. Both
  callback URLs must be listed as separate entries under **Products → Facebook
  Login → Settings → Valid OAuth Redirect URIs**, with "Client OAuth login" and
  "Web OAuth login" enabled. App Domains does *not* allowlist them — leaving them
  out produces Meta's misleading "the domain of this URL isn't included in the
  app's domains" dialog. Threads is exempt: it validates against the Threads use
  case's own Redirect Callback URLs field.
- **Reddit** blocks datacenter IPs at its edge, so token exchange from Railway can
  403 even with correct credentials. Set `REDDIT_USER_AGENT` to Reddit's required
  format (`web:vantage:1.0.0 (by /u/<username>)`) and, if still blocked,
  `REDDIT_PROXY_URL` to route calls through a clean IP.
- **X** also takes `X_WEBHOOK_SECRET` (optional; CRC falls back to `X_CLIENT_SECRET`).

Non-OAuth channels:

| Channel | Variables                                                        | Notes                                                    |
| ------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| Bluesky | none                                                             | per-workspace handle + app password entered in the UI     |
| Email   | `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `RESEND_WEBHOOK_SECRET` | env-only; the Channels tile never reads "Connected"       |

`RESEND_FROM_ADDRESS` is the exact name the adapter reads — `RESEND_FROM_EMAIL`
is silently ignored and the channel throws "Email channel not configured".


## Web service (`vantage-web`)

- **Build command:**

```bash
pnpm --filter @vantage/web build
```

Set **Railway build-time variables** (or dashboard “Variables” scoped to build):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_VANTAGE_API_URL` — public `https://…` of the API service
- **Start command:**

```bash
pnpm --filter @vantage/web start
```

`apps/web/scripts/listen.mjs` binds `serve` to `0.0.0.0:$PORT`.

## Smoke (Phase 0)

1. Sign in on web (stub email/password user in Supabase Auth).
2. Save brand voice.
3. Start X OAuth; confirm `vantage.channels` row `x` has `enabled=true` after callback.
4. Dashboard → pull topics → generate → Queue → audit → publish.
5. Send a test POST to `/v1/webhooks/x` and confirm `vantage.engagement_events` + activity log.

