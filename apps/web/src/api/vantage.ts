import { supabase } from "../lib/supabase";

const base = import.meta.env.VITE_VANTAGE_API_URL as string;

async function vantageFetch(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${base.replace(/\/$/, "")}${path}`, { ...init, headers });
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

export const vantageApi = {
  getTopics: (limit = 20) => vantageFetch(`/v1/source/topics?limit=${limit}`) as Promise<{ topics: unknown[] }>,
  refreshSource: () => vantageFetch("/v1/source/refresh", { method: "POST" }),
  generate: (channel: string, topic_id: string) =>
    vantageFetch(`/v1/generate/${channel}`, { method: "POST", body: JSON.stringify({ topic_id }) }),
  audit: (content_piece_id: string) =>
    vantageFetch("/v1/audit", { method: "POST", body: JSON.stringify({ content_piece_id }) }),
  publish: (channel: string, content_piece_id: string) =>
    vantageFetch(`/v1/publish/${channel}`, { method: "POST", body: JSON.stringify({ content_piece_id }) }),
  schedule: (content_piece_id: string, scheduled_for?: string) =>
    vantageFetch("/v1/schedule", {
      method: "POST",
      body: JSON.stringify({ content_piece_id, scheduled_for }),
    }),
  dashboardOverview: () => vantageFetch("/v1/dashboard/overview"),
  startXOAuth: () =>
    vantageFetch("/v1/channels/x/auth/start", { method: "POST" }) as Promise<{ authorize_url: string }>,
};
