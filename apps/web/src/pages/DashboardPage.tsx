import React from 'react'
import { vantageApi } from '../api/vantage'
import type { DashboardOverview } from '../api/vantage'
import { supabase } from '../lib/supabase'
import { StatCard, Panel, Badge } from '../ds'

type Topic = { id: string; topic_text: string; vertical: string | null; source_product?: string; priority?: number }
type ActivityEvent = DashboardOverview['activityLast24h'][number]

const CHANNEL_SLUGS = ['x', 'linkedin', 'reddit', 'email', 'tiktok', 'instagram', 'facebook'] as const
type ChannelSlug = typeof CHANNEL_SLUGS[number]

const CHANNEL_LABEL: Record<ChannelSlug, string> = {
  x: '𝕏', linkedin: 'in', reddit: 'r/', email: '✉',
  tiktok: '♪', instagram: '◉', facebook: 'f',
}

export function DashboardPage() {
  const [overview, setOverview]   = React.useState<DashboardOverview | null>(null)
  const [topics, setTopics]       = React.useState<Topic[]>([])
  const [err, setErr]             = React.useState<string | null>(null)
  const [msg, setMsg]             = React.useState<string | null>(null)
  const [generating, setGenerating] = React.useState<string | null>(null) // `${topicId}:${channel}`
  const [pulling, setPulling]     = React.useState(false)
  const [pulsing, setPulsing]     = React.useState(false)
  const [genChannel, setGenChannel] = React.useState<ChannelSlug>('x')

  const loadDash = React.useCallback(async () => {
    try {
      setOverview(await vantageApi.dashboardOverview())
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }, [])

  const loadTopics = React.useCallback(async () => {
    try {
      const r = await vantageApi.getTopics(50) as { topics: Topic[] }
      setTopics(r.topics ?? [])
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }, [])

  React.useEffect(() => { void loadDash(); void loadTopics() }, [loadDash, loadTopics])

  React.useEffect(() => {
    const ch = supabase
      .channel('vantage-activity-dash')
      .on('postgres_changes', { event: 'INSERT', schema: 'vantage', table: 'activity_events' }, (payload) => {
        setOverview((prev) => {
          if (!prev) return prev
          const ev = payload.new as ActivityEvent
          return { ...prev, activityLast24h: [ev, ...prev.activityLast24h].slice(0, 60) }
        })
      })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [])

  const handlePullTopics = async () => {
    setPulling(true); setErr(null); setMsg(null)
    try {
      const r = await vantageApi.refreshSource()
      const { shift, scripta } = r
      setMsg(`Topics refreshed — Shift: +${shift.inserted}, Scripta: +${scripta.inserted}`)
      await loadTopics(); await loadDash()
    } catch (e) { setErr(String((e as Error).message)) }
    finally { setPulling(false) }
  }

  const handlePulseScan = async () => {
    setPulsing(true); setErr(null); setMsg(null)
    try {
      const r = await vantageApi.pulseScan()
      setMsg(`Pulse scan complete — ${r.inserted} new signals from ${r.scanned} scanned`)
      await loadTopics(); await loadDash()
    } catch (e) { setErr(String((e as Error).message)) }
    finally { setPulsing(false) }
  }

  const handleGenerate = async (topicId: string) => {
    const key = `${topicId}:${genChannel}`
    setGenerating(key); setErr(null); setMsg(null)
    try {
      await vantageApi.generate(genChannel, topicId)
      setMsg(`Draft created for ${genChannel} — check Queue to audit`)
      await loadDash()
    } catch (e) { setErr(String((e as Error).message)) }
    finally { setGenerating(null) }
  }

  const queueDepth    = overview?.queueDepth ?? {}
  const publishedToday = overview?.publishedToday ?? {}
  const activity       = overview?.activityLast24h ?? []
  const channelStatus  = overview?.channelStatus ?? []

  const totalActive = Object.values(queueDepth).reduce((s, v) => s + v, 0)
  const totalQueued = (queueDepth['queued'] ?? 0) + (queueDepth['approved'] ?? 0)
  const publishedTodayTotal = Object.values(publishedToday).reduce((s, v) => s + v, 0)

  return (
    <>
      <div className="vg-page-header">
        <h1 className="vg-page-title">Dashboard</h1>
        <p className="vg-page-sub">Automated marketing pipeline — live status</p>
      </div>

      {err && <div className="vg-error" style={{ marginBottom: 16 }}>{err}</div>}
      {msg && <div className="vg-success" style={{ marginBottom: 16 }}>{msg}</div>}

      <div className="vg-stats">
        <StatCard
          label="Published Today"
          value={publishedTodayTotal}
          accent="green"
          fillPercent={Math.min(100, (publishedTodayTotal / Math.max(1, channelStatus.reduce((s, c) => s + c.posts_per_day, 0))) * 100)}
        />
        <StatCard
          label="Auditing"
          value={queueDepth['auditing'] ?? '—'}
          accent="cyan"
          fillPercent={totalActive ? ((queueDepth['auditing'] ?? 0) / totalActive) * 100 : 0}
        />
        <StatCard
          label="Ready to Post"
          value={totalQueued}
          accent="amber"
          fillPercent={totalActive ? (totalQueued / totalActive) * 100 : 0}
        />
        <StatCard
          label="Topics Available"
          value={topics.length}
          accent="none"
          fillPercent={Math.min(100, (topics.length / 50) * 100)}
        />
      </div>

      <div className="vg-grid-60-40">
        {/* Source pipeline */}
        <Panel
          title="Source Pipeline"
          titleAccent="amber"
          action={{ label: pulling ? 'Pulling…' : 'Pull Topics', onClick: () => void handlePullTopics() }}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <button
              type="button"
              className="nx-btn nx-btn--ghost nx-btn--sm"
              disabled={pulsing}
              onClick={() => void handlePulseScan()}
              title="Scan HN, Reddit, and news for trending external signals"
              style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.06em' }}
            >
              {pulsing ? '⚡ Scanning…' : '⚡ Pulse Reactor'}
            </button>
          </div>
          {/* Channel selector for generation */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)', alignSelf: 'center', marginRight: 2 }}>
              GEN FOR
            </span>
            {CHANNEL_SLUGS.map((slug) => (
              <button
                key={slug}
                type="button"
                onClick={() => setGenChannel(slug)}
                style={{
                  fontFamily: 'var(--nx-mono)',
                  fontSize: 10,
                  padding: '2px 8px',
                  border: `1px solid ${genChannel === slug ? 'var(--nx-amber)' : 'var(--nx-border)'}`,
                  borderRadius: 4,
                  background: genChannel === slug ? 'rgba(245,158,11,0.12)' : 'transparent',
                  color: genChannel === slug ? 'var(--nx-amber)' : 'var(--nx-text-3)',
                  cursor: 'pointer',
                }}
              >
                {CHANNEL_LABEL[slug]}
              </button>
            ))}
          </div>

          {topics.length === 0 ? (
            <p className="vg-empty">No topics loaded — pull from Shift to begin</p>
          ) : (
            <div className="vg-topic-list">
              {topics.map((t) => {
                const key = `${t.id}:${genChannel}`
                return (
                  <div key={t.id} className="vg-topic-item">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="vg-topic-text">
                        {t.topic_text.slice(0, 160)}{t.topic_text.length > 160 ? '…' : ''}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                        {t.vertical && <div className="vg-topic-vert">{t.vertical}</div>}
                        {t.source_product === 'pulse' && (
                          <div className="vg-topic-vert" style={{ color: 'var(--nx-cyan)', borderColor: 'var(--nx-cyan)' }}>⚡ pulse</div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="nx-btn nx-btn--secondary nx-btn--sm"
                      style={{ flexShrink: 0 }}
                      disabled={generating === key}
                      onClick={() => void handleGenerate(t.id)}
                    >
                      {generating === key ? '…' : `Gen ${CHANNEL_LABEL[genChannel]}`}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>

        {/* Activity feed */}
        <Panel title="Live Activity" titleAccent="cyan">
          {activity.length === 0 ? (
            <p className="vg-empty">No activity yet</p>
          ) : (
            <div className="vg-activity">
              {activity.map((a) => (
                <div key={a.id} className="vg-activity-item">
                  <div className="vg-activity-meta">
                    <span className="vg-activity-source">{a.source}</span>
                    <span className="vg-activity-time">
                      {new Date(a.occurred_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="vg-activity-summary">{a.summary}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Channel cadence overview */}
      {channelStatus.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Panel title="Channel Cadence">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
              {channelStatus.map((ch) => (
                <div
                  key={ch.slug}
                  style={{
                    background: 'var(--nx-surface-2)',
                    border: '1px solid var(--nx-border)',
                    borderRadius: 6,
                    padding: '8px 10px',
                  }}
                >
                  <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-3)', marginBottom: 4 }}>
                    {ch.slug}
                  </div>
                  <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 18, color: ch.connected ? 'var(--nx-amber)' : 'var(--nx-text-4)', fontWeight: 700 }}>
                    {publishedToday[ch.slug] ?? 0}
                    <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--nx-text-4)' }}>
                      /{ch.posts_per_day}
                    </span>
                  </div>
                  <Badge
                    label={ch.connected ? 'live' : 'off'}
                    variant={ch.connected && ch.enabled ? 'active' : 'default'}
                  />
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {/* Queue breakdown */}
      {Object.keys(queueDepth).length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Panel title="Queue Breakdown">
            <div className="vg-row">
              {Object.entries(queueDepth).map(([status, count]) => (
                <span key={status} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Badge
                    label={status}
                    variant={
                      status === 'approved' ? 'active'
                      : status === 'auditing' ? 'pending'
                      : status === 'rejected' || status === 'failed' ? 'critical'
                      : status === 'queued' ? 'new'
                      : 'default'
                    }
                  />
                  <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 12, color: 'var(--nx-text-1)', fontWeight: 700 }}>
                    {count}
                  </span>
                </span>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </>
  )
}
