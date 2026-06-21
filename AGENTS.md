# AGENTS.md

## Cursor Cloud specific instructions

Vantage is a **pnpm workspace monorepo** (`apps/web` = Vite + React SPA, `apps/api` = Hono service, `packages/shared-types`, `packages/prompts`). See `README.md` for routes and the local-dev flow; scripts are in the root `package.json` (`dev`, `build`, `lint`, `typecheck`, `test`).

Environment / setup notes (deps are installed automatically by the cloud update script):

- Use **pnpm** via corepack (run from the repo root so the pinned pnpm 9.x is used). Node 22 is present; the workspace declares Node 20, so a harmless "Unsupported engine" warning prints — ignore it.
- Copy env from `.env.local.example` into `apps/web/.env.local` and `apps/api/.env` before `pnpm dev` (both gitignored). No real Supabase / Anthropic / X secrets are injected here.
- `pnpm dev` runs web (Vite, defaults to 5173) and the API (Hono on `PORT`, default 8787) concurrently. API health: `curl localhost:8787/health` → `{"ok":true}`. With placeholder Supabase, the API's background scheduler ticks log `fetch failed` errors — expected, the HTTP server still serves. The web SPA redirects unauthenticated users to `VITE_NEXUS_AUTH_URL` (external Nexus SSO), so full web flows need a real auth backend.

Gotchas:

- `apps/api` typecheck imports the workspace package `@vantage/prompts`, whose declarations only exist after a build. Run `pnpm build` (it builds `shared-types` and `prompts` first) before `pnpm typecheck`, otherwise `apps/api` typecheck fails with `Cannot find module '@vantage/prompts'`.
- After building the packages, `pnpm typecheck` and `pnpm test` (Vitest in `apps/api`) pass.
