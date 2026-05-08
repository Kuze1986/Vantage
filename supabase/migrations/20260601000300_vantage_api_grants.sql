-- Required for Supabase JS / PostgREST when using schema("vantage"):
-- 1) Dashboard: Project Settings → Data API → "Exposed schemas" → add `vantage` (then Save / reload PostgREST if prompted).
-- 2) This migration grants API roles access; RLS on tables still applies for anon/authenticated.

GRANT USAGE ON SCHEMA vantage TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA vantage TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA vantage TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA vantage TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA vantage GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA vantage GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA vantage GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
