import React, { type ReactElement } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { signOut } from './lib/auth/sso'
import { NavItem } from './ds'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { QueuePage } from './pages/QueuePage'
import { ChannelsPage } from './pages/ChannelsPage'
import { VoicePage } from './pages/VoicePage'
import { SettingsPage } from './pages/SettingsPage'
import { CalendarPage } from './pages/CalendarPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { DemoForgePage } from './pages/DemoForgePage'
import { SocialKitPage } from './pages/SocialKitPage'
import { EmailBuilderPage } from './pages/EmailBuilderPage'

const NAV = [
  { label: 'Dashboard', path: '/',          icon: '◈' },
  { label: 'Queue',     path: '/queue',      icon: '≋' },
  { label: 'Calendar',  path: '/calendar',   icon: '▦' },
  { label: 'Analytics', path: '/analytics',  icon: '▲' },
  { label: 'DemoForge', path: '/demoforge',  icon: '⬡' },
  { label: 'Social Kit',     path: '/social-kit',     icon: '◧' },
  { label: 'Email Builder',  path: '/email-builder',  icon: '✉' },
  { label: 'Channels',  path: '/channels',   icon: '⊕' },
  { label: 'Voice',     path: '/voice',      icon: '◆' },
  { label: 'Settings',  path: '/settings',   icon: '⚙' },
]

function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()

  const handleSignOut = () => {
    void signOut().then(() => { window.location.href = '/login' })
  }

  return (
    <aside className="vg-sidebar">
      <div className="vg-sidebar__brand">
        <p className="vg-sidebar__brand-name">Vantage</p>
        <p className="vg-sidebar__brand-sub">Nexus Marketing OS</p>
      </div>
      <div className="vg-sidebar__divider" />
      <nav className="vg-sidebar__nav">
        <div className="vg-sidebar__section-label">Navigation</div>
        {NAV.map((item) => (
          <NavItem
            key={item.path}
            label={item.label}
            icon={<span>{item.icon}</span>}
            active={
              item.path === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.path)
            }
            onClick={() => navigate(item.path)}
          />
        ))}
      </nav>
      <div className="vg-sidebar__footer">
        <button
          type="button"
          className="nx-btn nx-btn--ghost nx-btn--sm nx-btn--full"
          onClick={handleSignOut}
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}

function Layout() {
  return (
    <div className="vg-layout nx-app">
      <Sidebar />
      <main className="vg-main">
        <Outlet />
      </main>
    </div>
  )
}

function RequireAuth({ children }: { children: ReactElement }) {
  const [ready, setReady] = React.useState(false)
  const [authed, setAuthed] = React.useState(false)

  React.useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!ready) {
    return (
      <div className="vg-layout nx-app">
        <div style={{ margin: 'auto', padding: '40px', fontFamily: 'var(--nx-mono)', fontSize: '10px', color: 'var(--nx-text-4)', letterSpacing: '0.1em' }}>
          LOADING…
        </div>
      </div>
    )
  }
  if (!authed) return <Navigate to="/login" replace />
  return children
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
          <Route path="/"           element={<DashboardPage />} />
          <Route path="/queue"      element={<QueuePage />} />
          <Route path="/calendar"   element={<CalendarPage />} />
          <Route path="/analytics"  element={<AnalyticsPage />} />
          <Route path="/demoforge"  element={<DemoForgePage />} />
          <Route path="/social-kit"    element={<SocialKitPage />} />
          <Route path="/email-builder" element={<EmailBuilderPage />} />
          <Route path="/channels"   element={<ChannelsPage />} />
          <Route path="/voice"      element={<VoicePage />} />
          <Route path="/settings"   element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
