import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function makeClient(schema: string): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  // Cast needed: createClient with a dynamic schema string infers SchemaName=string,
  // which is incompatible with the default SupabaseClient<any,"public","public"> signature.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema },
  }) as unknown as SupabaseClient;
}

// Singletons — one client per schema, created once on first use.
// Never call .schema() per-query: supabase-js v2 creates a full new client
// (including a new RealtimeClient + WebSocket) on every .schema() call.
let publicAdmin: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

/**
 * Service-role admin client, bound to the `public` schema.
 *
 * All app tables physically live in the `vantage` schema, but PostgREST only
 * serves schemas on its exposed list (here: just `public`) — the service_role
 * key bypasses RLS, NOT the exposed-schema restriction. So the server reaches
 * vantage tables through auto-updatable `public.<table>` views that proxy them.
 *
 * Every vantage table the server touches MUST have such a view WITH grants to
 * service_role. The `20260630000000_expose_vantage_views.sql` migration creates
 * them for all current tables and installs an event trigger so future tables get
 * a view automatically — see that file before adding tables.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!publicAdmin) publicAdmin = makeClient("public");
  return publicAdmin;
}

/** Use for cross-schema reads (shift, scripta, etc.) — creates a fresh client. */
export function getSupabaseForSchema(schema: string): SupabaseClient {
  return makeClient(schema);
}

export function getSupabaseAnon(): SupabaseClient {
  if (anonClient) return anonClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  anonClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return anonClient;
}
