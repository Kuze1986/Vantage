import React from 'react'
import { Corners } from '../pages/socialkit/CanvasMark'

export { Corners }

export function VantageMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
      <circle cx="16" cy="16" r="13" fill="none" stroke="var(--nx-cyan)" strokeWidth="1.2" opacity="0.6" />
      <circle cx="16" cy="16" r="8" fill="none" stroke="var(--nx-cyan)" strokeWidth="1.2" />
      <circle cx="16" cy="16" r="3" fill="var(--nx-amber)" />
      <line x1="16" y1="3" x2="16" y2="29" stroke="var(--nx-cyan)" strokeWidth="0.6" opacity="0.4" />
      <line x1="3" y1="16" x2="29" y2="16" stroke="var(--nx-cyan)" strokeWidth="0.6" opacity="0.4" />
    </svg>
  )
}

export function Chip({
  children,
  tone = 'default',
  style,
  dot,
}: {
  children: React.ReactNode
  tone?: 'default' | 'cyan' | 'amber' | 'red' | 'green'
  style?: React.CSSProperties
  dot?: boolean
}) {
  const cls = tone === 'default' ? 'nx-chip' : `nx-chip nx-chip--${tone}`
  return (
    <span className={cls} style={style}>
      {dot && <span className={`nx-pulse${tone !== 'default' ? ` nx-pulse--${tone}` : ''}`} style={{ width: 5, height: 5 }} />}
      {children}
    </span>
  )
}

export function TelemetryStrip() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-muted)', flexWrap: 'wrap' }}>
      <span><span className="nx-pulse" /> SYSTEM NOMINAL</span>
      <span>LAT 38.9072°N</span>
      <span>LON -77.0369°W</span>
      <span>UPLINK ▮▮▮▮▯</span>
      <span style={{ color: 'var(--nx-accent)' }}>SIG ●</span>
    </div>
  )
}

export function Sparkline({
  data,
  color,
  height = 22,
  style,
}: {
  data: number[]
  color?: string
  height?: number
  style?: React.CSSProperties
}) {
  const gradId = React.useId().replace(/:/g, '')
  if (!data.length) return null
  const w = 100
  const h = height
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((d - min) / range) * (h - 4) - 2
    return `${x},${y}`
  }).join(' ')
  const c = color || 'var(--nx-accent)'
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height={h} style={style}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity="0.4" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${gradId})`} />
      <polyline points={pts} fill="none" stroke={c} strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function SectionHead({
  n,
  eyebrow,
  title,
  sub,
  accent = 'var(--nx-accent)',
}: {
  n?: string
  eyebrow: string
  title: React.ReactNode
  sub?: string
  accent?: string
}) {
  return (
    <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginBottom: 40, flexWrap: 'wrap' }}>
      <div style={{ maxWidth: 760 }}>
        <div className="nx-mono" style={{ fontSize: 11, color: accent, letterSpacing: '0.3em', marginBottom: 14 }}>{eyebrow}</div>
        <h2 className="nx-display" style={{ margin: 0, fontSize: 'clamp(36px, 4.6vw, 60px)', lineHeight: 1.0, letterSpacing: '0.01em', color: 'var(--nx-text)' }}>{title}</h2>
        {sub && <p style={{ margin: '16px 0 0', fontSize: 16.5, lineHeight: 1.55, color: 'var(--nx-text-2)', maxWidth: 640, fontWeight: 500 }}>{sub}</p>}
      </div>
      {n && <div className="nx-display" style={{ fontSize: 'clamp(64px, 9vw, 120px)', lineHeight: 0.8, color: 'var(--nx-border-strong)', userSelect: 'none' }}>{n}</div>}
    </header>
  )
}
