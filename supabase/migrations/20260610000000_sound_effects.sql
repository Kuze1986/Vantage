-- Sound Effects Library for DemoForge (Phase 3D-SE: Sound Effects + Audio Mixer)
-- Mirrors music_tracks table pattern for consistency.

CREATE TABLE IF NOT EXISTS vantage.sound_effects (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  category      text not null,    -- ui_click, transition, success, error, notification, custom
  duration_ms   int,              -- effect length in milliseconds
  storage_path  text not null,    -- path inside vantage-media bucket
  use_case      text not null,    -- intro, step_transition, action_feedback, general
  created_at    timestamptz default now()
);

-- RLS: authenticated users can read/write, service role can do anything
ALTER TABLE vantage.sound_effects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sound_effects_auth"
  ON vantage.sound_effects
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "sound_effects_service"
  ON vantage.sound_effects
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Public view for PostgREST + web app access
CREATE OR REPLACE VIEW public.sound_effects AS SELECT * FROM vantage.sound_effects;

-- Trigger to keep created_at fresh (new effects only, no updates to timestamps)
DROP TRIGGER IF EXISTS sound_effects_created_at ON vantage.sound_effects;
-- (sound_effects are immutable once created; no update trigger needed like music_tracks)
