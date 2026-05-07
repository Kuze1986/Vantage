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

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | nexus-core URL |
| `SUPABASE_ANON_KEY` | JWT verification |
| `SUPABASE_SERVICE_ROLE_KEY` | server writes to `vantage` + `shift` reads |
| `ANTHROPIC_API_KEY` | Kuze + Ilita |
| `CORS_ORIGIN` | exact SPA origin (no trailing slash mismatch) |
| `X_CLIENT_ID` | X OAuth 2.0 |
| `X_CLIENT_SECRET` | X OAuth 2.0 |
| `X_REDIRECT_URI` | must match X developer app callback URL (`…/v1/channels/x/auth/callback`) |
| `X_WEBHOOK_SECRET` | optional; CRC uses this or falls back to `X_CLIENT_SECRET` |
| `PORT` | Railway injects |

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
