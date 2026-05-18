/**
 * Pulse Reactor — external signal intake.
 *
 * Pulls trending topics from public sources, scores them, deduplicates against
 * the existing topics table, and inserts survivors with source_product = 'pulse'.
 *
 * Sources (in priority order):
 *   1. Hacker News top stories   (always, no auth)
 *   2. Reddit hot posts           (always, configurable subreddits + r/all)
 *   3. NewsAPI top headlines      (optional, requires NEWS_API_KEY env var)
 */

import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";

const DEDUP_DAYS = Number(process.env.TOPIC_DEDUP_DAYS ?? "30");

// ── Vertical keyword inference ────────────────────────────────────────────────
const VERTICAL_KEYWORDS: Record<string, string[]> = {
  "pharmacy-tech":  ["pharmacy", "pharmacist", "medication", "drug", "prescription", "rx", "pharmaceutical", "compounding"],
  "healthcare":     ["healthcare", "hospital", "patient", "clinical", "medical", "health system", "telehealth", "ehr"],
  "biotech":        ["biotech", "genomics", "crispr", "mrna", "clinical trial", "fda", "life sciences"],
  "fintech":        ["fintech", "payments", "banking", "crypto", "defi", "lending", "neobank", "wealth tech"],
  "edtech":         ["edtech", "learning", "education", "online course", "curriculum", "lms", "upskilling"],
  "legaltech":      ["legal", "compliance", "regulation", "attorney", "law firm", "legaltech", "clm"],
  "proptech":       ["real estate", "property", "mortgage", "housing", "realty", "proptech", "reit"],
  "insurtech":      ["insurance", "insurtech", "underwriting", "claims", "actuarial", "reinsurance"],
  "ai":             ["ai", "llm", "machine learning", "neural", "openai", "anthropic", "generative"],
  "saas":           ["saas", "b2b software", "api", "developer tools", "devops", "platform"],
  "marketing":      ["marketing", "growth", "seo", "content", "brand", "advertising", "cmo", "gtm"],
  "hr-tech":        ["hr", "recruiting", "talent", "workforce", "payroll", "hrtech", "people ops"],
};

function inferVertical(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [vertical, keywords] of Object.entries(VERTICAL_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return vertical;
  }
  return null;
}

// ── Deduplication ─────────────────────────────────────────────────────────────
async function isDuplicate(sourceRef: string): Promise<boolean> {
  const sb = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - DEDUP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("topics")
    .select("id")
    .eq("source_product", "pulse")
    .eq("source_ref", sourceRef)
    .gte("created_at", cutoff)
    .limit(1)
    .maybeSingle();
  return !!data?.id;
}

type PulseSignal = {
  source_ref:      string;
  topic_text:      string;
  vertical:        string | null;
  priority:        number;
  context_payload: Record<string, unknown>;
};

// ── Source: Hacker News ───────────────────────────────────────────────────────
async function fetchHackerNewsSignals(): Promise<PulseSignal[]> {
  const signals: PulseSignal[] = [];
  try {
    const idsRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json", {
      signal: AbortSignal.timeout(8_000),
    });
    if (!idsRes.ok) return signals;

    const ids = (await idsRes.json() as number[]).slice(0, 30);

    await Promise.allSettled(ids.map(async (id) => {
      const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!r.ok) return;
      const item = await r.json() as {
        id: number; title?: string; url?: string;
        score?: number; descendants?: number; type?: string;
      };
      if (!item.title || item.type !== "story") return;

      const engagement = (item.score ?? 0) + 2 * (item.descendants ?? 0);
      // Priority 0–10: each 200 engagement points = 1 priority level
      const priority = Math.min(10, Math.floor(engagement / 200));

      signals.push({
        source_ref:      `hn:${item.id}`,
        topic_text:      item.url ? `${item.title} — ${item.url}` : item.title,
        vertical:        inferVertical(item.title),
        priority,
        context_payload: {
          source:    "hackernews",
          title:     item.title,
          url:       item.url ?? null,
          score:     item.score ?? 0,
          comments:  item.descendants ?? 0,
        },
      });
    }));
  } catch {
    // Network failure — skip source silently; logged at the call site
  }
  return signals;
}

// ── Source: Reddit hot posts ──────────────────────────────────────────────────
async function fetchRedditSignals(subreddits: string[]): Promise<PulseSignal[]> {
  const signals: PulseSignal[] = [];
  // r/all for broad cultural signal; configured subreddits for vertical depth
  const targets = [...new Set(["all", ...subreddits])].slice(0, 8);

  for (const sub of targets) {
    try {
      const r = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=15&raw_json=1`, {
        headers: { "User-Agent": "vantage-pulse-reactor/1.0" },
        signal:  AbortSignal.timeout(8_000),
      });
      if (!r.ok) continue;

      const json = await r.json() as {
        data?: {
          children?: Array<{
            data: {
              id: string; title: string; url: string;
              ups: number; num_comments: number; over_18: boolean;
              selftext?: string; subreddit: string;
            };
          }>;
        };
      };

      for (const child of json.data?.children ?? []) {
        const p = child.data;
        if (p.over_18) continue;
        if (!p.title || p.title.length < 10) continue;

        const engagement = p.ups + 2 * p.num_comments;
        const priority   = Math.min(10, Math.floor(engagement / 1_000));

        signals.push({
          source_ref:      `reddit:${p.id}`,
          topic_text:      p.title,
          vertical:        inferVertical(p.title + " " + (p.selftext ?? "")),
          priority,
          context_payload: {
            source:    "reddit",
            subreddit: p.subreddit,
            title:     p.title,
            url:       p.url,
            ups:       p.ups,
            comments:  p.num_comments,
          },
        });
      }
    } catch {
      // Skip individual subreddit on error
    }
  }
  return signals;
}

// ── Source: NewsAPI (optional) ────────────────────────────────────────────────
async function fetchNewsSignals(): Promise<PulseSignal[]> {
  const key = process.env.NEWS_API_KEY;
  if (!key) return [];

  const signals: PulseSignal[] = [];
  try {
    const r = await fetch(
      `https://newsapi.org/v2/top-headlines?language=en&pageSize=20&apiKey=${key}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!r.ok) return signals;

    const json = await r.json() as {
      articles?: Array<{
        title: string; url: string;
        source: { name: string }; publishedAt: string;
      }>;
    };

    for (const a of json.articles ?? []) {
      if (!a.title || a.title === "[Removed]") continue;
      const ref = `news:${Buffer.from(a.url).toString("base64url").slice(0, 48)}`;
      signals.push({
        source_ref:      ref,
        topic_text:      a.title,
        vertical:        inferVertical(a.title),
        priority:        3, // baseline — no engagement data available
        context_payload: {
          source:       "newsapi",
          title:        a.title,
          url:          a.url,
          outlet:       a.source?.name ?? null,
          published_at: a.publishedAt,
        },
      });
    }
  } catch {
    // Skip on network/API error
  }
  return signals;
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function refreshTopicsFromPulse(
  subreddits: string[] = [],
): Promise<{ inserted: number; scanned: number }> {
  const [hn, reddit, news] = await Promise.all([
    fetchHackerNewsSignals(),
    fetchRedditSignals(subreddits),
    fetchNewsSignals(),
  ]);

  const all: PulseSignal[] = [...hn, ...reddit, ...news];
  // Highest-priority signals get inserted first so daily caps favour quality
  all.sort((a, b) => b.priority - a.priority);

  const sb = getSupabaseAdmin();
  let inserted = 0;

  for (const signal of all) {
    if (signal.topic_text.length < 15) continue;
    if (await isDuplicate(signal.source_ref)) continue;

    const { error } = await sb.from("topics").insert({
      source_product:  "pulse",
      source_ref:      signal.source_ref,
      vertical:        signal.vertical,
      topic_text:      signal.topic_text,
      context_payload: signal.context_payload,
      priority:        signal.priority,
    });
    if (!error) inserted += 1;
  }

  const activeSources = ["hackernews", "reddit", ...(process.env.NEWS_API_KEY ? ["newsapi"] : [])];

  await logActivity({
    source:      "pulse",
    source_type: "system",
    event_type:  "pulse_scan_complete",
    summary:     `Pulse scan: ${inserted} inserted, ${all.length} scanned (${activeSources.join(", ")})`,
    payload:     { scanned: all.length, inserted, sources: activeSources, subreddits },
  });

  return { inserted, scanned: all.length };
}
