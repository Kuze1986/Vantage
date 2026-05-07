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

## Shift source pipeline

`apps/api` reads `shift.questions` via the service role. Ensure the `shift` schema exists in the same database and the service role (or a DB role used by the API) has `select` on `shift.questions`. If column names differ, adjust `apps/api/src/services/source.ts`.
