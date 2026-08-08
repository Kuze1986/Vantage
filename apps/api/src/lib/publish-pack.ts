/**
 * Publish Pack — one-click export bundle for manual channels.
 * TikTok/Instagram/Facebook all post automatically now; packageTikTok/
 * packageInstagram/packageFacebook stay wired into buildPublishPack() below
 * as a fallback/reference, but are unreachable via the API unless their slug
 * is added to MANUAL_PUBLISH_CHANNELS — queue.ts gates on it before ever
 * calling this.
 *
 * Reddit IS manual: Reddit's API blocks cloud egress ranges outright (see
 * adapters/reddit.ts), so it can never post from Railway no matter how the
 * OAuth flow is configured. It's the one channel here that's manual by
 * external constraint rather than by choice.
 */
import { packageForManualPost as packageTikTok } from "../adapters/tiktok.js";
import { packageForManualPost as packageInstagram } from "../adapters/instagram.js";
import { packageForManualPost as packageFacebook } from "../adapters/facebook.js";
import { packageForManualPost as packageReddit } from "../adapters/reddit.js";

/**
 * Channels the pipeline must NOT attempt to post automatically. Everything
 * downstream keys off this one set: the cadence engine skips these pieces
 * instead of claiming them, POST /v1/publish requires an external_post_url
 * for them, and GET /v1/queue/:id/publish-pack only serves these slugs.
 */
export const MANUAL_PUBLISH_CHANNELS = new Set<string>(["reddit"]);

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
  /** Reddit only — the current round-robin target from the channel's cadence_config. */
  subreddit?: string | null;
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
  } else if (channel === "reddit") {
    const pkg = packageReddit(payload, opts.subreddit ?? undefined);
    // Reddit is title+body, not caption+hashtags. Hashtags are meaningless on
    // Reddit and read as spam, so they're deliberately left empty here.
    caption = pkg.body;
    instructions = pkg.instructions;
    fields.title = pkg.title;
    if (pkg.subreddit) fields.subreddit = `r/${pkg.subreddit}`;
  } else {
    caption = String(payload.body ?? payload.caption ?? payload.text ?? "");
    hashtags = hashtagLine(payload.hashtags);
    instructions = "Copy the caption, attach media, and post on the platform.";
  }

  const captionWithTags = [caption.trim(), hashtags.trim()].filter(Boolean).join("\n\n");
  const media_ready =
    opts.mediaStatus === "ready" || Boolean(video_url) || Boolean(thumbnail_url);

  const copyParts = [
    // Reddit's fields are named differently on the submit form — labelling its
    // body "CAPTION" would just make the paste harder to follow.
    fields.subreddit ? `SUBREDDIT\n${fields.subreddit}` : "",
    fields.title ? `TITLE\n${fields.title}` : "",
    captionWithTags ? `${channel === "reddit" ? "BODY" : "CAPTION"}\n${captionWithTags}` : "",
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
