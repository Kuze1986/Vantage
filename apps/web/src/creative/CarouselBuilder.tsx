// CarouselBuilder.tsx — multi-slide carousel composer (2–10 slides).
// Slide types: cover / point / stat / quote / cta.
// Exports numbered PNGs (brand-id-carousel-01.png … -NN.png) via the shared
// exportCanvasNode engine.

import { useRef, useState } from 'react'
import { exportCanvasNode } from '../pages/socialkit/primitives'
import { CanvasMark } from '../pages/socialkit/CanvasMark'
import { EditableText } from '../pages/socialkit/primitives'
import { CanvasBG, CanvasCorners } from './canvasFurniture'
import { BRANDS, BRAND_ORDER } from './index'
import type { Brand, BrandId } from './index'
import '../pages/socialkit/socialkit.css'

// ─────────────────────────────────────────────────────────────────────
// Slide model
// ─────────────────────────────────────────────────────────────────────
type SlideType = 'cover' | 'point' | 'stat' | 'quote' | 'cta'

interface Slide {
  id: string
  type: SlideType
  heading: string
  body: string
  stat?: string
  statLabel?: string
}

function makeSlide(type: SlideType, n: number): Slide {
  const id = Math.random().toString(36).slice(2)
  switch (type) {
    case 'cover': return { id, type, heading: 'THE HEADLINE', body: 'Swipe to learn more.' }
    case 'point': return { id, type, heading: `POINT ${n}`, body: 'Describe the insight here.' }
    case 'stat':  return { id, type, heading: 'KEY STAT', body: 'Context for the number.', stat: '42', statLabel: 'LABEL' }
    case 'quote': return { id, type, heading: '"THE QUOTE"', body: '— Attribution' }
    case 'cta':   return { id, type, heading: 'GET STARTED', body: 'Link in bio.' }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Individual slide canvases  1080×1080
// ─────────────────────────────────────────────────────────────────────
function SlideCanvas({ slide, brand, index, total }: { slide: Slide; brand: Brand; index: number; total: number }) {
  const accentA = index % 2 === 0 ? brand.accent : brand.accent2
  const accentB = index % 2 === 0 ? brand.accent2 : brand.accent

  const Dots = () => (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} style={{ width: 12, height: 12, borderRadius: '50%', background: i === index ? accentA : 'rgba(200,220,240,0.25)' }} />
      ))}
    </div>
  )

  switch (slide.type) {
    case 'cover':
      return (
        <CanvasBG glow={brand.accent}>
          <CanvasCorners color={brand.accent} />
          <div style={{ position: 'absolute', inset: 0, padding: 96, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <CanvasMark id={brand.id} size={32} />
                <span className="nx-display" style={{ fontSize: 28, letterSpacing: '0.18em', color: 'var(--nx-text)' }}>{brand.name}</span>
              </div>
              <Dots />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <span style={{ display: 'block', width: 60, height: 4, background: brand.accent, boxShadow: `0 0 14px ${brand.accent}`, marginBottom: 32 }} />
              <EditableText as="h1" text={slide.heading} className="nx-display" style={{ margin: 0, fontSize: 120, lineHeight: 0.95, color: 'var(--nx-text)' }} />
              <EditableText as="p" text={slide.body} style={{ margin: '32px 0 0', fontSize: 30, lineHeight: 1.45, color: 'var(--nx-text-2)', fontFamily: 'var(--nx-body)', fontWeight: 500, maxWidth: 760 }} />
            </div>
            <div className="nx-mono" style={{ fontSize: 18, color: brand.accent, letterSpacing: '0.2em' }}>SWIPE ▶</div>
          </div>
        </CanvasBG>
      )

    case 'point':
      return (
        <CanvasBG glow={accentA}>
          <CanvasCorners color={accentA} />
          <div style={{ position: 'absolute', inset: 0, padding: 96, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                <span className="nx-display" style={{ fontSize: 80, color: `${accentA}40`, lineHeight: 1 }}>{String(index + 1).padStart(2, '0')}</span>
                <span className="nx-mono" style={{ fontSize: 18, color: accentA, letterSpacing: '0.24em' }}>OF {String(total).padStart(2, '0')}</span>
              </div>
              <Dots />
            </div>
            <EditableText as="h2" text={slide.heading} className="nx-display" style={{ margin: 0, fontSize: 88, lineHeight: 1.0, color: 'var(--nx-text)' }} />
            <span style={{ display: 'block', width: 80, height: 4, background: accentA, boxShadow: `0 0 12px ${accentA}`, margin: '32px 0' }} />
            <EditableText as="p" text={slide.body} style={{ margin: 0, fontSize: 32, lineHeight: 1.5, color: 'var(--nx-text-2)', fontFamily: 'var(--nx-body)', fontWeight: 500, maxWidth: 880 }} />
            <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <CanvasMark id={brand.id} size={24} />
              <span className="nx-mono" style={{ fontSize: 16, color: 'var(--nx-text-muted)' }}>{brand.handle}</span>
            </div>
          </div>
        </CanvasBG>
      )

    case 'stat':
      return (
        <CanvasBG glow={accentB}>
          <CanvasCorners color={accentB} />
          <div style={{ position: 'absolute', inset: 0, padding: 96, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
            <Dots />
            <div style={{ margin: '40px 0 24px' }}>
              <EditableText as="div" text={slide.stat ?? '—'} multiline={false} className="nx-display" style={{ fontSize: 220, lineHeight: 0.85, color: accentB, letterSpacing: '-0.02em' }} />
              <EditableText as="div" text={slide.statLabel ?? ''} multiline={false} className="nx-mono" style={{ fontSize: 24, color: 'var(--nx-text-muted)', letterSpacing: '0.28em', marginTop: 14 }} />
            </div>
            <span style={{ display: 'block', width: 60, height: 4, background: accentB, boxShadow: `0 0 12px ${accentB}`, margin: '0 auto 28px' }} />
            <EditableText as="h2" text={slide.heading} className="nx-display" style={{ margin: 0, fontSize: 56, lineHeight: 1.0, color: 'var(--nx-text)', maxWidth: 780 }} />
            <EditableText as="p" text={slide.body} style={{ margin: '20px auto 0', fontSize: 26, lineHeight: 1.45, color: 'var(--nx-text-2)', fontFamily: 'var(--nx-body)', fontWeight: 500, maxWidth: 680 }} />
          </div>
        </CanvasBG>
      )

    case 'quote':
      return (
        <CanvasBG glow={brand.accent}>
          <CanvasCorners color={brand.accent} />
          <div style={{ position: 'absolute', inset: 0, padding: 96, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Dots />
            <div style={{ fontSize: 200, lineHeight: 0.7, color: `${brand.accent}22`, fontFamily: 'var(--nx-display)', userSelect: 'none', marginTop: 20 }}>"</div>
            <EditableText as="h2" text={slide.heading} className="nx-display" style={{ margin: '8px 0 0', fontSize: 80, lineHeight: 1.05, color: 'var(--nx-text)' }} />
            <EditableText as="p" text={slide.body} style={{ margin: '32px 0 0', fontSize: 28, color: 'var(--nx-text-2)', fontFamily: 'var(--nx-body)', fontWeight: 500 }} />
            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              <CanvasMark id={brand.id} size={24} />
              <span className="nx-mono" style={{ fontSize: 16, color: 'var(--nx-text-muted)', letterSpacing: '0.14em' }}>{brand.handle}</span>
            </div>
          </div>
        </CanvasBG>
      )

    case 'cta':
      return (
        <CanvasBG glow={brand.accent2}>
          <CanvasCorners color={brand.accent2} pad={40} len={54} weight={4} />
          <div style={{ position: 'absolute', inset: 0, padding: 96, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
            <CanvasMark id={brand.id} size={64} />
            <div style={{ marginTop: 40 }}>
              <EditableText as="h2" text={slide.heading} className="nx-display" style={{ margin: 0, fontSize: 100, lineHeight: 0.95, color: 'var(--nx-text)' }} />
              <EditableText as="p" text={slide.body} style={{ margin: '28px auto 0', fontSize: 30, lineHeight: 1.45, color: 'var(--nx-text-2)', fontFamily: 'var(--nx-body)', fontWeight: 500, maxWidth: 680 }} />
            </div>
            <div style={{ marginTop: 56, display: 'inline-flex', alignItems: 'center', gap: 14, background: `linear-gradient(180deg, ${brand.accent2}2e, ${brand.accent2}12)`, border: `2px solid ${brand.accent2}`, padding: '22px 48px', boxShadow: `0 0 30px -6px ${brand.accent2}` }}>
              <span style={{ color: brand.accent2, fontSize: 28 }}>▶</span>
              <span className="nx-display" style={{ fontSize: 28, letterSpacing: '0.16em', color: brand.accent2, textTransform: 'uppercase' }}>{brand.handle}</span>
            </div>
          </div>
        </CanvasBG>
      )
  }
}

// ─────────────────────────────────────────────────────────────────────
// Scaled slide thumbnail (for the rail)
// ─────────────────────────────────────────────────────────────────────
function SlideThumbnail({ slide, brand, index, total, selected, onClick }: { slide: Slide; brand: Brand; index: number; total: number; selected: boolean; onClick: () => void }) {
  const THUMB = 120
  const scale = THUMB / 1080
  return (
    <div
      onClick={onClick}
      style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}
    >
      <div style={{
        width: THUMB, height: THUMB, position: 'relative', overflow: 'hidden',
        border: `2px solid ${selected ? brand.accent : 'var(--nx-border)'}`,
        boxShadow: selected ? `0 0 12px -3px ${brand.accent}` : 'none',
        borderRadius: 3,
      }}>
        <div className={`kit-canvas ${brand.theme}`} style={{ width: 1080, height: 1080, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
          <SlideCanvas slide={slide} brand={brand} index={index} total={total} />
        </div>
      </div>
      <span className="nx-mono" style={{ fontSize: 8, color: selected ? brand.accent : 'var(--nx-text-muted)', letterSpacing: '0.12em' }}>
        {String(index + 1).padStart(2, '0')} {slide.type.toUpperCase()}
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────
export function CarouselBuilder({ initialBrandId = 'vantage', exportScale = 2 }: { initialBrandId?: BrandId; exportScale?: number }) {
  const [activeBrand, setActiveBrand] = useState<BrandId>(initialBrandId)
  const [slides, setSlides] = useState<Slide[]>([
    makeSlide('cover', 1),
    makeSlide('point', 1),
    makeSlide('point', 2),
    makeSlide('cta', 4),
  ])
  const [selected, setSelected]   = useState(0)
  const [exporting, setExporting] = useState(false)
  const slideRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const brand = BRANDS[activeBrand]

  const addSlide = (type: SlideType) => {
    const n = slides.filter((s) => s.type === type).length + 1
    const ns = makeSlide(type, n)
    const newSlides = [...slides.slice(0, selected + 1), ns, ...slides.slice(selected + 1)]
    setSlides(newSlides)
    setSelected(selected + 1)
  }

  const removeSlide = (i: number) => {
    if (slides.length <= 1) return
    const next = [...slides]; next.splice(i, 1)
    setSlides(next)
    setSelected(Math.min(selected, next.length - 1))
  }

  const moveSlide = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= slides.length) return
    const next = [...slides]; [next[i], next[j]] = [next[j], next[i]]
    setSlides(next); setSelected(j)
  }

  const updateSlide = (i: number, patch: Partial<Slide>) =>
    setSlides((prev) => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s))

  const exportAll = async () => {
    setExporting(true)
    for (let i = 0; i < slides.length; i++) {
      const node = slideRefs.current.get(slides[i].id) ?? null
      const num  = String(i + 1).padStart(2, '0')
      await exportCanvasNode(node, 1080, 1080, `${brand.id}-carousel-${num}.png`, exportScale)
    }
    setExporting(false)
  }

  const cur = slides[selected]

  return (
    <div className={`vg-socialkit ${brand.theme}`}>
      {/* Module picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <span className="nx-mono" style={{ fontSize: 10, color: 'var(--nx-text-muted)', letterSpacing: '0.2em', flexShrink: 0 }}>MODULE ▸</span>
        {BRAND_ORDER.map((id) => {
          const b = BRANDS[id]; const on = id === activeBrand
          return (
            <button key={id} type="button" onClick={() => setActiveBrand(id)} className={b.theme}
              style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontFamily: 'var(--nx-display)', fontSize: 13, letterSpacing: '0.12em', padding: '5px 10px', background: on ? `${b.accent}1c` : 'transparent', border: `1px solid ${on ? b.accent : 'var(--nx-border-strong)'}`, color: on ? '#E8F4FF' : 'var(--nx-text-2)', borderRadius: 4, boxShadow: on ? `0 0 16px -6px ${b.accent}` : 'none', transition: 'all 120ms' }}>
              <CanvasMark id={id} size={14} />{b.name}
            </button>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>

        {/* ── Left: slide rail + canvas ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Slide rail */}
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {slides.map((s, i) => (
              <SlideThumbnail key={s.id} slide={s} brand={brand} index={i} total={slides.length} selected={i === selected} onClick={() => setSelected(i)} />
            ))}
          </div>

          {/* Full-size preview + export button */}
          {cur && (() => {
            const DISPLAY = 540
            const scale   = DISPLAY / 1080
            return (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="kit-frame" style={{ width: DISPLAY, height: DISPLAY, position: 'relative', overflow: 'hidden', border: '1px solid var(--nx-border-strong)', background: '#050C14' }}>
                  <div
                    ref={(el) => { if (el) slideRefs.current.set(cur.id, el) }}
                    className={`kit-canvas ${brand.theme}`}
                    style={{ width: 1080, height: 1080, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}
                  >
                    <SlideCanvas slide={cur} brand={brand} index={selected} total={slides.length} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={() => { void exportCanvasNode(slideRefs.current.get(cur.id) ?? null, 1080, 1080, `${brand.id}-carousel-${String(selected + 1).padStart(2, '0')}.png`, exportScale) }} className="nx-btn" style={{ flex: 1, justifyContent: 'center', padding: '9px', fontSize: 10, letterSpacing: '0.16em', color: brand.accent, borderColor: brand.accent }}>↓ THIS SLIDE</button>
                  <button onClick={exportAll} disabled={exporting} className="nx-btn nx-btn--primary" style={{ flex: 1, justifyContent: 'center', padding: '9px', fontSize: 10, letterSpacing: '0.16em', color: brand.accent, borderColor: brand.accent, opacity: exporting ? 0.6 : 1 }}>
                    {exporting ? 'EXPORTING…' : `↓ ALL ${slides.length} SLIDES`}
                  </button>
                </div>
              </div>
            )
          })()}
        </div>

        {/* ── Right: slide editor + controls ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Add slide */}
          <div style={{ border: '1px solid var(--nx-border)', borderRadius: 6, padding: 12 }}>
            <div className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.18em', marginBottom: 8 }}>ADD SLIDE AFTER CURRENT</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(['cover', 'point', 'stat', 'quote', 'cta'] as SlideType[]).map((t) => (
                <button key={t} type="button" onClick={() => addSlide(t)} disabled={slides.length >= 10}
                  style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, padding: '4px 10px', cursor: 'pointer', border: '1px solid var(--nx-border)', borderRadius: 3, background: 'var(--nx-surface-2)', color: 'var(--nx-text-3)', letterSpacing: '0.1em' }}>
                  + {t}
                </button>
              ))}
            </div>
            <div className="nx-mono" style={{ fontSize: 8, color: 'var(--nx-text-4)', marginTop: 6 }}>{slides.length}/10 slides</div>
          </div>

          {/* Current slide editor */}
          {cur && (
            <div style={{ border: '1px solid var(--nx-border)', borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="nx-mono" style={{ fontSize: 9, color: brand.accent, letterSpacing: '0.18em' }}>SLIDE {selected + 1} · {cur.type.toUpperCase()}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" onClick={() => moveSlide(selected, -1)} disabled={selected === 0} style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, background: 'none', border: '1px solid var(--nx-border)', borderRadius: 3, padding: '2px 6px', cursor: 'pointer', color: 'var(--nx-text-4)' }}>↑</button>
                  <button type="button" onClick={() => moveSlide(selected, 1)} disabled={selected === slides.length - 1} style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, background: 'none', border: '1px solid var(--nx-border)', borderRadius: 3, padding: '2px 6px', cursor: 'pointer', color: 'var(--nx-text-4)' }}>↓</button>
                  <button type="button" onClick={() => removeSlide(selected)} style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, background: 'none', border: '1px solid var(--nx-border)', borderRadius: 3, padding: '2px 6px', cursor: 'pointer', color: '#ef4444' }}>✕</button>
                </div>
              </div>

              <div>
                <label className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.14em', display: 'block', marginBottom: 3 }}>HEADING</label>
                <textarea rows={2} value={cur.heading} onChange={(e) => updateSlide(selected, { heading: e.target.value })} className="vg-input" style={{ width: '100%', resize: 'vertical', fontSize: 11, fontFamily: 'var(--nx-display)' }} />
              </div>
              <div>
                <label className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.14em', display: 'block', marginBottom: 3 }}>BODY</label>
                <textarea rows={3} value={cur.body} onChange={(e) => updateSlide(selected, { body: e.target.value })} className="vg-input" style={{ width: '100%', resize: 'vertical', fontSize: 11 }} />
              </div>
              {cur.type === 'stat' && (
                <>
                  <div>
                    <label className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.14em', display: 'block', marginBottom: 3 }}>STAT VALUE</label>
                    <input value={cur.stat ?? ''} onChange={(e) => updateSlide(selected, { stat: e.target.value })} className="vg-input" style={{ width: '100%', fontSize: 13, fontFamily: 'var(--nx-display)' }} />
                  </div>
                  <div>
                    <label className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.14em', display: 'block', marginBottom: 3 }}>STAT LABEL</label>
                    <input value={cur.statLabel ?? ''} onChange={(e) => updateSlide(selected, { statLabel: e.target.value })} className="vg-input" style={{ width: '100%', fontSize: 11 }} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Paste outline seed */}
          <PasteSeed onSeed={(lines) => {
            const newSlides: Slide[] = [
              makeSlide('cover', 1),
              ...lines.map((l, i) => ({ ...makeSlide('point', i + 1), heading: l.slice(0, 60).toUpperCase(), body: l })),
              makeSlide('cta', lines.length + 2),
            ]
            setSlides(newSlides); setSelected(0)
          }} />
        </div>
      </div>

      {/* Hidden full-res canvases for non-selected slides (for batch export) */}
      <div style={{ position: 'absolute', left: -99999, top: 0, visibility: 'hidden', pointerEvents: 'none' }}>
        {slides.map((s, i) => i !== selected && (
          <div key={s.id} ref={(el) => { if (el) slideRefs.current.set(s.id, el) }} className={`kit-canvas ${brand.theme}`} style={{ width: 1080, height: 1080, position: 'relative' }}>
            <SlideCanvas slide={s} brand={brand} index={i} total={slides.length} />
          </div>
        ))}
      </div>
    </div>
  )
}

function PasteSeed({ onSeed }: { onSeed: (lines: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const parse = () => {
    const lines = text.split('\n').map((l) => l.replace(/^[\d.\-*•]+\s*/, '').trim()).filter(Boolean)
    if (lines.length) { onSeed(lines); setOpen(false); setText('') }
  }
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--nx-mono)', fontSize: 9, letterSpacing: '0.1em', padding: '7px 10px', border: `1px solid ${open ? 'var(--nx-accent)' : 'var(--nx-border)'}`, borderRadius: 4, background: open ? 'rgba(0,196,232,0.04)' : 'var(--nx-surface-2)', color: open ? 'var(--nx-accent)' : 'var(--nx-text-3)' }}>
        {open ? '▾' : '▸'}&ensp;📋 PASTE OUTLINE → SEED SLIDES
      </button>
      {open && (
        <div style={{ marginTop: 6, border: '1px solid var(--nx-accent)', borderRadius: 4, padding: 10, background: 'rgba(0,196,232,0.03)' }}>
          <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 8, color: 'var(--nx-text-4)', marginBottom: 8, lineHeight: 1.7 }}>
            One line per slide point. Numbered lists, bullets, or plain lines. Cover + CTA added automatically.
          </p>
          <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} className="vg-input" placeholder={"1. First point\n2. Second point\n3. Third point"} style={{ width: '100%', fontSize: 10, fontFamily: 'var(--nx-mono)', marginBottom: 8, resize: 'vertical' }} />
          <button type="button" onClick={parse} disabled={!text.trim()} className="nx-btn" style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, padding: '5px 14px', background: 'var(--nx-accent)', color: '#000', border: 'none', borderRadius: 3, opacity: text.trim() ? 1 : 0.4, cursor: text.trim() ? 'pointer' : 'not-allowed' }}>
            Seed slides →
          </button>
        </div>
      )}
    </div>
  )
}
