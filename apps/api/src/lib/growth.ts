import { getSupabaseAdmin } from "./supabase.js";
import { logActivity } from "./activity.js";

/**
 * NEXUS Growth OS — Loop A (Acquisition) ledger writer.
 *
 * Appends one row to growth.events via the public.growth_record_event wrapper
 * (the `growth` schema is RLS-locked and not exposed; only this SECURITY DEFINER
 * function is granted to service_role). See the Nexus Console migration
 * supabase/migrations/20260606000000_growth_os.sql.
 *
 * FAIL-SOFT: growth instrumentation must never break publishing or webhook
 * handling. Errors are logged and swallowed.
 */
export type GrowthLoop = "acquisition" | "conversion" | "expansion" | "intelligence";

export interface GrowthEventInput {
  loop: GrowthLoop;
  kind: string; // impression|reply|signup|cross_sell|signal|order ...
  product?: string | null;
  channel?: string | null;
  value?: number | null;
  meta?: Record<string, unknown>;
  identityId?: string | null;
}

export async function recordGrowthEvent(e: GrowthEventInput): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.rpc("growth_record_event", {
      p_loop: e.loop,
      p_kind: e.kind,
      p_product: e.product ?? "vantage",
      p_channel: e.channel ?? null,
      p_value: e.value ?? null,
      p_meta: e.meta ?? {},
      p_identity_id: e.identityId ?? null,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logActivity({
      source: "growth-os",
      source_type: "system",
      event_type: "growth_event_failed",
      summary: msg.slice(0, 500),
      payload: { loop: e.loop, kind: e.kind, channel: e.channel ?? null },
    }).catch(() => {});
  }
}

/**
 * Map a raw platform engagement event_type to a growth `kind`.
 * The Acquisition metric cares about replies/clicks; everything else is an
 * impression-class signal.
 */
export function engagementKind(eventType: string): "reply" | "impression" {
  const t = eventType.toLowerCase();
  if (t.includes("reply") || t.includes("quote") || t.includes("mention") || t.includes("comment")) {
    return "reply";
  }
  return "impression";
}
