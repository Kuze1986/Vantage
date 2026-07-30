-- Portfolio marketing: per-product brand voice, content tagging, and asset library.
-- Products match Social Kit BrandId: shift | keystone | scripta | demoforge | crucible | vantage

-- ── brand_voice: one voice pack per (workspace, product) ─────────────────────
ALTER TABLE vantage.brand_voice
  ADD COLUMN IF NOT EXISTS product_slug text NOT NULL DEFAULT 'vantage',
  ADD COLUMN IF NOT EXISTS pack jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE vantage.brand_voice
  DROP CONSTRAINT IF EXISTS brand_voice_product_slug_check;

ALTER TABLE vantage.brand_voice
  ADD CONSTRAINT brand_voice_product_slug_check
  CHECK (product_slug IN ('shift', 'keystone', 'scripta', 'demoforge', 'crucible', 'vantage'));

DROP INDEX IF EXISTS vantage.brand_voice_workspace_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS brand_voice_workspace_product_uidx
  ON vantage.brand_voice (workspace_id, product_slug);

COMMENT ON COLUMN vantage.brand_voice.product_slug IS 'Social Kit product this voice markets';
COMMENT ON COLUMN vantage.brand_voice.pack IS 'Landing/Social Kit pack: essence, handle, domain, palette, voice, captions, hashtags, launch, insight';

-- ── content_pieces: destination product tag ──────────────────────────────────
ALTER TABLE vantage.content_pieces
  ADD COLUMN IF NOT EXISTS product_slug text NOT NULL DEFAULT 'vantage';

ALTER TABLE vantage.content_pieces
  DROP CONSTRAINT IF EXISTS content_pieces_product_slug_check;

ALTER TABLE vantage.content_pieces
  ADD CONSTRAINT content_pieces_product_slug_check
  CHECK (product_slug IN ('shift', 'keystone', 'scripta', 'demoforge', 'crucible', 'vantage'));

CREATE INDEX IF NOT EXISTS content_pieces_workspace_product_status_idx
  ON vantage.content_pieces (workspace_id, product_slug, status);

-- ── topics: destination product (source_product remains ingestion source) ────
ALTER TABLE vantage.topics
  ADD COLUMN IF NOT EXISTS target_product text;

ALTER TABLE vantage.topics
  DROP CONSTRAINT IF EXISTS topics_target_product_check;

ALTER TABLE vantage.topics
  ADD CONSTRAINT topics_target_product_check
  CHECK (
    target_product IS NULL
    OR target_product IN ('shift', 'keystone', 'scripta', 'demoforge', 'crucible', 'vantage')
  );

CREATE INDEX IF NOT EXISTS topics_workspace_target_product_idx
  ON vantage.topics (workspace_id, target_product)
  WHERE target_product IS NOT NULL;

-- ── marketing_assets: persisted Social Kit / Creative exports ────────────────
CREATE TABLE IF NOT EXISTS vantage.marketing_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES vantage.workspaces(id) ON DELETE CASCADE,
  product_slug    text NOT NULL,
  kind            text NOT NULL DEFAULT 'image',
  storage_path    text NOT NULL,
  public_url      text NOT NULL,
  content_piece_id uuid REFERENCES vantage.content_pieces(id) ON DELETE SET NULL,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_assets_product_slug_check
    CHECK (product_slug IN ('shift', 'keystone', 'scripta', 'demoforge', 'crucible', 'vantage')),
  CONSTRAINT marketing_assets_kind_check
    CHECK (kind IN ('og', 'square', 'story', 'x', 'linkedin', 'image', 'video', 'other'))
);

CREATE INDEX IF NOT EXISTS marketing_assets_workspace_product_idx
  ON vantage.marketing_assets (workspace_id, product_slug, created_at DESC);

ALTER TABLE vantage.marketing_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_assets_auth ON vantage.marketing_assets;
CREATE POLICY marketing_assets_auth
  ON vantage.marketing_assets
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS marketing_assets_service ON vantage.marketing_assets;
CREATE POLICY marketing_assets_service
  ON vantage.marketing_assets
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Refresh public views
CREATE OR REPLACE VIEW public.brand_voice AS SELECT * FROM vantage.brand_voice;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_voice TO authenticated, service_role;

CREATE OR REPLACE VIEW public.content_pieces AS SELECT * FROM vantage.content_pieces;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_pieces TO authenticated, service_role;

CREATE OR REPLACE VIEW public.topics AS SELECT * FROM vantage.topics;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.topics TO authenticated, service_role;
GRANT SELECT ON public.topics TO anon;

CREATE OR REPLACE VIEW public.marketing_assets AS SELECT * FROM vantage.marketing_assets;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_assets TO authenticated, service_role;
