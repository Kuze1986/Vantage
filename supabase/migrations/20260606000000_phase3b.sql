-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3B: new capabilities
-- 3B-6: evergreen topic recycling → recycle_after column on topics
-- ─────────────────────────────────────────────────────────────────────────────

-- 3B-6 ── recycle_after on topics ─────────────────────────────────────────────
ALTER TABLE vantage.topics
  ADD COLUMN IF NOT EXISTS recycle_after timestamptz;

-- Refresh the public view for topics so the new column is accessible
DROP VIEW IF EXISTS public.topics;
CREATE OR REPLACE VIEW public.topics AS
  SELECT
    id, source_product, source_ref,
    vertical, topic_text, priority,
    context_payload, used_at, recycle_after,
    created_at, updated_at
  FROM vantage.topics;

GRANT SELECT ON public.topics TO anon, authenticated;
