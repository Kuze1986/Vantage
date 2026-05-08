# Supabase migrations (nexus-core)

Target project ref: `yrvdxofquvprklzsxoav` (nexus-core).

## Apply

1. Confirm you are linked to the correct Supabase project: `supabase link --project-ref yrvdxofquvprklzsxoav`
2. **Warning:** `20260601000000_vantage_schema.sql` runs `drop schema if exists vantage cascade;` — destroys all data in `vantage`.
3. Push migrations: `supabase db push` (or run SQL in the SQL editor in order).

## Order

1. `20260601000000_vantage_schema.sql`
2. `20260601000100_vantage_storage.sql`
3. `20260601000200_vantage_realtime.sql`
4. `20260601000300_vantage_api_grants.sql`

## Expose `vantage` on the Data API (fixes `invalid schema: vantage`)

PostgREST only accepts schemas the project **explicitly exposes**. Without this, the JS client’s `.schema("vantage")` calls fail (often reported as **invalid schema: vantage**).

1. Open [API / Data API settings](https://supabase.com/dashboard/project/_/settings/api) for **nexus-core**.
2. Find **Exposed schemas** (or equivalent in your dashboard version).
3. Add **`vantage`** alongside `public` (and any others you use, e.g. `graphql_public`).
4. Save. If the dashboard offers “Reload schema” / PostgREST reload, use it.
5. Run migration **`20260601000300_vantage_api_grants.sql`** (or `supabase db push`) so `anon`, `authenticated`, and `service_role` have `USAGE` on the schema and privileges on tables.

See also: [Using custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas).

For **`supabase start`** locally, [`config.toml`](config.toml) includes `vantage` under `[api].schemas` so local PostgREST matches production.

## Shift source pipeline

`apps/api` reads `shift.questions` via the service role. Ensure the `shift` schema exists in the same database and the service role (or a DB role used by the API) has `select` on `shift.questions`. If column names differ, adjust `apps/api/src/services/source.ts`.
