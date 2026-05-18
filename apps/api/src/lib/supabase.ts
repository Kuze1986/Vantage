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
let vantageAdmin: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!vantageAdmin) vantageAdmin = makeClient("vantage");
  return vantageAdmin;
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
