import { z } from "zod";

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
  "email",
  "tiktok",
  "instagram",
  "facebook",
]);
export type ChannelSlug = z.infer<typeof channelSlugSchema>;

export const dashboardOverviewSchema = z.object({
  activityLast24h: z.array(
    z.object({
      id: z.string().uuid(),
      source: z.string(),
      source_type: activitySourceTypeSchema,
      event_type: z.string(),
      summary: z.string(),
      occurred_at: z.string(),
    }),
  ),
  queueDepth: z.object({
    approved: z.number(),
    queued: z.number(),
    auditing: z.number(),
    rejected: z.number(),
  }),
  recentEngagement: z.array(
    z.object({
      id: z.string().uuid(),
      content_piece_id: z.string().uuid().nullable(),
      event_type: z.string(),
      occurred_at: z.string(),
    }),
  ),
});
export type DashboardOverview = z.infer<typeof dashboardOverviewSchema>;

export const generateRequestSchema = z.object({
  topic_id: z.string().uuid(),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const auditRequestSchema = z.object({
  content_piece_id: z.string().uuid(),
});
export type AuditRequest = z.infer<typeof auditRequestSchema>;

export const publishRequestSchema = z.object({
  content_piece_id: z.string().uuid(),
});
export type PublishRequest = z.infer<typeof publishRequestSchema>;

export const scheduleRequestSchema = z.object({
  content_piece_id: z.string().uuid(),
  scheduled_for: z.string().optional(),
});
export type ScheduleRequest = z.infer<typeof scheduleRequestSchema>;
