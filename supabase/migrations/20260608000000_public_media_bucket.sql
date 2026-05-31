-- ─────────────────────────────────────────────────────────────────────────────
-- Make vantage-media a public bucket so DemoForge video download links work.
-- The bucket was originally created as private; public = true is required for
-- getPublicUrl() to return accessible URLs without signed tokens.
-- ─────────────────────────────────────────────────────────────────────────────

-- Create the bucket if it doesn't exist yet (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('vantage-media', 'vantage-media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public read policy — anyone can read objects in this bucket
DROP POLICY IF EXISTS "vantage_media_public_read" ON storage.objects;
CREATE POLICY "vantage_media_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'vantage-media');

-- Authenticated + service_role write policies (keep existing, recreate for safety)
DROP POLICY IF EXISTS "vantage_media_authenticated_insert" ON storage.objects;
CREATE POLICY "vantage_media_authenticated_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'vantage-media');

DROP POLICY IF EXISTS "vantage_media_service_insert" ON storage.objects;
CREATE POLICY "vantage_media_service_insert"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'vantage-media');

DROP POLICY IF EXISTS "vantage_media_service_update" ON storage.objects;
CREATE POLICY "vantage_media_service_update"
  ON storage.objects FOR UPDATE
  TO service_role
  USING (bucket_id = 'vantage-media');
