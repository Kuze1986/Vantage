import { BrowserRouter, NavLink, Navigate, Outlet, Route, Routes } from "react-router-dom";
import React, { type ReactElement } from "react";
import { supabase } from "./lib/supabase";
import { signOut } from "./lib/auth/sso";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { QueuePage } from "./pages/QueuePage";
import { ChannelsPage } from "./pages/ChannelsPage";
import { VoicePage } from "./pages/VoicePage";
import { SettingsPage } from "./pages/SettingsPage";

function Layout() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: "100vh" }}>
      <aside style={{ borderRight: "1px solid #ddd", padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Vantage</h2>
        <nav style={{ display: "grid", gap: 8 }}>
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : undefined)}>
            Dashboard
          </NavLink>
          <NavLink to="/queue" className={({ isActive }) => (isActive ? "active" : undefined)}>
            Queue
          </NavLink>
          <NavLink to="/channels" className={({ isActive }) => (isActive ? "active" : undefined)}>
            Channels
          </NavLink>
          <NavLink to="/voice" className={({ isActive }) => (isActive ? "active" : undefined)}>
            Voice
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : undefined)}>
            Settings
          </NavLink>
        </nav>
        <button type="button" style={{ marginTop: 24 }} onClick={() => void signOut().then(() => (window.location.href = "/login"))}>
          Sign out
        </button>
      </aside>
      <main style={{ padding: 24 }}>
        <Outlet />
      </main>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactElement }) {
  const [ready, setReady] = React.useState(false);
  const [authed, setAuthed] = React.useState(false);

  React.useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <p>Loading…</p>;
  if (!authed) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/voice" element={<VoicePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
