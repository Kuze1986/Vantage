import React from 'react'
import { vantageApi } from '../api/vantage'
import type { ChannelStatus, Subscriber } from '../api/vantage'
import { Panel, ModeTile, Badge, Button } from '../ds'

const CHANNEL_META: Record<string, {
  icon: string
  accent: 'amber' | 'cyan' | 'green' | 'red' | 'gold'
  description: string
  meta: string[]
  authMethod: 'oauth' | 'api_key' | 'manual'
}> = {
  x:         { icon: '𝕏',  accent: 'cyan',  description: 'Post tweets and threads. OAuth 2.0 PKCE.', meta: ['OAuth 2.0', 'API v2'], authMethod: 'oauth' },
  linkedin:  { icon: 'in', accent: 'cyan',  description: 'Publish professional posts and articles.', meta: ['OAuth 2.0', 'UGC Posts'], authMethod: 'oauth' },
  reddit:    { icon: 'r/', accent: 'amber', description: 'Post to subreddits with subreddit-aware cadence.', meta: ['OAuth 2.0', 'Subreddit targeting'], authMethod: 'oauth' },
  email:     { icon: '✉',  accent: 'green', description: 'Newsletter via Resend. HTML email.', meta: ['Resend API', 'HTML email'], authMethod: 'api_key' },
  tiktok:    { icon: '♪',  accent: 'red',   description: 'Script queue for one-click manual upload.', meta: ['Manual post', 'Video queue'], authMethod: 'manual' },
  instagram: { icon: '◉',  accent: 'gold',  description: 'Caption queue for manual Instagram upload.', meta: ['Manual post', 'Reels queue'], authMethod: 'manual' },
  facebook:  { icon: 'f',  accent: 'amber', description: 'Queue for manual Facebook Page publishing.', meta: ['Manual post'], authMethod: 'manual' },
}

const CHANNEL_ORDER = ['x', 'linkedin', 'reddit', 'email', 'tiktok', 'instagram', 'facebook']
const OAUTH_CHANNELS = ['x', 'linkedin', 'reddit']

function CadenceForm({ slug, config, onSave }: {
  slug: string
  config: ChannelStatus['cadence_config']
  onSave: (patch: Partial<ChannelStatus['cadence_config']>) => Promise<void>
}) {
  const [postsPerDay, setPostsPerDay]   = React.useState(String(config.posts_per_day ?? 0))
  const [autoApprove, setAutoApprove]   = React.useState(config.auto_approve ?? false)
  const [hours, setHours]               = React.useState((config.posting_hours ?? [9, 12, 17]).join(', '))
  const [subreddits, setSubreddits]     = React.useState((config.subreddits ?? []).join(', '))
  const [saving, setSaving]             = React.useState(false)
  const [saved, setSaved]               = React.useState(false)

  const handleSave = async () => {
    setSaving(true)
    const patch: Partial<ChannelStatus['cadence_config']> = {
      posts_per_day: parseInt(postsPerDay, 10) || 0,
      auto_approve:  autoApprove,
      posting_hours: hours.split(',').map((h) => parseInt(h.trim(), 10)).filter((n) => !isNaN(n) && n >= 0 && n <= 23),
    }
    if (slug === 'reddit') {
      patch.subreddits = subreddits.split(',').map((s) => s.trim()).filter(Boolean)
    }
    await onSave(patch)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    setSaving(false)
  }

  return (
    <div className="vg-cadence-form" style={{ marginTop: 10, borderTop: '1px solid var(--nx-border)', paddingTop: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <div className="vg-field">
          <label className="vg-label">Posts/day</label>
          <input
            type="number"
            className="vg-input"
            min={0} max={20}
            value={postsPerDay}
            onChange={(e) => setPostsPerDay(e.target.value)}
          />
        </div>
        <div className="vg-field">
          <label className="vg-label">UTC hours (comma-separated)</label>
          <input
            type="text"
            className="vg-input"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="9, 12, 17"
          />
        </div>
      </div>
      {slug === 'reddit' && (
        <div className="vg-field" style={{ marginBottom: 8 }}>
          <label className="vg-label">Subreddits (comma-separated)</label>
          <input
            type="text"
            className="vg-input"
            value={subreddits}
            onChange={(e) => setSubreddits(e.target.value)}
            placeholder="learnpython, webdev"
          />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-2)' }}>
          <input
            type="checkbox"
            checked={autoApprove}
            onChange={(e) => setAutoApprove(e.target.checked)}
            style={{ accentColor: 'var(--nx-amber)', width: 14, height: 14 }}
          />
          Auto-approve &amp; queue (Ilita must pass)
        </label>
      </div>
      <Button
        label={saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Cadence'}
        variant="secondary"
        size="sm"
        onClick={() => void handleSave()}
        disabled={saving}
      />
    </div>
  )
}

function SubscribersPanel() {
  const [subscribers, setSubscribers] = React.useState<Subscriber[]>([])
  const [email, setEmail]             = React.useState('')
  const [name, setName]               = React.useState('')
  const [adding, setAdding]           = React.useState(false)
  const [err, setErr]                 = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const r = await vantageApi.listSubscribers()
      setSubscribers(r.subscribers)
    } catch (e) { setErr(String((e as Error).message)) }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const handleAdd = async () => {
    if (!email.trim()) return
    setAdding(true); setErr(null)
    try {
      await vantageApi.addSubscriber(email.trim(), name.trim() || undefined)
      setEmail(''); setName('')
      await load()
    } catch (e) { setErr(String((e as Error).message)) }
    finally { setAdding(false) }
  }

  const handleRemove = async (id: string) => {
    try {
      await vantageApi.removeSubscriber(id)
      await load()
    } catch (e) { setErr(String((e as Error).message)) }
  }

  const active = subscribers.filter((s) => !s.unsubscribed_at)
  const inactive = subscribers.filter((s) => s.unsubscribed_at)

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--nx-border)', paddingTop: 12 }}>
      <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-3)', letterSpacing: '0.08em', marginBottom: 8 }}>
        NEWSLETTER SUBSCRIBERS — {active.length} active{inactive.length > 0 ? `, ${inactive.length} unsubscribed` : ''}
      </div>
      {err && <div className="vg-error" style={{ marginBottom: 8, fontSize: 11 }}>{err}</div>}

      {/* Add subscriber */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input
          type="email"
          className="vg-input"
          placeholder="email@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
          style={{ flex: 2 }}
        />
        <input
          type="text"
          className="vg-input"
          placeholder="Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button
          label={adding ? '…' : '+ Add'}
          variant="secondary"
          size="sm"
          onClick={() => void handleAdd()}
          disabled={adding || !email.trim()}
        />
      </div>

      {/* Subscriber list */}
      {active.length === 0 ? (
        <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)' }}>No active subscribers yet</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
          {active.map((s) => (
            <div
              key={s.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '4px 8px', background: 'var(--nx-surface-2)',
                borderRadius: 4, border: '1px solid var(--nx-border)',
              }}
            >
              <div>
                <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-1)' }}>{s.email}</span>
                {s.name && <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)', marginLeft: 8 }}>{s.name}</span>}
              </div>
              <button
                type="button"
                onClick={() => void handleRemove(s.id)}
                style={{
                  fontFamily: 'var(--nx-mono)', fontSize: 10, background: 'none',
                  border: 'none', color: 'var(--nx-text-4)', cursor: 'pointer', padding: '2px 4px',
                }}
                title="Unsubscribe"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ChannelsPage() {
  const [channels, setChannels] = React.useState<ChannelStatus[]>([])
  const [expanded, setExpanded] = React.useState<string | null>(null)
  const [err, setErr]           = React.useState<string | null>(null)
  const [msg, setMsg]           = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const r = await vantageApi.listChannels()
      setChannels(r.channels)
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const connectOAuth = async (slug: string) => {
    setErr(null)
    try {
      const { authorize_url } = await vantageApi.startOAuth(slug)
      window.location.href = authorize_url
    } catch (e) {
      const msg = String((e as Error).message)
      // 503 means env vars aren't set — surface the setup instructions directly
      if (msg.includes('not configured') || msg.includes('Missing')) {
        setErr(msg)
      } else {
        setErr(`OAuth failed for ${slug}: ${msg}`)
      }
    }
  }

  const saveCadence = async (slug: string, patch: Partial<ChannelStatus['cadence_config']>) => {
    setErr(null)
    try {
      await vantageApi.updateCadence(slug, patch)
      setMsg(`Cadence updated for ${slug}`)
      await load()
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }

  const channelMap = Object.fromEntries(channels.map((c) => [c.slug, c]))

  const liveChannels = CHANNEL_ORDER.map((slug) => {
    const row  = channelMap[slug]
    const meta = CHANNEL_META[slug]
    if (!meta) return null
    return { slug, meta, row: row ?? null, connected: row?.connected ?? false }
  }).filter(Boolean) as Array<{
    slug: string
    meta: typeof CHANNEL_META[string]
    row: ChannelStatus | null
    connected: boolean
  }>

  const connectedCount = liveChannels.filter((c) => c.connected).length
  const apiChannels    = liveChannels.filter((c) => c.meta.authMethod !== 'manual')
  const manualChannels = liveChannels.filter((c) => c.meta.authMethod === 'manual')

  return (
    <>
      <div className="vg-page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="vg-page-title">Channels</h1>
          <p className="vg-page-sub">Connect distribution channels and configure posting cadence</p>
        </div>
        <Badge
          label={`${connectedCount} / ${liveChannels.length} connected`}
          variant={connectedCount > 0 ? 'active' : 'soon'}
        />
      </div>

      {err && <div className="vg-error" style={{ marginBottom: 16 }}>{err}</div>}
      {msg && <div className="vg-success" style={{ marginBottom: 16 }}>{msg}</div>}

      <Panel title="API Channels" titleAccent="amber">
        <div className="vg-channel-grid">
          {apiChannels.map(({ slug, meta, row, connected }) => (
            <div key={slug} style={{ display: 'flex', flexDirection: 'column' }}>
              <ModeTile
                name={slug.toUpperCase()}
                description={meta.description}
                icon={meta.icon}
                accent={meta.accent}
                meta={meta.meta}
                badge={connected
                  ? { label: 'Connected', variant: 'active' }
                  : { label: 'Not connected', variant: 'soon' }
                }
                onClick={() => setExpanded(expanded === slug ? null : slug)}
              />

              {/* OAuth connect button for OAuth channels */}
              {meta.authMethod === 'oauth' && OAUTH_CHANNELS.includes(slug) && !connected && (
                <button
                  type="button"
                  className="nx-btn nx-btn--secondary nx-btn--sm nx-btn--full"
                  style={{ marginTop: 6 }}
                  onClick={() => void connectOAuth(slug)}
                  title={`Connect ${slug} via OAuth 2.0`}
                >
                  Connect {slug === 'x' ? '𝕏' : slug} via OAuth
                </button>
              )}
              {/* Already connected — show disconnect hint */}
              {meta.authMethod === 'oauth' && OAUTH_CHANNELS.includes(slug) && connected && (
                <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)', marginTop: 6, textAlign: 'center' }}>
                  ✓ Connected — click tile to configure cadence
                </p>
              )}

              {/* Cadence config (expandable) */}
              {expanded === slug && row && (
                <>
                  <CadenceForm
                    slug={slug}
                    config={row.cadence_config}
                    onSave={(patch) => saveCadence(slug, patch)}
                  />
                  {slug === 'email' && <SubscribersPanel />}
                </>
              )}
              {expanded === slug && !row && (
                <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)', marginTop: 8 }}>
                  Channel not found in database — run the migration to add it.
                </p>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <div style={{ marginTop: 16 }}>
        <Panel title="Manual Post Queue" titleAccent="cyan">
          <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)', marginTop: 0, marginBottom: 12, letterSpacing: '0.04em' }}>
            Vantage generates scripts and captions, packaged for one-click manual upload.
          </p>
          <div className="vg-channel-grid">
            {manualChannels.map(({ slug, meta, row }) => (
              <div key={slug} style={{ display: 'flex', flexDirection: 'column' }}>
                <ModeTile
                  name={slug.charAt(0).toUpperCase() + slug.slice(1)}
                  description={meta.description}
                  icon={meta.icon}
                  accent={meta.accent}
                  meta={meta.meta}
                  badge={{ label: 'Queue only', variant: 'default' }}
                  onClick={() => setExpanded(expanded === slug ? null : slug)}
                />
                {expanded === slug && row && (
                  <CadenceForm
                    slug={slug}
                    config={row.cadence_config}
                    onSave={(patch) => saveCadence(slug, patch)}
                  />
                )}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  )
}
