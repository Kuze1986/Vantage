import React from "react";
import { supabase } from "../lib/supabase";

export function VoicePage() {
  const [name, setName] = React.useState("Brandon default");
  const [description, setDescription] = React.useState("");
  const [tone, setTone] = React.useState("{}");
  const [offTopics, setOffTopics] = React.useState("");
  const [id, setId] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.schema("vantage").from("brand_voice").select("*").limit(1).maybeSingle();
      if (error) {
        setErr(error.message);
        return;
      }
      if (data) {
        setId(data.id as string);
        setName((data.name as string) ?? "");
        setDescription((data.description as string) ?? "");
        setTone(JSON.stringify(data.per_channel_tone ?? {}, null, 2));
        setOffTopics(((data.off_topics as string[]) ?? []).join("\n"));
      }
    })();
  }, []);

  const save = async () => {
    setErr(null);
    setMsg(null);
    let parsedTone: Record<string, unknown> = {};
    try {
      parsedTone = JSON.parse(tone) as Record<string, unknown>;
    } catch {
      setErr("per_channel_tone must be valid JSON");
      return;
    }
    const off = offTopics
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const row = {
      name,
      description: description || null,
      per_channel_tone: parsedTone,
      off_topics: off,
      updated_at: new Date().toISOString(),
    };
    if (id) {
      const { error } = await supabase.schema("vantage").from("brand_voice").update(row).eq("id", id);
      if (error) setErr(error.message);
      else setMsg("Saved");
    } else {
      const { data, error } = await supabase.schema("vantage").from("brand_voice").insert(row).select("id").single();
      if (error) setErr(error.message);
      else {
        setId(data?.id as string);
        setMsg("Created");
      }
    }
  };

  return (
    <div style={{ maxWidth: 640, display: "grid", gap: 12 }}>
      <h1>Brand voice</h1>
      {err && <p style={{ color: "crimson" }}>{err}</p>}
      {msg && <p style={{ color: "green" }}>{msg}</p>}
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
      </label>
      <label>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: "100%" }} rows={3} />
      </label>
      <label>
        Per-channel tone (JSON)
        <textarea value={tone} onChange={(e) => setTone(e.target.value)} style={{ width: "100%", fontFamily: "monospace" }} rows={8} />
      </label>
      <label>
        Off topics (one per line)
        <textarea value={offTopics} onChange={(e) => setOffTopics(e.target.value)} style={{ width: "100%" }} rows={4} />
      </label>
      <button type="button" onClick={() => void save()}>
        Save
      </button>
    </div>
  );
}
