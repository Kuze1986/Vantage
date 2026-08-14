-- Campaign-level destination link for cross-promotion.
--
-- Lets a campaign override the workspace's default product_base_url so one
-- Vantage instance can promote a different sibling product per campaign
-- (e.g. a workspace whose default is the Shift app running a campaign that
-- points at demogate's intake instead). See apps/api/src/lib/destination.ts.
--
-- NULL means "no override" — resolveDestination() falls back to
-- product_profile.product_base_url exactly as it does today.

ALTER TABLE vantage.campaigns
  ADD COLUMN IF NOT EXISTS destination_url text;

COMMENT ON COLUMN vantage.campaigns.destination_url IS
  'Overrides product_profile.product_base_url for every piece this campaign launches. NULL falls back to the workspace default.';

-- The public.campaigns view is a `SELECT *` snapshot taken when it was last
-- (re)created — Postgres does not propagate new columns on the base table to
-- an existing view, and the auto-expose event trigger in
-- 20260630000000_expose_vantage_views.sql only fires on CREATE TABLE, not
-- ALTER TABLE. Rebuild it here or PostgREST (and therefore the API, which
-- reads/writes vantage tables through these public views) will not see the
-- new column. CREATE OR REPLACE is safe for an append-only column change —
-- it only fails if existing column names/types/order shift.
CREATE OR REPLACE VIEW public.campaigns AS SELECT * FROM vantage.campaigns;
