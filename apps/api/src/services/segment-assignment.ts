/**
 * Segment-assignment engine
 *
 * segments.definition ({ match_type: "all"|"any", rules: [{ field, operator, value }] }) has
 * never had an evaluator — segment_members could only ever be populated via the manual
 * POST /v1/audience/segments/:id/members endpoint, making "engagement → segment membership"
 * structurally impossible even after actor_external_id capture was added to engagement_events.
 * This closes that gap.
 *
 * No prior rule vocabulary exists anywhere in this codebase (segments has zero rows in
 * production — the feature has never been exercised), so the field/operator set below is
 * newly defined here, scoped tightly to signal this codebase actually has:
 *
 *   field: "source_platform"   — the channel an actor's tracked engagement came from
 *                                 (derived from content_pieces.channel_slug of the pieces
 *                                 they engaged with — same values engagement_events feeds
 *                                 into, i.e. x/linkedin/reddit/bluesky/threads)
 *   field: "engagement_count"  — total matching engagement_events rows for the actor
 *   field: "event_type"        — whether the actor has any engagement_events.event_type
 *                                 matching (operator "eq"/"contains"/"in")
 *
 *   operator: "eq" | "gte" | "lte" | "gt" | "lt" | "in" | "contains"
 *
 * Unrecognized fields/operators are skipped (the rule evaluates false), not thrown — a typo'd
 * or forward-looking rule shouldn't crash the whole tick.
 */

import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";

const LOOKBACK_DAYS = 90;
const MAX_EVENTS = 5000;

type Rule = { field?: string; operator?: string; value?: unknown };
type SegmentDefinition = { match_type?: "all" | "any"; rules?: Rule[] };

type SegmentRow = {
  id: string;
  definition: SegmentDefinition | null;
};

type ActorStats = {
  actorExternalId: string;
  sourcePlatform: string | null;
  engagementCount: number;
  eventTypes: Set<string>;
  firstInteractionAt: string;
  lastInteractionAt: string;
};

function compare(operator: string | undefined, actual: unknown, expected: unknown): boolean {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "gt":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "lt":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "contains":
      return actual instanceof Set ? actual.has(String(expected)) : false;
    default:
      return false;
  }
}

function evaluateRule(rule: Rule, actor: ActorStats): boolean {
  switch (rule.field) {
    case "source_platform":
      return compare(rule.operator, actor.sourcePlatform, rule.value);
    case "engagement_count":
      return compare(rule.operator, actor.engagementCount, rule.value);
    case "event_type":
      return compare(rule.operator, actor.eventTypes, rule.value);
    default:
      return false;
  }
}

function matchesSegment(definition: SegmentDefinition | null, actor: ActorStats): boolean {
  const rules = definition?.rules ?? [];
  if (!rules.length) return false;
  const results = rules.map((r) => evaluateRule(r, actor));
  return definition?.match_type === "any" ? results.some(Boolean) : results.every(Boolean);
}

export async function assignSegmentMembers(
  workspaceId: string,
): Promise<{ segmentsProcessed: number; actorsEvaluated: number; membersUpserted: number }> {
  const sb = getSupabaseAdmin();

  const { data: segments, error: segErr } = await sb
    .from("segments")
    .select("id, definition")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  if (segErr) {
    console.error("[segment-assignment] load segments error:", segErr.message);
    return { segmentsProcessed: 0, actorsEvaluated: 0, membersUpserted: 0 };
  }
  if (!segments?.length) return { segmentsProcessed: 0, actorsEvaluated: 0, membersUpserted: 0 };

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: events, error: evtErr } = await sb
    .from("engagement_events")
    .select("content_piece_id, actor_external_id, event_type, occurred_at")
    .eq("workspace_id", workspaceId)
    .not("actor_external_id", "is", null)
    .gte("occurred_at", cutoff)
    .order("occurred_at", { ascending: false })
    .limit(MAX_EVENTS);

  if (evtErr) {
    console.error("[segment-assignment] load events error:", evtErr.message);
    return { segmentsProcessed: 0, actorsEvaluated: 0, membersUpserted: 0 };
  }
  if (!events?.length) return { segmentsProcessed: segments.length, actorsEvaluated: 0, membersUpserted: 0 };

  const pieceIds = [...new Set(events.map((e) => e.content_piece_id as string).filter(Boolean))];
  const pieceChannel = new Map<string, string>();
  if (pieceIds.length) {
    const { data: pieces } = await sb
      .from("content_pieces")
      .select("id, channel_slug")
      .in("id", pieceIds);
    for (const p of pieces ?? []) pieceChannel.set(p.id as string, p.channel_slug as string);
  }

  const actors = new Map<string, ActorStats>();
  for (const ev of events) {
    const actorId = ev.actor_external_id as string;
    const channel = ev.content_piece_id ? pieceChannel.get(ev.content_piece_id as string) ?? null : null;
    const occurredAt = String(ev.occurred_at);

    const existing = actors.get(actorId);
    if (!existing) {
      actors.set(actorId, {
        actorExternalId: actorId,
        sourcePlatform: channel,
        engagementCount: 1,
        eventTypes: new Set([String(ev.event_type ?? "")]),
        firstInteractionAt: occurredAt,
        lastInteractionAt: occurredAt,
      });
    } else {
      existing.engagementCount += 1;
      existing.eventTypes.add(String(ev.event_type ?? ""));
      if (channel && !existing.sourcePlatform) existing.sourcePlatform = channel;
      if (occurredAt < existing.firstInteractionAt) existing.firstInteractionAt = occurredAt;
      if (occurredAt > existing.lastInteractionAt) existing.lastInteractionAt = occurredAt;
    }
  }

  // Only platforms segment_members' CHECK constraint allows.
  const SEGMENT_MEMBER_PLATFORMS = new Set(["x", "linkedin", "reddit", "ga4", "bluesky", "threads"]);

  let membersUpserted = 0;
  for (const segment of segments as SegmentRow[]) {
    for (const actor of actors.values()) {
      if (!actor.sourcePlatform || !SEGMENT_MEMBER_PLATFORMS.has(actor.sourcePlatform)) continue;
      if (!matchesSegment(segment.definition, actor)) continue;

      const { data: existingMember } = await sb
        .from("segment_members")
        .select("id, total_interactions")
        .eq("workspace_id", workspaceId)
        .eq("segment_id", segment.id)
        .eq("external_id", actor.actorExternalId)
        .eq("source_platform", actor.sourcePlatform)
        .maybeSingle();

      if (existingMember?.id) {
        await sb
          .from("segment_members")
          .update({
            total_interactions: actor.engagementCount,
            last_interaction_at: actor.lastInteractionAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingMember.id);
      } else {
        await sb.from("segment_members").insert({
          workspace_id:          workspaceId,
          segment_id:            segment.id,
          external_id:           actor.actorExternalId,
          source_platform:       actor.sourcePlatform,
          total_interactions:    actor.engagementCount,
          first_interaction_at:  actor.firstInteractionAt,
          last_interaction_at:   actor.lastInteractionAt,
          joined_segment_at:     new Date().toISOString(),
        });
      }
      membersUpserted++;
    }
  }

  if (membersUpserted > 0) {
    await logActivity({
      source:       "segment-assignment",
      source_type:  "system",
      event_type:   "assignment_complete",
      summary:      `Segment assignment: ${membersUpserted} member row(s) upserted across ${segments.length} segment(s) from ${actors.size} tracked actor(s)`,
      payload:      { segments: segments.length, actors: actors.size, upserted: membersUpserted },
      workspace_id: workspaceId,
    });
  }

  return { segmentsProcessed: segments.length, actorsEvaluated: actors.size, membersUpserted };
}
