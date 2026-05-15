/** Append UTM parameters to every URL found in a string of content. */
export function tagUrls(content: string, channel: string, pieceId: string): string {
  const params = new URLSearchParams({
    utm_source:   channel,
    utm_medium:   "social",
    utm_campaign: "vantage",
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
