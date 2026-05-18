import { getSupabaseAdmin, getSupabaseForSchema } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";

const DEDUP_DAYS = Number(process.env.TOPIC_DEDUP_DAYS ?? "30");

type ShiftRow = Record<string, unknown>;

function rowTopicText(row: ShiftRow): string {
  const candidates = ["question_text", "body", "text", "title", "question", "prompt", "content"];
  for (const k of candidates) {
    const v = row[k];
    if (typeof v === "string" && v.trim().length > 10) return v.trim();
  }
  return JSON.stringify(row).slice(0, 2000);
}

function rowId(row: ShiftRow): string | null {
  const id = row.id ?? row.question_id ?? row.lesson_id ?? row.item_id;
  if (typeof id === "string" || typeof id === "number") return String(id);
  return null;
}

function rowVertical(row: ShiftRow): string | null {
  const v = row.vertical ?? row.vertical_slug ?? row.verticalSlug ?? row.vertical_id ?? row.verticalId ?? row.category;
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

/** Check if a source_ref was already ingested within the dedup window. */
async function isDuplicate(sourceProduct: string, sourceRef: string): Promise<boolean> {
  const sb = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - DEDUP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    
    .from("topics")
    .select("id")
    .eq("source_product", sourceProduct)
    .eq("source_ref", sourceRef)
    .gte("created_at", cutoff)
    .limit(1)
    .maybeSingle();
  return !!data?.id;
}

async function insertTopic(params: {
  source_product: string;
  source_ref: string | null;
  vertical: string | null;
  topic_text: string;
  context_payload: Record<string, unknown>;
  priority?: number;
}): Promise<boolean> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("topics").insert({
    source_product:  params.source_product,
    source_ref:      params.source_ref,
    vertical:        params.vertical,
    topic_text:      params.topic_text,
    context_payload: params.context_payload,
    priority:        params.priority ?? 0,
  });
  if (error) {
    await logActivity({
      source: "source",
      source_type: "system",
      event_type: "topic_insert_error",
      summary: error.message,
      payload: { source_ref: params.source_ref, source_product: params.source_product },
    });
    return false;
  }
  return true;
}

/** Pull topics from shift.questions — all verticals with 30-day dedup. */
export async function refreshTopicsFromShift(): Promise<{ inserted: number; scanned: number }> {
  const sb = getSupabaseAdmin();
  const { data: rows, error } = await getSupabaseForSchema("shift").from("questions").select("*").limit(500);

  if (error) {
    await logActivity({
      source: "source",
      source_type: "system",
      event_type: "shift_pull_error",
      summary: error.message,
      payload: { code: error.code },
    });
    throw new Error(`shift.questions read failed: ${error.message}`);
  }

  const list = (rows ?? []) as ShiftRow[];
  let inserted = 0;

  for (const row of list) {
    const sourceRef  = rowId(row);
    const topicText  = rowTopicText(row);
    const vertical   = rowVertical(row);

    // Skip rows with no usable content
    if (topicText.length < 15) continue;

    // 30-day deduplication
    if (sourceRef && await isDuplicate("shift", sourceRef)) continue;

    const ok = await insertTopic({
      source_product:  "shift",
      source_ref:      sourceRef,
      vertical,
      topic_text:      topicText,
      context_payload: row,
      priority:        0,
    });
    if (ok) inserted += 1;
  }

  await logActivity({
    source: "source",
    source_type: "system",
    event_type: "shift_pull_complete",
    summary: `Shift pull: ${inserted} inserted, ${list.length} scanned`,
    payload: { scanned: list.length, inserted },
  });

  return { inserted, scanned: list.length };
}

/** Pull topics from scripta.lessons — all verticals with 30-day dedup. */
export async function refreshTopicsFromScripta(): Promise<{ inserted: number; scanned: number }> {
  const sb = getSupabaseAdmin();

  // Scripta schema is flexible — try common table names
  const tables = ["lessons", "lesson_content", "items", "content"];
  let rows: ShiftRow[] = [];
  let tableName = "";

  for (const t of tables) {
    const { data, error } = await getSupabaseForSchema("scripta").from(t).select("*").limit(300);
    if (!error && data && data.length > 0) {
      rows = data as ShiftRow[];
      tableName = t;
      break;
    }
  }

  if (rows.length === 0) {
    await logActivity({
      source: "source",
      source_type: "system",
      event_type: "scripta_pull_skipped",
      summary: "Scripta: no accessible table found (tried lessons, lesson_content, items, content)",
      payload: {},
    });
    return { inserted: 0, scanned: 0 };
  }

  let inserted = 0;
  for (const row of rows) {
    const sourceRef = rowId(row);
    const topicText = rowTopicText(row);
    const vertical  = rowVertical(row);

    if (topicText.length < 15) continue;
    if (sourceRef && await isDuplicate("scripta", sourceRef)) continue;

    const ok = await insertTopic({
      source_product:  "scripta",
      source_ref:      sourceRef,
      vertical,
      topic_text:      topicText,
      context_payload: row,
      priority:        1, // Scripta content is lesson-quality — prioritize
    });
    if (ok) inserted += 1;
  }

  await logActivity({
    source: "source",
    source_type: "system",
    event_type: "scripta_pull_complete",
    summary: `Scripta pull (${tableName}): ${inserted} inserted, ${rows.length} scanned`,
    payload: { table: tableName, scanned: rows.length, inserted },
  });

  return { inserted, scanned: rows.length };
}

/** Combined refresh: Shift + Scripta. */
export async function refreshAllSources(): Promise<{ shift: { inserted: number; scanned: number }; scripta: { inserted: number; scanned: number } }> {
  const [shift, scripta] = await Promise.all([
    refreshTopicsFromShift().catch(async (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      await logActivity({ source: "source", source_type: "system", event_type: "shift_pull_error", summary: msg, payload: {} });
      return { inserted: 0, scanned: 0 };
    }),
    refreshTopicsFromScripta().catch(async () => ({ inserted: 0, scanned: 0 })),
  ]);
  return { shift, scripta };
}

export async function listNextTopics(limit: number): Promise<{
  id: string;
  topic_text: string;
  vertical: string | null;
  priority: number;
  source_ref: string | null;
  source_product: string;
}[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    
    .from("topics")
    .select("id, topic_text, vertical, priority, source_ref, source_product")
    .is("used_at", null)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as {
    id: string; topic_text: string; vertical: string | null;
    priority: number; source_ref: string | null; source_product: string;
  }[];
}

/** Pick the single best unused topic. Returns null if none available. */
export async function pickNextTopic(): Promise<{
  id: string; topic_text: string; vertical: string | null;
} | null> {
  const topics = await listNextTopics(1);
  return topics[0] ?? null;
}
