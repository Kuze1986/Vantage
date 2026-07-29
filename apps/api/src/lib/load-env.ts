// Side-effect module: load environment variables BEFORE any other module reads
// process.env. Imported first in index.ts so it runs during the import phase.
//
// In this monorepo the single source of truth is the repo-root `.env.local`
// (the api runs from apps/api, so dotenv's default `./.env` lookup would miss
// it). We load, in order of precedence: apps/api/.env.local, apps/api/.env,
// then the repo-root .env.local and .env. dotenv does NOT override already-set
// vars, so earlier (more specific) files win.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url)); // apps/api/src/lib
const apiDir = resolve(here, "..", ".."); // apps/api
const repoRoot = resolve(apiDir, "..", ".."); // repo root

for (const path of [
  resolve(apiDir, ".env.local"),
  resolve(apiDir, ".env"),
  resolve(repoRoot, ".env.local"),
  resolve(repoRoot, ".env"),
]) {
  config({ path });
}
