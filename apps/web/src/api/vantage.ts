import { supabase } from "../lib/supabase";

const base = ((import.meta.env.VITE_VANTAGE_API_URL as string | undefined) ?? "").replace(/\/$/, "");

// Workspace ID cache — populated by WorkspaceProvider on login
let _cachedWorkspaceId: string | null = null;
export function setWorkspaceId(id: string | null) { _cachedWorkspaceId = id; }
export function getWorkspaceId() { return _cachedWorkspaceId; }

export async function vantageFetch(path: string, init: RequestInit = {}) {
  if (!base) throw new Error("VITE_VANTAGE_API_URL is not set — add it to apps/web/.env.local");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (_cachedWorkspaceId) headers.set("x-workspace-id", _cachedWorkspaceId);
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: string }).error)
        : text;
    throw new Error(msg || res.statusText);
  }
  return body;
}

/** Live account state backing the TikTok posting form (never cached). */
export type TikTokCreatorInfo = {
  creator_avatar_url: string
  creator_username: string
  creator_nickname: string
  privacy_level_options: string[]
  comment_disabled: boolean
  duet_disabled: boolean
  stitch_disabled: boolean
  max_video_post_duration_sec: number
}

/** Mirrors TikTokPostSettings in apps/api/src/adapters/tiktok.ts. */
export type TikTokPostSettings = {
  title: string
  privacy_level: string
  disable_comment?: boolean
  disable_duet?: boolean
  disable_stitch?: boolean
  video_cover_timestamp_ms?: number
  brand_content_toggle?: boolean
  brand_organic_toggle?: boolean
  is_aigc?: boolean
}

export type BrandKitRecord = {
  id: string;
  name: string;
  logo_url: string | null;
  logo_storage_path: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  font_heading: string;
  font_body: string;
  created_at?: string;
  updated_at?: string;
};

/** Mirrors Plan in api/src/lib/plans.ts. A negative limit means unlimited. */
export type BillingPlan = {
  key: 'trial' | 'starter' | 'growth' | 'scale' | 'internal';
  label: string;
  priceMonthly: string;
  priceAnnual: string | null;
  generations: number;
  videos: number;
  workspaces: number;
  channels: number;
  features: string[];
  selfServe: boolean;
};

export type BillingState = {
  plan: BillingPlan;
  subscription: { status: string; plan_key: string | null; current_period_end: string | null } | null;
  usage: {
    period_start: string;
    used: { generations: number; videos: number };
    limits: { generations: number; videos: number };
  };
  plans: BillingPlan[];
  stripe_configured: boolean;
};

/** One asset in the media gallery. Mirrors MediaItem in api/src/lib/media-gallery.ts. */
export type MediaGalleryItem = {
  id: string;
  kind: 'image' | 'video';
  url: string;
  thumbnail_url: string | null;
  label: string;
  source: 'piece' | 'demoforge' | 'brand_kit' | 'clip' | 'upload';
  piece_id: string | null;
  job_id: string | null;
  created_at: string | null;
};

export type ChannelStatus = {
  slug: string;
  enabled: boolean;
  connected: boolean;
  cadence_config: {
    posts_per_day?: number;
    posts_per_week?: number;
    posting_hours?: number[];
    auto_approve?: boolean;
    subreddits?: string[];
    newsletter_day?: string;
  };
  connected_at: string | null;
  /** Derived server-side from MANUAL_PUBLISH_CHANNELS — see api/src/lib/channel-auth.ts. */
  auth_method: 'oauth' | 'api_key' | 'manual';
  /** True when the operator can start an OAuth flow for this channel. */
  supports_oauth: boolean;
};

export type ChannelBreakdownEntry = {
  published_today: number;
  published_7d: number;
  auditing: number;
  queued: number;
};

export type TopPiece = {
  id: string;
  channel_slug: string;
  published_at: string;
  engagement_count: number;
  preview: string;
};

export type VerticalBreakdownEntry = {
  published_7d: number;
  published_today: number;
  queued: number;
  auditing: number;
  engagement_7d: number;
};

export type DashboardOverview = {
  activityLast24h: { id: string; source: string; summary: string; occurred_at: string; event_type: string }[];
  queueDepth: Record<string, number>;
  publishedToday: Record<string, number>;
  channelStatus: { slug: string; enabled: boolean; connected: boolean; posts_per_day: number; published_today: number; published_7d: number; auditing: number; queued: number }[];
  channelBreakdown: Record<string, ChannelBreakdownEntry>;
  topPieces: TopPiece[];
  recentEngagement: unknown[];
  verticalBreakdown: Record<string, VerticalBreakdownEntry>;
};

export type Subscriber = {
  id: string;
  email: string;
  name: string | null;
  tags: string[];
  subscribed_at: string;
  unsubscribed_at: string | null;
};

/**
 * Mirrors PipelineSettings in apps/api/src/lib/settings.ts. Declared once so the GET
 * and PATCH shapes cannot drift — SettingsPage PATCHes the whole draft, so a field
 * missing here is a field the UI silently drops.
 */
export type VantageSettings = {
  dedup_days: number;
  scripta_enabled: boolean;
  bioloop_enabled: boolean;
  active_verticals: string[];
  /** Bare provider name, or a failover pool: "openai:gpt-4o,anthropic". "" = inherit. */
  llm_provider_generate: string;
  llm_provider_audit: string;
  /** Model for the head slot. "" = provider default. */
  llm_model_generate: string;
  llm_model_audit: string;
  llm_failover_enabled: boolean;
  generator_instructions: string;
  auditor_instructions: string;
  /** 3C-6: serialized Email Builder chrome with a {{content}} marker. "" = send unwrapped. */
  email_wrapper_html: string;
};

export const vantageApi = {
  // ── Source ────────────────────────────────────────────────────────────────
  getTopics: (limit = 20) =>
    vantageFetch(`/v1/source/topics?limit=${limit}`) as Promise<{ topics: unknown[] }>,
  refreshSource: () =>
    vantageFetch("/v1/source/refresh", { method: "POST" }) as Promise<{
      shift: { inserted: number; scanned: number };
      scripta: { inserted: number; scanned: number };
    }>,
  pulseScan: () =>
    vantageFetch("/v1/source/pulse", { method: "POST" }) as Promise<{
      inserted: number;
      scanned: number;
    }>,

  // ── Generate ──────────────────────────────────────────────────────────────
  generate: (channel: string, topic_id: string, opts?: { subreddit?: string }) =>
    vantageFetch(`/v1/generate/${channel}`, {
      method: "POST",
      body: JSON.stringify({ topic_id, ...(opts ?? {}) }),
    }) as Promise<{ content_piece_id: string; format: string; status: string }>,

  // ── Audit ─────────────────────────────────────────────────────────────────
  audit: (content_piece_id: string) =>
    vantageFetch("/v1/audit", {
      method: "POST",
      body: JSON.stringify({ content_piece_id }),
    }) as Promise<{ verdict: string; status: string; feedback?: string }>,

  // ── Publish ───────────────────────────────────────────────────────────────
  publish: (channel: string, content_piece_id: string, external_post_url?: string, force?: boolean) =>
    vantageFetch(`/v1/publish/${channel}`, {
      method: "POST",
      body: JSON.stringify({ content_piece_id, external_post_url, force }),
    }) as Promise<{ ok: boolean; external_post_id: string; manual?: boolean }>,

  // ── Schedule ──────────────────────────────────────────────────────────────
  schedule: (content_piece_id: string, scheduled_for?: string, force?: boolean) =>
    vantageFetch("/v1/schedule", {
      method: "POST",
      body: JSON.stringify({ content_piece_id, scheduled_for, force }),
    }),

  bulkSchedule: (content_piece_ids: string[], force?: boolean) =>
    vantageFetch("/v1/queue/bulk-schedule", {
      method: "POST",
      body: JSON.stringify({ content_piece_ids, force }),
    }) as Promise<{
      ok: boolean;
      scheduled: number;
      results: { id: string; ok: boolean; error?: string }[];
    }>,

  getPublishPack: (id: string) =>
    vantageFetch(`/v1/queue/${id}/publish-pack`) as Promise<{
      content_piece_id: string;
      channel: string;
      caption: string;
      hashtags: string;
      video_url: string | null;
      thumbnail_url: string | null;
      copy_all: string;
      media_ready: boolean;
      instructions: string;
      fields?: Record<string, string>;
    }>,

  // ── Queue ─────────────────────────────────────────────────────────────────
  getQueue: (limit = 100) =>
    vantageFetch(`/v1/queue?limit=${limit}`) as Promise<{ pieces: {
      id: string; status: string; channel_slug: string; format: string;
      content_payload: Record<string, unknown>; audit_notes: string | null;
      audit_iterations: number; created_at: string;
      image_url?: string | null;
      video_url?: string | null;
      media_status?: string | null;
      retry_count?: number; retry_after?: string | null;
      variant_group_id?: string | null;
    }[] }>,

  patchQueuePiece: (id: string, body: {
    image_url?: string | null;
    video_url?: string | null;
    media_status?: "none" | "pending" | "ready" | "failed";
    content_payload_patch?: Record<string, unknown>;
  }) =>
    vantageFetch(`/v1/queue/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }) as Promise<{ piece: {
      id: string; image_url: string | null; video_url: string | null;
      media_status: string; content_payload: Record<string, unknown>;
    } }>,

  // ── TikTok Direct Post ────────────────────────────────────────────────────
  // creator-info is fetched fresh every time the compose form opens — TikTok
  // requires the options shown to reflect the account's current settings.
  getTikTokCreatorInfo: () =>
    vantageFetch("/v1/channels/tiktok/creator-info") as Promise<{ creator: TikTokCreatorInfo }>,

  getTikTokUserInfo: () =>
    vantageFetch("/v1/channels/tiktok/user-info") as Promise<{
      user: { open_id: string; display_name: string; avatar_url: string };
    }>,

  getTikTokPublishStatus: (publishId: string) =>
    vantageFetch(`/v1/channels/tiktok/publish-status/${publishId}`) as Promise<{
      status: string; fail_reason?: string; publicly_available_post_id?: string[];
    }>,

  disconnectTikTok: () =>
    vantageFetch("/v1/channels/tiktok/auth", { method: "DELETE" }) as Promise<{
      ok: boolean; revoked: boolean;
    }>,

  // 3A-6: Retry a permanently-failed piece
  retryPiece: (id: string) =>
    vantageFetch(`/v1/queue/${id}/retry`, { method: "POST" }) as Promise<{ ok: boolean }>,

  /** Soft-dismiss — status → rejected (still visible on Rejected tab). */
  rejectPiece: (id: string, reason?: string) =>
    vantageFetch(`/v1/queue/${id}/reject`, {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    }) as Promise<{ ok: boolean; status: string }>,

  /** Permanently delete a piece from the queue. */
  deletePiece: (id: string) =>
    vantageFetch(`/v1/queue/${id}`, { method: "DELETE" }) as Promise<{ ok: boolean; deleted: string }>,

  // ── Dashboard ─────────────────────────────────────────────────────────────
  dashboardOverview: () =>
    vantageFetch("/v1/dashboard/overview") as Promise<DashboardOverview>,

  // ── Billing ───────────────────────────────────────────────────────────────
  getBilling: () => vantageFetch("/v1/billing") as Promise<BillingState>,

  startCheckout: (plan: string, interval: 'monthly' | 'annual') =>
    vantageFetch("/v1/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan, interval }),
    }) as Promise<{ url: string; session_id: string }>,

  openBillingPortal: () =>
    vantageFetch("/v1/billing/portal", { method: "POST" }) as Promise<{ url: string }>,

  // ── Media gallery ─────────────────────────────────────────────────────────
  mediaGallery: (opts?: { source?: string; kind?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.source) qs.set("source", opts.source);
    if (opts?.kind) qs.set("kind", opts.kind);
    if (opts?.limit != null) qs.set("limit", String(opts.limit));
    if (opts?.offset != null) qs.set("offset", String(opts.offset));
    const q = qs.toString();
    return vantageFetch(`/v1/media/gallery${q ? `?${q}` : ""}`) as Promise<{
      items: MediaGalleryItem[];
      total: number;
      next_offset: number | null;
      scan_limit: number;
    }>;
  },

  // ── Channels ──────────────────────────────────────────────────────────────
  listChannels: () =>
    vantageFetch("/v1/channels") as Promise<{ channels: ChannelStatus[] }>,

  updateCadence: (slug: string, patch: Partial<ChannelStatus["cadence_config"]>) =>
    vantageFetch(`/v1/channels/${slug}/cadence`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }) as Promise<{ ok: boolean; cadence_config: ChannelStatus["cadence_config"] }>,

  toggleChannel: (slug: string, enabled: boolean) =>
    vantageFetch(`/v1/channels/${slug}/toggle`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }) as Promise<{ ok: boolean }>,

  startOAuth: (slug: string) =>
    vantageFetch(`/v1/channels/${slug}/auth/start`, { method: "POST" }) as Promise<{ authorize_url: string }>,

  // Credential-based connect (Bluesky app password)
  connectBluesky: (handle: string, appPassword: string) =>
    vantageFetch("/v1/channels/bluesky/connect", {
      method: "POST",
      body: JSON.stringify({ handle, app_password: appPassword }),
    }) as Promise<{ ok: boolean; did: string; handle: string }>,

  // Legacy alias
  startXOAuth: () =>
    vantageFetch("/v1/channels/x/auth/start", { method: "POST" }) as Promise<{ authorize_url: string }>,

  // ── Subscribers ───────────────────────────────────────────────────────────
  listSubscribers: () =>
    vantageFetch("/v1/subscribers") as Promise<{ subscribers: Subscriber[] }>,

  addSubscriber: (email: string, name?: string, tags?: string[]) =>
    vantageFetch("/v1/subscribers", {
      method: "POST",
      body: JSON.stringify({ email, ...(name ? { name } : {}), ...(tags ? { tags } : {}) }),
    }) as Promise<{ ok: boolean; subscriber: { id: string; email: string } }>,

  removeSubscriber: (id: string) =>
    vantageFetch(`/v1/subscribers/${id}`, { method: "DELETE" }) as Promise<{ ok: boolean }>,

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings: () =>
    vantageFetch("/v1/settings") as Promise<{ settings: VantageSettings }>,

  patchSettings: (patch: Partial<VantageSettings>) =>
    vantageFetch("/v1/settings", { method: "PATCH", body: JSON.stringify(patch) }) as Promise<{
      ok: boolean;
      settings: VantageSettings;
    }>,

  listLLMProviders: () =>
    vantageFetch("/v1/settings/llm-providers") as Promise<{
      providers: {
        name: string;
        displayName: string;
        available: boolean;
        defaultModel: string;
        candidateModels: string[];
      }[]
    }>,

  /** The provider:model chain each task actually resolves to, after all precedence. */
  getLLMResolution: () =>
    vantageFetch("/v1/settings/llm-resolution") as Promise<{
      generate: { provider: string; model: string }[];
      audit: { provider: string; model: string }[];
    }>,

  // ── Calendar ──────────────────────────────────────────────────────────────
  // 3B-2: pieces with scheduled_for in a date range
  getCalendar: (from: string, to: string, campaignId?: string) => {
    const q = new URLSearchParams({ from, to });
    if (campaignId) q.set("campaign_id", campaignId);
    return vantageFetch(`/v1/queue/calendar?${q}`) as Promise<{
      pieces: {
        id: string; status: string; channel_slug: string; format: string;
        content_payload: Record<string, unknown>; scheduled_for: string | null; published_at: string | null;
      }[]
    }>;
  },

  getProductProfile: () =>
    vantageFetch("/v1/settings/product-profile") as Promise<{
      profile: {
        default_product_id: string;
        product_base_url: string;
        default_brand_id: string;
        default_demoforge_template_id: string;
        default_brand_kit_id: string;
      }
    }>,

  patchProductProfile: (patch: Record<string, string>) =>
    vantageFetch("/v1/settings/product-profile", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }) as Promise<{ ok: boolean; profile: Record<string, string> }>,

  listShiftPacks: () =>
    vantageFetch("/v1/campaigns/meta/shift-packs") as Promise<{
      packs: {
        id: string; name: string; description: string;
        items: { id: string; title: string; outline: string; visual_type: string; demoforge_template_id?: string }[];
      }[]
    }>,

  addCampaignPack: (campaignId: string, pack_id: string, item_ids?: string[]) =>
    vantageFetch(`/v1/campaigns/${campaignId}/add-pack`, {
      method: "POST",
      body: JSON.stringify({ pack_id, item_ids }),
    }) as Promise<{ added: number; timeline: unknown[] }>,

  refillCampaignEvergreen: (campaignId: string) =>
    vantageFetch(`/v1/campaigns/${campaignId}/refill-evergreen`, { method: "POST" }) as Promise<{
      added: number; message?: string; timeline?: unknown[];
    }>,

  applyInsightToCampaign: (insightId: string, campaign_id: string) =>
    vantageFetch(`/v1/intelligence/insights/${insightId}/apply`, {
      method: "POST",
      body: JSON.stringify({ campaign_id }),
    }) as Promise<{ day: unknown }>,

  /**
   * Set a job's cover: either promote an extracted keyframe by index, or point
   * at a composed cover card already uploaded to vantage-media. Exactly one of
   * frame_index / thumbnail_url. Also mirrors the cover onto the linked piece.
   */
  setDemoForgeThumbnail: (
    jobId: string,
    body: { frame_index?: number; thumbnail_url?: string; content_piece_id?: string },
  ) =>
    vantageFetch(`/v1/demoforge/jobs/${jobId}/set-thumbnail`, {
      method: "POST",
      body: JSON.stringify(body),
    }) as Promise<{ thumbnail_url: string; frame_index: number }>,

  // ── Analytics ─────────────────────────────────────────────────────────────
  // 3B-3: engagement trend data
  getEngagementTrend: (params?: { channel?: string; vertical?: string; period?: string; group_by?: string }) => {
    const qs = new URLSearchParams()
    if (params?.channel)  qs.set('channel',  params.channel)
    if (params?.vertical) qs.set('vertical', params.vertical)
    if (params?.period)   qs.set('period',   params.period)
    if (params?.group_by) qs.set('group_by', params.group_by)
    return vantageFetch(`/v1/analytics/engagement${qs.toString() ? `?${qs}` : ''}`) as Promise<{
      period: string; group_by: string; data: { label: string; count: number }[]
    }>
  },
  getPostingHours: (channel?: string) =>
    vantageFetch(`/v1/analytics/posting-hours${channel ? `?channel=${channel}` : ''}`) as Promise<{
      channel: string; data: { hour: number; piece_count: number; total_engagement: number; avg_engagement: number }[]
    }>,

  // ── Generate (Phase 2 additions) ─────────────────────────────────────────
  generateWithImage: (channel: string, topic_id: string) =>
    vantageFetch(`/v1/generate/${channel}`, {
      method: "POST",
      body: JSON.stringify({ topic_id, generate_image: true }),
    }) as Promise<{ content_piece_id: string; format: string; status: string }>,

  generateVariants: (channel: string, topic_id: string, count: 2 | 3) =>
    vantageFetch(`/v1/generate/${channel}`, {
      method: "POST",
      body: JSON.stringify({ topic_id, variants: count }),
    }) as Promise<{ variant_group_id: string; pieces: { content_piece_id: string; format: string; status: string }[] }>,

  // ── BioLoop ───────────────────────────────────────────────────────────────
  runBioLoop: () =>
    vantageFetch("/v1/bioloop/run", { method: "POST" }) as Promise<{ ok: boolean; analyzed: number; updated: number }>,

  getBioLoopWeights: (channel?: string) =>
    vantageFetch(`/v1/bioloop/weights${channel ? `?channel=${channel}` : ""}`) as Promise<{
      weights: { channel_slug: string; pattern_key: string; weight: number; sample_size: number; last_updated: string }[]
    }>,

  // ── Music library ─────────────────────────────────────────────────────────
  listMusicTracks: (mood?: string, use_case?: string) => {
    const params = new URLSearchParams();
    if (mood)     params.set("mood", mood);
    if (use_case) params.set("use_case", use_case);
    const qs = params.toString();
    return vantageFetch(`/v1/music${qs ? `?${qs}` : ""}`) as Promise<{
      tracks: { id: string; title: string; artist: string | null; mood: string; use_case: string; duration_secs: number | null; bpm: number | null; storage_path: string; public_url: string }[]
    }>;
  },

  uploadMedia: (payload: { path: string; data_url: string; title: string }) =>
    vantageFetch('/v1/media/upload', {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<{ public_url: string; storage_path: string }>,

  deleteMediaAsset: (id: string) =>
    vantageFetch(`/v1/media/gallery/${encodeURIComponent(id)}`, { method: 'DELETE' }) as Promise<{ ok: boolean; removed_from_storage: boolean }>,
  uploadMusicTrack: (body: { title: string; data_url: string }) => vantageFetch('/v1/music/upload', { method: 'POST', body: JSON.stringify(body) }) as Promise<{ track: any }>,
  listMusicProjects: () => vantageFetch('/v1/music/projects') as Promise<{ projects: any[] }>,
  createMusicProject: (body: any) => vantageFetch('/v1/music/projects', { method: 'POST', body: JSON.stringify(body) }) as Promise<{ project: any }>,
  updateMusicProject: (id: string, body: any) => vantageFetch(`/v1/music/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) }) as Promise<{ project: any }>,
  deleteMusicProject: (id: string) => vantageFetch(`/v1/music/projects/${id}`, { method: 'DELETE' }) as Promise<{ ok: boolean }>,

  // ── Sound Effects Library (Phase 3D-SE) ─────────────────────────────────────
  listSoundEffects: (category?: string, use_case?: string) => {
    const params = new URLSearchParams();
    if (category)  params.set("category", category);
    if (use_case)  params.set("use_case", use_case);
    const qs = params.toString();
    return vantageFetch(`/v1/sound-effects${qs ? `?${qs}` : ""}`) as Promise<{
      effects: { id: string; title: string; category: string; duration_ms: number | null; storage_path: string; use_case: string; created_at: string }[]
    }>;
  },

  registerSoundEffect: (body: { title: string; category: string; duration_ms?: number; storage_path: string; use_case: string }) =>
    vantageFetch('/v1/sound-effects', { method: 'POST', body: JSON.stringify(body) }) as Promise<{ effect: { id: string; title: string } }>,

  deleteSoundEffect: (id: string) =>
    vantageFetch(`/v1/sound-effects/${id}`, { method: 'DELETE' }) as Promise<{ ok: boolean }>,

  // ── Email Templates (3C-6) ────────────────────────────────────────────────
  listEmailTemplates: () =>
    vantageFetch('/v1/email-templates') as Promise<{ templates: { id: string; name: string; description: string; updated_at: string }[] }>,

  getEmailTemplate: (id: string) =>
    vantageFetch(`/v1/email-templates/${id}`) as Promise<{ template: { id: string; name: string; description: string; blocks: unknown[] } }>,

  saveEmailTemplate: (body: { name: string; description?: string; blocks?: unknown[] }) =>
    vantageFetch('/v1/email-templates', { method: 'POST', body: JSON.stringify(body) }) as Promise<{ template: { id: string } }>,

  patchEmailTemplate: (id: string, body: { name?: string; description?: string; blocks?: unknown[] }) =>
    vantageFetch(`/v1/email-templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) }) as Promise<{ template: { id: string } }>,

  deleteEmailTemplate: (id: string) =>
    vantageFetch(`/v1/email-templates/${id}`, { method: 'DELETE' }) as Promise<{ ok: boolean }>,

  // ── Caption Studio (3C-2) ─────────────────────────────────────────────────
  generateCaptions: (params: { prompt: string; channel: string; count?: number; tone?: string }) =>
    vantageFetch('/v1/captions', {
      method: 'POST',
      body: JSON.stringify(params),
    }) as Promise<{ captions: string[] }>,

  // ── Brand Kits (Phase 1: DemoForge creative studio) ──────────────────────
  listBrandKits: () =>
    vantageFetch("/v1/brand-kits") as Promise<{
      kits: BrandKitRecord[]
    }>,

  createBrandKit: (body: {
    name: string;
    logo_url?: string;
    logo_storage_path?: string;
    primary_color?: string;
    secondary_color?: string;
    accent_color?: string;
    font_heading?: string;
    font_body?: string;
    data_url?: string;
  }) =>
    vantageFetch("/v1/brand-kits", { method: "POST", body: JSON.stringify(body) }) as Promise<{ ok: boolean; kit: BrandKitRecord }>,

  updateBrandKit: (id: string, body: {
    name?: string;
    logo_url?: string;
    logo_storage_path?: string;
    primary_color?: string;
    secondary_color?: string;
    accent_color?: string;
    font_heading?: string;
    font_body?: string;
  }) =>
    vantageFetch(`/v1/brand-kits/${id}`, { method: "PATCH", body: JSON.stringify(body) }) as Promise<{ ok: boolean; kit: BrandKitRecord }>,

  uploadBrandKitLogo: (id: string, data_url: string) =>
    vantageFetch(`/v1/brand-kits/${id}/logo`, {
      method: "POST",
      body: JSON.stringify({ data_url }),
    }) as Promise<{ ok: boolean; kit: BrandKitRecord }>,

  deleteBrandKit: (id: string) =>
    vantageFetch(`/v1/brand-kits/${id}`, { method: "DELETE" }) as Promise<{ ok: boolean }>,

  // ── Intro / Outro Clips (Phase 4: DemoForge sequences) ───────────────────
  listIntroOutroClips: (params?: { format?: string; type?: string }) => {
    const qs = new URLSearchParams();
    if (params?.format) qs.set("format", params.format);
    if (params?.type)   qs.set("type",   params.type);
    const q = qs.toString();
    return vantageFetch(`/v1/intro-outro-clips${q ? `?${q}` : ""}`) as Promise<{
      clips: { id: string; type: string; name: string; duration_ms: number; storage_path: string; target_format: string; brand_kit_id: string | null; preview_url: string | null }[]
    }>;
  },

  // ── DemoForge ─────────────────────────────────────────────────────────────
  createDemoForgeJob: (body: {
    content_piece_id?: string;
    target_format: "tiktok" | "linkedin" | "instagram";
    url: string;
    script: { action: string; selector?: string; text?: string; ms?: number; narration: string; soundEffect?: { effectId: string; delayMs: number; volumePercent: number } }[];
    music_track_id?: string;
    narration_volume?: number;
    music_volume?: number;
    master_volume?: number;
    // Phase 1: video overlays
    overlays?: Array<{
      type: "text" | "image";
      content?: string;
      font_size?: number;
      font_color?: string;
      font_family?: "mono" | "sans" | "display";
      box_color?: string;
      brand_kit_id?: string;
      width?: number;
      x: "left" | "center" | "right" | number;
      y: "top" | "center" | "bottom" | number;
      x_offset?: number;
      y_offset?: number;
      start_sec?: number;
      end_sec?: number;
    }>;
    brand_kit_id?: string;
    // Phase 2: auto-captions
    caption_config?: {
      enabled: boolean;
      font_size?: number;
      font_family?: "mono" | "sans";
      primary_color?: string;
      outline_color?: string;
      background?: boolean;
      position?: "top" | "center" | "bottom";
      word_highlight?: boolean;
      highlight_color?: string;
      max_words_per_line?: number;
    };
    // Phase 3: color grading
    color_grade?: {
      preset?: "clean" | "warm" | "cinematic" | "vibrant" | "muted" | "cool" | "dark";
      custom?: {
        brightness?: number;
        contrast?: number;
        saturation?: number;
        red_gain?: number;
        green_gain?: number;
        blue_gain?: number;
        gamma?: number;
      };
    };
    // Phase 4: intro/outro
    intro_clip_id?: string;
    outro_clip_id?: string;
    // Phase 5: timeline
    timeline_config?: {
      target_duration_sec?: number;
      trim_start_sec?: number;
      trim_end_sec?: number;
      global_speed_multiplier?: number;
      per_step_speed?: boolean;
    };
  }) =>
    vantageFetch("/v1/demoforge/jobs", { method: "POST", body: JSON.stringify(body) }) as Promise<{ job_id: string; status: string }>,

  getDemoForgeJob: (jobId: string) =>
    vantageFetch(`/v1/demoforge/jobs/${jobId}`) as Promise<{
      id: string; status: string; target_format: string; output_url: string | null;
      thumbnail_url?: string | null; extracted_frames?: Array<{ url?: string; mode?: string; timestamp_sec?: number }> | null;
      content_piece_id?: string | null; error_message: string | null; updated_at: string
    }>,

  listDemoForgeJobs: () =>
    vantageFetch("/v1/demoforge/jobs") as Promise<{
      jobs: {
        id: string; content_piece_id: string | null; status: string; target_format: string;
        output_url: string | null; thumbnail_url?: string | null;
        extracted_frames?: Array<{ url?: string; mode?: string; timestamp_sec?: number }> | null;
        error_message: string | null; created_at: string; updated_at?: string
      }[]
    }>,

  listDemoForgeTemplates: () =>
    vantageFetch("/v1/demoforge/templates") as Promise<{
      templates: { id: string; name: string; format: string; default_base_url: string | null; step_count: number }[];
      defaults_by_channel: Record<string, string>;
    }>,

  createDemoForgeJobFromTemplate: (body: {
    content_piece_id: string;
    template_id?: string;
    channel?: string;
    base_url?: string;
  }) =>
    vantageFetch("/v1/demoforge/jobs/from-template", {
      method: "POST",
      body: JSON.stringify(body),
    }) as Promise<{ job_id: string; status: string; template_id: string }>,

  // ── Campaigns ─────────────────────────────────────────────────────────────
  listCampaigns: () =>
    vantageFetch("/v1/campaigns") as Promise<{ campaigns: any[] }>,

  getCampaign: (id: string) =>
    vantageFetch(`/v1/campaigns/${id}`) as Promise<any>,
  listCampaignAssets: (id: string) => vantageFetch(`/v1/campaigns/${id}/assets`) as Promise<{ assets: any[] }>,
  addCampaignAsset: (id: string, body: { title: string; asset_type: 'visual' | 'gif' | 'video' | 'music_project'; source_url?: string | null; source_ref?: string | null; metadata?: Record<string, unknown> }) =>
    vantageFetch(`/v1/campaigns/${id}/assets`, { method: 'POST', body: JSON.stringify(body) }) as Promise<{ asset: any }>,

  createCampaign: (body: any) =>
    vantageFetch("/v1/campaigns", { method: "POST", body: JSON.stringify(body) }) as Promise<any>,

  updateCampaign: (id: string, body: any) =>
    vantageFetch(`/v1/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(body) }) as Promise<any>,

  deleteCampaign: (id: string) =>
    vantageFetch(`/v1/campaigns/${id}`, { method: "DELETE" }) as Promise<{ success: boolean }>,

  getCampaignTimeline: (campaignId: string) =>
    vantageFetch(`/v1/campaigns/${campaignId}/timeline`) as Promise<{ timeline: any[] }>,

  generateCampaignTimeline: (campaignId: string) =>
    vantageFetch(`/v1/campaigns/${campaignId}/timeline/generate`, { method: "POST" }) as Promise<{ timeline: any[] }>,

  addCampaignTimelineDays: (campaignId: string, days: any | any[]) =>
    vantageFetch(`/v1/campaigns/${campaignId}/timeline`, { method: "POST", body: JSON.stringify(days) }) as Promise<{ timeline_entries: any[] }>,

  updateCampaignTimelineDay: (campaignId: string, dayNumber: number, body: any) =>
    vantageFetch(`/v1/campaigns/${campaignId}/timeline/${dayNumber}`, { method: "PATCH", body: JSON.stringify(body) }) as Promise<any>,

  deleteCampaignTimelineDay: (campaignId: string, dayNumber: number) =>
    vantageFetch(`/v1/campaigns/${campaignId}/timeline/${dayNumber}`, { method: "DELETE" }) as Promise<{ success: boolean }>,

  launchCampaign: (campaignId: string, dayNumbers?: number[], retryRejected = false) =>
    vantageFetch(`/v1/campaigns/${campaignId}/launch`, {
      method: "POST",
      body: JSON.stringify({
        ...(dayNumbers ? { day_numbers: dayNumbers } : {}),
        ...(retryRejected ? { retry_rejected: true } : {}),
      }),
    }) as Promise<{
      launched: number; skipped: number; failed: number;
      pieces: {
        content_piece_id: string; channel: string; day_number: number;
        media_status: string; demoforge_job_id?: string;
      }[];
      failures: { day_number: number; channel?: string; error: string }[];
    }>,

  getCampaignKPI: (campaignId: string) =>
    vantageFetch(`/v1/campaigns/${campaignId}/kpi`) as Promise<{ kpi_tracking: any[] }>,

  // ── Strategic Intelligence ────────────────────────────────────────────────
  listCompetitivePosts: (limit = 50, platform?: string) => {
    const params = new URLSearchParams();
    params.append('limit', String(limit));
    if (platform) params.append('platform', platform);
    return vantageFetch(`/v1/intelligence/posts?${params}`) as Promise<{ posts: any[] }>;
  },

  addCompetitivePost: (body: any) =>
    vantageFetch("/v1/intelligence/posts", { method: "POST", body: JSON.stringify(body) }) as Promise<any>,

  listTrends: (limit = 20, status?: string) => {
    const params = new URLSearchParams();
    params.append('limit', String(limit));
    if (status) params.append('status', status);
    return vantageFetch(`/v1/intelligence/trends?${params}`) as Promise<{ trends: any[] }>;
  },

  detectTrends: (daysWindow = 7) =>
    vantageFetch(`/v1/intelligence/trends/detect?days=${daysWindow}`, { method: "POST" }) as Promise<{ trends: any[] }>,

  listInsights: (campaignId?: string, type?: string) => {
    const params = new URLSearchParams();
    if (campaignId) params.append('campaign_id', campaignId);
    if (type) params.append('type', type);
    return vantageFetch(`/v1/intelligence/insights?${params}`) as Promise<{ insights: any[] }>;
  },

  listBenchmarks: (limit = 10) =>
    vantageFetch(`/v1/intelligence/benchmarks?limit=${limit}`) as Promise<{ benchmarks: any[] }>,

  listMonitoringSources: (limit = 50, active?: boolean) => {
    const params = new URLSearchParams();
    params.append('limit', String(limit));
    if (active !== undefined) params.append('active', String(active));
    return vantageFetch(`/v1/intelligence/sources?${params}`) as Promise<{ sources: any[] }>;
  },

  addMonitoringSource: (body: any) =>
    vantageFetch("/v1/intelligence/sources", { method: "POST", body: JSON.stringify(body) }) as Promise<any>,

  // ── Audience Model ────────────────────────────────────────────────────────
  listSegments: (limit = 50, type?: string) => {
    const params = new URLSearchParams();
    params.append('limit', String(limit));
    if (type) params.append('type', type);
    return vantageFetch(`/v1/audience/segments?${params}`) as Promise<{ segments: any[] }>;
  },

  getSegment: (id: string) =>
    vantageFetch(`/v1/audience/segments/${id}`) as Promise<any>,

  createSegment: (body: any) =>
    vantageFetch("/v1/audience/segments", { method: "POST", body: JSON.stringify(body) }) as Promise<any>,

  updateSegment: (id: string, body: any) =>
    vantageFetch(`/v1/audience/segments/${id}`, { method: "PATCH", body: JSON.stringify(body) }) as Promise<any>,

  deleteSegment: (id: string) =>
    vantageFetch(`/v1/audience/segments/${id}`, { method: "DELETE" }) as Promise<{ success: boolean }>,

  getSegmentMembers: (segmentId: string, limit = 50) =>
    vantageFetch(`/v1/audience/segments/${segmentId}/members?limit=${limit}`) as Promise<{ members: any[] }>,

  addSegmentMember: (segmentId: string, body: any) =>
    vantageFetch(`/v1/audience/segments/${segmentId}/members`, { method: "POST", body: JSON.stringify(body) }) as Promise<any>,

  getSegmentAnalytics: (segmentId: string, limit = 30) =>
    vantageFetch(`/v1/audience/segments/${segmentId}/analytics?limit=${limit}`) as Promise<{ analytics: any[] }>,

  getSegmentPreferences: (segmentId: string) =>
    vantageFetch(`/v1/audience/segments/${segmentId}/preferences`) as Promise<{ preferences: any }>,

  getGA4Config: () =>
    vantageFetch("/v1/audience/ga4/config") as Promise<{ config: any }>,

  setupGA4: (body: any) =>
    vantageFetch("/v1/audience/ga4/config", { method: "POST", body: JSON.stringify(body) }) as Promise<any>,

  syncGA4: () =>
    vantageFetch("/v1/audience/ga4/sync", { method: "POST" }) as Promise<{ status: string; syncedAt: string }>,

  // ── Legal pages (Terms & Conditions / Privacy Policy) ───────────────────────
  getLegalPage: (slug: "terms" | "privacy") =>
    vantageFetch(`/v1/legal/${slug}`) as Promise<{
      page: { slug: string; title: string; content: string; updated_at: string };
    }>,

  updateLegalPage: (slug: "terms" | "privacy", patch: { title?: string; content?: string }) =>
    vantageFetch(`/v1/legal/${slug}`, { method: "PATCH", body: JSON.stringify(patch) }) as Promise<{
      page: { slug: string; title: string; content: string; updated_at: string };
    }>,
};
