import React from 'react'
import { vantageApi } from '../api/vantage'
import { Panel, Badge } from '../ds'

type CalPiece = {
  id: string
  status: string
  channel_slug: string
  format: string
  content_payload: Record<string, unknown>
  scheduled_for: string | null
  published_at: string | null
}

const CHANNELS = ['x', 'linkedin', 'reddit', 'email', 'tiktok', 'instagram', 'facebook']

const CHANNEL_COLOR: Record<string, string> = {
  x:         'var(--nx-text-1)',
  linkedin:  '#0077b5',
  reddit:    '#ff4500',
  email:     'var(--nx-cyan)',
  tiktok:    '#ee1d52',
  instagram: '#c13584',
  facebook:  '#1877f2',
}

function weekStart(d: Date): Date {
  const s = new Date(d)
  s.setUTCHours(0, 0, 0, 0)
  // Monday-aligned week
  const day = s.getUTCDay()
  s.setUTCDate(s.getUTCDate() - ((day + 6) % 7))
  return s
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function CalendarPage() {
  const [weekOf, setWeekOf]   = React.useState(() => weekStart(new Date()))
  const [pieces, setPieces]   = React.useState<CalPiece[]>([])
  const [loading, setLoading] = React.useState(false)
  const [err, setErr]         = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState<string | null>(null) // 'channel:dateKey'

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekOf, i))

  const load = React.useCallback(async (start: Date) => {
    setLoading(true); setErr(null)
    try {
      const from = start.toISOString()
      const to   = addDays(start, 7).toISOString()
      const r    = await vantageApi.getCalendar(from, to)
      setPieces(r.pieces)
    } catch (e) { setErr(String((e as Error).message)) }
    finally { setLoading(false) }
  }, [])

  React.useEffect(() => { void load(weekOf) }, [load, weekOf])

  // Index pieces by channel + date
  const index: Record<string, CalPiece[]> = {}
  for (const p of pieces) {
    const slot = p.scheduled_for ?? p.published_at
    if (!slot) continue
    const dk   = slot.slice(0, 10)
    const key  = `${p.channel_slug}:${dk}`
    if (!index[key]) index[key] = []
    index[key].push(p)
  }

  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <>
      <div className="vg-page-header">
        <h1 className="vg-page-title">Content Calendar</h1>
        <p className="vg-page-sub">Scheduled and published posts — 7-day week view</p>
      </div>

      {err && <div className="vg-error" style={{ marginBottom: 16 }}>{err}</div>}

      {/* Week navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button
          type="button"
          className="nx-btn nx-btn--ghost nx-btn--sm"
          onClick={() => setWeekOf(addDays(weekOf, -7))}
        >
          ← Prev week
        </button>
        <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-2)', minWidth: 200, textAlign: 'center' }}>
          {weekOf.toLocaleDateString([], { month: 'long', day: 'numeric' })} –{' '}
          {addDays(weekOf, 6).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}
        </span>
        <button
          type="button"
          className="nx-btn nx-btn--ghost nx-btn--sm"
          onClick={() => setWeekOf(addDays(weekOf, 7))}
        >
          Next week →
        </button>
        <button
          type="button"
          className="nx-btn nx-btn--ghost nx-btn--sm"
          style={{ marginLeft: 'auto' }}
          onClick={() => setWeekOf(weekStart(new Date()))}
        >
          Today
        </button>
      </div>

      {loading ? (
        <p className="vg-empty">Loading…</p>
      ) : (
        <Panel title="Weekly Schedule">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--nx-mono)', fontSize: 10 }}>
              <thead>
                <tr>
                  <th style={{ width: 80, textAlign: 'left', padding: '6px 8px', color: 'var(--nx-text-4)', borderBottom: '1px solid var(--nx-border)', fontWeight: 400 }}>
                    Channel
                  </th>
                  {days.map((d, i) => {
                    const isToday = dateKey(d) === dateKey(new Date())
                    return (
                      <th key={i} style={{
                        textAlign: 'center', padding: '6px 4px',
                        borderBottom: '1px solid var(--nx-border)',
                        color: isToday ? 'var(--nx-amber)' : 'var(--nx-text-3)',
                        fontWeight: isToday ? 700 : 400,
                      }}>
                        <div>{DAY_LABELS[i]}</div>
                        <div style={{ fontSize: 9, color: isToday ? 'var(--nx-amber)' : 'var(--nx-text-4)' }}>
                          {d.toLocaleDateString([], { month: 'numeric', day: 'numeric' })}
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {CHANNELS.map((ch) => (
                  <tr key={ch} style={{ borderBottom: '1px solid var(--nx-border)' }}>
                    <td style={{ padding: '6px 8px', color: CHANNEL_COLOR[ch] ?? 'var(--nx-text-3)', fontWeight: 600 }}>
                      {ch}
                    </td>
                    {days.map((d, i) => {
                      const key     = `${ch}:${dateKey(d)}`
                      const cell    = index[key] ?? []
                      const isOpen  = expanded === key
                      return (
                        <td key={i} style={{ padding: '4px', verticalAlign: 'top', minWidth: 80 }}>
                          {cell.length === 0 ? (
                            <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--nx-text-4)', fontSize: 9 }}>
                              —
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setExpanded(isOpen ? null : key)}
                              style={{
                                width: '100%', cursor: 'pointer', background: 'none', border: 'none', padding: 0,
                              }}
                            >
                              <div style={{
                                background: isOpen ? 'rgba(245,158,11,0.15)' : 'var(--nx-surface-2)',
                                border: `1px solid ${isOpen ? 'var(--nx-amber)' : 'var(--nx-border)'}`,
                                borderRadius: 4, padding: '4px 6px',
                                textAlign: 'center',
                              }}>
                                <div style={{ fontSize: 14, fontWeight: 700, color: CHANNEL_COLOR[ch] ?? 'var(--nx-text-1)' }}>
                                  {cell.length}
                                </div>
                                <div style={{ fontSize: 8, color: 'var(--nx-text-4)' }}>
                                  {cell.filter((p) => p.status === 'published').length > 0
                                    ? `${cell.filter((p) => p.status === 'published').length} pub`
                                    : 'queued'}
                                </div>
                              </div>
                              {isOpen && (
                                <div style={{ marginTop: 4, textAlign: 'left' }}>
                                  {cell.map((p) => (
                                    <div key={p.id} style={{
                                      background: 'var(--nx-surface-2)',
                                      border: '1px solid var(--nx-border)',
                                      borderRadius: 4, padding: '4px 6px', marginBottom: 3,
                                    }}>
                                      <Badge label={p.status} variant={
                                        p.status === 'published' ? 'core'
                                        : p.status === 'queued'  ? 'new'
                                        : 'default'
                                      } />
                                      <div style={{ fontSize: 9, color: 'var(--nx-text-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                                        {String(p.content_payload?.body ?? p.content_payload?.text ?? p.content_payload?.hook ?? p.content_payload?.title ?? '—').slice(0, 60)}
                                      </div>
                                      {p.scheduled_for && (
                                        <div style={{ fontSize: 8, color: 'var(--nx-text-4)', marginTop: 1 }}>
                                          {new Date(p.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} UTC
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </button>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginTop: 10 }}>
            Click any cell to expand scheduled pieces. Times shown in UTC.
          </div>
        </Panel>
      )}
    </>
  )
}
