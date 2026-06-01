// canvasFurniture.tsx — shared canvas decoration components for creative tools.
// Extracted from socialkit/templates.tsx so every creative canvas can reuse them.
// The socialkit templates still import from their own copies; these are the
// shared versions for tools outside that module.

import React from 'react'
import { CanvasMark } from '../pages/socialkit/CanvasMark'
import { EditableText } from '../pages/socialkit/primitives'
import type { Brand, BrandMetric } from '../pages/socialkit/brands'

export function CanvasBG({ glow = '#00C4E8', children }: { glow?: string; children?: React.ReactNode }) {
  return (
    <div className="nx-grid-bg" style={{
      position: 'absolute', inset: 0,
      background: `radial-gradient(ellipse 70% 55% at 75% 30%, ${glow}1f, transparent 70%), linear-gradient(rgba(0,196,232,0.04) 1px, transparent 1px) 0 0 / 60px 60px, linear-gradient(90deg, rgba(0,196,232,0.04) 1px, transparent 1px) 0 0 / 60px 60px, #050C14`,
    }}>
      {children}
    </div>
  )
}

export function ScopeMark({ size, color = '#00C4E8', style }: { size: number; color?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} style={style}>
      <circle cx="100" cy="100" r="92" fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="0.8" />
      <circle cx="100" cy="100" r="70" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="0.6" strokeDasharray="3 4" />
      <circle cx="100" cy="100" r="48" fill="none" stroke={color} strokeOpacity="0.5" strokeWidth="0.8" />
      {Array.from({ length: 48 }).map((_, i) => {
        const a = (i / 48) * Math.PI * 2; const r1 = 92; const r2 = i % 6 === 0 ? 82 : 87
        return <line key={i} x1={100 + Math.cos(a) * r1} y1={100 + Math.sin(a) * r1} x2={100 + Math.cos(a) * r2} y2={100 + Math.sin(a) * r2} stroke={color} strokeOpacity={i % 6 === 0 ? 0.7 : 0.3} strokeWidth="0.7" />
      })}
      <line x1="100" y1="8" x2="100" y2="34" stroke={color} strokeWidth="0.7" strokeOpacity="0.6" />
      <line x1="100" y1="166" x2="100" y2="192" stroke={color} strokeWidth="0.7" strokeOpacity="0.6" />
      <line x1="8" y1="100" x2="34" y2="100" stroke={color} strokeWidth="0.7" strokeOpacity="0.6" />
      <line x1="166" y1="100" x2="192" y2="100" stroke={color} strokeWidth="0.7" strokeOpacity="0.6" />
    </svg>
  )
}

export function CanvasCorners({ color = '#00C4E8', pad = 36, len = 46, weight = 3 }: { color?: string; pad?: number; len?: number; weight?: number }) {
  const base: React.CSSProperties = { position: 'absolute', width: len, height: len, borderColor: color, borderStyle: 'solid', pointerEvents: 'none' }
  return (
    <>
      <span style={{ ...base, top: pad, left: pad, borderWidth: `${weight}px 0 0 ${weight}px` }} />
      <span style={{ ...base, top: pad, right: pad, borderWidth: `${weight}px ${weight}px 0 0` }} />
      <span style={{ ...base, bottom: pad, left: pad, borderWidth: `0 0 ${weight}px ${weight}px` }} />
      <span style={{ ...base, bottom: pad, right: pad, borderWidth: `0 ${weight}px ${weight}px 0` }} />
    </>
  )
}

export function CanvasWordmark({ brand, size = 30, color = 'var(--nx-text)' }: { brand: Brand; size?: number; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.45 }}>
      <CanvasMark id={brand.id} size={size} />
      <span className="nx-display" style={{ fontSize: size * 0.95, letterSpacing: '0.18em', color, whiteSpace: 'nowrap' }}>{brand.name}</span>
    </div>
  )
}

export function StatusBadge({ brand, size = 18 }: { brand: Brand; size?: number }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, border: `1px solid ${brand.statusTone}`, background: `${brand.statusTone}1a`, padding: '10px 18px' }}>
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: brand.statusTone, boxShadow: `0 0 12px ${brand.statusTone}` }} />
      <EditableText as="span" multiline={false} text={brand.statusLabel} className="nx-mono" style={{ fontSize: size, color: brand.statusTone, letterSpacing: '0.2em' }} />
    </div>
  )
}

export function CanvasMetric({ m }: { m: BrandMetric }) {
  return (
    <div style={{ flex: 1, border: '1px solid var(--nx-border-strong)', borderTop: `3px solid ${m.color}`, background: 'rgba(0,0,0,0.35)', padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <EditableText as="span" text={m.value} className="nx-display" multiline={false} style={{ fontSize: 60, color: m.color, lineHeight: 0.9 }} />
        {m.unit && <EditableText as="span" multiline={false} text={m.unit} className="nx-display" style={{ fontSize: 28, color: m.color, opacity: 0.8 }} />}
      </div>
      <EditableText as="div" text={m.label} className="nx-mono" multiline={false} style={{ fontSize: 15, color: 'var(--nx-text-muted)', letterSpacing: '0.16em', marginTop: 8 }} />
    </div>
  )
}

export function CTAPill({ text, color = '#00C4E8', size = 26 }: { text: string; color?: string; size?: number }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, background: `linear-gradient(180deg, ${color}2e, ${color}12)`, border: `2px solid ${color}`, padding: `${size * 0.7}px ${size * 1.3}px`, boxShadow: `0 0 30px -6px ${color}` }}>
      <span style={{ color, fontSize: size * 0.9 }}>▶</span>
      <EditableText as="span" text={text} multiline={false} style={{ fontFamily: 'var(--nx-body)', fontWeight: 700, fontSize: size, letterSpacing: '0.16em', color, textTransform: 'uppercase' }} />
    </div>
  )
}
