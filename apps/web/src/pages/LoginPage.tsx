import React from "react";
import { signInStub } from "../lib/auth/sso";

export function LoginPage() {
  const [email, setEmail] = React.useState(import.meta.env.VITE_STUB_EMAIL ?? "");
  const [password, setPassword] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await signInStub(email, password);
      window.location.href = "/";
    } catch (e) {
      setErr(String((e as Error).message));
    }
  };

  return (
    <div style={{ maxWidth: 360, margin: "48px auto" }}>
      <h1>Vantage — sign in</h1>
      <p style={{ opacity: 0.8 }}>Stub SSO: Supabase email/password (single operator).</p>
      {err && <p style={{ color: "crimson" }}>{err}</p>}
      <form onSubmit={(e) => void submit(e)} style={{ display: "grid", gap: 12 }}>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required style={{ width: "100%" }} />
        </label>
        <label>
          Password
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required style={{ width: "100%" }} />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </div>
  );
}
