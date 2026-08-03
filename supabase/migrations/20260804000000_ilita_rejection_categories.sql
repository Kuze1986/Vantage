-- Structured Ilita rejection categories.
--
-- audit_notes has always been freeform text, sometimes concatenated across regen
-- attempts, with no aggregation anywhere in the codebase despite being the obvious
-- input to feeding rejection patterns back into Kuze's generation prompt. Rather than
-- retroactively parsing years of freeform text, Ilita now emits a small fixed category
-- alongside its feedback on every fail verdict; this column captures the most recent
-- rejection's category so it can be aggregated per-channel (see kuze.ts
-- loadRejectionCategories()).

ALTER TABLE vantage.content_pieces
  ADD COLUMN IF NOT EXISTS audit_category text;

COMMENT ON COLUMN vantage.content_pieces.audit_category IS
  'Structured category for the most recent Ilita rejection (see ILITA_REJECTION_CATEGORIES
   in @vantage/prompts). Null when the piece has never been rejected, or was rejected before
   this column existed. Aggregated per-channel by kuze.ts to feed avoid-list guidance back
   into content generation.';

CREATE INDEX IF NOT EXISTS content_pieces_audit_category_idx
  ON vantage.content_pieces (channel_slug, audit_category)
  WHERE audit_category IS NOT NULL;

CREATE OR REPLACE VIEW public.content_pieces AS SELECT * FROM vantage.content_pieces;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_pieces TO service_role;
