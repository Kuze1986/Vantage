import { z } from "zod";

// ── Status / enums ─────────────────────────────────────────────────────────────
export const contentPieceStatusSchema = z.enum([
  "draft",
  "auditing",
  "approved",
  "rejected",
  "queued",
  "published",
  "failed",
]);
export type ContentPieceStatus = z.infer<typeof contentPieceStatusSchema>;

export const activitySourceTypeSchema = z.enum(["agent", "system", "adapter"]);
export type ActivitySourceType = z.infer<typeof activitySourceTypeSchema>;

export const channelSlugSchema = z.enum([
  "x",
  "linkedin",
  "reddit",
  "threads",
  "bluesky",
  "email",
  "tiktok",
  "instagram",
  "facebook",
]);
export type ChannelSlug = z.infer<typeof channelSlugSchema>;

// ── Channel → format map ───────────────────────────────────────────────────────
export const channelFormatMap: Record<ChannelSlug, string> = {
  x:         "tweet",
  linkedin:  "linkedin_post",
  reddit:    "reddit_thread",
  threads:   "threads_post",
  bluesky:   "bluesky_post",
  email:     "email_newsletter",
  tiktok:    "tiktok_script",
  instagram: "instagram_caption",
  facebook:  "facebook_post",
};

// Channels that post via API (vs manual queue)
export const API_CHANNELS: ChannelSlug[] = ["x", "linkedin", "reddit", "threads", "bluesky", "email"];
// Channels that require manual upload
export const MANUAL_CHANNELS: ChannelSlug[] = ["tiktok", "instagram", "facebook"];

// ── Cadence config ─────────────────────────────────────────────────────────────
export const cadenceConfigSchema = z.object({
  posts_per_day:    z.number().min(0).max(24).optional(),
  posts_per_week:   z.number().min(0).max(50).optional(),
  posting_hours:    z.array(z.number().min(0).max(23)).optional(), // UTC hours
  auto_approve:     z.boolean().optional(),
  subreddits:       z.array(z.string().min(1)).optional(),         // reddit only
  newsletter_day:   z.number().min(0).max(6).optional(),           // email, 0=Sun
}).strict();
export type CadenceConfig = z.infer<typeof cadenceConfigSchema>;

// ── Content payload shapes per format ─────────────────────────────────────────
export const tweetPayloadSchema = z.object({
  body: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export const linkedinPayloadSchema = z.object({
  body: z.string(),
  headline: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const redditPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  is_link_post: z.boolean().default(false),
  subreddit: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const emailPayloadSchema = z.object({
  subject: z.string(),
  preview_text: z.string().optional(),
  body: z.string(), // HTML
  metadata: z.record(z.unknown()).optional(),
});

export const tiktokScriptPayloadSchema = z.object({
  hook: z.string(),
  body: z.string(),
  on_screen_text: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const instagramPayloadSchema = z.object({
  body: z.string(),
  hashtags: z.array(z.string()).optional(),
  alt_text: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const facebookPayloadSchema = z.object({
  body: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

// ── API request/response schemas ───────────────────────────────────────────────
export const generateRequestSchema = z.object({
  topic_id:        z.string().uuid(),
  generate_image:  z.boolean().optional(),
  subreddit:       z.string().optional(),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const auditRequestSchema = z.object({
  content_piece_id: z.string().uuid(),
});
export type AuditRequest = z.infer<typeof auditRequestSchema>;

export const publishRequestSchema = z.object({
  content_piece_id: z.string().uuid(),
  external_post_url: z.string().url().optional(), // for manual-post channels
});
export type PublishRequest = z.infer<typeof publishRequestSchema>;

export const scheduleRequestSchema = z.object({
  content_piece_id: z.string().uuid(),
  scheduled_for:    z.string().optional(),
});
export type ScheduleRequest = z.infer<typeof scheduleRequestSchema>;

export const cadenceUpdateSchema = z.object({
  cadence_config: cadenceConfigSchema,
  enabled:        z.boolean().optional(),
});
export type CadenceUpdate = z.infer<typeof cadenceUpdateSchema>;

// ── Dashboard types ────────────────────────────────────────────────────────────
export const dashboardOverviewSchema = z.object({
  activityLast24h: z.array(z.object({
    id:           z.string().uuid(),
    source:       z.string(),
    source_type:  activitySourceTypeSchema,
    event_type:   z.string(),
    summary:      z.string(),
    occurred_at:  z.string(),
  })),
  queueDepth: z.object({
    draft:     z.number(),
    auditing:  z.number(),
    approved:  z.number(),
    rejected:  z.number(),
    queued:    z.number(),
    published: z.number(),
    failed:    z.number(),
  }),
  publishedToday: z.record(z.number()),   // channel_slug → count
  recentEngagement: z.array(z.object({
    id:               z.string().uuid(),
    content_piece_id: z.string().uuid().nullable(),
    event_type:       z.string(),
    occurred_at:      z.string(),
  })),
  channelStatus: z.array(z.object({
    slug:       z.string(),
    enabled:    z.boolean(),
    connected:  z.boolean(),
    queued:     z.number(),
    published_today: z.number(),
  })),
});
export type DashboardOverview = z.infer<typeof dashboardOverviewSchema>;

// ── Generation weights ─────────────────────────────────────────────────────────
export interface GenerationWeight {
  channel_slug: ChannelSlug;
  pattern_key:  string;
  weight:       number;
  sample_size:  number;
}
