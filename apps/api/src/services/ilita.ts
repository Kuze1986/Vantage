import { ilitaAuditSystemPrompt, ilitaAuditUserPrompt } from "@vantage/prompts";
import type { ContentFormat } from "@vantage/prompts";
import { resolveProvider } from "../lib/llm.js";

function extractJson(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end   = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`Ilita returned non-JSON: ${trimmed.slice(0, 200)}`);
  return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
}

export type AuditResult =
  | { verdict: "pass"; feedback: string }
  | { verdict: "fail"; feedback: string };

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
  const provider = await resolveProvider("audit", params.workspace_id);
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
  return { verdict, feedback };
}

// ── Legacy shim ────────────────────────────────────────────────────────────────
export async function auditTweet(params: { tweet: string; brand_voice: string }): Promise<AuditResult> {
  return auditContent({ content: params.tweet, format: "tweet", brand_voice: params.brand_voice });
}
