import React from "react";
import { vantageApi } from "../api/vantage";
import { supabase } from "../lib/supabase";

type Topic = { id: string; topic_text: string; vertical: string | null };

export function DashboardPage() {
  const [data, setData] = React.useState<unknown>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [activity, setActivity] = React.useState<unknown[]>([]);
  const [topics, setTopics] = React.useState<Topic[]>([]);
  const [pipelineMsg, setPipelineMsg] = React.useState<string | null>(null);

  const loadDash = React.useCallback(() => {
    vantageApi
      .dashboardOverview()
      .then(setData)
      .catch((e: Error) => setErr(String(e.message ?? e)));
  }, []);

  const loadTopics = React.useCallback(() => {
    vantageApi
      .getTopics(20)
      .then((r) => setTopics((r.topics ?? []) as Topic[]))
      .catch((e: Error) => setErr(String(e.message ?? e)));
  }, []);

  React.useEffect(() => {
    loadDash();
    loadTopics();
  }, [loadDash, loadTopics]);

  React.useEffect(() => {
    const ch = supabase
      .channel("vantage-activity")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "vantage", table: "activity_events" },
        (payload) => setActivity((prev) => [payload.new, ...prev].slice(0, 50)),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, []);

  if (err) return <p style={{ color: "crimson" }}>{err}</p>;
  if (!data) return <p>Loading…</p>;

  const d = data as {
    activityLast24h: { id: string; summary: string; source: string; occurred_at: string }[];
    queueDepth: Record<string, number>;
    recentEngagement: unknown[];
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h1>Dashboard</h1>
      <section>
        <h2>Source pipeline</h2>
        {pipelineMsg && <p style={{ color: "green" }}>{pipelineMsg}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={async () => {
              setPipelineMsg(null);
              try {
                await vantageApi.refreshSource();
                setPipelineMsg("Shift refresh triggered");
                loadTopics();
                loadDash();
              } catch (e) {
                setErr(String((e as Error).message));
              }
            }}
          >
            Pull topics (Shift)
          </button>
          <button type="button" onClick={() => loadTopics()}>
            Reload topic list
          </button>
        </div>
        <ul style={{ maxHeight: 200, overflow: "auto" }}>
          {topics.map((t) => (
            <li key={t.id} style={{ marginBottom: 8 }}>
              <div>{t.topic_text.slice(0, 140)}…</div>
              <button
                type="button"
                onClick={async () => {
                  setPipelineMsg(null);
                  try {
                    await vantageApi.generate("x", t.id);
                    setPipelineMsg("Generated draft — open Queue to audit");
                    loadDash();
                  } catch (e) {
                    setErr(String((e as Error).message));
                  }
                }}
              >
                Generate X draft
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Queue depth</h2>
        <pre>{JSON.stringify(d.queueDepth, null, 2)}</pre>
      </section>
      <section>
        <h2>Activity (24h)</h2>
        <ul style={{ maxHeight: 320, overflow: "auto", paddingLeft: 16 }}>
          {activity.length
            ? activity.map((row: unknown) => (
                <li key={(row as { id: string }).id}>{JSON.stringify(row)}</li>
              ))
            : d.activityLast24h.map((a) => (
                <li key={a.id}>
                  <strong>{a.source}</strong> — {a.summary}{" "}
                  <span style={{ opacity: 0.7 }}>{new Date(a.occurred_at).toLocaleString()}</span>
                </li>
              ))}
        </ul>
      </section>
      <section>
        <h2>Recent engagement</h2>
        <pre style={{ maxHeight: 200, overflow: "auto" }}>{JSON.stringify(d.recentEngagement, null, 2)}</pre>
      </section>
    </div>
  );
}
