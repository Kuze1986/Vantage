/**
 * Render a content piece for Ilita.
 *
 * The audit gate was structurally blind. Every automated call site passed
 * `gen.text_preview` — a **200-character slice of a single field**
 * (`kuze.ts`: `String(body ?? text ?? hook ?? title).slice(0, 200)`) — so the
 * brand-safety reviewer never saw the content it was approving or rejecting.
 *
 * Two failure modes came out of that, both observed in production:
 *
 *   1. **Phantom truncation.** Anything over 200 characters looked cut off. A
 *      complete 305-character Facebook post was rejected for "cuts off
 *      mid-sentence"; a 539-character TikTok script for being "cut off
 *      mid-sentence, making it impossible to evaluate the full CTA".
 *   2. **Phantom omissions.** Only one field was ever rendered, so every other
 *      part of the format was invisible. An Instagram caption carrying both
 *      `hashtags` and `alt_text` was rejected because "the caption does not
 *      include a hashtag block and no alt text is present".
 *
 * Both rejections were correct about what the model was shown and wrong about
 * the piece. This renders the whole payload, labelled, so a verdict is about
 * the content that would actually publish.
 */

/**
 * Content-bearing keys, in the order a reviewer would want to read them.
 * Anything not listed is plumbing (storage URLs, job ids, media flags) and is
 * noise in an audit prompt.
 */
const AUDIT_FIELDS: readonly string[] = [
  "title",
  "subject",
  "preview_text",
  "headline",
  "hook",
  "body",
  "text",
  "script",
  "caption",
  "on_screen_text",
  "hashtags",
  "alt_text",
  "instructions",
  "is_link_post",
];

/** Human labels — `on_screen_text` reads badly as a heading. */
const LABELS: Record<string, string> = {
  title: "Title",
  subject: "Subject line",
  preview_text: "Preview text",
  headline: "Headline",
  hook: "Hook",
  body: "Body",
  text: "Text",
  script: "Script",
  caption: "Caption",
  on_screen_text: "On-screen text",
  hashtags: "Hashtags",
  alt_text: "Alt text",
  instructions: "Upload instructions",
  is_link_post: "Link post",
};

function renderValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => (typeof v === "string" ? v.trim() : String(v))).filter(Boolean);
    return parts.length ? parts.join(" ") : null;
  }
  return null;
}

/**
 * Render `content_payload` as a labelled block for the audit prompt.
 *
 * Falls back to whole-payload JSON if nothing recognised is present, so a new
 * format that adds fields is reviewed imperfectly rather than reviewed blind.
 */
export function renderPayloadForAudit(payload: Record<string, unknown> | null | undefined): string {
  if (!payload) return "";

  const lines: string[] = [];
  for (const key of AUDIT_FIELDS) {
    if (!(key in payload)) continue;
    const rendered = renderValue(payload[key]);
    if (rendered === null) continue;
    lines.push(`${LABELS[key] ?? key}: ${rendered}`);
  }

  if (lines.length === 0) {
    // Unknown shape — better to hand over everything than an empty string,
    // which would have the reviewer judging nothing at all.
    try {
      return JSON.stringify(payload);
    } catch {
      return "";
    }
  }

  return lines.join("\n\n");
}

/**
 * Character budget for the audit prompt.
 *
 * Deliberately generous: the previous 200-character cap is what caused phantom
 * truncation rejections, so the cap here exists only to stop a pathological
 * payload blowing the context window. If it ever bites, the reviewer is told
 * the text was shortened, so it cannot mistake our cut for the model's.
 */
export const AUDIT_MAX_CHARS = 8000;

export function renderForAudit(payload: Record<string, unknown> | null | undefined): string {
  const full = renderPayloadForAudit(payload);
  if (full.length <= AUDIT_MAX_CHARS) return full;
  return (
    `${full.slice(0, AUDIT_MAX_CHARS)}\n\n` +
    `[Truncated by Vantage at ${AUDIT_MAX_CHARS} characters for review — the piece itself is complete. ` +
    `Do not fail this for appearing cut off.]`
  );
}
