// sections.tsx — Social Kit page sections: hero, brand essentials, caption
// library, footer. Ported from kit-shared.jsx. The embedded product switcher
// from the prototype's KitHeader is dropped here — module switching lives in
// SocialKitPage's control bar instead.

import React, { useState } from 'react'
import type { Brand, BrandCaption, PaletteColor } from './brands'
import { CanvasMark, Corners } from './CanvasMark'
import { CopyButton } from './primitives'
import { CaptionStudio } from '../../creative/CaptionStudio'

// ─────────────────────────────────────────────────────────────────────
// SECTION wrapper
// ─────────────────────────────────────────────────────────────────────
export function KitSection({
  id, index, eyebrow, title, sub, children, accent = 'var(--nx-accent)',
}: {
  id?: string; index?: string; eyebrow?: string; title: React.ReactNode; sub?: string
  children?: React.ReactNode; accent?: string
}) {
  return (
    <section id={id} style={{ padding: '88px 56px', borderBottom: '1px solid var(--nx-border)', position: 'relative' }} className="nx-grid-bg">
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginBottom: 44, flexWrap: 'wrap' }}>
          <div style={{ maxWidth: 760 }}>
            <div className="nx-mono" style={{ fontSize: 11, color: accent, letterSpacing: '0.3em', marginBottom: 14 }}>{eyebrow}</div>
            <h2 className="nx-display" style={{ margin: 0, fontSize: 'clamp(34px, 4.4vw, 56px)', lineHeight: 1.02, letterSpacing: '0.01em', color: 'var(--nx-text)' }}>{title}</h2>
            {sub && <p style={{ margin: '16px 0 0', fontSize: 16, lineHeight: 1.55, color: 'var(--nx-text-2)', maxWidth: 620 }}>{sub}</p>}
          </div>
          {index && <div className="nx-display" style={{ fontSize: 'clamp(60px, 9vw, 120px)', lineHeight: 0.8, color: 'var(--nx-border-strong)', letterSpacing: '0.02em', userSelect: 'none' }}>{index}</div>}
        </header>
        {children}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────
// HERO
// ─────────────────────────────────────────────────────────────────────
export function KitHero({ brand }: { brand: Brand }) {
  return (
    <header className="nx-grid-bg nx-scanlines" style={{
      position: 'relative', overflow: 'hidden', borderBottom: '1px solid var(--nx-border)',
      background: `radial-gradient(ellipse 60% 70% at 80% 30%, ${brand.accent}1f, transparent 70%), radial-gradient(ellipse 50% 60% at 5% 90%, ${brand.accent2}14, transparent 70%), var(--nx-bg)`,
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '64px 56px 56px', position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
          <span style={{ width: 9, height: 9, background: brand.statusTone, boxShadow: `0 0 10px ${brand.statusTone}`, animation: 'kit-pulse 1.6s ease infinite' }} />
          <span className="nx-mono" style={{ fontSize: 11, color: 'var(--nx-text-2)', letterSpacing: '0.28em' }}>{brand.eyebrowMeta} · {brand.statusLabel}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginBottom: 22, flexWrap: 'wrap' }}>
          <div style={{ width: 76, height: 76, border: `1px solid ${brand.accent}`, background: 'var(--nx-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 30px -10px ${brand.accent}`, flexShrink: 0 }}>
            <CanvasMark id={brand.id} size={48} />
          </div>
          <h1 className="nx-display" style={{ fontSize: 'clamp(48px, 7vw, 96px)', lineHeight: 0.9, letterSpacing: '0.02em', margin: 0, color: 'var(--nx-text)' }}>
            {brand.name}<span style={{ color: brand.accent }}> · SOCIAL KIT</span>
          </h1>
        </div>
        <p style={{ maxWidth: 640, marginTop: 4, fontSize: 18, lineHeight: 1.55, color: 'var(--nx-text-2)' }}>
          {brand.essence} Everything you need to post on-brand — logos, colors, voice, ready-to-paste captions, and <strong style={{ color: 'var(--nx-text)' }}>editable post templates</strong> for every platform. Type your copy, drop your image, export a clean PNG.
        </p>
        <div style={{ marginTop: 30, display: 'flex', gap: 20, flexWrap: 'wrap', fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-muted)', letterSpacing: '0.16em' }}>
          {['INSTAGRAM', 'X / TWITTER', 'LINKEDIN', 'TIKTOK / REELS'].map((p) => (
            <span key={p}><span style={{ color: brand.accent }}>◇</span> {p}</span>
          ))}
        </div>
      </div>
    </header>
  )
}

// ─────────────────────────────────────────────────────────────────────
// BRAND ESSENTIALS
// ─────────────────────────────────────────────────────────────────────
export function BrandEssentials({ brand }: { brand: Brand }) {
  return (
    <KitSection id="essentials" index="01" eyebrow="ASSETS · GRAB & GO" accent={brand.accent}
      title={<>The brand <span style={{ color: brand.accent }}>at a glance.</span></>}
      sub="Copy a hex, lift a lockup, match the type. The fundamentals every post should hold to.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>

        {/* LOGO LOCKUP */}
        <div className="nx-panel" style={{ gridColumn: 'span 7', position: 'relative', padding: 0, overflow: 'hidden' }}>
          <Corners color={brand.accent} />
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--nx-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="nx-label" style={{ color: brand.accent }}>● PRIMARY LOCKUP</span>
            <span className="nx-mono" style={{ fontSize: 10, color: 'var(--nx-text-muted)', letterSpacing: '0.16em' }}>CLEARSPACE = MARK HEIGHT</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--nx-border)' }}>
            <LogoTile bg="#050C14"><Lockup brand={brand} /></LogoTile>
            <LogoTile bg="#0D1E30"><Lockup brand={brand} /></LogoTile>
            <LogoTile bg={brand.accent}><Lockup brand={brand} onLight /></LogoTile>
            <LogoTile bg="#050C14" stacked><LockupStacked brand={brand} /></LogoTile>
          </div>
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--nx-border)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="nx-mono" style={{ fontSize: 10, color: 'var(--nx-text-muted)', letterSpacing: '0.16em', flex: 1 }}>NEVER recolor the mark · NEVER stretch · NEVER add a drop shadow</span>
            <CopyButton small value={`${brand.name} — ${brand.essence}`} label="COPY NAME" />
          </div>
        </div>

        {/* COLORS */}
        <div className="nx-panel" style={{ gridColumn: 'span 5', position: 'relative', padding: 0, overflow: 'hidden' }}>
          <Corners color={brand.accent2} />
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--nx-border)' }}>
            <span className="nx-label" style={{ color: brand.accent2 }}>● PALETTE · CLICK TO COPY</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' }}>
            {brand.palette.map((c) => <Swatch key={c.name + c.hex} c={c} />)}
          </div>
        </div>

        {/* TYPE */}
        <div className="nx-panel" style={{ gridColumn: 'span 7', position: 'relative', padding: 20 }}>
          <Corners color={brand.accent} />
          <span className="nx-label" style={{ color: brand.accent }}>● TYPE SYSTEM</span>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <TypeRow role="DISPLAY" font="Bebas Neue" sample="OPERATE UNDER PRESSURE" style={{ fontFamily: 'var(--nx-display)', fontSize: 40, letterSpacing: '0.03em' }} />
            <TypeRow role="BODY" font="Barlow Condensed" sample="Workforce training for high-stakes outcomes." style={{ fontFamily: 'var(--nx-body)', fontSize: 22, fontWeight: 500 }} />
            <TypeRow role="MONO / TELEMETRY" font="Share Tech Mono" sample="SYS · v4.2 · ● LIVE" style={{ fontFamily: 'var(--nx-mono)', fontSize: 16, letterSpacing: '0.12em', color: brand.accent }} />
          </div>
        </div>

        {/* VOICE */}
        <div className="nx-panel" style={{ gridColumn: 'span 5', position: 'relative', padding: 20 }}>
          <Corners color="var(--nx-green)" />
          <span className="nx-label" style={{ color: 'var(--nx-green)' }}>● VOICE · SOCIAL REGISTER</span>
          <p style={{ fontSize: 13, color: 'var(--nx-text-2)', lineHeight: 1.5, margin: '12px 0 16px' }}>{brand.voice.register}</p>
          {brand.voice.do.map((t) => <VoiceRow key={t} tone="do" text={t} />)}
          {brand.voice.dont.map((t) => <VoiceRow key={t} tone="dont" text={t} />)}
        </div>
      </div>
    </KitSection>
  )
}

function LogoTile({ bg, children, stacked }: { bg: string; children: React.ReactNode; stacked?: boolean }) {
  return (
    <div style={{ background: bg, minHeight: stacked ? 150 : 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      {children}
    </div>
  )
}

function Lockup({ brand, onLight }: { brand: Brand; onLight?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      {onLight
        ? <span style={{ width: 34, height: 34, background: '#050C14', clipPath: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)' }} />
        : <CanvasMark id={brand.id} size={36} />}
      <span className="nx-display" style={{ fontSize: 30, letterSpacing: '0.16em', color: onLight ? '#050C14' : 'var(--nx-text)', whiteSpace: 'nowrap' }}>{brand.name}</span>
    </div>
  )
}

function LockupStacked({ brand }: { brand: Brand }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <CanvasMark id={brand.id} size={44} />
      <div className="nx-display" style={{ fontSize: 26, letterSpacing: '0.18em', color: 'var(--nx-text)', marginTop: 10, whiteSpace: 'nowrap' }}>{brand.name}</div>
      <div className="nx-mono" style={{ fontSize: 9, letterSpacing: '0.3em', color: 'var(--nx-text-muted)', marginTop: 4 }}>NEXUS MODULE</div>
    </div>
  )
}

function Swatch({ c }: { c: PaletteColor }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => { if (navigator.clipboard) void navigator.clipboard.writeText(c.hex); setDone(true); setTimeout(() => setDone(false), 1200) }}
      style={{
        border: '1px solid var(--nx-border)', background: c.hex, color: c.dark ? '#050C14' : '#8BA4BC',
        padding: '16px 14px', cursor: 'pointer', textAlign: 'left', minHeight: 78,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontFamily: 'var(--nx-mono)',
        outline: c.dark ? 'none' : '1px solid var(--nx-border-strong)', outlineOffset: -1,
      }}>
      <span style={{ fontSize: 10, letterSpacing: '0.14em' }}>{c.name}</span>
      <span style={{ fontSize: 13, letterSpacing: '0.1em', opacity: 0.92 }}>{done ? 'COPIED ✓' : c.hex}</span>
    </button>
  )
}

function TypeRow({ role, font, sample, style }: { role: string; font: string; sample: string; style?: React.CSSProperties }) {
  return (
    <div style={{ borderLeft: '2px solid var(--nx-border-strong)', paddingLeft: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span className="nx-mono" style={{ fontSize: 9.5, color: 'var(--nx-text-muted)', letterSpacing: '0.18em' }}>{role}</span>
        <span className="nx-mono" style={{ fontSize: 9.5, color: 'var(--nx-text-2)', letterSpacing: '0.12em' }}>{font}</span>
      </div>
      <div style={{ color: 'var(--nx-text)', lineHeight: 1.1, ...style }}>{sample}</div>
    </div>
  )
}

function VoiceRow({ tone, text }: { tone: 'do' | 'dont'; text: string }) {
  const ok = tone === 'do'
  const c = ok ? 'var(--nx-green)' : 'var(--nx-red)'
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0' }}>
      <span className="nx-mono" style={{ fontSize: 11, color: c, letterSpacing: '0.1em', flexShrink: 0, marginTop: 1 }}>{ok ? 'DO' : 'DON’T'}</span>
      <span style={{ fontSize: 13, color: 'var(--nx-text-2)', lineHeight: 1.4 }}>{text}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// CAPTION LIBRARY
// ─────────────────────────────────────────────────────────────────────
export function CaptionLibrary({ brand }: { brand: Brand }) {
  return (
    <KitSection id="captions" index="02" eyebrow="COPY · PASTE · POST" accent={brand.accent2}
      title={<>Captions, <span style={{ color: brand.accent2 }}>ready to fire.</span></>}
      sub="On-voice copy for the posts you'll write most. Tap copy, paste, tweak the specifics.">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {brand.captions.map((c) => <CaptionCard key={c.title} c={c} />)}
      </div>

      {/* 3C-2: AI Caption Studio */}
      <CaptionStudio accent={brand.accent2} />

      <div className="nx-panel" style={{ position: 'relative', padding: 20, marginTop: 16 }}>
        <Corners color={brand.accent} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span className="nx-label" style={{ color: brand.accent }}>● HASHTAG BANK</span>
          <CopyButton small value={Object.values(brand.hashtags).join(' ')} label="COPY ALL" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {Object.entries(brand.hashtags).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--nx-border)', background: 'rgba(0,0,0,0.25)', padding: '10px 12px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.18em', marginBottom: 4 }}>{k.toUpperCase()}</div>
                <div style={{ fontSize: 12.5, color: 'var(--nx-text-2)', lineHeight: 1.35 }}>{v}</div>
              </div>
              <CopyButton small value={v} label="COPY" />
            </div>
          ))}
        </div>
      </div>
    </KitSection>
  )
}

function CaptionCard({ c }: { c: BrandCaption }) {
  return (
    <div className="nx-panel" style={{ position: 'relative', padding: 0, overflow: 'hidden', borderTop: `2px solid ${c.tone}` }}>
      <Corners color={c.tone} />
      <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px dashed var(--nx-border)', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span className="nx-chip" style={{ color: c.tone, borderColor: `${c.tone}66`, background: `${c.tone}14`, flexShrink: 0 }}>{c.tag}</span>
          <span style={{ fontSize: 14, color: 'var(--nx-text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</span>
        </div>
        <CopyButton small value={c.body} label="COPY" />
      </div>
      <p style={{ padding: '16px 18px', margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--nx-text-2)', whiteSpace: 'pre-line', fontFamily: 'var(--nx-body)' }}>
        {c.body}
      </p>
    </div>
  )
}

export function KitFooter({ brand }: { brand: Brand }) {
  return (
    <footer style={{ background: 'var(--nx-bg)', borderTop: '2px solid var(--nx-border-strong)', padding: '40px 56px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14, fontFamily: 'var(--nx-mono)', fontSize: 10.5, color: 'var(--nx-text-muted)', letterSpacing: '0.18em' }}>
        <span>{brand.domain} · SOCIAL KIT — exports are PNG at 2× resolution</span>
        <span>© 2026 BIOLOOP NEXUS</span>
      </div>
    </footer>
  )
}
