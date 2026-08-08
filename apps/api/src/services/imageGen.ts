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
 *
 * **The generated image is persisted to Storage before this returns.** OpenAI
 * serves DALL-E output from a signed URL that expires about an hour after
 * generation, so storing that URL on the piece — which is what this used to do —
 * produced an `image_url` that was a dead link by the time anyone published or
 * reviewed it, and would have handed the LinkedIn image passthrough (3A-3) a 404
 * to register as its media asset.
 *
 * We request `b64_json` rather than `url` so there is no expiry window to race:
 * the bytes come back inline and go straight to `vantage-media`. The only URL
 * that ever touches the database is the permanent Supabase public URL.
 */
import OpenAI from "openai";
import { logActivity } from "../lib/activity.js";
import { getSupabaseAdmin } from "../lib/supabase.js";

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
  topic_text:   string;
  vertical:     string | null;
  channel:      string;
  brand_name:   string;
  workspace_id: string;
  piece_id:     string;
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
    response_format: "b64_json",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("DALL-E 3 returned no image data");

  // Namespaced by workspace to match POST /v1/media/upload's convention, so the
  // media gallery can attribute the object without consulting the database.
  const storagePath = `workspaces/${params.workspace_id}/generated/${params.piece_id}.png`;
  const buffer      = Buffer.from(b64, "base64");

  const sb = getSupabaseAdmin();
  const { error: uploadErr } = await sb.storage
    .from("vantage-media")
    .upload(storagePath, buffer, { contentType: "image/png", upsert: true });
  if (uploadErr) {
    // Throwing is correct: the base64 payload was the only copy, so there is no
    // usable URL to fall back to. The caller logs image_generate_error and the
    // piece continues without an image rather than carrying a broken one.
    throw new Error(`Generated image upload failed: ${uploadErr.message}`);
  }

  const { data: urlData } = sb.storage.from("vantage-media").getPublicUrl(storagePath);
  const publicUrl = urlData.publicUrl;

  await logActivity({
    source: "kuze", source_type: "agent",
    event_type: "image_generated",
    summary: `Image generated for ${params.channel} (${size})`,
    payload: {
      channel:      params.channel,
      vertical:     params.vertical,
      size,
      storage_path: storagePath,
      bytes:        buffer.length,
    },
    workspace_id: params.workspace_id,
  });

  return publicUrl;
}
