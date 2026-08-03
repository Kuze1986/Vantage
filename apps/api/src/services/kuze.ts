import { kuzeSystemPrompt, kuzeUserPrompt, channelFormatMap } from "@vantage/prompts";
import type { ChannelSlug, ContentFormat, ViralityPatternExtra } from "@vantage/prompts";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { tagUrls } from "../lib/utm.js";
import { resolveProvider } from "../lib/llm.js";

export type { ChannelSlug, ContentFormat };

function extractJson(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end   = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`Kuze returned non-JSON: ${trimmed.slice(0, 200)}`);
  return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
}

async function loadWeights(workspaceId: string, channel: ChannelSlug): Promise<string> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from("generation_weights")
      .select("pattern_key, weight, sample_size")
      .eq("workspace_id", workspaceId)
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

// BioLoop's EWMA clamps weight to [0.5, 2.0] with 1.0 neutral (see supabase/functions/bioloop/index.ts).
// 0.8 requires a pattern to be meaningfully bad — 0.2 below neutral — before Kuze is told to
// avoid it, a higher bar than the 1.1 "apply" floor since avoid-instructions more actively
// constrain generation than apply-instructions loosen it.
async function loadUnderperformingWeights(workspaceId: string, channel: ChannelSlug): Promise<string> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from("generation_weights")
      .select("pattern_key, weight, sample_size")
      .eq("workspace_id", workspaceId)
      .eq("channel_slug", channel)
      .lte("weight", 0.8)
      .order("weight", { ascending: true })
      .limit(10);
    if (!data?.length) return "";
    return (data as { pattern_key: string; weight: number; sample_size: number }[])
      .map((w) => `${w.pattern_key}: ${w.weight.toFixed(2)} (n=${w.sample_size})`)
      .join("\n");
  } catch {
    return "";
  }
}

// virality_patterns.source_platform only allows x/linkedin/reddit today — this returns []
// for bluesky/threads until BioLoop's pattern-detection is separately extended to cover them
// (out of scope here; empty result is expected, not a bug).
async function loadViralityPatterns(workspaceId: string, channel: ChannelSlug): Promise<ViralityPatternExtra[]> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from("virality_patterns")
      .select("pattern_name, pattern_description, characteristics, reproduction_success_rate, confidence_score, sample_size")
      .eq("workspace_id", workspaceId)
      .eq("source_platform", channel)
      .gte("confidence_score", 0.6)
      .order("reproduction_success_rate", { ascending: false })
      .limit(5);
    return (data ?? []) as ViralityPatternExtra[];
  } catch {
    return [];
  }
}

export interface GenerateContentInput {
  workspace_id: string;
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
  const format = channelFormatMap[input.channel] as ContentFormat;
  const [weights, avoidWeights, viralityPatterns] = await Promise.all([
    loadWeights(input.workspace_id, input.channel),
    loadUnderperformingWeights(input.workspace_id, input.channel),
    loadViralityPatterns(input.workspace_id, input.channel),
  ]);
  const provider = await resolveProvider("generate", input.workspace_id);

  const rawText = (await provider.generateCompletion(
    kuzeUserPrompt({
      format,
      topic_text:  input.topic_text,
      vertical:    input.vertical,
      brand_voice: input.brand_voice,
      extras: {
        subreddit: input.extras?.subreddit,
        weights: weights || undefined,
        avoidWeights: avoidWeights || undefined,
        viralityPatterns: viralityPatterns.length ? viralityPatterns : undefined,
      },
    }),
    { system_prompt: kuzeSystemPrompt(format), max_tokens: 1400 },
  )).trim();

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

// ── Caption generation (AI Caption Studio — 3C-2) ─────────────────────────────
export interface GenerateCaptionsInput {
  workspace_id: string;
  prompt: string;
  channel: ChannelSlug;
  count?: number;
  tone?: string;
  brand_voice: string;
}

export async function generateCaptions(input: GenerateCaptionsInput): Promise<string[]> {
  const [weights, avoidWeights, patterns] = await Promise.all([
    loadWeights(input.workspace_id, input.channel),
    loadUnderperformingWeights(input.workspace_id, input.channel),
    loadViralityPatterns(input.workspace_id, input.channel),
  ]);
  const provider = await resolveProvider("generate", input.workspace_id);

  const channelLabel = input.channel.toUpperCase();
  const toneHint     = input.tone ? `Tone: ${input.tone}. ` : '';
  const weightsHint  = weights
    ? `\n\nPerformance weights (favour these patterns): ${weights}`
    : '';
  const avoidHint = avoidWeights
    ? `\n\nUnderperforming patterns (avoid): ${avoidWeights}`
    : '';
  // Terse — pattern names only, not the full characteristics breakdown. That level of
  // detail belongs in the primary generation prompt, not this compact caption-variant tool.
  const patternHint = patterns.length
    ? `\n\nProven viral patterns: ${patterns.map((p) => p.pattern_name).join(', ')}`
    : '';
  const countHint    = input.count ?? 3;

  const systemPrompt = `You are Kuze, a social-media copywriter. Return ONLY a JSON array of ${countHint} caption strings — no markdown, no wrapper object, just a raw JSON array. Each caption is a distinct variation of the same angle for ${channelLabel}. Platform character limits: X ≤ 280. LinkedIn ≤ 3000. Instagram ≤ 2200. Others: no limit.`;

  const userContent = `Brand voice:
${input.brand_voice}
${weightsHint}${avoidHint}${patternHint}

Topic/angle: ${input.prompt}
${toneHint}
Generate ${countHint} caption variants for ${channelLabel}. Return a JSON array of strings only.`;

  const raw = (await provider.generateCompletion(userContent, {
    system_prompt: systemPrompt,
    max_tokens: 1200,
  }))
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Kuze returned non-array for captions');
  return (parsed as unknown[]).map((s) => String(s));
}

// ── Legacy shim ────────────────────────────────────────────────────────────────
export async function generateTweet(params: {
  workspace_id: string;
  topic_text: string;
  vertical: string | null;
  brand_voice: string;
}): Promise<{ body: string }> {
  const out = await generateContent({ channel: "x", ...params });
  return { body: String(out.content_payload.body ?? "") };
}
