import Anthropic from "@anthropic-ai/sdk";
import { ilitaAuditSystemPrompt, ilitaAuditUserPrompt } from "@vantage/prompts";
import type { ContentFormat } from "@vantage/prompts";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");
  return new Anthropic({ apiKey: key });
}

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
  content:     string;
  format:      ContentFormat;
  brand_voice: string;
}): Promise<AuditResult> {
  const client = getClient();
  const msg = await client.messages.create({
    model:      MODEL,
    max_tokens: 400,
    system:     ilitaAuditSystemPrompt(params.format),
    messages:   [{ role: "user", content: ilitaAuditUserPrompt({
      content:     params.content,
      format:      params.format,
      brand_voice: params.brand_voice,
    }) }],
  });

  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Ilita: empty response");
  const text    = block.text;
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
