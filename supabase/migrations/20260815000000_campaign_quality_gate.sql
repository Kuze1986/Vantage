-- Campaign quality gate: approved facts, typed asset provenance, and an auditable
-- final validation record. This migration deliberately does not alter existing
-- published pieces or invoke any external channel action.
ALTER TABLE vantage.campaigns
  ADD COLUMN IF NOT EXISTS fact_sheet jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS fact_sheet_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validated_piece_count integer,
  ADD COLUMN IF NOT EXISTS preflight_validated_at timestamptz;

ALTER TABLE vantage.campaign_assets
  ADD COLUMN IF NOT EXISTS media_kind text,
  ADD COLUMN IF NOT EXISTS preview_url text,
  ADD COLUMN IF NOT EXISTS origin_surface text,
  ADD COLUMN IF NOT EXISTS origin_project_id text,
  ADD COLUMN IF NOT EXISTS attachment_status text NOT NULL DEFAULT 'ready';

ALTER TABLE vantage.content_pieces
  ADD COLUMN IF NOT EXISTS fact_sheet_revision integer,
  ADD COLUMN IF NOT EXISTS final_character_count integer,
  ADD COLUMN IF NOT EXISTS similarity_score numeric,
  ADD COLUMN IF NOT EXISTS validation_result jsonb,
  ADD COLUMN IF NOT EXISTS audit_payload_hash text;

CREATE INDEX IF NOT EXISTS campaign_assets_ready_idx
  ON vantage.campaign_assets(campaign_id, attachment_status)
  WHERE attachment_status = 'ready';

CREATE INDEX IF NOT EXISTS content_pieces_validation_idx
  ON vantage.content_pieces(workspace_id, created_at DESC)
  WHERE validation_result IS NOT NULL;

CREATE OR REPLACE VIEW public.campaigns AS SELECT * FROM vantage.campaigns;
CREATE OR REPLACE VIEW public.campaign_assets AS SELECT * FROM vantage.campaign_assets;
CREATE OR REPLACE VIEW public.content_pieces AS SELECT * FROM vantage.content_pieces;
-- content_pieces remains service-role-only (see 20260804000000); do not
-- accidentally re-expose generated draft payloads to browser clients.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns, public.campaign_assets TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_pieces TO service_role;

-- Rollback runbook (manual, after confirming no dependent deployment is live):
-- DROP INDEX IF EXISTS vantage.content_pieces_validation_idx;
-- DROP INDEX IF EXISTS vantage.campaign_assets_ready_idx;
-- ALTER TABLE vantage.content_pieces DROP COLUMN IF EXISTS audit_payload_hash, DROP COLUMN IF EXISTS validation_result, DROP COLUMN IF EXISTS similarity_score, DROP COLUMN IF EXISTS final_character_count, DROP COLUMN IF EXISTS fact_sheet_revision;
-- ALTER TABLE vantage.campaign_assets DROP COLUMN IF EXISTS attachment_status, DROP COLUMN IF EXISTS origin_project_id, DROP COLUMN IF EXISTS origin_surface, DROP COLUMN IF EXISTS preview_url, DROP COLUMN IF EXISTS media_kind;
-- ALTER TABLE vantage.campaigns DROP COLUMN IF EXISTS preflight_validated_at, DROP COLUMN IF EXISTS validated_piece_count, DROP COLUMN IF EXISTS fact_sheet_revision, DROP COLUMN IF EXISTS fact_sheet;
