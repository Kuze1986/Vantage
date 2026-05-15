import { Panel, Badge } from '../ds'

const ENV_VARS = [
  { key: 'VITE_VANTAGE_API_URL',  label: 'API Base URL',       hint: 'Set at build time' },
  { key: 'VITE_SUPABASE_URL',     label: 'Supabase URL',       hint: 'Set at build time' },
  { key: 'VITE_SUPABASE_ANON_KEY',label: 'Supabase Anon Key',  hint: 'Set at build time' },
  { key: 'VITE_STUB_EMAIL',       label: 'Stub Email',         hint: 'Optional — pre-fills login' },
]

function envPresent(key: string): boolean {
  const val = (import.meta.env as Record<string, string | undefined>)[key]
  return !!val && val !== 'undefined'
}

export function SettingsPage() {
  return (
    <>
      <div className="vg-page-header">
        <h1 className="vg-page-title">Settings</h1>
        <p className="vg-page-sub">System configuration and environment status</p>
      </div>

      <div className="vg-stack">
        {/* Environment */}
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

        {/* API config */}
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

        {/* Build info */}
        <Panel title="Build">
          <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)', letterSpacing: '0.06em', margin: 0 }}>
            All API keys (Anthropic, X OAuth, LinkedIn, Reddit, Resend, OpenAI, ElevenLabs) are set
            server-side on the <span style={{ color: 'var(--nx-amber)' }}>axis-api</span> Railway service.
            No sensitive keys are bundled into this SPA.
          </p>
        </Panel>

        {/* Upcoming settings */}
        <Panel title="Upcoming Configuration" titleAccent="cyan">
          <div style={{ display: 'grid', gap: 8 }}>
            {[
              'Auto-approve toggle (per channel)',
              'Posting cadence (posts per day / week per channel)',
              'Topic deduplication window (days)',
              'Active Shift verticals (source weighting)',
              'Scripta integration toggle',
              'BioLoop learning toggle',
            ].map((item) => (
              <div key={item} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'var(--nx-sans)', fontSize: 12.5, color: 'var(--nx-text-2)' }}>{item}</span>
                <Badge label="Phase 1" variant="soon" />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  )
}
