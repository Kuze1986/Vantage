import { getSupabaseAdmin } from "./supabase.js";

export type LogActivityInput = {
  source: string;
  source_type: "agent" | "system" | "adapter";
  event_type: string;
  summary: string;
  payload?: Record<string, unknown> | null;
  drill_uri?: string | null;
};

export async function logActivity(input: LogActivityInput): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("activity_events").insert({
    source: input.source,
    source_type: input.source_type,
    event_type: input.event_type,
    summary: input.summary,
    payload: input.payload ?? null,
    drill_uri: input.drill_uri ?? null,
  });
  if (error) {
    console.error("activity_events insert failed", error);
    throw new Error(`activity_events insert failed: ${error.message}`);
  }
}
