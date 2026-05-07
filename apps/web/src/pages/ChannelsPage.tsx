import React from "react";
import { supabase } from "../lib/supabase";
import { vantageApi } from "../api/vantage";

export function ChannelsPage() {
  const [row, setRow] = React.useState<Record<string, unknown> | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const { data, error } = await supabase.schema("vantage").from("channels").select("*").eq("slug", "x").single();
    if (error) setErr(error.message);
    else setRow(data);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const connectX = async () => {
    setErr(null);
    try {
      const { authorize_url } = await vantageApi.startXOAuth();
      window.location.href = authorize_url;
    } catch (e) {
      setErr(String((e as Error).message));
    }
  };

  return (
    <div>
      <h1>Channels</h1>
      {err && <p style={{ color: "crimson" }}>{err}</p>}
      <section style={{ marginTop: 16 }}>
        <h2>X</h2>
        <pre>{JSON.stringify(row, null, 2)}</pre>
        <button type="button" onClick={() => void connectX()}>
          Connect X (OAuth)
        </button>
      </section>
    </div>
  );
}
