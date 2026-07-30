-- Client creative tools (OG share cards, quote cards, thumbnails) upload with
-- upsert: true. Supabase Storage upsert requires INSERT + SELECT + UPDATE.
-- UPDATE was only granted to service_role — so browser uploads failed with RLS.
-- Also re-assert public SELECT so getPublicUrl() links remain readable.

DROP POLICY IF EXISTS "vantage_media_public_read" ON storage.objects;
CREATE POLICY "vantage_media_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'vantage-media');

DROP POLICY IF EXISTS "vantage_media_authenticated_update" ON storage.objects;
CREATE POLICY "vantage_media_authenticated_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'vantage-media')
  WITH CHECK (bucket_id = 'vantage-media');

DROP POLICY IF EXISTS "vantage_media_authenticated_select" ON storage.objects;
CREATE POLICY "vantage_media_authenticated_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'vantage-media');

DROP POLICY IF EXISTS "vantage_media_authenticated_insert" ON storage.objects;
CREATE POLICY "vantage_media_authenticated_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'vantage-media');
