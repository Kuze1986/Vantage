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
  image_url?: string | null
  variant_group_id?: string | null
  retry_count?: number
  retry_after?: string | null
}

const MANUAL_CHANNELS = new Set(['tiktok', 'instagram', 'facebook'])
const VIDEO_FORMATS   = new Set(['tiktok_script', 'instagram_caption', 'facebook_post'])

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

// ── Video script panel for manual channels ────────────────────────────────────
function VideoScriptPanel({ piece }: { piece: Piece }) {
  const cp = piece.content_payload
  const [copied, setCopied] = React.useState(false)

  const copyText = [
    cp.hook        ? `HOOK:\n${String(cp.hook)}`                         : '',
    cp.script      ? `SCRIPT:\n${String(cp.script)}`                     : '',
    cp.caption     ? `CAPTION:\n${String(cp.caption)}`                   : '',
    cp.text        ? `TEXT:\n${String(cp.text)}`                         : '',
    cp.on_screen_text ? `ON-SCREEN:\n${String(cp.on_screen_text)}`       : '',
    cp.hashtags && Array.isArray(cp.hashtags) ? `\nHASHTAGS:\n${(cp.hashtags as string[]).join(' ')}` : '',
    cp.instructions ? `\nINSTRUCTIONS:\n${String(cp.instructions)}`      : '',
  ].filter(Boolean).join('\n\n')

  const handleCopy = () => {
    void navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--nx-surface-2)', borderRadius: 6, border: '1px solid var(--nx-border)' }}>
      {cp.hook && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-amber)', letterSpacing: '0.1em', marginBottom: 2 }}>HOOK</div>
          <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 12, color: 'var(--nx-text-1)' }}>{String(cp.hook)}</div>
        </div>
      )}
      {cp.script && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-cyan)', letterSpacing: '0.1em', marginBottom: 2 }}>SCRIPT</div>
          <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 11, color: 'var(--nx-text-2)', whiteSpace: 'pre-wrap' }}>{String(cp.script)}</div>
        </div>
      )}
      {cp.on_screen_text && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', letterSpacing: '0.1em', marginBottom: 2 }}>ON-SCREEN TEXT</div>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-2)' }}>{String(cp.on_screen_text)}</div>
        </div>
      )}
      {cp.hashtags && Array.isArray(cp.hashtags) && (cp.hashtags as string[]).length > 0 && (
        <div style={{ marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(cp.hashtags as string[]).map((h) => (
            <span key={h} style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-cyan)', background: 'rgba(6,182,212,0.08)', padding: '1px 6px', borderRadius: 4 }}>
              {h.startsWith('#') ? h : `#${h}`}
            </span>
          ))}
        </div>
      )}
      {cp.instructions && (
        <div style={{ borderTop: '1px solid var(--nx-border)', paddingTop: 6, marginTop: 6 }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', letterSpacing: '0.1em', marginBottom: 2 }}>UPLOAD INSTRUCTIONS</div>
          <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 11, color: 'var(--nx-text-3)' }}>{String(cp.instructions)}</div>
        </div>
      )}
      <button
        type="button"
        onClick={handleCopy}
        style={{
          marginTop: 8, fontFamily: 'var(--nx-mono)', fontSize: 10, padding: '3px 10px',
          background: 'none', border: '1px solid var(--nx-border)', borderRadius: 4,
          color: copied ? 'var(--nx-green, #22c55e)' : 'var(--nx-text-3)', cursor: 'pointer',
        }}
      >
        {copied ? '✓ Copied' : '⎘ Copy script'}
      </button>
    </div>
  )
}

// ── Image preview ─────────────────────────────────────────────────────────────
function ImagePreview({ url }: { url: string }) {
  return (
    <div style={{ marginTop: 6 }}>
      <img
        src={url}
        alt="Generated"
        style={{ width: '100%', maxWidth: 200, borderRadius: 4, border: '1px solid var(--nx-border)' }}
        loading="lazy"
      />
    </div>
  )
}

export function QueuePage() {
  const [pieces, setPieces] = React.useState<Piece[]>([])
  const [filter, setFilter] = React.useState<typeof STATUS_FILTERS[number]>('all')
  const [err, setErr] = React.useState<string | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [busy, setBusy]           = React.useState<string | null>(null)
  const [manualUrl, setManualUrl] = React.useState<Record<string, string>>({})
  const [expandedScript, setExpandedScript] = React.useState<Set<string>>(new Set())

  const load = React.useCallback(async () => {
    setErr(null)
    try {
      const { pieces } = await vantageApi.getQueue()
      // Fetch also includes variant_group_id and image_url via the view now
      setPieces(pieces as Piece[])
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

  const toggleScript = (id: string) =>
    setExpandedScript((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const counts: Record<string, number> = {}
  for (const p of pieces) counts[p.status] = (counts[p.status] ?? 0) + 1

  // Group variants so they render together
  const variantGroups = new Map<string, Piece[]>()
  for (const p of visible) {
    if (p.variant_group_id) {
      const g = variantGroups.get(p.variant_group_id) ?? []
      g.push(p)
      variantGroups.set(p.variant_group_id, g)
    }
  }

  const tableRows: Record<string, ReactNode>[] = visible.map((p) => ({
    channel: (
      <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--nx-text-3)' }}>
        {p.channel_slug}
        {p.variant_group_id && (
          <span style={{ display: 'block', fontSize: 8, color: 'var(--nx-amber)', marginTop: 1 }}>A/B</span>
        )}
      </span>
    ),
    content: (
      <div>
        <div className="vg-piece-preview">
          {String(p.content_payload?.body ?? p.content_payload?.text ?? p.content_payload?.hook ?? p.content_payload?.title ?? p.content_payload?.caption ?? '—')}
        </div>
        {p.audit_notes && (
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginTop: 3 }}>
            Ilita: {p.audit_notes.slice(0, 80)}{p.audit_notes.length > 80 ? '…' : ''}
          </div>
        )}
        {/* Image preview */}
        {p.image_url && <ImagePreview url={p.image_url} />}
        {/* Video script expand */}
        {VIDEO_FORMATS.has(p.format) && (
          <>
            <button
              type="button"
              onClick={() => toggleScript(p.id)}
              style={{
                marginTop: 4, fontFamily: 'var(--nx-mono)', fontSize: 9, background: 'none',
                border: 'none', color: 'var(--nx-text-4)', cursor: 'pointer', padding: 0,
              }}
            >
              {expandedScript.has(p.id) ? '▲ Hide script' : '▼ Show script'}
            </button>
            {expandedScript.has(p.id) && <VideoScriptPanel piece={p} />}
          </>
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
        {/* 3A-6: Retry button for permanently-failed pieces */}
        {p.status === 'failed' && (
          <div>
            <button
              type="button"
              className="nx-btn nx-btn--ghost nx-btn--sm"
              disabled={busy === p.id}
              onClick={() => {
                setBusy(p.id)
                void action(() => vantageApi.retryPiece(p.id), 'Re-queued for retry').finally(() => setBusy(null))
              }}
              title="Reset retry counter and re-queue this piece for immediate publish attempt"
            >
              {busy === p.id ? '…' : '↺ Retry'}
            </button>
            {(p.retry_count ?? 0) > 0 && (
              <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 8, color: 'var(--nx-text-4)', marginTop: 2 }}>
                {p.retry_count} auto-retry{(p.retry_count ?? 0) !== 1 ? 's' : ''} attempted
              </div>
            )}
          </div>
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

      {/* A/B variant groups notice */}
      {variantGroups.size > 0 && (
        <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-amber)', marginBottom: 8 }}>
          {variantGroups.size} A/B variant group{variantGroups.size > 1 ? 's' : ''} in view — pieces marked A/B share a topic
        </div>
      )}

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
