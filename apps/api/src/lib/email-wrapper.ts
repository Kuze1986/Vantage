/**
 * 3C-6 pipeline integration — wrap a generated newsletter in branded chrome.
 *
 * The Email Builder produced templates that nothing ever sent: `email_templates`
 * was read only by its own CRUD route, so automated newsletters went out as
 * Kuze's raw HTML with no header, hero, styled CTA or footer.
 *
 * The obvious fix — share `serializeToHtml()` between the builder and the email
 * adapter — is not available. It lives in `apps/web/src/creative/emailSerializer.ts`,
 * and the web app has no workspace-package dependencies: Railway builds it with a
 * bare `pnpm --filter @vantage/web build` that would not build a shared package
 * first (docs/railway.md). Introducing one would break that deploy.
 *
 * So the builder serializes (it already can) and stores the finished HTML as the
 * `email_wrapper_html` setting — `vantage.settings.value` is JSONB, so this needs
 * no migration — and the adapter does a single substitution here. There is still
 * exactly one serializer implementation; only the rendered result crosses the
 * boundary.
 */

/** Where the generated newsletter body is spliced into the wrapper. */
export const CONTENT_MARKER = "{{content}}";

export type WrapResult = {
  html: string;
  /** True when the wrapper was applied; false means `body` passed through untouched. */
  wrapped: boolean;
  /** Set when a wrapper was configured but could not be used, for the caller to log. */
  skippedReason?: "no_marker";
};

/**
 * Splice `body` into `wrapper` at the content marker.
 *
 * Degrades to the unwrapped body rather than throwing: a broken wrapper should
 * cost a newsletter its branding, never its delivery. Both failure modes — no
 * wrapper configured, and a wrapper missing its marker — return the body as-is,
 * but only the second is worth telling the operator about, since it means a
 * wrapper was chosen and silently did nothing.
 */
export function applyEmailWrapper(wrapper: string | null | undefined, body: string): WrapResult {
  const tpl = typeof wrapper === "string" ? wrapper.trim() : "";
  if (!tpl) return { html: body, wrapped: false };

  if (!tpl.includes(CONTENT_MARKER)) {
    return { html: body, wrapped: false, skippedReason: "no_marker" };
  }

  // Every occurrence, so a wrapper may repeat the body (e.g. a plain-text echo).
  return { html: tpl.split(CONTENT_MARKER).join(body), wrapped: true };
}
