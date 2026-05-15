/**
 * TikTok adapter — manual-post queue only.
 * TikTok's API does not support direct video publishing for marketing accounts
 * without enterprise approval. Content is packaged here for one-click manual upload.
 */
import { logActivity } from "../lib/activity.js";

export interface TikTokPackage {
  hook: string;
  script: string;
  on_screen_text?: string;
  instructions: string;
}

export function packageForManualPost(payload: Record<string, unknown>): TikTokPackage {
  return {
    hook:           String(payload.hook ?? ""),
    script:         String(payload.body ?? ""),
    on_screen_text: payload.on_screen_text ? String(payload.on_screen_text) : undefined,
    instructions: [
      "1. Record a video following the script below.",
      "2. Add on-screen text captions where indicated.",
      "3. Upload to TikTok Creator Studio.",
      "4. Copy the TikTok URL and paste it into Vantage to mark as published.",
    ].join("\n"),
  };
}

export async function post(_payload: Record<string, unknown>, pieceId: string): Promise<never> {
  await logActivity({
    source: "adapter:tiktok",
    source_type: "adapter",
    event_type: "manual_post_required",
    summary: `TikTok piece ${pieceId} requires manual upload`,
    payload: { piece_id: pieceId },
  });
  throw new Error("TikTok requires manual posting — download the script package from the Queue page");
}
