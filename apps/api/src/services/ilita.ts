import { ilitaAuditSystemPrompt, ilitaAuditUserPrompt, ILITA_REJECTION_CATEGORIES } from "@vantage/prompts";
import type { ContentFormat, IlitaRejectionCategory } from "@vantage/prompts";
import { resolveProvider } from "../lib/llm.js";
import { extractJsonObject } from "../lib/llm-json.js";

/** Shared tolerant parser — Ilita carried a byte-identical copy of the fragile one. */
const extractJson = (text: string): Record<string, unknown> => extractJsonObject(text, "Ilita");

const CATEGORY_SET = new Set<string>(ILITA_REJECTION_CATEGORIES);

export type AuditResult =
  | { verdict: "pass"; feedback: string }
  | { verdict: "fail"; feedback: string; category: IlitaRejectionCategory };

/**
 * Audit any content format. The content string passed here should be the
 * canonical text of the piece (body, script, subject+body, etc.)
 */
export async function auditContent(params: {
  content:      string;
  format:       ContentFormat;
  brand_voice:  string;
  workspace_id?: string;
}): Promise<AuditResult> {
  const provider = await resolveProvider("audit", params.workspace_id, "ilita.auditContent");
  const text = (await provider.generateCompletion(
    ilitaAuditUserPrompt({
      content:     params.content,
      format:      params.format,
      brand_voice: params.brand_voice,
    }),
    { system_prompt: ilitaAuditSystemPrompt(params.format), max_tokens: 400 },
  )).trim();
  if (!text) throw new Error("Ilita: empty response");
  const parsed  = extractJson(text);
  const verdict = parsed.verdict === "pass" || parsed.verdict === "fail" ? parsed.verdict : null;
  if (!verdict) throw new Error(`Ilita: invalid verdict in response: ${text.slice(0, 200)}`);
  const feedback = typeof parsed.feedback === "string" ? parsed.feedback : "";
  if (verdict === "pass") return { verdict, feedback };

  // Fall back to "other" rather than throwing if the model omits/mis-spells the category —
  // a missing category shouldn't ever block a real rejection from being recorded.
  const category = CATEGORY_SET.has(String(parsed.category)) ? (parsed.category as IlitaRejectionCategory) : "other";
  return { verdict, feedback, category };
}

// ── Legacy shim ────────────────────────────────────────────────────────────────
export async function auditTweet(params: { tweet: string; brand_voice: string }): Promise<AuditResult> {
  return auditContent({ content: params.tweet, format: "tweet", brand_voice: params.brand_voice });
}
