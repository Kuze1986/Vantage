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
--   1. Backfills a public view + service_role grants for ALL existing vantage
--      tables (idempotent — safe to re-run; uses CREATE OR REPLACE so existing
--      grants, e.g. brand_voice's authenticated access for the SPA, are kept).
--   2. Installs an event trigger so any table created in `vantage` later gets
--      its view + grant automatically — no per-feature step.

-- 1. Backfill existing tables ------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'vantage'
  LOOP
    -- Don't clobber a real (non-view) relation that already occupies public.<t>
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind <> 'v'
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('CREATE OR REPLACE VIEW public.%I AS SELECT * FROM vantage.%I', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
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

-- Note: a public view's column list is fixed at creation. If you ALTER an
-- existing vantage table (add/rename/drop a column), re-run the backfill block
-- above (or DROP the specific view first) so the view reflects the new shape.
