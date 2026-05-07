import Anthropic from "@anthropic-ai/sdk";
import { ilitaAuditSystemPrompt, ilitaAuditUserPrompt } from "@vantage/prompts";

const model = process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022";

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");
  return new Anthropic({ apiKey: key });
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Ilita returned non-JSON");
  const slice = trimmed.slice(start, end + 1);
  return JSON.parse(slice) as Record<string, unknown>;
}

export type AuditResult =
  | { verdict: "pass"; feedback: string }
  | { verdict: "fail"; feedback: string };

export async function auditTweet(params: { tweet: string; brand_voice: string }): Promise<AuditResult> {
  const client = getClient();
  const system = ilitaAuditSystemPrompt();
  const user = ilitaAuditUserPrompt({ tweet: params.tweet, brand_voice: params.brand_voice });
  const msg = await client.messages.create({
    model,
    max_tokens: 400,
    system,
    messages: [{ role: "user", content: user }],
  });
  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Ilita: empty response");
  const parsed = parseJsonObject(block.text);
  const verdict = parsed.verdict === "pass" || parsed.verdict === "fail" ? parsed.verdict : null;
  const feedback = typeof parsed.feedback === "string" ? parsed.feedback : "";
  if (!verdict) throw new Error("Ilita: invalid verdict");
  return { verdict, feedback };
}
