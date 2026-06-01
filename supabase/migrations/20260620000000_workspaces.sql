-- Workspaces foundation table (multi-tenancy support)
-- This table must be created FIRST before any other Phase 2-5 migrations

CREATE TABLE IF NOT EXISTS vantage.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  owner_id uuid NOT NULL,

  -- Configuration
  llm_provider text DEFAULT 'claude' CHECK (llm_provider IN ('claude', 'gpt4o', 'grok')),
  llm_model text,

  -- Metadata
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Public view for RLS compatibility (auto-updatable)
CREATE OR REPLACE VIEW public.workspaces AS SELECT * FROM vantage.workspaces;

-- Enable RLS
ALTER TABLE vantage.workspaces ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Workspaces are readable by owner"
  ON vantage.workspaces
  FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Workspaces are updatable by owner"
  ON vantage.workspaces
  FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "Workspaces are deletable by owner"
  ON vantage.workspaces
  FOR DELETE
  USING (owner_id = auth.uid());

-- Indexes
CREATE INDEX idx_workspaces_owner_id ON vantage.workspaces(owner_id);
CREATE INDEX idx_workspaces_slug ON vantage.workspaces(slug);

-- Comments
COMMENT ON TABLE vantage.workspaces IS 'Multi-tenant workspace definitions - foundation for all other Vantage tables';
COMMENT ON COLUMN vantage.workspaces.id IS 'Unique workspace identifier';
COMMENT ON COLUMN vantage.workspaces.owner_id IS 'Supabase auth user ID who owns this workspace';
COMMENT ON COLUMN vantage.workspaces.llm_provider IS 'Default LLM provider for this workspace (claude, gpt4o, grok)';
