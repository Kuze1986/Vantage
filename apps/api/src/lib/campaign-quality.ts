import { createHash } from 'node:crypto';

export const PLATFORM_LIMITS: Record<string, number> = { x: 280, threads: 500, bluesky: 300, instagram: 2200, linkedin: 3000, facebook: 63206, reddit: 40000, tiktok: 4000 };

export type FactSheet = {
  approved_claims: string[];
  prohibited_claims: string[];
  approved_terms: string[];
  product_name: string;
  primary_cta: string;
};

export function campaignVolume(channelMix: Record<string, { daily?: number }>, days: number) {
  const daily = Object.values(channelMix).reduce((sum, value) => sum + (Number(value?.daily) || 0), 0);
  return { days, posts_per_day: daily, total_pieces: daily * days };
}

export function validateFactSheet(value: unknown): { valid: boolean; errors: string[]; factSheet?: FactSheet } {
  const fact = value as Partial<FactSheet> | null;
  const errors: string[] = [];
  if (!fact || typeof fact !== 'object') errors.push('A campaign fact sheet is required.');
  if (!Array.isArray(fact?.approved_claims) || !fact.approved_claims.length) errors.push('Add at least one approved claim.');
  if (!Array.isArray(fact?.prohibited_claims)) errors.push('Add prohibited claims (use an empty list only after explicit confirmation).');
  if (!Array.isArray(fact?.approved_terms) || !fact.approved_terms.length) errors.push('Add approved terminology.');
  if (!fact?.product_name?.trim()) errors.push('Set the approved product name.');
  if (!fact?.primary_cta?.trim()) errors.push('Set the primary CTA.');
  return { valid: errors.length === 0, errors, factSheet: errors.length ? undefined : fact as FactSheet };
}

export function validateFinalPayload(channel: string, payload: Record<string, unknown>) {
  const body = String(payload.body ?? payload.text ?? payload.caption ?? payload.script ?? '');
  const errors: string[] = [];
  const limit = PLATFORM_LIMITS[channel];
  if (!body.trim()) errors.push('Generated payload has no publishable body.');
  if (limit && body.length > limit) errors.push(`${channel} final payload is ${body.length}/${limit} characters.`);
  if (channel === 'instagram') {
    if (!Array.isArray(payload.hashtags) || payload.hashtags.length < 3) errors.push('Instagram requires at least three hashtags.');
    if (!String(payload.alt_text ?? '').trim()) errors.push('Instagram requires alt text.');
    // Instagram's content-publishing API accepts a container and only rejects
    // it at media_publish, where the error is the uninformative "Media ID is
    // not available" whatever the actual cause. Two causes are checkable from
    // the payload alone, so name them here rather than at publish time.
    //
    // Format: JPEG only for a feed image. GIF and PNG both fail.
    const image = String(payload.image_url ?? '');
    if (/\.(gif|png|webp|avif|heic)(\?|$)/i.test(image)) {
      const ext = image.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1]?.toUpperCase() ?? 'that format';
      errors.push(`Instagram cannot publish ${ext} — attach a JPEG still instead.`);
    }
    // Aspect: a feed image must sit between 4:5 (0.8) and 1.91:1. A 9:16 story
    // or reel still is 0.5625 and is rejected, which is easy to hit because
    // 1080x1920 is the natural output of a phone-viewport capture.
    const dims = payload.image_dimensions as { width?: number; height?: number } | undefined;
    if (dims?.width && dims?.height) {
      const ratio = dims.width / dims.height;
      if (ratio < 0.8 || ratio > 1.91) {
        errors.push(
          `Instagram feed images must be between 4:5 and 1.91:1 — this is ${dims.width}x${dims.height} ` +
          `(${ratio.toFixed(2)}). Crop to 1080x1350 for a feed post.`,
        );
      }
    }
  }
  if (channel === 'tiktok' && body.length < 40) errors.push('TikTok requires a substantive script.');
  return { valid: errors.length === 0, errors, character_count: body.length, payload_hash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}

export function similarityScore(candidate: string, prior: string[]) {
  const words = new Set(candidate.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  return Math.max(0, ...prior.map((text) => {
    const other = new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    const union = new Set([...words, ...other]).size || 1;
    let shared = 0; for (const word of words) if (other.has(word)) shared++;
    return shared / union;
  }));
}
