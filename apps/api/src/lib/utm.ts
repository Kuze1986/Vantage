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
