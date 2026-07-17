import React from 'react'
import { vantageApi } from '../api/vantage'
import { Panel, Badge, Button } from '../ds'

const ALL_VERTICALS = [
  'pharmacy-tech', 'healthcare', 'biotech', 'fintech', 'edtech',
  'legaltech', 'proptech', 'insurtech', 'ai', 'saas', 'marketing', 'hr-tech',
]

const ENV_VARS = [
  { key: 'VITE_VANTAGE_API_URL',  label: 'API Base URL',       hint: 'Set at build time' },
  { key: 'VITE_SUPABASE_URL',     label: 'Supabase URL',       hint: 'Set at build time' },
  { key: 'VITE_SUPABASE_ANON_KEY',label: 'Supabase Anon Key',  hint: 'Set at build time' },
  { key: 'VITE_NEXUS_AUTH_URL',   label: 'Nexus SSO URL',      hint: 'Set at build time — SSO redirect target' },
]

function envPresent(key: string): boolean {
  const val = (import.meta.env as Record<string, string | undefined>)[key]
  return !!val && val !== 'undefined'
}

type Settings = {
  dedup_days:            number
  scripta_enabled:       boolean
  bioloop_enabled:       boolean
  active_verticals:      string[]
  llm_provider_generate: string
  llm_provider_audit:    string
}

type LLMProviderInfo = { name: string; displayName: string; available: boolean }

export function SettingsPage() {
  const [settings, setSettings]   = React.useState<Settings | null>(null)
  const [draft, setDraft]         = React.useState<Settings | null>(null)
  const [providers, setProviders] = React.useState<LLMProviderInfo[]>([])
  const [saving, setSaving]       = React.useState(false)
  const [saved, setSaved]         = React.useState(false)
  const [err, setErr]             = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const [r, p] = await Promise.all([
        vantageApi.getSettings(),
        vantageApi.listLLMProviders().catch(() => ({ providers: [] as LLMProviderInfo[] })),
      ])
      setSettings(r.settings)
      setDraft(r.settings)
      setProviders(p.providers)
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const handleSave = async () => {
    if (!draft) return
    setSaving(true); setErr(null)
    try {
      const r = await vantageApi.patchSettings(draft)
      setSettings(r.settings)
      setDraft(r.settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setSaving(false)
    }
  }

  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((prev) => prev ? { ...prev, [key]: value } : prev)

  const toggleVertical = (v: string) => {
    if (!draft) return
    const current = draft.active_verticals
    const next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v]
    patch('active_verticals', next)
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify(settings)

  return (
    <>
      <div className="vg-page-header">
        <h1 className="vg-page-title">Settings</h1>
        <p className="vg-page-sub">System configuration and environment status</p>
      </div>

      {err && <div className="vg-error" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="vg-stack">

        {/* ── Pipeline configuration ─────────────────────────────────────── */}
        <Panel title="Pipeline Configuration" titleAccent="amber">
          {!draft ? (
            <p className="vg-empty">Loading…</p>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>

              {/* Topic dedup window */}
              <div>
                <label className="vg-label" style={{ display: 'block', marginBottom: 6 }}>
                  Topic deduplication window (days)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="number"
                    className="vg-input"
                    min={1} max={365}
                    value={draft.dedup_days}
                    onChange={(e) => patch('dedup_days', Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 30)))}
                    style={{ width: 80 }}
                  />
                  <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)' }}>
                    Same source_ref won't be re-ingested within this window
                  </span>
                </div>
              </div>

              {/* Scripta toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 13, color: 'var(--nx-text-1)', marginBottom: 2 }}>
                    Scripta integration
                  </div>
                  <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)' }}>
                    Pull lesson highlights from scripta.lessons as topic source
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={draft.scripta_enabled}
                    onChange={(e) => patch('scripta_enabled', e.target.checked)}
                    style={{ accentColor: 'var(--nx-amber)', width: 16, height: 16 }}
                  />
                  <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: draft.scripta_enabled ? 'var(--nx-amber)' : 'var(--nx-text-4)' }}>
                    {draft.scripta_enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </label>
              </div>

              {/* BioLoop toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 13, color: 'var(--nx-text-1)', marginBottom: 2 }}>
                    BioLoop learning
                  </div>
                  <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)' }}>
                    Daily cron updates generation_weights from engagement patterns
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={draft.bioloop_enabled}
                    onChange={(e) => patch('bioloop_enabled', e.target.checked)}
                    style={{ accentColor: 'var(--nx-amber)', width: 16, height: 16 }}
                  />
                  <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: draft.bioloop_enabled ? 'var(--nx-amber)' : 'var(--nx-text-4)' }}>
                    {draft.bioloop_enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </label>
              </div>

              {/* Active verticals */}
              <div>
                <label className="vg-label" style={{ display: 'block', marginBottom: 6 }}>
                  Active Shift verticals
                  <span style={{ fontFamily: 'var(--nx-mono)', fontWeight: 400, fontSize: 9, color: 'var(--nx-text-4)', marginLeft: 8 }}>
                    {draft.active_verticals.length === 0 ? 'all verticals' : `${draft.active_verticals.length} selected`}
                  </span>
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ALL_VERTICALS.map((v) => {
                    const active = draft.active_verticals.length === 0 || draft.active_verticals.includes(v)
                    const selected = draft.active_verticals.includes(v)
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => toggleVertical(v)}
                        style={{
                          fontFamily:  'var(--nx-mono)',
                          fontSize:    10,
                          padding:     '3px 10px',
                          border:      `1px solid ${selected ? 'var(--nx-amber)' : 'var(--nx-border)'}`,
                          borderRadius: 4,
                          background:  selected ? 'rgba(245,158,11,0.12)' : 'transparent',
                          color:       selected ? 'var(--nx-amber)' : active ? 'var(--nx-text-3)' : 'var(--nx-text-4)',
                          cursor:      'pointer',
                          opacity:     draft.active_verticals.length > 0 && !selected ? 0.5 : 1,
                        }}
                      >
                        {v}
                      </button>
                    )
                  })}
                </div>
                <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginTop: 6 }}>
                  Deselect all to pull from every vertical. Select specific ones to filter Shift pulls.
                </div>
                {draft.active_verticals.length > 0 && (
                  <button
                    type="button"
                    onClick={() => patch('active_verticals', [])}
                    style={{ marginTop: 6, fontFamily: 'var(--nx-mono)', fontSize: 9, background: 'none', border: 'none', color: 'var(--nx-text-4)', cursor: 'pointer', padding: 0 }}
                  >
                    ✕ Clear selection (use all verticals)
                  </button>
                )}
              </div>

              {/* Implemented-elsewhere note */}
              <div style={{ borderTop: '1px solid var(--nx-border)', paddingTop: 12 }}>
                <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', letterSpacing: '0.08em', marginBottom: 8 }}>
                  CONFIGURED PER CHANNEL (IN CHANNELS PAGE)
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {[
                    { label: 'Auto-approve toggle', note: 'Channels → expand channel → Cadence form' },
                    { label: 'Posting cadence (posts per day)', note: 'Channels → expand channel → Cadence form' },
                  ].map(({ label, note }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <span style={{ fontFamily: 'var(--nx-sans)', fontSize: 12, color: 'var(--nx-text-2)' }}>{label}</span>
                        <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginLeft: 10 }}>{note}</span>
                      </div>
                      <Badge label="Active" variant="active" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Save */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Button
                  label={saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Settings'}
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleSave()}
                  disabled={saving || !isDirty}
                />
                {isDirty && !saving && (
                  <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-amber)' }}>Unsaved changes</span>
                )}
              </div>
            </div>
          )}
        </Panel>

        {/* ── AI Providers ───────────────────────────────────────────────── */}
        <Panel title="AI Providers" titleAccent="amber">
          {!draft ? (
            <p className="vg-empty">Loading…</p>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)', margin: 0, lineHeight: 1.6 }}>
                Choose which model powers each AI task. "Inherit default" uses the server's
                LLM_PROVIDER_* environment variable. A provider is selectable only if its API
                key is configured server-side.
              </p>

              {([
                { key: 'llm_provider_generate' as const, label: 'Content generation (Kuze)', hint: 'Writes posts, threads, captions' },
                { key: 'llm_provider_audit' as const,    label: 'Compliance audit (Ilita)',  hint: 'Reviews content before it ships' },
              ]).map(({ key, label, hint }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 13, color: 'var(--nx-text-1)', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)' }}>{hint}</div>
                  </div>
                  <select
                    className="vg-input"
                    value={draft[key]}
                    onChange={(e) => patch(key, e.target.value)}
                    style={{ width: 220 }}
                  >
                    <option value="">Inherit default</option>
                    {providers.map((p) => (
                      <option key={p.name} value={p.name} disabled={!p.available}>
                        {p.displayName}{p.available ? '' : ' — no API key'}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Button
                  label={saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Settings'}
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleSave()}
                  disabled={saving || !isDirty}
                />
                {isDirty && !saving && (
                  <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-amber)' }}>Unsaved changes</span>
                )}
              </div>
            </div>
          )}
        </Panel>

        {/* ── Environment ────────────────────────────────────────────────── */}
        <Panel title="Environment" titleAccent="amber">
          <div style={{ display: 'grid', gap: 10 }}>
            {ENV_VARS.map(({ key, label, hint }) => {
              const present = envPresent(key)
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-1)', marginBottom: 2 }}>
                      {label}
                    </div>
                    <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', letterSpacing: '0.08em' }}>
                      {key} — {hint}
                    </div>
                  </div>
                  <Badge label={present ? 'Set' : 'Missing'} variant={present ? 'active' : 'critical'} />
                </div>
              )
            })}
          </div>
        </Panel>

        {/* ── API config ─────────────────────────────────────────────────── */}
        <Panel title="API Configuration">
          <div style={{ display: 'grid', gap: 10 }}>
            {[
              { label: 'API URL', value: (import.meta.env.VITE_VANTAGE_API_URL as string) || '(not set)' },
              { label: 'Supabase Project', value: (import.meta.env.VITE_SUPABASE_URL as string)?.replace('https://', '').split('.')[0] || '(not set)' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {label}
                </span>
                <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-cyan)' }}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        {/* ── Build ──────────────────────────────────────────────────────── */}
        <Panel title="Build">
          <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)', letterSpacing: '0.06em', margin: 0 }}>
            All API keys (Anthropic, X OAuth, LinkedIn, Reddit, Resend, OpenAI, ElevenLabs) are set
            server-side on the <span style={{ color: 'var(--nx-amber)' }}>vantage-api</span> Railway service.
            No sensitive keys are bundled into this SPA.
          </p>
        </Panel>

      </div>
    </>
  )
}
