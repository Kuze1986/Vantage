-- Email / Newsletter Template Builder (Phase 3C-6)
-- Stores named email templates as ordered blocks (JSONB array).

CREATE TABLE IF NOT EXISTS vantage.email_templates (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text          NOT NULL,
  description text          NOT NULL DEFAULT '',
  blocks      jsonb         NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);

-- Public view so PostgREST / web app can query via RLS
CREATE OR REPLACE VIEW public.email_templates AS SELECT * FROM vantage.email_templates;

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION vantage.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS email_templates_updated_at ON vantage.email_templates;
CREATE TRIGGER email_templates_updated_at
  BEFORE UPDATE ON vantage.email_templates
  FOR EACH ROW EXECUTE FUNCTION vantage.set_updated_at();
