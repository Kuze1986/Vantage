/**
 * 3A-8 — per-vertical dashboard breakdown.
 *
 * Extracted from the dashboard route so the counting rules are testable without
 * standing up the whole Supabase query chain.
 *
 * The subtle part is the 7-day window. It cannot live in the query: `queued` and
 * `auditing` pieces have a null `published_at`, so a `.gte("published_at", …)`
 * filter drops them before they are ever counted — which is why this breakdown
 * originally reported publish counts only. The caller fetches without a date
 * filter and the window is applied per-status here.
 */

export type VerticalStats = {
  published_7d: number;
  published_today: number;
  queued: number;
  auditing: number;
  engagement_7d: number;
};

/** A content_pieces row joined to its topic's vertical. */
export type VerticalPieceRow = {
  id: string;
  status: string;
  published_at: string | null;
  /** PostgREST returns an object for a to-one embed, an array when it infers to-many. */
  topics: { vertical: string | null } | { vertical: string | null }[] | null;
};

export type VerticalEngagementRow = { content_piece_id: string | null };

export function emptyVerticalStats(): VerticalStats {
  return { published_7d: 0, published_today: 0, queued: 0, auditing: 0, engagement_7d: 0 };
}

function verticalOf(row: VerticalPieceRow): string | null {
  const topic = Array.isArray(row.topics) ? row.topics[0] : row.topics;
  const vertical = topic?.vertical;
  return typeof vertical === "string" && vertical.trim() ? vertical : null;
}

export function buildVerticalBreakdown(
  pieces: VerticalPieceRow[],
  engagement: VerticalEngagementRow[],
  window: { since7d: string; todayStart: string },
): Record<string, VerticalStats> {
  const breakdown: Record<string, VerticalStats> = {};
  // piece id → vertical, so engagement attributes without a second round trip.
  const pieceVertical = new Map<string, string>();

  for (const row of pieces) {
    const vertical = verticalOf(row);
    if (!vertical) continue;

    pieceVertical.set(row.id, vertical);
    const stats = (breakdown[vertical] ??= emptyVerticalStats());

    if (row.status === "published") {
      if (row.published_at && row.published_at >= window.since7d) {
        stats.published_7d += 1;
        if (row.published_at >= window.todayStart) stats.published_today += 1;
      }
    } else if (row.status === "queued") {
      stats.queued += 1;
    } else if (row.status === "auditing") {
      stats.auditing += 1;
    }
  }

  for (const ev of engagement) {
    if (!ev.content_piece_id) continue;
    const vertical = pieceVertical.get(ev.content_piece_id);
    if (!vertical) continue;
    // The piece is already in the map, so the vertical key already exists.
    breakdown[vertical]!.engagement_7d += 1;
  }

  return breakdown;
}
