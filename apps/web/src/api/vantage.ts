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

export type DashboardOverview = {
  activityLast24h: { id: string; source: string; summary: string; occurred_at: string; event_type: string }[];
  queueDepth: Record<string, number>;
  publishedToday: Record<string, number>;
  channelStatus: { slug: string; enabled: boolean; connected: boolean; posts_per_day: number }[];
  recentEngagement: unknown[];
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
};
