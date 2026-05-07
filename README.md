# Vantage

Automated advertising loop for the NEXUS portfolio: **source → Kuze → Ilita → queue → X publish → engagement webhooks**.

## Repo layout

- `apps/web` — React + Vite SPA (`VITE_VANTAGE_API_URL` at build time)
- `apps/api` — Hono `vantage-api` (Supabase JWT + service role)
- `packages/shared-types`, `packages/prompts`
- `supabase/migrations` — apply to **nexus-core** (`yrvdxofquvprklzsxoav`)

## Local dev

1. Copy [`.env.local.example`](.env.local.example) into `apps/api/.env` and `apps/web/.env.local` (or use root `.env` for the API with `dotenv`).
2. Apply migrations (see [`supabase/README.md`](supabase/README.md)).
3. Create a Supabase user for Brandon and sign in via stub SSO (email/password) on the web app.
4. From repo root:

```bash
pnpm install
pnpm dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:8787`

## Railway (two services)

### Service A — `vantage-api`

- **Root directory:** `apps/api`
- **Build:** `pnpm install && pnpm exec tsc -p tsconfig.build.json` (from `apps/api`, after monorepo install — see below)
- **Start:** `node dist/index.js`
- **Env:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `CORS_ORIGIN` (public web URL), `X_*`, `PORT` (Railway)

Monorepo note: Railway can use **root directory** repo with custom install:

- Install: `corepack enable && pnpm install --frozen-lockfile` at repo root
- Build command: `pnpm --filter @vantage/shared-types build && pnpm --filter @vantage/prompts build && pnpm --filter @vantage/api build`
- Start command: `pnpm --filter @vantage/api start`
- Watch paths: `apps/api`, `packages/shared-types`, `packages/prompts`

### Service B — `vantage-web`

- **Install** (root): same as above
- **Build:** `pnpm --filter @vantage/web build` with build args `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VANTAGE_API_URL` set to production values
- **Start:** `pnpm --filter @vantage/web start` (serves `apps/web/dist` on `PORT`)

See [docs/railway.md](docs/railway.md) for a copy-paste checklist.

## Phase 0 flow

1. Configure **Brand voice** (Voice page).
2. **Channels** → Connect X (OAuth).
3. **Dashboard** → Pull topics from `shift.questions`, generate X draft.
4. **Queue** → Run Ilita audit → Publish (or queue then publish).

## API routes (JWT except webhooks + OAuth callback)

- `GET /v1/source/topics`
- `POST /v1/source/refresh`
- `POST /v1/generate/:channel` (x)
- `POST /v1/audit`
- `POST /v1/publish/:channel` (x)
- `POST /v1/schedule`
- `GET /v1/dashboard/overview`
- `POST /v1/channels/x/auth/start` (JWT)
- `GET /v1/channels/x/auth/callback` (public)
- `GET|POST /v1/webhooks/x` (public; CRC + events)
