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

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

/**
 * The caller's role in a workspace, or null if they are not a member.
 * This is the authorization primitive the guard and member routes build on.
 */
export async function getMembershipRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as WorkspaceRole | undefined) ?? null;
}

/**
 * Resolve (and lazily provision) a workspace for a user. Returns the workspace
 * id of any workspace they belong to (preferring one they own), creating a
 * default workspace + owner membership + channel rows on first access. Mirrors
 * GET /v1/workspaces/me so the guard can scope requests that omit the header.
 */
export async function resolveOrCreateWorkspace(userId: string): Promise<string> {
  const sb = getSupabaseAdmin();

  // Any existing membership (owner first) satisfies the request.
  const { data: membership } = await sb
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId)
    .order("role", { ascending: true }) // 'admin','editor','owner','viewer' — see below
    .limit(50);
  if (membership?.length) {
    const owned = membership.find((m) => m.role === "owner");
    return (owned ?? membership[0]).workspace_id as string;
  }

  const slug = `workspace-${userId.slice(0, 8)}`;
  const { data: created, error } = await sb
    .from("workspaces")
    .insert({ owner_id: userId, name: "My Workspace", slug })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Failed to create workspace");

  await sb.from("workspace_members").insert({ workspace_id: created.id, user_id: userId, role: "owner" });
  await seedDefaultChannels(sb, created.id as string);
  return created.id as string;
}
