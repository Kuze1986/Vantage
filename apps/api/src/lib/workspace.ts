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
  { slug: "threads",   display_name: "Threads",     auth_method: "oauth",   cadence_config: { posts_per_day: 2, posting_hours: [9, 17] } },
  { slug: "bluesky",   display_name: "Bluesky",     auth_method: "api_key", cadence_config: { posts_per_day: 3, posting_hours: [9, 13, 18] } },
  { slug: "email",     display_name: "Email",       auth_method: "api_key", cadence_config: { newsletter_day: "tuesday" } },
  { slug: "tiktok",    display_name: "TikTok",      auth_method: "oauth",   cadence_config: {} },
  { slug: "instagram", display_name: "Instagram",   auth_method: "oauth",   cadence_config: {} },
  { slug: "facebook",  display_name: "Facebook",    auth_method: "oauth",   cadence_config: {} },
] as const;

/**
 * Idempotently seed the default channel rows for a workspace.
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

export type WorkspaceSummary = { id: string; name: string; slug: string; role: WorkspaceRole };

/**
 * Every workspace a user belongs to, with their role in each.
 *
 * Two queries rather than a PostgREST embed: `workspaces` is a view over
 * vantage.workspaces, and views carry no foreign keys for PostgREST to infer a
 * relationship from, so `select('workspaces(...)')` would not resolve.
 */
export async function listWorkspacesForUser(userId: string): Promise<WorkspaceSummary[]> {
  const sb = getSupabaseAdmin();
  const { data: memberships, error } = await sb
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  if (!memberships?.length) return [];

  const roleById = new Map(memberships.map((m) => [m.workspace_id as string, m.role as WorkspaceRole]));
  const { data: rows, error: wsErr } = await sb
    .from("workspaces")
    .select("id, name, slug")
    .in("id", [...roleById.keys()])
    .order("name", { ascending: true });
  if (wsErr) throw new Error(wsErr.message);

  return (rows ?? []).map((w) => ({
    id: w.id as string,
    name: w.name as string,
    slug: w.slug as string,
    role: roleById.get(w.id as string)!,
  }));
}

/** URL-safe stem for a workspace slug. Empty for names with no alphanumerics. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * Create a workspace owned by `userId`, with an owner membership and the
 * default channel rows.
 *
 * `workspaces.slug` is globally UNIQUE, and the lazy path in
 * resolveOrCreateWorkspace derives its slug deterministically from the user id
 * — so it can only ever produce one workspace per user. Named workspaces need
 * their own strategy: try the slugified name, then fall back to short random
 * suffixes. Retrying on 23505 rather than pre-checking avoids the race between
 * a SELECT and the INSERT.
 */
export async function createWorkspace(userId: string, name: string): Promise<WorkspaceSummary> {
  const sb = getSupabaseAdmin();
  const stem = slugify(name) || `workspace-${userId.slice(0, 8)}`;

  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = attempt === 0 ? stem : `${stem}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await sb
      .from("workspaces")
      .insert({ owner_id: userId, name, slug })
      .select("id, name, slug")
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) continue; // slug taken — try another
      throw new Error(error.message);
    }
    if (!data) throw new Error("Failed to create workspace");

    const workspaceId = data.id as string;
    const { error: memberErr } = await sb
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: userId, role: "owner" });
    if (memberErr) throw new Error(memberErr.message);
    await seedDefaultChannels(sb, workspaceId);

    return { id: workspaceId, name: data.name as string, slug: data.slug as string, role: "owner" };
  }

  throw new Error(`Could not allocate a unique slug for "${name}" — try a different name`);
}

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
    const workspaceId = (membership.find((m) => m.role === "owner") ?? membership[0]).workspace_id as string;
    // Self-heal: DEFAULT_CHANNELS has grown over time (threads/bluesky, then
    // tiktok/instagram/facebook were all added after some workspaces already existed),
    // and each addition required a one-off backfill migration to reach pre-existing
    // workspaces — one already missed a workspace in production (content_pieces_channel_fk
    // violations on threads/bluesky). Upsert with ignoreDuplicates is cheap and a no-op
    // once channels are in sync, so just keep every workspace current on every resolve
    // instead of relying on a migration to remember every existing workspace.
    await seedDefaultChannels(sb, workspaceId);
    return workspaceId;
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
