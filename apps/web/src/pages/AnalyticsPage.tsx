import React from 'react'
import { vantageApi } from '../api/vantage'
import { Panel } from '../ds'

// ── Tiny SVG bar chart ────────────────────────────────────────────────────────
function BarChart({
  data,
  labelKey,
  valueKey,
  color = 'var(--nx-amber)',
  height = 120,
}: {
  data: Record<string, unknown>[]
  labelKey: string
  valueKey: string
  color?: string
  height?: number
}) {
  if (!data.length) return <p className="vg-empty">No data</p>
  const values = data.map((d) => Number(d[valueKey]) || 0)
  const maxVal = Math.max(...values, 1)
  const barW   = Math.max(8, Math.min(32, Math.floor(480 / data.length) - 4))
  const w      = data.length * (barW + 4) + 40
  const h      = height + 32

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', maxWidth: w, fontFamily: 'var(--nx-mono)' }}>
      {data.map((d, i) => {
        const val     = Number(d[valueKey]) || 0
        const barH    = (val / maxVal) * height
        const x       = 36 + i * (barW + 4)
        const y       = height - barH
        const label   = String(d[labelKey])
        const shortLbl = label.length > 5 ? label.slice(-5) : label
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} fill={color} rx={2} opacity={0.85} />
            <title>{`${label}: ${val}`}</title>
            <text x={x + barW / 2} y={height + 12} textAnchor="middle" fontSize={7} fill="var(--nx-text-4)">{shortLbl}</text>
            {val > 0 && (
              <text x={x + barW / 2} y={Math.max(y - 3, 8)} textAnchor="middle" fontSize={7} fill="var(--nx-text-2)">{val}</text>
            )}
          </g>
        )
      })}
      {/* Y axis */}
      <line x1={36} y1={0} x2={36} y2={height} stroke="var(--nx-border)" strokeWidth={1} />
      <text x={32} y={8}  textAnchor="end" fontSize={7} fill="var(--nx-text-4)">{maxVal}</text>
      <text x={32} y={height} textAnchor="end" fontSize={7} fill="var(--nx-text-4)">0</text>
    </svg>
  )
}

// ── Tiny SVG line chart ───────────────────────────────────────────────────────
function LineChart({
  data,
  labelKey,
  valueKey,
  color = 'var(--nx-cyan)',
  height = 120,
}: {
  data: Record<string, unknown>[]
  labelKey: string
  valueKey: string
  color?: string
  height?: number
}) {
  if (data.length < 2) return <BarChart data={data} labelKey={labelKey} valueKey={valueKey} color={color} height={height} />
  const values = data.map((d) => Number(d[valueKey]) || 0)
  const maxVal = Math.max(...values, 1)
  const w = 480
  const h = height + 32
  const padL = 36; const padR = 10

  const pts = data.map((d, i) => {
    const x = padL + (i / (data.length - 1)) * (w - padL - padR)
    const y = height - (Number(d[valueKey]) || 0) / maxVal * height
    return `${x},${y}`
  }).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', fontFamily: 'var(--nx-mono)' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} />
      {data.map((d, i) => {
        const x    = padL + (i / (data.length - 1)) * (w - padL - padR)
        const y    = height - (Number(d[valueKey]) || 0) / maxVal * height
        const label = String(d[labelKey]).slice(5) // show MM-DD
        const val  = Number(d[valueKey]) || 0
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={3} fill={color} />
            <title>{`${String(d[labelKey])}: ${val}`}</title>
            {i % Math.max(1, Math.floor(data.length / 8)) === 0 && (
              <text x={x} y={height + 12} textAnchor="middle" fontSize={7} fill="var(--nx-text-4)">{label}</text>
            )}
          </g>
        )
      })}
      <line x1={padL} y1={0} x2={padL} y2={height} stroke="var(--nx-border)" strokeWidth={1} />
      <text x={32} y={8} textAnchor="end" fontSize={7} fill="var(--nx-text-4)">{maxVal}</text>
      <text x={32} y={height} textAnchor="end" fontSize={7} fill="var(--nx-text-4)">0</text>
    </svg>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
const PERIODS = ['7d', '30d', '90d'] as const
const CHANNELS = ['all', 'x', 'linkedin', 'reddit', 'email', 'tiktok', 'instagram', 'facebook'] as const

export function AnalyticsPage() {
  const [period,  setPeriod]  = React.useState<typeof PERIODS[number]>('30d')
  const [channel, setChannel] = React.useState<typeof CHANNELS[number]>('all')
  const [trendData, setTrendData] = React.useState<{ label: string; count: number }[]>([])
  const [hourData,  setHourData]  = React.useState<{ hour: number; piece_count: number; total_engagement: number; avg_engagement: number }[]>([])
  const [vertData,  setVertData]  = React.useState<{ label: string; count: number }[]>([])
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const ch = channel === 'all' ? undefined : channel
      const [trend, hours, vert] = await Promise.all([
        vantageApi.getEngagementTrend({ period, channel: ch, group_by: 'day' }),
        vantageApi.getPostingHours(ch),
        vantageApi.getEngagementTrend({ period, channel: ch, group_by: 'vertical' }),
      ])
      setTrendData(trend.data)
      setHourData(hours.data)
      setVertData(vert.data.sort((a, b) => b.count - a.count).slice(0, 12))
    } catch (e) { setErr(String((e as Error).message)) }
    finally { setLoading(false) }
  }, [period, channel])

  React.useEffect(() => { void load() }, [load])

  const totalEvents = trendData.reduce((s, d) => s + d.count, 0)
  const bestHour    = hourData.reduce((best, h) => h.avg_engagement > best.avg_engagement ? h : best, { hour: 0, avg_engagement: 0 })

  return (
    <>
      <div className="vg-page-header">
        <h1 className="vg-page-title">Analytics</h1>
        <p className="vg-page-sub">Engagement trends, posting-hour performance, and vertical breakdown</p>
      </div>

      {err && <div className="vg-error" style={{ marginBottom: 16 }}>{err}</div>}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)' }}>PERIOD</span>
        {PERIODS.map((p) => (
          <button key={p} type="button"
            className={`vg-filter-tab${period === p ? ' vg-filter-tab--active' : ''}`}
            onClick={() => setPeriod(p)}>{p}</button>
        ))}
        <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)', marginLeft: 12 }}>CHANNEL</span>
        {CHANNELS.map((ch) => (
          <button key={ch} type="button"
            className={`vg-filter-tab${channel === ch ? ' vg-filter-tab--active' : ''}`}
            onClick={() => setChannel(ch)}>{ch}</button>
        ))}
        <button type="button" className="vg-filter-tab" style={{ marginLeft: 'auto' }} onClick={() => void load()}>↻</button>
      </div>

      {/* Summary stats */}
      <div className="vg-stats" style={{ marginBottom: 16 }}>
        <div className="vg-stat-card" style={{ background: 'var(--nx-surface-2)', border: '1px solid var(--nx-border)', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', letterSpacing: '0.1em', marginBottom: 4 }}>TOTAL EVENTS ({period})</div>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 24, fontWeight: 700, color: 'var(--nx-cyan)' }}>{totalEvents.toLocaleString()}</div>
        </div>
        <div className="vg-stat-card" style={{ background: 'var(--nx-surface-2)', border: '1px solid var(--nx-border)', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', letterSpacing: '0.1em', marginBottom: 4 }}>BEST POSTING HOUR (UTC)</div>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 24, fontWeight: 700, color: 'var(--nx-amber)' }}>
            {bestHour.avg_engagement > 0 ? `${String(bestHour.hour).padStart(2, '0')}:00` : '—'}
          </div>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)' }}>
            {bestHour.avg_engagement > 0 ? `avg ${bestHour.avg_engagement} events/post` : 'no data'}
          </div>
        </div>
        <div className="vg-stat-card" style={{ background: 'var(--nx-surface-2)', border: '1px solid var(--nx-border)', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', letterSpacing: '0.1em', marginBottom: 4 }}>TOP VERTICAL</div>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 18, fontWeight: 700, color: 'var(--nx-text-1)' }}>
            {vertData[0]?.label ?? '—'}
          </div>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)' }}>
            {vertData[0] ? `${vertData[0].count} events` : 'no data'}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="vg-empty">Loading…</p>
      ) : (
        <div className="vg-stack">

          {/* Engagement over time */}
          <Panel title={`Engagement Events — ${period}`} titleAccent="cyan">
            {trendData.length === 0 ? (
              <p className="vg-empty">No engagement data in this period</p>
            ) : (
              <LineChart
                data={trendData as unknown as Record<string, unknown>[]}
                labelKey="label"
                valueKey="count"
                color="var(--nx-cyan)"
              />
            )}
          </Panel>

          {/* Posting hour heatmap */}
          <Panel title="Avg Engagement by UTC Posting Hour" titleAccent="amber">
            {hourData.every((h) => h.avg_engagement === 0) ? (
              <p className="vg-empty">No posting-hour data yet — publish some pieces first</p>
            ) : (
              <BarChart
                data={hourData.map((h) => ({ label: `${String(h.hour).padStart(2, '0')}h`, count: h.avg_engagement }))}
                labelKey="label"
                valueKey="count"
                color="var(--nx-amber)"
                height={100}
              />
            )}
            <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginTop: 6 }}>
              Average engagement events per post published in that UTC hour (last 30 days)
            </div>
          </Panel>

          {/* Top verticals */}
          <Panel title="Engagement by Vertical" titleAccent="amber">
            {vertData.length === 0 ? (
              <p className="vg-empty">No vertical data in this period</p>
            ) : (
              <BarChart
                data={vertData as unknown as Record<string, unknown>[]}
                labelKey="label"
                valueKey="count"
                color="var(--nx-text-3)"
                height={100}
              />
            )}
          </Panel>

        </div>
      )}
    </>
  )
}
