import Anthropic from "@anthropic-ai/sdk";
import { kuzeTweetSystemPrompt, kuzeTweetUserPrompt } from "@vantage/prompts";

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
  if (start === -1 || end === -1) throw new Error("Kuze returned non-JSON");
  const slice = trimmed.slice(start, end + 1);
  return JSON.parse(slice) as Record<string, unknown>;
}

export async function generateTweet(params: {
  topic_text: string;
  vertical: string | null;
  brand_voice: string;
}): Promise<{ body: string }> {
  const client = getClient();
  const system = kuzeTweetSystemPrompt();
  const user = kuzeTweetUserPrompt({
    topic_text: params.topic_text,
    vertical: params.vertical,
    brand_voice: params.brand_voice,
  });
  const msg = await client.messages.create({
    model,
    max_tokens: 600,
    system,
    messages: [{ role: "user", content: user }],
  });
  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Kuze: empty response");
  const parsed = parseJsonObject(block.text);
  const body = typeof parsed.body === "string" ? parsed.body : null;
  if (!body) throw new Error("Kuze: missing body in JSON");
  if (body.length > 280) throw new Error("Kuze: tweet exceeds 280 characters");
  return { body };
}
