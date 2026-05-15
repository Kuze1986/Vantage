import Anthropic from "@anthropic-ai/sdk";
import { kuzeSystemPrompt, kuzeUserPrompt, channelFormatMap } from "@vantage/prompts";
import type { ChannelSlug, ContentFormat } from "@vantage/prompts";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { tagUrls } from "../lib/utm.js";

export type { ChannelSlug, ContentFormat };

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
  if (start === -1 || end === -1) throw new Error(`Kuze returned non-JSON: ${trimmed.slice(0, 200)}`);
  return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
}

async function loadWeights(channel: ChannelSlug): Promise<string> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .schema("vantage")
      .from("generation_weights")
      .select("pattern_key, weight, sample_size")
      .eq("channel_slug", channel)
      .gte("weight", 1.1)
      .order("weight", { ascending: false })
      .limit(10);
    if (!data?.length) return "";
    return (data as { pattern_key: string; weight: number; sample_size: number }[])
      .map((w) => `${w.pattern_key}: ${w.weight.toFixed(2)} (n=${w.sample_size})`)
      .join("\n");
  } catch {
    return "";
  }
}

export interface GenerateContentInput {
  channel: ChannelSlug;
  topic_text: string;
  vertical: string | null;
  brand_voice: string;
  pieceId?: string;
  extras?: { subreddit?: string };
}

export interface GenerateContentOutput {
  format: ContentFormat;
  content_payload: Record<string, unknown>;
  text_preview: string;
}

export async function generateContent(input: GenerateContentInput): Promise<GenerateContentOutput> {
  const format  = channelFormatMap[input.channel] as ContentFormat;
  const weights = await loadWeights(input.channel);
  const client  = getClient();

  const msg = await client.messages.create({
    model:      MODEL,
    max_tokens: 1400,
    system:     kuzeSystemPrompt(format),
    messages:   [{ role: "user", content: kuzeUserPrompt({
      format,
      topic_text:  input.topic_text,
      vertical:    input.vertical,
      brand_voice: input.brand_voice,
      extras: { subreddit: input.extras?.subreddit, weights: weights || undefined },
    }) }],
  });

  const rawText = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .trim();

  const parsed = extractJson(rawText);

  // Tweet-specific length guard
  if (format === "tweet") {
    const body = typeof parsed.body === "string" ? parsed.body : "";
    if (body.length > 280) {
      throw new Error(`Kuze tweet exceeds 280 chars (${body.length})`);
    }
  }

  // UTM-tag any URL-like strings in the payload
  if (input.pieceId) {
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") parsed[k] = tagUrls(v, input.channel, input.pieceId);
    }
  }

  const preview = String(parsed.body ?? parsed.text ?? parsed.hook ?? parsed.title ?? "").slice(0, 200);

  return { format, content_payload: parsed, text_preview: preview };
}

// ── Legacy shim ────────────────────────────────────────────────────────────────
export async function generateTweet(params: {
  topic_text: string;
  vertical: string | null;
  brand_voice: string;
}): Promise<{ body: string }> {
  const out = await generateContent({ channel: "x", ...params });
  return { body: String(out.content_payload.body ?? "") };
}
