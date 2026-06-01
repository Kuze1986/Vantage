// storage.ts — thin helper for uploading data-URLs to the vantage-media bucket.
// Used by creative tools (OG cards, DemoForge thumbnails) that persist a PNG.

import { supabase } from './supabase'

/**
 * Convert a data-URL to a Blob, upload to vantage-media at `path`,
 * and return the public URL.  Overwrites if the file already exists.
 */
export async function uploadDataUrl(path: string, dataUrl: string): Promise<string> {
  const res   = await fetch(dataUrl)
  const blob  = await res.blob()
  const ext   = blob.type.includes('png') ? 'png' : 'jpg'
  const full  = path.endsWith('.png') || path.endsWith('.jpg') ? path : `${path}.${ext}`

  const { error } = await supabase.storage
    .from('vantage-media')
    .upload(full, blob, { contentType: blob.type, upsert: true })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const { data } = supabase.storage.from('vantage-media').getPublicUrl(full)
  return data.publicUrl
}
