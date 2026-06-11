import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./supabase.js";

/**
 * Default channel rows seeded for every new workspace. Mirrors the original
 * global seed in 20260601000000_vantage_schema.sql — but now one set per tenant,
 * because channels are keyed (workspace_id, slug).
 */
const DEFAULT_CHANNELS = [
  { slug: "x",         display_name: "X (Twitter)", auth_method: "oauth",   cadence_config: { posts_per_day: 3, posting_hours: [9, 13, 18] } },
  { slug: "linkedin",  display_name: "LinkedIn",    auth_method: "oauth",   cadence_config: { posts_per_day: 1, posting_hours: [9] } },
  { slug: "reddit",    display_name: "Reddit",      auth_method: "oauth",   cadence_config: { posts_per_day: 2, posting_hours: [10, 17], subreddits: [] } },
  { slug: "email",     display_name: "Email",       auth_method: "api_key", cadence_config: { newsletter_day: "tuesday" } },
  { slug: "tiktok",    display_name: "TikTok",      auth_method: "manual",  cadence_config: {} },
  { slug: "instagram", display_name: "Instagram",   auth_method: "manual",  cadence_config: {} },
  { slug: "facebook",  display_name: "Facebook",    auth_method: "manual",  cadence_config: {} },
] as const;

/**
 * Idempotently seed the seven default channel rows for a workspace.
 * Uses upsert on (workspace_id, slug) so re-running is harmless.
 */
export async function seedDefaultChannels(sb: SupabaseClient, workspaceId: string): Promise<void> {
  const rows = DEFAULT_CHANNELS.map((ch) => ({
    workspace_id: workspaceId,
    slug: ch.slug,
    display_name: ch.display_name,
    auth_method: ch.auth_method,
    enabled: false,
    cadence_config: ch.cadence_config,
  }));
  await sb.from("channels").upsert(rows, { onConflict: "workspace_id,slug", ignoreDuplicates: true });
}

/** List every workspace id. Used by the scheduler to run its ticks per tenant. */
export async function listAllWorkspaceIds(): Promise<string[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("workspaces").select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((w) => w.id as string);
}

/**
 * Resolve (and lazily provision) the workspace owned by a user. Returns the
 * workspace id, creating a default workspace + channel rows on first access.
 * This mirrors GET /v1/workspaces/me so the guard can scope requests that omit
 * the x-workspace-id header.
 */
export async function resolveOrCreateWorkspace(userId: string): Promise<string> {
  const sb = getSupabaseAdmin();

  const { data: existing } = await sb
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id as string;

  const slug = `workspace-${userId.slice(0, 8)}`;
  const { data: created, error } = await sb
    .from("workspaces")
    .insert({ owner_id: userId, name: "My Workspace", slug })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Failed to create workspace");

  await seedDefaultChannels(sb, created.id as string);
  return created.id as string;
}
