-- Revoke the accidental anon over-grants on the vantage schema + public proxy views.
--
-- 20260601000300_vantage_api_grants.sql granted ALL on the vantage schema to
-- `anon` (alongside authenticated + service_role) and set matching default
-- privileges, so every vantage table — and its auto-created public.<table> proxy
-- view — became readable AND writable by unauthenticated callers holding the
-- public anon key. Vantage is SSO-gated (browser = authenticated; API =
-- service_role; token checks use auth.getUser(), not table reads), so anon never
-- needs table access. This migration removes it.
--
-- Kept anon-READABLE on purpose (SELECT only, no writes):
--   * public.content_pieces, public.topics  — public content feed
--   * public.settings                        — The Shift Terms/Privacy store
--                                              (writes are admin-gated via RLS)
--
-- Idempotent; safe to re-run. Runs after 20260630000000_expose_vantage_views.sql,
-- so it has the final word on grants even on a fresh database rebuild.

-- 1. Strip anon from the vantage schema (current + future objects) ------------
REVOKE ALL ON ALL TABLES    IN SCHEMA vantage FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA vantage FROM anon;
REVOKE ALL ON ALL ROUTINES  IN SCHEMA vantage FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA vantage REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA vantage REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA vantage REVOKE ALL ON ROUTINES  FROM anon;

-- 2. Revoke anon on the public proxy views, keeping the public-feed exceptions -
DO $$
DECLARE v text;
BEGIN
  FOR v IN
    SELECT vw.table_name FROM information_schema.views vw
    WHERE vw.table_schema = 'public'
      AND EXISTS (
        SELECT 1 FROM information_schema.role_table_grants g
        WHERE g.table_schema = 'public' AND g.table_name = vw.table_name AND g.grantee = 'anon'
      )
  LOOP
    IF v = 'settings' THEN
      CONTINUE;                                                       -- handled in step 3
    ELSIF v IN ('content_pieces', 'topics') THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon', v);  -- keep SELECT
    ELSE
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    END IF;
  END LOOP;
END $$;

-- 3. settings: public read, admin-only write ---------------------------------
-- public.settings is consumed by both Vantage and The Shift (Terms/Privacy). It
-- runs with security_invoker so the base table's RLS governs access: anyone may
-- read, only admins may write. Anon needs schema USAGE + base SELECT for the
-- invoker-side read to resolve through the view.
CREATE OR REPLACE FUNCTION public.is_admin()
  RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public AS $fn$
    SELECT EXISTS (
      SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    );
  $fn$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

ALTER VIEW public.settings SET (security_invoker = on);

ALTER TABLE vantage.settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settings_auth        ON vantage.settings;  -- old: authenticated ALL (true)
DROP POLICY IF EXISTS settings_read        ON vantage.settings;
DROP POLICY IF EXISTS settings_admin_write ON vantage.settings;
CREATE POLICY settings_read        ON vantage.settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY settings_admin_write ON vantage.settings FOR ALL    TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT USAGE  ON SCHEMA  vantage          TO anon;
GRANT SELECT ON TABLE   vantage.settings TO anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON vantage.settings FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.settings  FROM anon;
