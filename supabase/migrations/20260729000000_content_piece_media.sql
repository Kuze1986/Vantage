-- Content piece media fields for visual pipeline (DemoForge / Social Kit write-back)

ALTER TABLE vantage.content_pieces
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS media_status text NOT NULL DEFAULT 'none';

ALTER TABLE vantage.content_pieces
  DROP CONSTRAINT IF EXISTS content_pieces_media_status_check;

ALTER TABLE vantage.content_pieces
  ADD CONSTRAINT content_pieces_media_status_check
  CHECK (media_status IN ('none', 'pending', 'ready', 'failed'));

COMMENT ON COLUMN vantage.content_pieces.video_url IS 'DemoForge (or other) MP4 URL attached to the piece';
COMMENT ON COLUMN vantage.content_pieces.media_status IS 'none | pending | ready | failed — visual asset readiness';

CREATE INDEX IF NOT EXISTS content_pieces_media_status_idx
  ON vantage.content_pieces (media_status)
  WHERE media_status IN ('pending', 'failed');

-- Campaign-level visual defaults (Shift when unset at app layer)
ALTER TABLE vantage.campaigns
  ADD COLUMN IF NOT EXISTS default_brand_id text,
  ADD COLUMN IF NOT EXISTS default_demoforge_template_id text;

COMMENT ON COLUMN vantage.campaigns.default_brand_id IS 'Social Kit brand id default for launched pieces (app default: shift)';
COMMENT ON COLUMN vantage.campaigns.default_demoforge_template_id IS 'DemoForge template id default when idea omits one';

-- Refresh public views so PostgREST exposes the new columns
CREATE OR REPLACE VIEW public.content_pieces AS SELECT * FROM vantage.content_pieces;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_pieces TO authenticated, service_role;

CREATE OR REPLACE VIEW public.campaigns AS SELECT * FROM vantage.campaigns;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated, service_role;
