import React from "react";
import { supabase } from "../lib/supabase";
import { vantageApi } from "../api/vantage";

type Piece = {
  id: string;
  status: string;
  content_payload: { body?: string };
  topic_id: string;
};

export function QueuePage() {
  const [pieces, setPieces] = React.useState<Piece[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setErr(null);
    const { data, error } = await supabase
      .schema("vantage")
      .from("content_pieces")
      .select("id, status, content_payload, topic_id")
      .in("status", ["auditing", "approved", "queued"])
      .order("created_at", { ascending: false });
    if (error) setErr(error.message);
    else setPieces((data ?? []) as Piece[]);
  }, []);

  React.useEffect(() => {
    void load();
    const ch = supabase
      .channel("vantage-pieces")
      .on(
        "postgres_changes",
        { event: "*", schema: "vantage", table: "content_pieces" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [load]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <h1>Queue</h1>
      {err && <p style={{ color: "crimson" }}>{err}</p>}
      {msg && <p style={{ color: "green" }}>{msg}</p>}
      <button type="button" onClick={() => void load()}>
        Refresh
      </button>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {pieces.map((p) => (
          <li
            key={p.id}
            style={{ border: "1px solid #ccc", borderRadius: 8, padding: 12 }}
          >
            <div>
              <strong>{p.status}</strong> — {p.id}
            </div>
            <pre style={{ whiteSpace: "pre-wrap" }}>{p.content_payload?.body ?? ""}</pre>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {p.status === "auditing" && (
                <button
                  type="button"
                  onClick={async () => {
                    setMsg(null);
                    try {
                      await vantageApi.audit(p.id);
                      setMsg("Audit complete");
                      await load();
                    } catch (e) {
                      setErr(String((e as Error).message));
                    }
                  }}
                >
                  Run Ilita audit
                </button>
              )}
              {p.status === "approved" && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      setMsg(null);
                      try {
                        await vantageApi.schedule(p.id);
                        setMsg("Queued");
                        await load();
                      } catch (e) {
                        setErr(String((e as Error).message));
                      }
                    }}
                  >
                    Queue for cadence
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setMsg(null);
                      try {
                        await vantageApi.publish("x", p.id);
                        setMsg("Published");
                        await load();
                      } catch (e) {
                        setErr(String((e as Error).message));
                      }
                    }}
                  >
                    Publish to X now
                  </button>
                </>
              )}
              {p.status === "queued" && (
                <button
                  type="button"
                  onClick={async () => {
                    setMsg(null);
                    try {
                      await vantageApi.publish("x", p.id);
                      setMsg("Published");
                      await load();
                    } catch (e) {
                      setErr(String((e as Error).message));
                    }
                  }}
                >
                  Publish to X now
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
