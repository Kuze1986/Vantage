/** Default utm_campaign for pieces that don't belong to a campaign (ad-hoc generation). */
export const DEFAULT_UTM_CAMPAIGN = "vantage";

/**
 * Append UTM parameters to every URL found in a string of content.
 *
 * `campaign` sets utm_campaign — pass the campaign id for campaign-launched pieces so
 * analytics can separate them. Omit it for ad-hoc pieces, which fall back to "vantage".
 */
export function tagUrls(
  content: string,
  channel: string,
  pieceId: string,
  campaign: string = DEFAULT_UTM_CAMPAIGN,
): string {
  const params = new URLSearchParams({
    utm_source:   channel,
    utm_medium:   "social",
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
