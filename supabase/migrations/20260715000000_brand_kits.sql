-- Brand Kits: workspace-level brand identity for DemoForge video overlays.
-- Stores logo, colors, and font preferences applied to text/image overlay burns.

CREATE TABLE IF NOT EXISTS vantage.brand_kits (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references vantage.workspaces(id) on delete cascade,
  name                text not null,
  logo_url            text,                       -- public URL (derived from storage path)
  logo_storage_path   text,                       -- path inside vantage-media bucket
  primary_color       text not null default '#FFFFFF',
  secondary_color     text not null default '#000000',
  accent_color        text not null default '#EFA020',
  font_heading        text not null default 'sans',  -- 'mono' | 'sans' | 'display'
  font_body           text not null default 'sans',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

CREATE INDEX brand_kits_workspace_idx ON vantage.brand_kits (workspace_id);

-- RLS: authenticated users and service role can manage brand kits
ALTER TABLE vantage.brand_kits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_kits_auth"
  ON vantage.brand_kits
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "brand_kits_service"
  ON vantage.brand_kits
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Public view for PostgREST (same pattern as music_tracks, sound_effects)
CREATE OR REPLACE VIEW public.brand_kits AS SELECT * FROM vantage.brand_kits;

-- Auto-update updated_at on modification
CREATE OR REPLACE FUNCTION vantage.brand_kits_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS brand_kits_updated_at ON vantage.brand_kits;
CREATE TRIGGER brand_kits_updated_at
  BEFORE UPDATE ON vantage.brand_kits
  FOR EACH ROW EXECUTE FUNCTION vantage.brand_kits_updated_at();
