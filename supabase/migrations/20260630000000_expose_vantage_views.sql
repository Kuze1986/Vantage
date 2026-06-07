-- Expose every vantage table to PostgREST via public views.
--
-- Why: PostgREST only serves schemas on its exposed list (here: `public`).
-- All app tables live in `vantage`, so the API (service_role) reaches them
-- through auto-updatable `public.<table>` views. A `SELECT *` view over a single
-- table is automatically updatable in Postgres 9.3+, so INSERT/UPDATE/DELETE/
-- RETURNING pass through to the base table (defaults, triggers, RLS included).
--
-- Earlier migrations created views for only a handful of tables, so features
-- whose tables had no view (campaigns, segments, intelligence_*, virality_*,
-- ga4_sync_config, …) silently failed every read/write. This migration:
--   1. Rebuilds a public view + service_role grant for ALL existing vantage
--      tables. It DROPs+CREATEs (not CREATE OR REPLACE) so it also repairs views
--      whose column list drifted from the base table (CREATE OR REPLACE cannot
--      rename/reorder columns -> error 42P16). Existing *authenticated* grants
--      are captured and re-applied so the browser's access (e.g. brand_voice in
--      VoicePage) is preserved. anon grants are intentionally NOT re-applied —
--      see 20260701000000_revoke_anon_grants.sql.
--   2. Installs an event trigger so any table created in `vantage` later gets its
--      view + grant automatically — no per-feature step.
--
-- Idempotent: safe to re-run, including after ALTERing a vantage table.

-- 1. Rebuild views for all existing tables -----------------------------------
DO $$
DECLARE
  t text;
  roles_to_keep text[];
  r text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'vantage' ORDER BY tablename
  LOOP
    -- Don't clobber a real (non-view) relation that already occupies public.<t>
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind <> 'v'
    ) THEN
      CONTINUE;
    END IF;

    -- Remember which browser roles currently have access, to re-grant after rebuild.
    -- NOTE: deliberately authenticated-only — anon must never regain table access
    -- (see 20260701000000_revoke_anon_grants.sql). Re-granting anon here was how
    -- the unauthenticated read/write hole kept coming back after every rebuild.
    SELECT array_agg(DISTINCT grantee) INTO roles_to_keep
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = t
      AND grantee = 'authenticated';

    EXECUTE format('DROP VIEW IF EXISTS public.%I', t);
    EXECUTE format('CREATE VIEW public.%I AS SELECT * FROM vantage.%I', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);

    IF roles_to_keep IS NOT NULL THEN
      FOREACH r IN ARRAY roles_to_keep LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- 2. Auto-expose future tables ----------------------------------------------
-- SECURITY DEFINER so the view/grant are created by this function's (superuser)
-- owner regardless of who runs the CREATE TABLE.
CREATE OR REPLACE FUNCTION public.expose_vantage_table()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  obj record;
  tbl text;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF obj.object_type = 'table' AND obj.schema_name = 'vantage' THEN
      tbl := split_part(obj.object_identity, '.', 2);
      EXECUTE format('CREATE OR REPLACE VIEW public.%I AS SELECT * FROM vantage.%I', tbl, tbl);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', tbl);
    END IF;
  END LOOP;
END $$;

DROP EVENT TRIGGER IF EXISTS expose_vantage_tables;
CREATE EVENT TRIGGER expose_vantage_tables
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE')
  EXECUTE FUNCTION public.expose_vantage_table();
