/**
 * imageGen — DALL-E 3 static image generation.
 *
 * Called from the generate route when generate_image=true.
 * Requires OPENAI_API_KEY. If the key is absent the function throws a clear
 * error that surfaces in the activity log and API response.
 *
 * Aspect ratios are chosen per channel:
 *   landscape 1792×1024 → X, LinkedIn, Facebook
 *   square    1024×1024 → Instagram
 *   portrait  1024×1792 → TikTok
 */
import OpenAI from "openai";
import { logActivity } from "../lib/activity.js";

type DalleSize = "1024x1024" | "1792x1024" | "1024x1792";

const CHANNEL_SIZE: Record<string, DalleSize> = {
  x:         "1792x1024",
  linkedin:  "1792x1024",
  facebook:  "1792x1024",
  instagram: "1024x1024",
  tiktok:    "1024x1792",
  reddit:    "1024x1024",
  email:     "1792x1024",
};

function getClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set — image generation unavailable");
  return new OpenAI({ apiKey: key });
}

export async function generateImage(params: {
  topic_text:  string;
  vertical:    string | null;
  channel:     string;
  brand_name:  string;
}): Promise<string> {
  const client = getClient();
  const size   = CHANNEL_SIZE[params.channel] ?? "1024x1024";

  const prompt = [
    `Professional marketing visual for ${params.brand_name}.`,
    `Visual theme: ${params.topic_text.slice(0, 180)}`,
    params.vertical ? `Industry: ${params.vertical}.` : "",
    "Style: clean, modern, high-quality. No text overlays or watermarks.",
    "Corporate but approachable. Photorealistic or polished illustration.",
  ].filter(Boolean).join(" ");

  const response = await client.images.generate({
    model:           "dall-e-3",
    prompt,
    n:               1,
    size,
    quality:         "standard",
    response_format: "url",
  });

  const url = response.data?.[0]?.url;
  if (!url) throw new Error("DALL-E 3 returned no image URL");

  await logActivity({
    source: "kuze", source_type: "agent",
    event_type: "image_generated",
    summary: `Image generated for ${params.channel} (${size})`,
    payload: { channel: params.channel, vertical: params.vertical, size },
  });

  return url;
}
