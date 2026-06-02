import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getSupabaseAdmin } from '../lib/supabase.js';

export const workspaceRoutes = new Hono();

/**
 * GET /v1/workspaces/me
 * Returns the calling user's workspace. Creates one automatically on first access.
 */
workspaceRoutes.get('/me', async (c) => {
  const user = c.get('user');
  const sb = getSupabaseAdmin();

  // Look up existing workspace for this user
  const { data: existing, error: selectError } = await sb
    .from('workspaces')
    .select('*')
    .eq('owner_id', user.id)
    .single();

  if (selectError && selectError.code !== 'PGRST116') {
    // PGRST116 = "no rows returned" — anything else is a real error
    throw new HTTPException(500, { message: selectError.message });
  }

  if (existing) return c.json(existing);

  // No workspace yet — create one automatically
  const slug = `workspace-${user.id.slice(0, 8)}`;
  const { data: created, error: insertError } = await sb
    .from('workspaces')
    .insert({
      owner_id: user.id,
      name: 'My Workspace',
      slug,
    })
    .select()
    .single();

  if (insertError) {
    throw new HTTPException(500, { message: insertError.message });
  }

  return c.json(created, 201);
});
