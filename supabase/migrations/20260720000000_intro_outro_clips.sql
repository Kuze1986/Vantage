-- Intro/Outro Clips: reusable branded video bookend sequences for DemoForge.
-- Clips are normalized to the target format's dimensions before concat.

CREATE TABLE IF NOT EXISTS vantage.intro_outro_clips (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid references vantage.workspaces(id) on delete cascade,  -- null = global library
  type            text not null check (type in ('intro', 'outro', 'both')),
  name            text not null,
  duration_ms     integer not null default 0,
  storage_path    text not null,                -- path inside vantage-media bucket
  target_format   text not null check (target_format in ('tiktok', 'linkedin', 'instagram', 'all')),
  brand_kit_id    uuid references vantage.brand_kits(id) on delete set null,
  preview_url     text,                         -- GIF preview URL
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

CREATE INDEX intro_outro_clips_workspace_idx  ON vantage.intro_outro_clips (workspace_id);
CREATE INDEX intro_outro_clips_format_type_idx ON vantage.intro_outro_clips (target_format, type);

ALTER TABLE vantage.intro_outro_clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intro_outro_clips_auth"
  ON vantage.intro_outro_clips
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "intro_outro_clips_service"
  ON vantage.intro_outro_clips
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Public view for PostgREST
CREATE OR REPLACE VIEW public.intro_outro_clips AS SELECT * FROM vantage.intro_outro_clips;

CREATE OR REPLACE FUNCTION vantage.intro_outro_clips_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS intro_outro_clips_updated_at ON vantage.intro_outro_clips;
CREATE TRIGGER intro_outro_clips_updated_at
  BEFORE UPDATE ON vantage.intro_outro_clips
  FOR EACH ROW EXECUTE FUNCTION vantage.intro_outro_clips_updated_at();
