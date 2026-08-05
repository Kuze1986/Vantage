/**
 * Publish Pack — one-click export bundle for manual channels (Facebook).
 * TikTok/Instagram post automatically now; packageTikTok/packageInstagram stay
 * wired into buildPublishPack() below as a fallback/reference, but are
 * unreachable via the API since queue.ts gates on MANUAL_PUBLISH_CHANNELS
 * before ever calling this.
 */
import { packageForManualPost as packageTikTok } from "../adapters/tiktok.js";
import { packageForManualPost as packageInstagram } from "../adapters/instagram.js";
import { packageForManualPost as packageFacebook } from "../adapters/facebook.js";

export const MANUAL_PUBLISH_CHANNELS = new Set(["facebook"]);

export type PublishPack = {
  content_piece_id: string;
  channel: string;
  caption: string;
  hashtags: string;
  video_url: string | null;
  thumbnail_url: string | null;
  copy_all: string;
  media_ready: boolean;
  instructions: string;
  /** Extra structured fields for the UI (hook/script/etc.). */
  fields: Record<string, string>;
};

function hashtagLine(tags: unknown): string {
  if (!Array.isArray(tags) || !tags.length) return "";
  return tags
    .map((t) => {
      const s = String(t).trim();
      if (!s) return "";
      return s.startsWith("#") ? s : `#${s}`;
    })
    .filter(Boolean)
    .join(" ");
}

export function buildPublishPack(opts: {
  id: string;
  channel: string;
  payload: Record<string, unknown>;
  videoUrl?: string | null;
  imageUrl?: string | null;
  mediaStatus?: string | null;
}): PublishPack {
  const { id, channel, payload } = opts;
  const video_url =
    (typeof opts.videoUrl === "string" && opts.videoUrl) ||
    (typeof payload.video_url === "string" ? payload.video_url : null);
  const thumbnail_url =
    (typeof opts.imageUrl === "string" && opts.imageUrl) ||
    (typeof payload.image_url === "string" ? payload.image_url : null) ||
    (typeof payload.og_image_url === "string" ? payload.og_image_url : null);

  let caption = "";
  let hashtags = "";
  let instructions = "";
  const fields: Record<string, string> = {};

  if (channel === "tiktok") {
    const pkg = packageTikTok(payload);
    // Post caption = hook (short); full narration stays in fields.script
    caption = pkg.hook || pkg.script;
    hashtags = hashtagLine(payload.hashtags);
    instructions = [
      video_url
        ? "1. Download the video from the link below."
        : "1. Record a video following the script (or attach a DemoForge render first).",
      "2. Upload to TikTok Creator Studio / the TikTok app.",
      "3. Paste the caption + hashtags.",
      "4. Copy the TikTok URL and paste it into Vantage to mark as published.",
    ].join("\n");
    if (pkg.hook) fields.hook = pkg.hook;
    if (pkg.script) fields.script = pkg.script;
    if (pkg.on_screen_text) fields.on_screen_text = pkg.on_screen_text;
  } else if (channel === "instagram") {
    const pkg = packageInstagram(payload);
    caption = pkg.caption || String(payload.body ?? payload.caption ?? "");
    hashtags = hashtagLine(pkg.hashtags.length ? pkg.hashtags : payload.hashtags);
    instructions = [
      video_url || thumbnail_url
        ? "1. Download the media from the link(s) below."
        : "1. Select your image or video in Instagram.",
      "2. Open Instagram → + → New post (or Reel).",
      "3. Paste the caption and hashtags.",
      "4. Post, then copy the URL and mark as published in Vantage.",
    ].join("\n");
    if (pkg.alt_text) fields.alt_text = pkg.alt_text;
  } else if (channel === "facebook") {
    const pkg = packageFacebook(payload);
    caption = pkg.text || String(payload.body ?? payload.text ?? "");
    hashtags = hashtagLine(payload.hashtags);
    instructions = [
      video_url || thumbnail_url
        ? "1. Download the media from the link(s) below."
        : "1. Open Facebook and go to your Page.",
      "2. Create a new post / Reel and attach the media.",
      "3. Paste the caption below.",
      "4. Publish, then copy the URL and mark as published in Vantage.",
    ].join("\n");
  } else {
    caption = String(payload.body ?? payload.caption ?? payload.text ?? "");
    hashtags = hashtagLine(payload.hashtags);
    instructions = "Copy the caption, attach media, and post on the platform.";
  }

  const captionWithTags = [caption.trim(), hashtags.trim()].filter(Boolean).join("\n\n");
  const media_ready =
    opts.mediaStatus === "ready" || Boolean(video_url) || Boolean(thumbnail_url);

  const copyParts = [
    captionWithTags ? `CAPTION\n${captionWithTags}` : "",
    fields.hook ? `HOOK\n${fields.hook}` : "",
    fields.script && channel === "tiktok" ? `SCRIPT\n${fields.script}` : "",
    fields.on_screen_text ? `ON-SCREEN\n${fields.on_screen_text}` : "",
    fields.alt_text ? `ALT TEXT\n${fields.alt_text}` : "",
    video_url ? `VIDEO\n${video_url}` : "",
    thumbnail_url ? `THUMBNAIL\n${thumbnail_url}` : "",
    instructions ? `INSTRUCTIONS\n${instructions}` : "",
  ].filter(Boolean);

  return {
    content_piece_id: id,
    channel,
    caption: caption.trim(),
    hashtags,
    video_url,
    thumbnail_url,
    copy_all: copyParts.join("\n\n"),
    media_ready,
    instructions,
    fields,
  };
}
