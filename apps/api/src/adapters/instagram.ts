/**
 * Instagram adapter — manual-post queue only.
 * Instagram Graph API requires a connected Facebook Page and business account approval
 * for automated posting. Content is packaged for one-click manual upload.
 */
import { logActivity } from "../lib/activity.js";

export interface InstagramPackage {
  caption: string;
  hashtags: string[];
  alt_text: string;
  instructions: string;
}

export function packageForManualPost(payload: Record<string, unknown>): InstagramPackage {
  return {
    caption:    String(payload.body ?? ""),
    hashtags:   Array.isArray(payload.hashtags) ? payload.hashtags.map(String) : [],
    alt_text:   String(payload.alt_text ?? ""),
    instructions: [
      "1. Open Instagram and tap the + button.",
      "2. Select your image or video.",
      "3. Paste the caption and hashtags below.",
      "4. Post, then copy the URL and mark as published in Vantage.",
    ].join("\n"),
  };
}

export async function post(_payload: Record<string, unknown>, pieceId: string): Promise<never> {
  await logActivity({
    source: "adapter:instagram",
    source_type: "adapter",
    event_type: "manual_post_required",
    summary: `Instagram piece ${pieceId} requires manual upload`,
    payload: { piece_id: pieceId },
  });
  throw new Error("Instagram requires manual posting — use the Queue page to copy the package");
}
