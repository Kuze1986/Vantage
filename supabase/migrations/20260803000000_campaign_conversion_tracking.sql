-- Conversion tracking on campaign_kpi_tracking.
--
-- kpi_targets (jsonb on campaigns) was documented as supporting a "conversion" key but
-- the API-level zod schema (kpiTargetsSchema) never allowed it, so it was silently
-- stripped on write — not just unpopulated, structurally absent. campaign_kpi_tracking,
-- the table campaigns actually roll KPIs into, had no conversions column at all. This adds
-- it so POST /v1/webhooks/conversion (a new Vantage-side endpoint any downstream product
-- can report a signup/conversion to, keyed by content_pieces.id — the value tagUrls()
-- already embeds as utm_content on every outbound link) has somewhere real to write.

ALTER TABLE vantage.campaign_kpi_tracking
  ADD COLUMN IF NOT EXISTS conversions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversion_value decimal(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN vantage.campaign_kpi_tracking.conversions IS
  'Count of downstream conversion events (e.g. signups) attributed to this campaign/source/day via recordCampaignConversion().';
COMMENT ON COLUMN vantage.campaign_kpi_tracking.conversion_value IS
  'Sum of reported conversion values (e.g. deal/subscription value), when the reporting system provides one.';

-- ALTER TABLE does not fire the expose_vantage_tables event trigger (CREATE TABLE only),
-- so the new columns would otherwise be invisible to PostgREST/service_role.
CREATE OR REPLACE VIEW public.campaign_kpi_tracking AS SELECT * FROM vantage.campaign_kpi_tracking;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_kpi_tracking TO service_role;
