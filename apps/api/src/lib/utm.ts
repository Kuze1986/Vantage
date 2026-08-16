/** Default utm_campaign for pieces that don't belong to a campaign (ad-hoc generation). */
export const DEFAULT_UTM_CAMPAIGN = "vantage";

/**
 * Append UTM parameters to every URL found in a string of content.
 *
 * `campaign` sets utm_campaign — pass the campaign id for campaign-launched pieces so
 * analytics can separate them. Omit it for ad-hoc pieces, which fall back to "vantage".
 */
/** UUID-shaped stand-in for the not-yet-created piece id, so the probe below measures a real-length tag. */
const PIECE_ID_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

/**
 * Payload keys holding a media asset rather than a click destination.
 *
 * These must never be UTM-tagged. Attribution parameters belong on links a
 * human clicks; a media URL is fetched by the platform's own ingest service.
 * Tagging them appended `?utm_source=instagram&...` to the stored asset URL,
 * which is at best meaningless and at worst breaks the fetch — signed URLs and
 * CDNs that validate their query string reject the extra parameters outright.
 *
 * `carousel_urls` is an array and was already skipped by the string-only loops,
 * but it is listed here so a future caller that flattens it stays correct.
 */
const MEDIA_URL_KEYS = new Set(["image_url", "video_url", "carousel_urls", "audio_url", "soundtrack_url"]);

/**
 * UTM-tag every click destination in a content payload, leaving media URLs alone.
 *
 * Replaces the hand-rolled `for (const [k, v] of Object.entries(payload))` loops
 * that each call site used to run: all three of them (campaign launch, autopilot
 * cadence, Kuze's own tagging) tagged whatever string fields they found, media
 * included.
 */
export function tagPayloadUrls(
  payload: Record<string, unknown>,
  channel: string,
  pieceId: string,
  campaign: string = DEFAULT_UTM_CAMPAIGN,
): { payload: Record<string, unknown>; changed: boolean } {
  let changed = false;
  const next: Record<string, unknown> = { ...payload };
  for (const [key, value] of Object.entries(next)) {
    if (typeof value !== "string") continue;
    if (MEDIA_URL_KEYS.has(key)) continue;
    const tagged = tagUrls(value, channel, pieceId, campaign);
    if (tagged !== value) {
      next[key] = tagged;
      changed = true;
    }
  }
  return { payload: next, changed };
}

/**
 * How many characters `tagUrls` will add to `url` on this channel/campaign.
 *
 * Generation happens before the content piece exists, so its id — and therefore
 * the exact length of the UTM suffix — is unknown at the time Kuze has to be
 * told its character budget. That budget used to carry a flat 130-character
 * allowance, which was simply too small: a campaign-scoped tag is
 * `?utm_source=<channel>&utm_medium=social&utm_campaign=<uuid>&utm_content=<uuid>`,
 * about 131 characters before the channel slug, and longer on `instagram` or
 * `bluesky` than on `x`. The shortfall landed on exactly the three formats with
 * hard platform caps: a launched day put X at 299/280, Bluesky at 350/300 and
 * Threads at 505/500, all rejected after tagging with otherwise-good copy.
 *
 * Measured by running the real `tagUrls` rather than re-deriving the format, so
 * this cannot drift from it — and it accounts for URL normalization (a bare
 * origin gains a `/`) that a hand-computed length would miss.
 */
export function utmExpansionCost(
  url: string,
  channel: string,
  campaign: string = DEFAULT_UTM_CAMPAIGN,
): number {
  const tagged = tagUrls(url, channel, PIECE_ID_PLACEHOLDER, campaign);
  return Math.max(0, tagged.length - url.length);
}

export function tagUrls(
  content: string,
  channel: string,
  pieceId: string,
  campaign: string = DEFAULT_UTM_CAMPAIGN,
): string {
  const params = new URLSearchParams({
    utm_source:   channel,
    // "social" was hardcoded here even for the email adapter (adapters/email.ts),
    // which mislabeled every newsletter click as social traffic in analytics.
    utm_medium:   channel === "email" ? "email" : "social",
    utm_campaign: campaign || DEFAULT_UTM_CAMPAIGN,
    utm_content:  pieceId,
  });
  // Match http(s) URLs, stopping at whitespace or common punctuation that ends a URL in prose
  return content.replace(
    /https?:\/\/[^\s"'<>)\]]+/g,
    (url) => {
      try {
        const u = new URL(url);
        for (const [k, v] of params) u.searchParams.set(k, v);
        return u.toString();
      } catch {
        return url;
      }
    },
  );
}
