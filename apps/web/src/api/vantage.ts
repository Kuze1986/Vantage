import { supabase } from "../lib/supabase";

const base = ((import.meta.env.VITE_VANTAGE_API_URL as string | undefined) ?? "").replace(/\/$/, "");

async function vantageFetch(path: string, init: RequestInit = {}) {
  if (!base) throw new Error("VITE_VANTAGE_API_URL is not set — add it to apps/web/.env.local");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
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

export type DashboardOverview = {
  activityLast24h: { id: string; source: string; summary: string; occurred_at: string; event_type: string }[];
  queueDepth: Record<string, number>;
  publishedToday: Record<string, number>;
  channelStatus: { slug: string; enabled: boolean; connected: boolean; posts_per_day: number; published_today: number; published_7d: number; auditing: number; queued: number }[];
  channelBreakdown: Record<string, ChannelBreakdownEntry>;
  topPieces: TopPiece[];
  recentEngagement: unknown[];
};

export type Subscriber = {
  id: string;
  email: string;
  name: string | null;
  tags: string[];
  subscribed_at: string;
  unsubscribed_at: string | null;
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
  publish: (channel: string, content_piece_id: string, external_post_url?: string) =>
    vantageFetch(`/v1/publish/${channel}`, {
      method: "POST",
      body: JSON.stringify({ content_piece_id, external_post_url }),
    }) as Promise<{ ok: boolean; external_post_id: string; manual?: boolean }>,

  // ── Schedule ──────────────────────────────────────────────────────────────
  schedule: (content_piece_id: string, scheduled_for?: string) =>
    vantageFetch("/v1/schedule", {
      method: "POST",
      body: JSON.stringify({ content_piece_id, scheduled_for }),
    }),

  // ── Queue ─────────────────────────────────────────────────────────────────
  getQueue: (limit = 100) =>
    vantageFetch(`/v1/queue?limit=${limit}`) as Promise<{ pieces: {
      id: string; status: string; channel_slug: string; format: string;
      content_payload: Record<string, unknown>; audit_notes: string | null;
      audit_iterations: number; created_at: string;
    }[] }>,

  // ── Dashboard ─────────────────────────────────────────────────────────────
  dashboardOverview: () =>
    vantageFetch("/v1/dashboard/overview") as Promise<DashboardOverview>,

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
    vantageFetch("/v1/settings") as Promise<{
      settings: {
        dedup_days: number;
        scripta_enabled: boolean;
        bioloop_enabled: boolean;
        active_verticals: string[];
      }
    }>,

  patchSettings: (patch: {
    dedup_days?:       number;
    scripta_enabled?:  boolean;
    bioloop_enabled?:  boolean;
    active_verticals?: string[];
  }) =>
    vantageFetch("/v1/settings", { method: "PATCH", body: JSON.stringify(patch) }) as Promise<{
      ok: boolean;
      settings: {
        dedup_days: number;
        scripta_enabled: boolean;
        bioloop_enabled: boolean;
        active_verticals: string[];
      }
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
      tracks: { id: string; title: string; artist: string | null; mood: string; use_case: string; duration_secs: number | null; bpm: number | null }[]
    }>;
  },

  // ── DemoForge ─────────────────────────────────────────────────────────────
  createDemoForgeJob: (body: {
    content_piece_id?: string;
    target_format: "tiktok" | "linkedin" | "instagram";
    url: string;
    script: { action: string; selector?: string; text?: string; ms?: number; narration: string }[];
    music_track_id?: string;
  }) =>
    vantageFetch("/v1/demoforge/jobs", { method: "POST", body: JSON.stringify(body) }) as Promise<{ job_id: string; status: string }>,

  getDemoForgeJob: (jobId: string) =>
    vantageFetch(`/v1/demoforge/jobs/${jobId}`) as Promise<{
      id: string; status: string; target_format: string; output_url: string | null; error_message: string | null; updated_at: string
    }>,

  listDemoForgeJobs: () =>
    vantageFetch("/v1/demoforge/jobs") as Promise<{
      jobs: { id: string; content_piece_id: string | null; status: string; target_format: string; output_url: string | null; error_message: string | null; created_at: string }[]
    }>,
};
