import React from 'react'
import { Navigate } from 'react-router-dom'
import { getSession, redirectToNexus, isSsoConfigured } from '../lib/auth/sso'

type State = 'checking' | 'authed' | 'redirecting' | 'error'

export function LoginPage() {
  const [state, setState] = React.useState<State>('checking')

  React.useEffect(() => {
    let mounted = true
    void getSession().then((session) => {
      if (!mounted) return
      if (session) {
        setState('authed')
        return
      }
      if (!isSsoConfigured()) {
        setState('error')
        return
      }
      setState('redirecting')
      redirectToNexus(window.location.origin)
    })
    return () => {
      mounted = false
    }
  }, [])

  if (state === 'authed') return <Navigate to="/" replace />

  return (
    <div className="vg-login-wrap nx-app">
      <div className="vg-login-card">
        <div className="vg-login-brand">
          <p className="vg-login-brand-name">Vantage</p>
          <p className="vg-login-brand-sub">Nexus Marketing OS — Operator access</p>
        </div>

        {state === 'error' ? (
          <div className="vg-error" style={{ marginTop: 16 }}>
            Single sign-on is not configured. Set <code>VITE_NEXUS_AUTH_URL</code> on the
            web build and redeploy.
          </div>
        ) : (
          <p style={{ marginTop: 16, fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-4)', letterSpacing: '0.1em' }}>
            REDIRECTING TO NEXUS SSO…
          </p>
        )}
      </div>
    </div>
  )
}
