import React from 'react'
import { vantageApi, type BrandKitRecord, type VantageSettings } from '../api/vantage'
import { Panel, Badge, Button } from '../ds'
import { BrandKitsPanel } from './BrandKitsPanel'
import { BillingPanel } from './BillingPanel'

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

// Sourced from the API client so the two can't drift — handleSave PATCHes the whole
// draft, and dirty-tracking is a JSON.stringify comparison, so a field missing from
// this type is a field the UI silently drops.
type Settings = VantageSettings

type LLMProviderInfo = {
  name: string
  displayName: string
  available: boolean
  defaultModel: string
  candidateModels: string[]
}

type LLMResolution = {
  generate: { provider: string; model: string }[]
  audit: { provider: string; model: string }[]
}

/** The two AI tasks, and which settings keys drive each. */
const LLM_TASKS = [
  {
    task: 'generate' as const,
    providerKey: 'llm_provider_generate' as const,
    modelKey: 'llm_model_generate' as const,
    label: 'Content generation (Kuze)',
  },
  {
    task: 'audit' as const,
    providerKey: 'llm_provider_audit' as const,
    modelKey: 'llm_model_audit' as const,
    label: 'Compliance audit (Ilita)',
  },
]

type ProductProfile = {
  default_product_id: string
  product_base_url: string
  default_brand_id: string
  default_demoforge_template_id: string
  default_brand_kit_id: string
  bio_link_url: string
}

export function SettingsPage() {
  const [settings, setSettings]   = React.useState<Settings | null>(null)
  const [draft, setDraft]         = React.useState<Settings | null>(null)
  const [providers, setProviders] = React.useState<LLMProviderInfo[]>([])
  const [profile, setProfile]     = React.useState<ProductProfile | null>(null)
  const [profileDraft, setProfileDraft] = React.useState<ProductProfile | null>(null)
  const [saving, setSaving]       = React.useState(false)
  const [savingProfile, setSavingProfile] = React.useState(false)
  const [saved, setSaved]         = React.useState(false)
  const [profileSaved, setProfileSaved] = React.useState(false)
  const [brandKits, setBrandKits] = React.useState<BrandKitRecord[]>([])
  const [resolution, setResolution] = React.useState<LLMResolution | null>(null)
  const [err, setErr]             = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const [r, p, pp, kits, res] = await Promise.all([
        vantageApi.getSettings(),
        vantageApi.listLLMProviders().catch(() => ({ providers: [] as LLMProviderInfo[] })),
        vantageApi.getProductProfile().catch(() => null),
        vantageApi.listBrandKits().catch(() => ({ kits: [] as BrandKitRecord[] })),
        vantageApi.getLLMResolution().catch(() => null),
      ])
      setSettings(r.settings)
      setDraft(r.settings)
      setProviders(p.providers)
      setBrandKits(kits.kits)
      setResolution(res)
      if (pp?.profile) {
        setProfile(pp.profile as ProductProfile)
        setProfileDraft(pp.profile as ProductProfile)
      }
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
      // The chain is derived server-side from what we just saved — refetch so the
      // displayed failover order reflects the new settings rather than the old ones.
      setResolution(await vantageApi.getLLMResolution().catch(() => null))
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
  const profileDirty = JSON.stringify(profileDraft) !== JSON.stringify(profile)

  const saveProductProfile = async () => {
    if (!profileDraft) return
    setSavingProfile(true); setErr(null)
    try {
      const r = await vantageApi.patchProductProfile(profileDraft)
      setProfile(r.profile as ProductProfile)
      setProfileDraft(r.profile as ProductProfile)
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 2500)
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setSavingProfile(false)
    }
  }

  return (
    <>
      <div className="vg-page-header">
        <h1 className="vg-page-title">Settings</h1>
        <p className="vg-page-sub">System configuration and environment status</p>
      </div>

      {err && <div className="vg-error" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="vg-stack">

        <BillingPanel />

        <BrandKitsPanel onKitsChange={setBrandKits} />

        {/* ── Product profile (Shift defaults) ───────────────────────────── */}
        <Panel title="Product Profile" titleAccent="amber">
          {!profileDraft ? (
            <p className="vg-empty">Loading…</p>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)', margin: 0, lineHeight: 1.6 }}>
                Workspace defaults for campaign launch and DemoForge (idea → campaign → product profile → channel seed).
              </p>
              {([
                { key: 'default_product_id' as const, label: 'Default product id', hint: 'e.g. shift' },
                { key: 'product_base_url' as const, label: 'Product base URL', hint: 'DemoForge recording URL' },
                { key: 'default_brand_id' as const, label: 'Default brand id', hint: 'Social Kit brand' },
                { key: 'default_demoforge_template_id' as const, label: 'Default DemoForge template', hint: 'Optional template id' },
              ]).map(({ key, label, hint }) => (
                <div key={key}>
                  <label className="vg-label" style={{ display: 'block', marginBottom: 6 }}>{label}</label>
                  <input
                    className="vg-input"
                    value={profileDraft[key]}
                    onChange={(e) => setProfileDraft((prev) => prev ? { ...prev, [key]: e.target.value } : prev)}
                    style={{ width: '100%', maxWidth: 420 }}
                  />
                  <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginTop: 4 }}>{hint}</div>
                </div>
              ))}
              <div>
                <label className="vg-label" style={{ display: 'block', marginBottom: 6 }}>Bio link (TikTok / Instagram)</label>
                <input
                  className="vg-input"
                  value={profileDraft.bio_link_url}
                  onChange={(e) => setProfileDraft((prev) => prev ? { ...prev, bio_link_url: e.target.value } : prev)}
                  placeholder="https://…"
                  style={{ width: '100%', maxWidth: 420 }}
                />
                <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginTop: 4 }}>
                  TikTok and Instagram don't render clickable links in captions, so the destination link
                  can't be appended to those pieces the way it is everywhere else — it has to already be
                  live in the account bio. Set it here to match, and to whatever campaign is currently
                  driving traffic there.
                </div>
                {!profileDraft.bio_link_url.trim() && (profileDraft.product_base_url.trim() || '') && (
                  <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-amber)', marginTop: 4 }}>
                    ⚠ No bio link configured — TikTok and Instagram posts are publishing with nothing to click.
                  </div>
                )}
              </div>
              <div>
                <label className="vg-label" style={{ display: 'block', marginBottom: 6 }}>Default brand kit</label>
                <select
                  className="vg-input"
                  value={profileDraft.default_brand_kit_id}
                  onChange={(e) => setProfileDraft((prev) => prev ? { ...prev, default_brand_kit_id: e.target.value } : prev)}
                  style={{ width: '100%', maxWidth: 420 }}
                >
                  <option value="">— none —</option>
                  {brandKits.map((k) => (
                    <option key={k.id} value={k.id}>{k.name}{k.logo_storage_path ? '' : ' (no logo)'}</option>
                  ))}
                </select>
                <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginTop: 4 }}>
                  Used when DemoForge / campaign launch needs a workspace logo kit
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Button
                  label={savingProfile ? 'Saving…' : profileSaved ? 'Saved ✓' : 'Save product profile'}
                  variant="secondary"
                  size="sm"
                  onClick={() => void saveProductProfile()}
                  disabled={savingProfile || !profileDirty}
                />
                {profileDirty && !savingProfile && (
                  <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-amber)' }}>Unsaved changes</span>
                )}
              </div>
            </div>
          )}
        </Panel>

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
                Choose the provider and model for each AI task. "Inherit default" falls back to
                the server's LLM_POOL_* / LLM_PROVIDER_* environment, then to the task default
                (Kuze → OpenAI, Ilita → Anthropic). A provider is selectable only if its API key
                is configured server-side. If a provider fails mid-run — rate limited, out of
                credits, overloaded — the next one in the chain takes over automatically.
              </p>

              {LLM_TASKS.map(({ task, providerKey, modelKey, label }) => {
                const selected = providers.find((p) => p.name === draft[providerKey])
                const chain = resolution?.[task] ?? []
                const listId = `vg-models-${task}`
                return (
                  <div key={task} style={{ display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 13, color: 'var(--nx-text-1)' }}>{label}</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <select
                          className="vg-input"
                          value={draft[providerKey]}
                          onChange={(e) => patch(providerKey, e.target.value)}
                          style={{ width: 180 }}
                          aria-label={`${label} provider`}
                        >
                          <option value="">Inherit default</option>
                          {providers.map((p) => (
                            <option key={p.name} value={p.name} disabled={!p.available}>
                              {p.displayName}{p.available ? '' : ' — no API key'}
                            </option>
                          ))}
                        </select>
                        {/* A free-text input with suggestions, not a closed <select>: new
                            model ids must be settable without shipping a code change. */}
                        <input
                          className="vg-input"
                          list={listId}
                          value={draft[modelKey]}
                          onChange={(e) => patch(modelKey, e.target.value)}
                          disabled={!draft[providerKey]}
                          placeholder={selected ? `Default — ${selected.defaultModel}` : 'Model'}
                          aria-label={`${label} model`}
                          style={{ width: 180 }}
                        />
                        <datalist id={listId}>
                          {(selected?.candidateModels ?? []).map((m) => (
                            <option key={m} value={m} />
                          ))}
                        </datalist>
                      </div>
                    </div>
                    {chain.length > 0 && (
                      <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)', textAlign: 'right' }}>
                        {isDirty ? 'Saved chain: ' : 'Failover: '}
                        {chain.map((s) => `${s.provider}:${s.model}`).join(' → ')}
                      </div>
                    )}
                  </div>
                )
              })}

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)' }}>
                <input
                  type="checkbox"
                  checked={draft.llm_failover_enabled}
                  onChange={(e) => patch('llm_failover_enabled', e.target.checked)}
                />
                Automatically fail over to the next provider when one is unavailable
              </label>

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
