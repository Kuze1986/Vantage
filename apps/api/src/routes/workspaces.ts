import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabase.js';
import { resolveOrCreateWorkspace, getMembershipRole } from '../lib/workspace.js';

export const workspaceRoutes = new Hono();

/**
 * GET /v1/workspaces/me
 * Returns the calling user's workspace, lazily provisioning one (with an owner
 * membership + default channels) on first access.
 */
workspaceRoutes.get('/me', async (c) => {
  c.header('Cache-Control', 'no-store');
  const user = c.get('user');
  const sb = getSupabaseAdmin();

  const workspaceId = await resolveOrCreateWorkspace(user.id);
  const { data, error } = await sb.from('workspaces').select('*').eq('id', workspaceId).single();
  if (error || !data) throw new HTTPException(500, { message: error?.message ?? 'Workspace load failed' });
  return c.json(data);
});

// Only owners/admins may change membership.
const MANAGE_ROLES = new Set(['owner', 'admin']);

/** GET /v1/workspaces/:id/members — list members (any member may read). */
workspaceRoutes.get('/:id/members', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  if (!(await getMembershipRole(id, user.id))) {
    throw new HTTPException(403, { message: 'You do not have access to this workspace' });
  }
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from('workspace_members')
    .select('user_id, role, created_at')
    .eq('workspace_id', id)
    .order('created_at', { ascending: true });
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ members: data ?? [] });
});

const addMemberSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(['admin', 'editor', 'viewer']).default('editor'),
});

/** POST /v1/workspaces/:id/members — add/update a member (owner/admin only). */
workspaceRoutes.post('/:id/members', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const callerRole = await getMembershipRole(id, user.id);
  if (!callerRole || !MANAGE_ROLES.has(callerRole)) {
    throw new HTTPException(403, { message: 'Only workspace owners/admins can manage members' });
  }
  const parsed = addMemberSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from('workspace_members')
    .upsert({ workspace_id: id, ...parsed.data }, { onConflict: 'workspace_id,user_id' });
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ ok: true, user_id: parsed.data.user_id, role: parsed.data.role }, 201);
});

/** DELETE /v1/workspaces/:id/members/:userId — remove a member (owner/admin only). */
workspaceRoutes.delete('/:id/members/:userId', async (c) => {
  const id = c.req.param('id');
  const targetUser = c.req.param('userId');
  const user = c.get('user');
  const callerRole = await getMembershipRole(id, user.id);
  if (!callerRole || !MANAGE_ROLES.has(callerRole)) {
    throw new HTTPException(403, { message: 'Only workspace owners/admins can manage members' });
  }
  const sb = getSupabaseAdmin();

  // Never remove the last owner — it would orphan the workspace.
  const targetRole = await getMembershipRole(id, targetUser);
  if (targetRole === 'owner') {
    const { count } = await sb
      .from('workspace_members')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', id)
      .eq('role', 'owner');
    if ((count ?? 0) <= 1) {
      throw new HTTPException(400, { message: 'Cannot remove the last owner of a workspace' });
    }
  }

  const { error } = await sb
    .from('workspace_members')
    .delete()
    .eq('workspace_id', id)
    .eq('user_id', targetUser);
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ ok: true });
});
