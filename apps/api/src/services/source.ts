import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";

const VERTICAL = "pharmacy-tech";

type ShiftQuestionRow = Record<string, unknown>;

function rowTopicText(row: ShiftQuestionRow): string {
  const candidates = ["question_text", "body", "text", "title", "question", "prompt"];
  for (const k of candidates) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return JSON.stringify(row).slice(0, 2000);
}

function rowId(row: ShiftQuestionRow): string | null {
  const id = row.id ?? row.question_id;
  if (typeof id === "string" || typeof id === "number") return String(id);
  return null;
}

function rowVertical(row: ShiftQuestionRow): string | null {
  const v =
    row.vertical ??
    row.vertical_slug ??
    row.verticalSlug ??
    row.vertical_id ??
    row.verticalId;
  if (typeof v === "string") return v;
  return null;
}

/** Pull topics from shift.questions into vantage.topics. Adjust column filters to match your Shift schema. */
export async function refreshTopicsFromShift(): Promise<{ inserted: number }> {
  const sb = getSupabaseAdmin();
  const { data: rows, error } = await sb.schema("shift").from("questions").select("*").limit(200);

  if (error) {
    await logActivity({
      source: "source",
      source_type: "system",
      event_type: "shift_pull_error",
      summary: error.message,
      payload: { code: error.code, details: error.details, hint: error.hint },
    });
    throw new Error(`shift.questions read failed: ${error.message}`);
  }

  const list = (rows ?? []) as ShiftQuestionRow[];
  const filtered = list.filter((r) => {
    const vert = rowVertical(r);
    if (!vert) return true;
    return String(vert).toLowerCase().includes("pharm") || String(vert).toLowerCase() === VERTICAL;
  });

  let inserted = 0;
  for (const row of filtered) {
    const sourceRef = rowId(row);
    const topicText = rowTopicText(row);
    const vertical = rowVertical(row) ?? VERTICAL;

    if (sourceRef) {
      const { data: existing } = await sb
        .schema("vantage")
        .from("topics")
        .select("id")
        .eq("source_product", "shift")
        .eq("source_ref", sourceRef)
        .is("used_at", null)
        .maybeSingle();
      if (existing?.id) continue;
    }

    const { error: insErr } = await sb.schema("vantage").from("topics").insert({
      source_product: "shift",
      source_ref: sourceRef,
      vertical,
      topic_text: topicText,
      context_payload: row as Record<string, unknown>,
      priority: 0,
    });
    if (insErr) {
      await logActivity({
        source: "source",
        source_type: "system",
        event_type: "topic_insert_error",
        summary: insErr.message,
        payload: { source_ref: sourceRef },
      });
      continue;
    }
    inserted += 1;
  }

  await logActivity({
    source: "source",
    source_type: "system",
    event_type: "shift_pull_complete",
    summary: `Inserted ${inserted} topics from shift.questions`,
    payload: { scanned: list.length, inserted },
  });

  return { inserted };
}

export async function listNextTopics(limit: number): Promise<
  {
    id: string;
    topic_text: string;
    vertical: string | null;
    priority: number;
    source_ref: string | null;
  }[]
> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .schema("vantage")
    .from("topics")
    .select("id, topic_text, vertical, priority, source_ref")
    .is("used_at", null)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as {
    id: string;
    topic_text: string;
    vertical: string | null;
    priority: number;
    source_ref: string | null;
  }[];
}
