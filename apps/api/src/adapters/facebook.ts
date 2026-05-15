/**
 * Facebook adapter — manual-post queue only.
 * Facebook Graph API posting requires Page access tokens which require
 * business verification. Content is packaged for one-click manual upload.
 */
import { logActivity } from "../lib/activity.js";

export interface FacebookPackage {
  text: string;
  instructions: string;
}

export function packageForManualPost(payload: Record<string, unknown>): FacebookPackage {
  return {
    text: String(payload.body ?? ""),
    instructions: [
      "1. Open Facebook and go to your Page.",
      "2. Create a new post and paste the text below.",
      "3. Publish, then copy the URL and mark as published in Vantage.",
    ].join("\n"),
  };
}

export async function post(_payload: Record<string, unknown>, pieceId: string): Promise<never> {
  await logActivity({
    source: "adapter:facebook",
    source_type: "adapter",
    event_type: "manual_post_required",
    summary: `Facebook piece ${pieceId} requires manual upload`,
    payload: { piece_id: pieceId },
  });
  throw new Error("Facebook requires manual posting — use the Queue page to copy the package");
}
