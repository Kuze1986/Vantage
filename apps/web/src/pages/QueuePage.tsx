import React from 'react'
import { vantageApi } from '../api/vantage'
import { Panel, Badge, DataTable } from '../ds'
import type { BadgeVariant } from '../ds'
import type { ReactNode } from 'react'

export type Piece = {
  id: string
  status: string
  channel_slug: string
  format: string
  content_payload: Record<string, unknown>
  audit_notes: string | null
  audit_iterations: number
  created_at: string
}

const MANUAL_CHANNELS = new Set(['tiktok', 'instagram', 'facebook'])

const STATUS_FILTERS = ['all', 'auditing', 'approved', 'queued', 'published', 'rejected', 'failed'] as const

function statusBadge(status: string): BadgeVariant {
  switch (status) {
    case 'approved':  return 'active'
    case 'auditing':  return 'pending'
    case 'queued':    return 'new'
    case 'published': return 'core'
    case 'rejected':
    case 'failed':    return 'critical'
    default:          return 'default'
  }
}

export function QueuePage() {
  const [pieces, setPieces] = React.useState<Piece[]>([])
  const [filter, setFilter] = React.useState<typeof STATUS_FILTERS[number]>('all')
  const [err, setErr] = React.useState<string | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [busy, setBusy]           = React.useState<string | null>(null)
  const [manualUrl, setManualUrl] = React.useState<Record<string, string>>({})

  const load = React.useCallback(async () => {
    setErr(null)
    try {
      const { pieces } = await vantageApi.getQueue()
      setPieces(pieces)
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const visible = filter === 'all' ? pieces : pieces.filter((p) => p.status === filter)

  const action = async (fn: () => Promise<unknown>, successMsg: string) => {
    setErr(null)
    setMsg(null)
    try {
      await fn()
      setMsg(successMsg)
      await load()
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }

  const counts: Record<string, number> = {}
  for (const p of pieces) counts[p.status] = (counts[p.status] ?? 0) + 1

  const tableRows: Record<string, ReactNode>[] = visible.map((p) => ({
    channel: (
      <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--nx-text-3)' }}>
        {p.channel_slug}
      </span>
    ),
    content: (
      <div>
        <div className="vg-piece-preview">
          {String(p.content_payload?.body ?? p.content_payload?.text ?? p.content_payload?.hook ?? p.content_payload?.title ?? '—')}
        </div>
        {p.audit_notes && (
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginTop: 3 }}>
            Ilita: {p.audit_notes.slice(0, 80)}{p.audit_notes.length > 80 ? '…' : ''}
          </div>
        )}
      </div>
    ),
    status: <Badge label={p.status} variant={statusBadge(p.status)} />,
    iterations: (
      <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)' }}>
        {p.audit_iterations ?? 0}
      </span>
    ),
    created: (
      <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)' }}>
        {new Date(p.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </span>
    ),
    actions: (
      <div className="vg-row">
        {p.status === 'auditing' && (
          <button
            type="button"
            className="nx-btn nx-btn--secondary nx-btn--sm"
            disabled={busy === p.id}
            onClick={() => {
              setBusy(p.id)
              void action(() => vantageApi.audit(p.id), 'Audit complete').finally(() => setBusy(null))
            }}
          >
            {busy === p.id ? '…' : 'Audit'}
          </button>
        )}
        {p.status === 'approved' && (
          <button
            type="button"
            className="nx-btn nx-btn--ghost nx-btn--sm"
            disabled={busy === p.id}
            onClick={() => {
              setBusy(p.id)
              void action(() => vantageApi.schedule(p.id), 'Queued for cadence').finally(() => setBusy(null))
            }}
          >
            Queue
          </button>
        )}
        {(p.status === 'approved' || p.status === 'queued') && MANUAL_CHANNELS.has(p.channel_slug) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 }}>
            <input
              type="url"
              className="vg-input"
              placeholder="Paste post URL after uploading"
              value={manualUrl[p.id] ?? ''}
              onChange={(e) => setManualUrl((prev) => ({ ...prev, [p.id]: e.target.value }))}
              style={{ fontSize: 10, padding: '3px 6px' }}
            />
            <button
              type="button"
              className="nx-btn nx-btn--primary nx-btn--sm"
              disabled={busy === p.id || !manualUrl[p.id]}
              onClick={() => {
                setBusy(p.id)
                void action(
                  () => vantageApi.publish(p.channel_slug, p.id, manualUrl[p.id]),
                  'Manual post recorded',
                ).finally(() => setBusy(null))
              }}
            >
              {busy === p.id ? '…' : 'Mark Published'}
            </button>
          </div>
        )}
        {(p.status === 'approved' || p.status === 'queued') && !MANUAL_CHANNELS.has(p.channel_slug) && (
          <button
            type="button"
            className="nx-btn nx-btn--primary nx-btn--sm"
            disabled={busy === p.id}
            onClick={() => {
              setBusy(p.id)
              void action(() => vantageApi.publish(p.channel_slug, p.id), 'Published').finally(() => setBusy(null))
            }}
          >
            {busy === p.id ? '…' : 'Publish'}
          </button>
        )}
      </div>
    ),
  }))

  return (
    <>
      <div className="vg-page-header">
        <h1 className="vg-page-title">Content Queue</h1>
        <p className="vg-page-sub">Review, audit, and publish generated content</p>
      </div>

      {err && <div className="vg-error" style={{ marginBottom: 16 }}>{err}</div>}
      {msg && <div className="vg-success" style={{ marginBottom: 16 }}>{msg}</div>}

      {/* Filter tabs */}
      <div className="vg-filter-bar">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            className={`vg-filter-tab${filter === s ? ' vg-filter-tab--active' : ''}`}
            onClick={() => setFilter(s)}
          >
            {s}
            {s !== 'all' && counts[s] ? ` (${counts[s]})` : s === 'all' && pieces.length ? ` (${pieces.length})` : ''}
          </button>
        ))}
        <button
          type="button"
          className="vg-filter-tab"
          style={{ marginLeft: 'auto' }}
          onClick={() => void load()}
        >
          ↻ Refresh
        </button>
      </div>

      <Panel title={filter === 'all' ? 'All Content' : `${filter.charAt(0).toUpperCase()}${filter.slice(1)}`}>
        {visible.length === 0 ? (
          <p className="vg-empty">No items in this status</p>
        ) : (
          <DataTable
            columns={[
              { key: 'channel',    label: 'Channel',    width: '90px' },
              { key: 'content',    label: 'Content',    width: '40%' },
              { key: 'status',     label: 'Status',     width: '100px' },
              { key: 'iterations', label: 'Iters',      width: '56px' },
              { key: 'created',    label: 'Created',    width: '130px' },
              { key: 'actions',    label: 'Actions' },
            ]}
            rows={tableRows}
          />
        )}
      </Panel>
    </>
  )
}
