import React from 'react'
import { vantageApi } from '../api/vantage'
import type { ChannelStatus, Subscriber } from '../api/vantage'
import { Panel, ModeTile, Badge, Button } from '../ds'

/** Presentation only — icon, accent and copy. How a channel authenticates is NOT
 *  decided here: the API derives `auth_method` / `supports_oauth` from
 *  MANUAL_PUBLISH_CHANNELS (api/src/lib/channel-auth.ts) and sends them on each row.
 *  A hard-coded copy here once let this page call a channel "manual" while the
 *  publish path was posting to it automatically. */
const CHANNEL_META: Record<string, {
  icon: string
  accent: 'amber' | 'cyan' | 'green' | 'red' | 'gold'
  description: string
  meta: string[]
}> = {
  x:         { icon: '𝕏',  accent: 'cyan',  description: 'Post tweets and threads. OAuth 2.0 PKCE.', meta: ['OAuth 2.0', 'API v2'] },
  linkedin:  { icon: 'in', accent: 'cyan',  description: 'Publish professional posts and articles.', meta: ['OAuth 2.0', 'UGC Posts'] },
  reddit:    { icon: 'r/', accent: 'amber', description: 'Vantage picks the subreddit and writes the post; you paste it. Reddit blocks server posting.', meta: ['Manual post', 'Subreddit targeting'] },
  threads:   { icon: '@',  accent: 'cyan',  description: 'Publish text posts to Threads. Meta Graph API.', meta: ['OAuth 2.0', 'Text posts'] },
  bluesky:   { icon: '🦋', accent: 'cyan',  description: 'Post to Bluesky via AT Protocol. App password.', meta: ['App password', 'AT Protocol'] },
  email:     { icon: '✉',  accent: 'green', description: 'Newsletter via Resend. HTML email.', meta: ['Resend API', 'HTML email'] },
  tiktok:    { icon: '♪',  accent: 'red',   description: 'Publish videos via the Content Posting API.', meta: ['OAuth 2.0 PKCE', 'Content Posting API'] },
  instagram: { icon: '◉',  accent: 'gold',  description: 'Publish Reels and images via the Graph API.', meta: ['Facebook Login', 'Graph API'] },
  facebook:  { icon: 'f',  accent: 'amber', description: 'Publish to your Facebook Page via the Graph API.', meta: ['Facebook Login', 'Graph API'] },
}

const CHANNEL_ORDER = ['x', 'linkedin', 'reddit', 'threads', 'bluesky', 'email', 'tiktok', 'instagram', 'facebook']

/** Mirrors DEFAULT_POSTING_HOURS in apps/api/src/lib/posting-hours.ts — shown as the
 *  placeholder for a channel with no configured hours. The API is authoritative. */
const DEFAULT_POSTING_HOURS = [9, 12, 17]

function CadenceForm({ slug, config, onSave }: {
  slug: string
  config: ChannelStatus['cadence_config']
  onSave: (patch: Partial<ChannelStatus['cadence_config']>) => Promise<void>
}) {
  const [postsPerDay, setPostsPerDay]   = React.useState(String(config.posts_per_day ?? 0))
  const [autoApprove, setAutoApprove]   = React.useState(config.auto_approve ?? false)
  const [hours, setHours]               = React.useState((config.posting_hours ?? DEFAULT_POSTING_HOURS).join(', '))
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

function BlueskyConnectForm({ onConnect }: { onConnect: (handle: string, appPassword: string) => Promise<void> }) {
  const [handle, setHandle]         = React.useState('')
  const [appPassword, setAppPassword] = React.useState('')
  const [busy, setBusy]             = React.useState(false)

  const submit = async () => {
    if (!handle.trim() || !appPassword.trim()) return
    setBusy(true)
    try {
      await onConnect(handle.trim(), appPassword.trim())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input
        type="text"
        className="vg-input"
        placeholder="handle.bsky.social"
        value={handle}
        onChange={(e) => setHandle(e.target.value)}
        autoComplete="off"
      />
      <input
        type="password"
        className="vg-input"
        placeholder="App password (Settings → App Passwords)"
        value={appPassword}
        onChange={(e) => setAppPassword(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
        autoComplete="off"
      />
      <Button
        label={busy ? 'Connecting…' : 'Connect Bluesky'}
        variant="secondary"
        size="sm"
        onClick={() => void submit()}
        disabled={busy || !handle.trim() || !appPassword.trim()}
      />
      <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', margin: 0 }}>
        Use an app password, not your main password. Create one at bsky.app → Settings → App Passwords.
      </p>
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

  const connectBluesky = async (handle: string, appPassword: string) => {
    setErr(null)
    try {
      const { handle: connectedHandle } = await vantageApi.connectBluesky(handle, appPassword)
      setMsg(`Bluesky connected as @${connectedHandle}`)
      await load()
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setErr(String((e as Error).message))
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
    // The API is authoritative for auth_method / supports_oauth. Until a row
    // loads we treat the channel as OAuth-but-not-yet-connectable, so no
    // Connect button flashes before we know whether it earns one.
    return {
      slug,
      meta,
      row: row ?? null,
      connected: row?.connected ?? false,
      authMethod: row?.auth_method ?? 'oauth',
      supportsOAuth: row?.supports_oauth ?? false,
    }
  }).filter(Boolean) as Array<{
    slug: string
    meta: typeof CHANNEL_META[string]
    row: ChannelStatus | null
    connected: boolean
    authMethod: 'oauth' | 'api_key' | 'manual'
    supportsOAuth: boolean
  }>

  const apiChannels    = liveChannels.filter((c) => c.authMethod !== 'manual')
  const manualChannels = liveChannels.filter((c) => c.authMethod === 'manual')
  // Counted over apiChannels only — a manual channel has nothing to connect, so
  // including it in the denominator would leave the header permanently short.
  const connectedCount = apiChannels.filter((c) => c.connected).length

  return (
    <>
      <div className="vg-page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="vg-page-title">Channels</h1>
          <p className="vg-page-sub">Connect distribution channels and configure posting cadence</p>
        </div>
        <Badge
          label={`${connectedCount} / ${apiChannels.length} connected`}
          variant={connectedCount > 0 ? 'active' : 'soon'}
        />
      </div>

      {err && <div className="vg-error" style={{ marginBottom: 16 }}>{err}</div>}
      {msg && <div className="vg-success" style={{ marginBottom: 16 }}>{msg}</div>}

      <Panel title="API Channels" titleAccent="amber">
        <div className="vg-channel-grid">
          {apiChannels.map(({ slug, meta, row, connected, supportsOAuth }) => (
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
              {supportsOAuth && !connected && (
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
              {supportsOAuth && connected && (
                <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)', marginTop: 6, textAlign: 'center' }}>
                  ✓ Connected — click tile to configure cadence
                </p>
              )}

              {/* Bluesky credential connect form */}
              {slug === 'bluesky' && !connected && (
                <BlueskyConnectForm onConnect={connectBluesky} />
              )}
              {slug === 'bluesky' && connected && (
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
