import { kuzeSystemPrompt, kuzeUserPrompt, channelFormatMap } from "@vantage/prompts";
import type { ChannelSlug, ContentFormat, ViralityPatternExtra } from "@vantage/prompts";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { tagUrls } from "../lib/utm.js";
import { resolveDestination, appendDestination } from "../lib/destination.js";
import { loadSettings } from "../lib/settings.js";
import { resolveProvider } from "../lib/llm.js";
import { extractJsonArray, extractJsonObject, LlmJsonError } from "../lib/llm-json.js";

export type { ChannelSlug, ContentFormat };

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

const REJECTION_LOOKBACK_DAYS = 90;
const MIN_REJECTION_COUNT = 2; // a single rejection is noise, not a pattern worth avoiding

// Aggregates content_pieces.audit_category (structured Ilita rejection reasons — see
// packages/prompts ILITA_REJECTION_CATEGORIES) into the "avoid repeating this" prompt
// section. Closes the loop Ilita's rejections previously fed nowhere.
async function loadRejectionCategories(workspaceId: string, channel: ChannelSlug): Promise<string> {
  try {
    const sb = getSupabaseAdmin();
    const cutoff = new Date(Date.now() - REJECTION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await sb
      .from("content_pieces")
      .select("audit_category")
      .eq("workspace_id", workspaceId)
      .eq("channel_slug", channel)
      .in("status", ["rejected", "failed"])
      .not("audit_category", "is", null)
      .gte("updated_at", cutoff)
      .limit(200);
    if (!data?.length) return "";

    const counts = new Map<string, number>();
    for (const row of data as { audit_category: string }[]) {
      counts.set(row.audit_category, (counts.get(row.audit_category) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, count]) => count >= MIN_REJECTION_COUNT)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => `${category}: ${count}`)
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
  /**
   * The launching campaign, if any — lets its `destination_url` override the
   * workspace's default product link. Every regeneration path (audit
   * retries, launch retries, autogen retries) re-enters through this same
   * function, so passing it once here covers first-pass and retried
   * generations alike without each caller having to remember to append a
   * link a second time.
   */
  campaign_id?: string | null;
  extras?: { subreddit?: string };
}

export interface GenerateContentOutput {
  format: ContentFormat;
  content_payload: Record<string, unknown>;
  text_preview: string;
}

export async function generateContent(input: GenerateContentInput): Promise<GenerateContentOutput> {
  const format = channelFormatMap[input.channel] as ContentFormat;
  const [weights, avoidWeights, viralityPatterns, rejectionCategories, destination, settings] = await Promise.all([
    loadWeights(input.workspace_id, input.channel),
    loadUnderperformingWeights(input.workspace_id, input.channel),
    loadViralityPatterns(input.workspace_id, input.channel),
    loadRejectionCategories(input.workspace_id, input.channel),
    resolveDestination(input.workspace_id, input.channel, input.campaign_id),
    loadSettings(input.workspace_id),
  ]);
  const reserveForLink = destination.policy === "inline" && !!destination.url;
  // UTM decoration happens after a content piece exists. Reserve for both the
  // raw destination and the bounded attribution suffix now, so the finished
  // post rather than just Kuze's pre-link draft fits platform hard limits.
  const linkReserveChars = reserveForLink
    ? destination.url!.length + 2 + 130
    : 0;
  const provider = await resolveProvider("generate", input.workspace_id, "kuze.generateContent");

  const userPrompt = kuzeUserPrompt({
    format,
    topic_text:  input.topic_text,
    vertical:    input.vertical,
    brand_voice: input.brand_voice,
    channel:     input.channel,
    extras: {
      subreddit: input.extras?.subreddit,
      weights: weights || undefined,
      avoidWeights: avoidWeights || undefined,
      viralityPatterns: viralityPatterns.length ? viralityPatterns : undefined,
      rejectionCategories: rejectionCategories || undefined,
    },
  });
  // Brand voice goes into the *system* prompt, where it outranks the built-in
  // defaults, rather than sitting mid-stack in the user prompt where it lost to
  // them.
  const genOptions = {
    system_prompt: kuzeSystemPrompt(format, {
      brandVoice: input.brand_voice,
      channel: input.channel,
      reserveForLink,
      linkReserveChars,
      operatorInstructions: settings.generator_instructions,
    }),
    max_tokens: 1400,
  };

  const rawText = (await provider.generateCompletion(userPrompt, genOptions)).trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJsonObject(rawText, "Kuze");
  } catch (err) {
    if (!(err instanceof LlmJsonError)) throw err;
    // The safe repairs could not rescue it. Rather than fail a campaign launch on
    // one malformed response, hand the model its own broken output and the parser
    // error and let it correct itself — the same regenerate-with-feedback shape the
    // Ilita audit loop already uses. One retry only: a model that cannot emit valid
    // JSON twice is a prompt or provider problem, and retrying forever would just
    // burn tokens hiding it.
    console.warn(
      `[kuze] malformed JSON for ${input.channel}/${format}, retrying once. ` +
      `${err.message}${err.position != null ? ` near: ${err.context}` : ""}`,
    );
    const retryText = (await provider.generateCompletion(
      `${userPrompt}\n\nYour previous response could not be parsed as JSON (${err.message}). ` +
      `Return the same content as a single valid JSON object and nothing else — no prose, no ` +
      `markdown fence. Escape every double quote and newline inside string values.`,
      genOptions,
    )).trim();
    try {
      parsed = extractJsonObject(retryText, "Kuze");
    } catch (retryErr) {
      if (!(retryErr instanceof LlmJsonError)) throw retryErr;
      // Surface what the model actually said. The old extractor discarded it,
      // which is why the first production occurrence left nothing to debug.
      throw new Error(
        `Kuze returned unparseable JSON twice for ${input.channel}/${format}. ` +
        `${retryErr.message}. Near: ${retryErr.context}`,
      );
    }
  }

  // Append the resolved destination before any length check runs, so a link
  // that pushes a piece over budget is caught here rather than shipping a
  // silently truncated post — see destination.ts for why this is
  // deterministic rather than left to the model.
  parsed = appendDestination(parsed, destination);

  // Hard-capped platforms: a model that ignores its instructed budget (with
  // or without an appended link) must fail generation, not publish a post
  // the platform truncates or rejects outright. Bluesky's 300-grapheme cap in
  // particular fails at the adapter/API layer with a worse error than this.
  const LENGTH_LIMITS: Partial<Record<ContentFormat, number>> = {
    tweet: 280,
    threads_post: 500,
    bluesky_post: 300,
  };
  const limit = LENGTH_LIMITS[format];
  if (limit != null) {
    const body = typeof parsed.body === "string" ? parsed.body : "";
    if (body.length > limit) {
      throw new Error(`Kuze ${format} exceeds ${limit} chars${reserveForLink ? " after destination link" : ""} (${body.length})`);
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
  const [weights, avoidWeights, patterns, rejectionCategories] = await Promise.all([
    loadWeights(input.workspace_id, input.channel),
    loadUnderperformingWeights(input.workspace_id, input.channel),
    loadViralityPatterns(input.workspace_id, input.channel),
    loadRejectionCategories(input.workspace_id, input.channel),
  ]);
  const provider = await resolveProvider("generate", input.workspace_id, "kuze.generateCaptions");

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
  const rejectionHint = rejectionCategories
    ? `\n\nRecently rejected for (avoid): ${rejectionCategories.split('\n').map((l) => l.split(':')[0]).join(', ')}`
    : '';
  const countHint    = input.count ?? 3;

  const systemPrompt = `You are Kuze, a social-media copywriter. Return ONLY a JSON array of ${countHint} caption strings — no markdown, no wrapper object, just a raw JSON array. Each caption is a distinct variation of the same angle for ${channelLabel}. Platform character limits: X ≤ 280. LinkedIn ≤ 3000. Instagram ≤ 2200. Others: no limit.`;

  const userContent = `Brand voice:
${input.brand_voice}
${weightsHint}${avoidHint}${patternHint}${rejectionHint}

Topic/angle: ${input.prompt}
${toneHint}
Generate ${countHint} caption variants for ${channelLabel}. Return a JSON array of strings only.`;

  const raw = (await provider.generateCompletion(userContent, {
    system_prompt: systemPrompt,
    max_tokens: 1200,
  })).trim();

  // Same tolerant path as generateContent — fences, trailing commas and raw
  // newlines in captions were all reachable here too.
  return extractJsonArray<unknown>(raw, "Kuze captions").map((s) => String(s));
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
