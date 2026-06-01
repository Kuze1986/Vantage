-- LLM Provider Selection Setting
-- Allows operators to choose which LLM provider to use for insight generation and other AI tasks

-- Add preferred_llm_provider to settings if not exists
INSERT INTO vantage.settings (key, value)
VALUES ('preferred_llm_provider', '"anthropic"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Add comment
COMMENT ON COLUMN vantage.settings.key IS 'Setting key (examples: dedup_days, scripta_enabled, preferred_llm_provider)';
