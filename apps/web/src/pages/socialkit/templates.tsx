// templates.tsx — editable / exportable social templates, brand-driven.
// Ported from kit-templates.jsx. Each template takes a `b` (brand) object and
// reads its copy, accents, mark, and metrics from there. Canvas authored at
// native pixel size, visually scaled into a card; export captures the un-scaled
// node at the selected scale.

import React, { useRef, useState } from 'react'
import type { Brand, BrandMetric } from './brands'
import { CanvasMark, Corners } from './CanvasMark'
import { EditableText, KitImageSlot, exportCanvasNode } from './primitives'
import { KitSection } from './sections'

// ─────────────────────────────────────────────────────────────────────
// Card wrapper: header (label · dims · export) + scaled canvas frame
// ─────────────────────────────────────────────────────────────────────
function TemplateCard({
  platform, w, h, displayW, accent = 'var(--nx-accent)', filename, exportScale, children,
}: {
  platform: string; w: number; h: number; displayW: number; accent?: string
  filename: string; exportScale: number; children: React.ReactNode
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const scale = displayW / w
  const displayH = Math.round(h * scale)

  const doExport = async () => {
    setBusy(true)
    await exportCanvasNode(canvasRef.current, w, h, filename, exportScale)
    setBusy(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ width: 7, height: 7, background: accent, boxShadow: `0 0 8px ${accent}`, flexShrink: 0 }} />
          <span className="nx-mono" style={{ fontSize: 11, color: 'var(--nx-text)', letterSpacing: '0.16em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{platform}</span>
        </div>
        <span className="nx-mono" style={{ fontSize: 10, color: 'var(--nx-text-muted)', letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>{w}×{h}</span>
      </div>

      <div className="kit-frame" style={{ width: displayW, height: displayH, position: 'relative', overflow: 'hidden', border: '1px solid var(--nx-border-strong)', background: '#050C14', flexShrink: 0 }}>
        <div ref={canvasRef} className="kit-canvas" style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
          {children}
        </div>
      </div>

      <button onClick={doExport} disabled={busy} className="nx-btn nx-btn--primary" style={{ marginTop: 10, justifyContent: 'center', padding: '11px 14px', fontSize: 11, letterSpacing: '0.18em', borderColor: accent, color: accent, opacity: busy ? 0.6 : 1, width: displayW }}>
        {busy ? 'RENDERING…' : '↓ EXPORT PNG'}
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Shared canvas furniture
// ─────────────────────────────────────────────────────────────────────
function CanvasBG({ glow = '#00C4E8', children }: { glow?: string; children?: React.ReactNode }) {
  return (
    <div className="nx-grid-bg" style={{
      position: 'absolute', inset: 0,
      background: `radial-gradient(ellipse 70% 55% at 75% 30%, ${glow}1f, transparent 70%), linear-gradient(rgba(0,196,232,0.04) 1px, transparent 1px) 0 0 / 60px 60px, linear-gradient(90deg, rgba(0,196,232,0.04) 1px, transparent 1px) 0 0 / 60px 60px, #050C14`,
    }}>
      {children}
    </div>
  )
}

function ScopeMark({ size, color = '#00C4E8', style }: { size: number; color?: string; style?: React.CSSProperties }) {
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

function CanvasCorners({ color = '#00C4E8', pad = 36, len = 46, weight = 3 }: { color?: string; pad?: number; len?: number; weight?: number }) {
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

function CanvasWordmark({ brand, size = 30, color = 'var(--nx-text)' }: { brand: Brand; size?: number; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.45 }}>
      <CanvasMark id={brand.id} size={size} />
      <span className="nx-display" style={{ fontSize: size * 0.95, letterSpacing: '0.18em', color, whiteSpace: 'nowrap' }}>{brand.name}</span>
    </div>
  )
}

function StatusBadge({ brand, size = 18 }: { brand: Brand; size?: number }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, border: `1px solid ${brand.statusTone}`, background: `${brand.statusTone}1a`, padding: '10px 18px' }}>
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: brand.statusTone, boxShadow: `0 0 12px ${brand.statusTone}` }} />
      <EditableText as="span" multiline={false} text={brand.statusLabel} className="nx-mono" style={{ fontSize: size, color: brand.statusTone, letterSpacing: '0.2em' }} />
    </div>
  )
}

function CanvasMetric({ m }: { m: BrandMetric }) {
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

function CTAPill({ text, color = '#00C4E8', size = 26 }: { text: string; color?: string; size?: number }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, background: `linear-gradient(180deg, ${color}2e, ${color}12)`, border: `2px solid ${color}`, padding: `${size * 0.7}px ${size * 1.3}px`, boxShadow: `0 0 30px -6px ${color}` }}>
      <span style={{ color, fontSize: size * 0.9 }}>▶</span>
      <EditableText as="span" text={text} multiline={false} style={{ fontFamily: 'var(--nx-body)', fontWeight: 700, fontSize: size, letterSpacing: '0.16em', color, textTransform: 'uppercase' }} />
    </div>
  )
}

// ═══════════════════════════ 1 · LAUNCH SQUARE 1080² ═══════════════════
function LaunchSquare({ b }: { b: Brand }) {
  return (
    <CanvasBG glow={b.accent}>
      <ScopeMark size={760} color={b.accent} style={{ position: 'absolute', right: -200, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
      <CanvasCorners color={b.accent} />
      <div style={{ position: 'absolute', inset: 0, padding: 96, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <CanvasWordmark brand={b} size={34} />
          <StatusBadge brand={b} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <EditableText as="div" className="nx-mono" multiline={false} text={b.launch.eyebrow} style={{ fontSize: 20, color: b.accent, letterSpacing: '0.3em', marginBottom: 26 }} />
          <EditableText as="h2" className="nx-display" text={b.launch.sqHeadline} style={{ margin: 0, fontSize: 100, lineHeight: 1.0, color: 'var(--nx-text)', letterSpacing: '0.01em' }} />
          <EditableText as="p" text={b.launch.sqSub} style={{ margin: '40px 0 0', fontSize: 27, lineHeight: 1.4, color: 'var(--nx-text-2)', maxWidth: 780, fontFamily: 'var(--nx-body)', fontWeight: 500 }} />
        </div>
        <div style={{ display: 'flex', gap: 16, marginBottom: 30 }}>
          {b.launch.metrics.map((m, i) => <CanvasMetric key={i} m={m} />)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <CTAPill text={b.launch.cta} color={b.accent} size={30} />
          <EditableText as="div" className="nx-mono" multiline={false} text={b.handle} style={{ fontSize: 24, color: 'var(--nx-text-muted)', letterSpacing: '0.16em' }} />
        </div>
      </div>
    </CanvasBG>
  )
}

// ═══════════════════════════ 2 · LAUNCH STORY 1080×1920 ════════════════
function LaunchStory({ b }: { b: Brand }) {
  return (
    <CanvasBG glow={b.accent2}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1080 }}>
        <KitImageSlot label="DROP HERO PHOTO" overlay={0.6} />
      </div>
      <div style={{ position: 'absolute', top: 1010, left: 0, right: 0, height: 200, background: 'linear-gradient(180deg, transparent, #050C14)' }} />
      <CanvasCorners color={b.accent2} pad={40} len={54} />
      <div style={{ position: 'absolute', top: 96, left: 96, right: 96, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <CanvasWordmark brand={b} size={36} />
        <StatusBadge brand={b} />
      </div>
      <div style={{ position: 'absolute', left: 96, right: 96, bottom: 110 }}>
        <EditableText as="div" className="nx-mono" multiline={false} text={b.launch.eyebrow} style={{ fontSize: 24, color: b.accent2, letterSpacing: '0.26em', marginBottom: 28 }} />
        <EditableText as="h2" className="nx-display" text={b.launch.storyHeadline} style={{ margin: 0, fontSize: 118, lineHeight: 0.98, color: 'var(--nx-text)' }} />
        <EditableText as="p" text={b.launch.storySub} style={{ margin: '40px 0 44px', fontSize: 32, lineHeight: 1.45, color: 'var(--nx-text-2)', fontFamily: 'var(--nx-body)', fontWeight: 500, maxWidth: 800 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
          <CTAPill text={b.launch.cta} color={b.accent2} size={30} />
          <EditableText as="div" className="nx-mono" multiline={false} text={b.handle} style={{ fontSize: 24, color: 'var(--nx-text-muted)', letterSpacing: '0.18em' }} />
        </div>
      </div>
    </CanvasBG>
  )
}

// ═══════════════════════════ 3 · LAUNCH X 1600×900 ═════════════════════
function LaunchX({ b }: { b: Brand }) {
  return (
    <CanvasBG glow={b.accent}>
      <ScopeMark size={620} color={b.accent} style={{ position: 'absolute', right: -120, bottom: -120, opacity: 0.4 }} />
      <CanvasCorners color={b.accent} pad={34} len={42} />
      <div style={{ position: 'absolute', inset: 0, padding: 72, display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 56, alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 30 }}>
            <CanvasWordmark brand={b} size={28} />
            <span style={{ width: 1, height: 28, background: 'var(--nx-border-strong)' }} />
            <EditableText as="span" multiline={false} text={`● ${b.statusLabel}`} className="nx-mono" style={{ fontSize: 16, color: b.statusTone, letterSpacing: '0.18em' }} />
          </div>
          <EditableText as="h2" className="nx-display" text={b.launch.xHeadline} style={{ margin: 0, fontSize: 100, lineHeight: 0.88, color: 'var(--nx-text)' }} />
          <EditableText as="p" text={b.launch.xSub} style={{ margin: '28px 0 36px', fontSize: 26, lineHeight: 1.45, color: 'var(--nx-text-2)', fontFamily: 'var(--nx-body)', fontWeight: 500, maxWidth: 660 }} />
          <CTAPill text={b.launch.cta} color={b.accent} size={24} />
        </div>
        <div style={{ position: 'relative', border: '1px solid var(--nx-border-strong)', background: 'linear-gradient(180deg, rgba(13,30,48,0.7), rgba(5,12,20,0.7))', padding: 36 }}>
          <Corners color={b.accent} size={16} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 26 }}>
            <span className="nx-mono" style={{ fontSize: 15, color: 'var(--nx-text-muted)', letterSpacing: '0.2em' }}>DOSSIER · LIVE</span>
            <span className="nx-mono" style={{ fontSize: 15, color: b.accent, letterSpacing: '0.16em' }}>● ACTIVE</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {b.launch.metrics.map((m, i) => <CanvasMetric key={i} m={m} />)}
          </div>
        </div>
      </div>
    </CanvasBG>
  )
}

// ═══════════════════════════ 4 · LAUNCH LINKEDIN 1200×627 ══════════════
function LaunchLinkedIn({ b }: { b: Brand }) {
  return (
    <CanvasBG glow={b.accent}>
      <CanvasCorners color="var(--nx-border-strong)" pad={28} len={34} weight={2} />
      <div style={{ position: 'absolute', inset: 0, padding: 64, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <CanvasWordmark brand={b} size={26} />
          <EditableText as="span" multiline={false} text={b.statusLabel} className="nx-mono" style={{ fontSize: 15, color: b.accent, letterSpacing: '0.22em' }} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 920 }}>
          <EditableText as="h2" className="nx-display" text={b.launch.liHeadline} style={{ margin: 0, fontSize: 74, lineHeight: 0.92, color: 'var(--nx-text)' }} />
          <EditableText as="p" text={b.launch.liSub} style={{ margin: '24px 0 0', fontSize: 24, lineHeight: 1.5, color: 'var(--nx-text-2)', fontFamily: 'var(--nx-body)', fontWeight: 500, maxWidth: 820 }} />
        </div>
        <div style={{ display: 'flex', gap: 48, paddingTop: 28, borderTop: '1px solid var(--nx-border-strong)' }}>
          {b.launch.metrics.map((m, i) => (
            <div key={i}>
              <EditableText as="span" className="nx-display" multiline={false} text={m.value + (m.unit ? m.unit : '')} style={{ fontSize: 52, color: m.color, lineHeight: 0.9, display: 'inline-block' }} />
              <EditableText as="div" className="nx-mono" multiline={false} text={m.label} style={{ fontSize: 14, color: 'var(--nx-text-muted)', letterSpacing: '0.18em', marginTop: 8 }} />
            </div>
          ))}
        </div>
      </div>
    </CanvasBG>
  )
}

// ═══════════════════════════ 5 · INSIGHT SQUARE 1080² ══════════════════
function InsightSquare({ b }: { b: Brand }) {
  return (
    <CanvasBG glow={b.accent2}>
      <div className="nx-display" style={{ position: 'absolute', right: -40, bottom: -180, fontSize: 720, lineHeight: 0.7, color: `${b.accent2}12`, userSelect: 'none' }}>01</div>
      <CanvasCorners color={b.accent2} />
      <div style={{ position: 'absolute', inset: 0, padding: 96, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
            <EditableText as="span" className="nx-display" multiline={false} text={b.insight.group} style={{ fontSize: 40, color: b.accent2, letterSpacing: '0.16em' }} />
            <EditableText as="span" className="nx-mono" multiline={false} text="/ 01" style={{ fontSize: 28, color: 'var(--nx-text-muted)', letterSpacing: '0.2em' }} />
          </div>
          <span className="nx-mono" style={{ fontSize: 22, color: 'var(--nx-text-2)', letterSpacing: '0.2em' }}>SWIPE ▶</span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <span style={{ width: 90, height: 5, background: b.accent2, boxShadow: `0 0 16px ${b.accent2}`, marginBottom: 36 }} />
          <EditableText as="h2" className="nx-display" text={b.insight.sqHeadline} style={{ margin: 0, fontSize: 90, lineHeight: 1.0, color: 'var(--nx-text)' }} />
          <EditableText as="p" text={b.insight.sqBody} style={{ margin: '36px 0 0', fontSize: 30, lineHeight: 1.5, color: 'var(--nx-text-2)', fontFamily: 'var(--nx-body)', fontWeight: 500, maxWidth: 840 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 32, borderTop: '1px solid var(--nx-border-strong)' }}>
          <CanvasWordmark brand={b} size={26} />
          <EditableText as="div" className="nx-mono" multiline={false} text={b.handle} style={{ fontSize: 24, color: 'var(--nx-text-muted)', letterSpacing: '0.16em' }} />
        </div>
      </div>
    </CanvasBG>
  )
}

// ═══════════════════════════ 6 · INSIGHT STORY 1080×1920 ═══════════════
function InsightStory({ b }: { b: Brand }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#050C14' }}>
      <KitImageSlot label={b.insight.slotLabel} overlay={0.78} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(5,12,20,0.55) 0%, rgba(5,12,20,0.2) 35%, rgba(5,12,20,0.92) 100%)', pointerEvents: 'none' }} />
      <div className="nx-grid-bg" style={{ position: 'absolute', inset: 0, opacity: 0.4, pointerEvents: 'none', background: 'linear-gradient(rgba(0,196,232,0.04) 1px, transparent 1px) 0 0 / 60px 60px, linear-gradient(90deg, rgba(0,196,232,0.04) 1px, transparent 1px) 0 0 / 60px 60px' }} />
      <CanvasCorners color={b.accent2} pad={40} len={54} />
      <div style={{ position: 'absolute', top: 96, left: 96, right: 96, display: 'flex', justifyContent: 'space-between', alignItems: 'center', pointerEvents: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <EditableText as="span" className="nx-display" multiline={false} text={b.insight.group} style={{ fontSize: 44, color: b.accent2, letterSpacing: '0.16em', pointerEvents: 'auto' }} />
          <EditableText as="span" className="nx-mono" multiline={false} text="/ 01" style={{ fontSize: 30, color: 'var(--nx-text-2)', letterSpacing: '0.2em', pointerEvents: 'auto' }} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {[0, 1, 2, 3].map((i) => <span key={i} style={{ width: 40, height: 6, background: i === 0 ? b.accent2 : 'rgba(200,220,240,0.3)' }} />)}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 96, right: 96, bottom: 120 }}>
        <span style={{ display: 'block', width: 90, height: 5, background: b.accent2, boxShadow: `0 0 16px ${b.accent2}`, marginBottom: 36 }} />
        <EditableText as="h2" className="nx-display" text={b.insight.storyHeadline} style={{ margin: 0, fontSize: 120, lineHeight: 0.98, color: 'var(--nx-text)' }} />
        <EditableText as="p" text={b.insight.storyBody} style={{ margin: '40px 0 48px', fontSize: 34, lineHeight: 1.45, color: 'var(--nx-text)', fontFamily: 'var(--nx-body)', fontWeight: 500, maxWidth: 820, textShadow: '0 2px 12px rgba(0,0,0,0.6)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <CanvasWordmark brand={b} size={30} />
          <span style={{ flex: 1 }} />
          <EditableText as="div" className="nx-mono" multiline={false} text="FULL SERIES → BIO" style={{ fontSize: 24, color: b.accent2, letterSpacing: '0.16em' }} />
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════ GALLERY ═══════════════════════════════════
export function TemplateGallery({ brand, exportScale }: { brand: Brand; exportScale: number }) {
  const b = brand
  return (
    <KitSection id="templates" index="03" eyebrow="EDITABLE · EXPORTABLE" accent={b.accent}
      title={<>Post <span style={{ color: b.accent }}>templates.</span></>}
      sub="Click any text to rewrite it. Drag a photo onto an image slot. Hit export for a clean PNG at the exact size each platform wants.">

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32, padding: '12px 16px', border: '1px dashed var(--nx-border-strong)', background: 'rgba(0,196,232,0.04)', fontFamily: 'var(--nx-mono)', fontSize: 12, color: 'var(--nx-text-2)', letterSpacing: '0.06em' }}>
        <span style={{ color: b.accent }}>ⓘ</span>
        <span>Edits live in your browser — type directly on the canvas. Exports render at the selected scale and never include these editing guides.</span>
      </div>

      <GroupHead n="A" label="LAUNCH ANNOUNCEMENT" color={b.accent} sub={`${b.name} is live — four platform cuts.`} />
      <div className="kit-gallery">
        <TemplateCard platform="INSTAGRAM · FEED" w={1080} h={1080} displayW={380} accent={b.accent} exportScale={exportScale} filename={`${b.id}-launch-instagram-1080.png`}><LaunchSquare b={b} /></TemplateCard>
        <TemplateCard platform="STORY · REEL · TIKTOK" w={1080} h={1920} displayW={250} accent={b.accent2} exportScale={exportScale} filename={`${b.id}-launch-story-1080x1920.png`}><LaunchStory b={b} /></TemplateCard>
        <TemplateCard platform="X · TWITTER" w={1600} h={900} displayW={480} accent={b.accent} exportScale={exportScale} filename={`${b.id}-launch-x-1600x900.png`}><LaunchX b={b} /></TemplateCard>
        <TemplateCard platform="LINKEDIN" w={1200} h={627} displayW={480} accent={b.accent} exportScale={exportScale} filename={`${b.id}-launch-linkedin-1200x627.png`}><LaunchLinkedIn b={b} /></TemplateCard>
      </div>

      <div style={{ marginTop: 56 }}>
        <GroupHead n="B" label={`${b.insight.group} · TIP SERIES`} color={b.accent2} sub="Reusable insight carousel slides." />
      </div>
      <div className="kit-gallery">
        <TemplateCard platform="INSTAGRAM · CAROUSEL" w={1080} h={1080} displayW={380} accent={b.accent2} exportScale={exportScale} filename={`${b.id}-insight-instagram-1080.png`}><InsightSquare b={b} /></TemplateCard>
        <TemplateCard platform="STORY · REEL · TIKTOK" w={1080} h={1920} displayW={250} accent={b.accent2} exportScale={exportScale} filename={`${b.id}-insight-story-1080x1920.png`}><InsightStory b={b} /></TemplateCard>
      </div>
    </KitSection>
  )
}

function GroupHead({ n, label, color, sub }: { n: string; label: string; color: string; sub: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 24 }}>
      <span className="nx-display" style={{ fontSize: 34, color, width: 48, height: 48, border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{n}</span>
      <div>
        <div className="nx-display" style={{ fontSize: 30, color: 'var(--nx-text)', letterSpacing: '0.06em', lineHeight: 1 }}>{label}</div>
        <div className="nx-mono" style={{ fontSize: 12, color: 'var(--nx-text-muted)', letterSpacing: '0.14em', marginTop: 5 }}>{sub}</div>
      </div>
    </div>
  )
}
