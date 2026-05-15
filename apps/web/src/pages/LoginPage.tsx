import React from 'react'
import { signInStub } from '../lib/auth/sso'

export function LoginPage() {
  const [email, setEmail] = React.useState(import.meta.env.VITE_STUB_EMAIL ?? '')
  const [password, setPassword] = React.useState('')
  const [err, setErr] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    try {
      await signInStub(email, password)
      window.location.href = '/'
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="vg-login-wrap nx-app">
      <div className="vg-login-card">
        <div className="vg-login-brand">
          <p className="vg-login-brand-name">Vantage</p>
          <p className="vg-login-brand-sub">Nexus Marketing OS — Operator access</p>
        </div>

        {err && <div className="vg-error" style={{ marginBottom: 16 }}>{err}</div>}

        <form onSubmit={(e) => void submit(e)} className="vg-form">
          <div className="vg-field">
            <label className="vg-field__label" htmlFor="email">Email</label>
            <input
              id="email"
              className="vg-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@nexus.io"
              required
              autoComplete="email"
            />
          </div>

          <div className="vg-field">
            <label className="vg-field__label" htmlFor="password">Password</label>
            <input
              id="password"
              className="vg-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="nx-btn nx-btn--primary nx-btn--md nx-btn--full"
            disabled={loading}
            style={{ marginTop: 4 }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
