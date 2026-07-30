// storage.ts — upload data-URLs via the vantage API (service-role Storage).
// Used by creative tools (OG cards, quote cards) that persist a PNG.

import { vantageFetch } from '../api/vantage'

/**
 * Convert a data-URL to a Blob path upload through POST /v1/media/upload,
 * and return the public URL. Overwrites if the file already exists.
 */
export async function uploadDataUrl(path: string, dataUrl: string): Promise<string> {
  const res = await vantageFetch('/v1/media/upload', {
    method: 'POST',
    body: JSON.stringify({ path, data_url: dataUrl }),
  }) as { public_url: string; storage_path: string }
  if (!res?.public_url) throw new Error('Storage upload failed: missing public_url')
  return res.public_url
}
