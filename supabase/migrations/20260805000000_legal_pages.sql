-- Legal pages: platform-wide Terms & Conditions / Privacy Policy content.
-- Global (no workspace_id) — one Vantage instance has one ToS and one Privacy
-- Policy, not one per tenant. Publicly readable (served without auth so
-- platform reviewers — e.g. TikTok's app review — can view them), editable
-- only by workspace owners via PATCH /v1/legal/:slug.

CREATE TABLE IF NOT EXISTS vantage.legal_pages (
  slug        text primary key,          -- 'terms' | 'privacy'
  title       text not null,
  content     text not null default '',  -- plain text / paragraphs, no markup needed
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

ALTER TABLE vantage.legal_pages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'vantage' AND tablename = 'legal_pages' AND policyname = 'legal_pages_auth') THEN
    CREATE POLICY "legal_pages_auth" ON vantage.legal_pages FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'vantage' AND tablename = 'legal_pages' AND policyname = 'legal_pages_service') THEN
    CREATE POLICY "legal_pages_service" ON vantage.legal_pages FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- Public view for PostgREST (same pattern as brand_kits, music_tracks) —
-- the API's admin client reads/writes through this; anon grants stay revoked.
CREATE OR REPLACE VIEW public.legal_pages AS SELECT * FROM vantage.legal_pages;

CREATE OR REPLACE FUNCTION vantage.legal_pages_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS legal_pages_updated_at ON vantage.legal_pages;
CREATE TRIGGER legal_pages_updated_at
  BEFORE UPDATE ON vantage.legal_pages
  FOR EACH ROW EXECUTE FUNCTION vantage.legal_pages_updated_at();

-- Seed the two required slugs empty — filled in via the Legal editor page.
INSERT INTO vantage.legal_pages (slug, title, content) VALUES
  ('terms',   'Terms & Conditions', ''),
  ('privacy', 'Privacy Policy',     '')
ON CONFLICT (slug) DO NOTHING;
