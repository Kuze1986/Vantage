-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3A: gap fixes
-- 3A-5: webhook event deduplication  → external_event_id on engagement_events
-- 3A-6: retry logic                  → retry_count, retry_after on content_pieces
-- ─────────────────────────────────────────────────────────────────────────────

-- 3A-5 ── external_event_id for dedup ─────────────────────────────────────────
ALTER TABLE vantage.engagement_events
  ADD COLUMN IF NOT EXISTS external_event_id text;

-- Partial unique index: only enforces uniqueness on non-NULL values
CREATE UNIQUE INDEX IF NOT EXISTS engagement_events_external_id_uq
  ON vantage.engagement_events(external_event_id)
  WHERE external_event_id IS NOT NULL;

-- 3A-6 ── retry columns on content_pieces ─────────────────────────────────────
ALTER TABLE vantage.content_pieces
  ADD COLUMN IF NOT EXISTS retry_count  integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_after  timestamptz;

-- Expose new columns in the public view so the frontend/API can read them
-- (Drop and recreate the view to pick up the new columns)
DROP VIEW IF EXISTS public.content_pieces;
CREATE OR REPLACE VIEW public.content_pieces AS
  SELECT
    id, topic_id, channel_slug, format,
    content_payload, status,
    audit_notes, audit_iterations,
    image_url, variant_group_id,
    retry_count, retry_after,
    external_post_id, published_at,
    scheduled_for, created_at, updated_at
  FROM vantage.content_pieces;

GRANT SELECT ON public.content_pieces TO anon, authenticated;
