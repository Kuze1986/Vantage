/**
 * Multi-image ("carousel") posting support.
 *
 * The Social Kit carousel builder writes its rendered slides to
 * `content_payload.carousel_urls` and mirrors slide 01 onto `image_url` so the
 * media gate is satisfied. Channels that can post several images natively read
 * the full array from here; everything else keeps sending the single
 * `image_url` and is unaffected.
 */

/** Instagram caps a carousel at 10 children; Facebook is applied the same cap. */
export const CAROUSEL_MAX = 10;
/** Below two items it isn't a carousel — post it as a normal single image. */
export const CAROUSEL_MIN = 2;

/**
 * Channels whose adapters can post more than one image in a single post.
 *
 * Deliberately small: X, Bluesky, LinkedIn and Threads all support multiple
 * images at the platform level, but their adapters here are text-only (or
 * single-image, for LinkedIn), so multi-image for them is adapter work rather
 * than a dispatch change. TikTok photo posts are a different Content Posting
 * API flow than the video one implemented today.
 */
export const MULTI_IMAGE_CHANNELS = new Set<string>(["instagram", "facebook"]);

export function supportsMultiImage(channelSlug: string): boolean {
  return MULTI_IMAGE_CHANNELS.has(channelSlug);
}

/**
 * Read and normalise `carousel_urls`. Non-strings, blanks and duplicates are
 * dropped — a duplicate would make Instagram render the same slide twice — and
 * the result is capped at CAROUSEL_MAX.
 */
export function parseCarouselUrls(payload: Record<string, unknown> | null | undefined): string[] {
  const raw = payload?.carousel_urls;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const url = item.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= CAROUSEL_MAX) break;
  }
  return urls;
}

/**
 * The slides to post for this channel, or [] to fall through to single-image.
 *
 * Returns nothing when a video is present: a piece with a rendered video should
 * publish as that video (a Reel on Instagram), not as a slide deck. Callers pass
 * the resolved video URL so this decision lives in one place.
 */
export function carouselUrlsForChannel(
  channelSlug: string,
  payload: Record<string, unknown> | null | undefined,
  videoUrl?: string | null,
): string[] {
  if (!supportsMultiImage(channelSlug)) return [];
  if (videoUrl) return [];
  const urls = parseCarouselUrls(payload);
  return urls.length >= CAROUSEL_MIN ? urls : [];
}
