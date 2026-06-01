// QuoteCard.tsx — branded pull-quote canvases (1080² square + 1080×1920 story).
// Used from the Social Kit "Quote" tab and the Queue "Quotify" action.

import { useState } from 'react'
import { BRANDS, BRAND_ORDER } from './index'
import type { Brand, BrandId } from './index'
import { CanvasMark } from '../pages/socialkit/CanvasMark'
import { EditableText } from '../pages/socialkit/primitives'
import { CanvasBG, CanvasCorners } from './canvasFurniture'
import { ExportCard } from './ExportCard'
import '../pages/socialkit/socialkit.css'

// ─────────────────────────────────────────────────────────────────────
// Quote square canvas  1080×1080
// ─────────────────────────────────────────────────────────────────────
function QuoteSquareCanvas({ brand, quote, attribution }: { brand: Brand; quote: string; attribution: string }) {
  return (
    <CanvasBG glow={brand.accent}>
      <CanvasCorners color={brand.accent} />
      <div style={{ position: 'absolute', inset: 0, padding: 96, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 48 }}>
          <span style={{ display: 'block', width: 60, height: 4, background: brand.accent, boxShadow: `0 0 16px ${brand.accent}` }} />
          <span className="nx-mono" style={{ fontSize: 18, color: brand.accent, letterSpacing: '0.3em' }}>QUOTE</span>
        </div>

        <div style={{ marginBottom: 12, fontSize: 120, lineHeight: 0.7, color: `${brand.accent}30`, fontFamily: 'var(--nx-display)', userSelect: 'none' }}>"</div>
        <EditableText
          as="p"
          text={quote}
          className="nx-display"
          style={{ margin: 0, fontSize: 72, lineHeight: 1.05, color: 'var(--nx-text)', letterSpacing: '0.01em' }}
        />
        <div style={{ marginTop: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <CanvasMark id={brand.id} size={28} />
            <div>
              <EditableText as="div" text={attribution} multiline={false} className="nx-mono" style={{ fontSize: 18, color: 'var(--nx-text-2)', letterSpacing: '0.1em' }} />
            </div>
          </div>
          <EditableText as="div" text={brand.handle} multiline={false} className="nx-mono" style={{ fontSize: 18, color: 'var(--nx-text-muted)', letterSpacing: '0.18em' }} />
        </div>
      </div>
    </CanvasBG>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Quote story canvas  1080×1920
// ─────────────────────────────────────────────────────────────────────
function QuoteStoryCanvas({ brand, quote, attribution }: { brand: Brand; quote: string; attribution: string }) {
  return (
    <CanvasBG glow={brand.accent2}>
      <CanvasCorners color={brand.accent2} pad={40} len={54} />
      <div style={{ position: 'absolute', top: 96, left: 96, right: 96, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <CanvasMark id={brand.id} size={36} />
          <span className="nx-display" style={{ fontSize: 32, letterSpacing: '0.18em', color: 'var(--nx-text)' }}>{brand.name}</span>
        </div>
        <span className="nx-mono" style={{ fontSize: 18, color: brand.accent2, letterSpacing: '0.2em' }}>● {brand.statusLabel}</span>
      </div>
      <div style={{ position: 'absolute', left: 96, right: 96, top: '50%', transform: 'translateY(-55%)' }}>
        <span style={{ display: 'block', width: 80, height: 5, background: brand.accent2, boxShadow: `0 0 16px ${brand.accent2}`, marginBottom: 40 }} />
        <div style={{ fontSize: 140, lineHeight: 0.7, color: `${brand.accent2}30`, fontFamily: 'var(--nx-display)', userSelect: 'none' }}>"</div>
        <EditableText
          as="p"
          text={quote}
          className="nx-display"
          style={{ margin: '16px 0 0', fontSize: 88, lineHeight: 1.0, color: 'var(--nx-text)', letterSpacing: '0.01em' }}
        />
        <EditableText
          as="div"
          text={attribution}
          multiline={false}
          className="nx-mono"
          style={{ marginTop: 48, fontSize: 24, color: 'var(--nx-text-2)', letterSpacing: '0.16em' }}
        />
      </div>
      <div style={{ position: 'absolute', bottom: 96, left: 96, right: 96 }}>
        <EditableText as="div" text={brand.handle} multiline={false} className="nx-mono" style={{ fontSize: 24, color: brand.accent2, letterSpacing: '0.18em' }} />
      </div>
    </CanvasBG>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Public component — full quote card UI with module selector + text inputs
// ─────────────────────────────────────────────────────────────────────
export function QuoteCardStudio({
  initialQuote = '',
  initialBrandId = 'vantage',
  exportScale = 2,
}: {
  initialQuote?: string
  initialBrandId?: BrandId
  exportScale?: number
}) {
  const [activeBrand, setActiveBrand] = useState<BrandId>(initialBrandId)
  const [quote, setQuote]             = useState(initialQuote || 'The best channel is the one you haven\'t tried yet.')
  const [attribution, setAttribution] = useState('— VANTAGE')

  const brand = BRANDS[activeBrand]

  return (
    <div className={`vg-socialkit ${brand.theme}`}>
      {/* Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        {/* Module picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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

        {/* Quote text */}
        <div>
          <label className="nx-mono" style={{ fontSize: 10, color: 'var(--nx-text-muted)', letterSpacing: '0.16em', display: 'block', marginBottom: 4 }}>QUOTE TEXT</label>
          <textarea
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            rows={3}
            className="vg-input"
            style={{ width: '100%', resize: 'vertical', fontSize: 13, fontFamily: 'var(--nx-body)' }}
            placeholder="Enter the quote…"
          />
        </div>
        <div>
          <label className="nx-mono" style={{ fontSize: 10, color: 'var(--nx-text-muted)', letterSpacing: '0.16em', display: 'block', marginBottom: 4 }}>ATTRIBUTION</label>
          <input
            value={attribution}
            onChange={(e) => setAttribution(e.target.value)}
            className="vg-input"
            style={{ width: '100%', fontSize: 12 }}
            placeholder="— Source name"
          />
        </div>
      </div>

      {/* Canvas cards */}
      <div className="kit-gallery">
        <ExportCard label="INSTAGRAM · SQUARE" w={1080} h={1080} displayW={380} accent={brand.accent} exportScale={exportScale} filename={`${brand.id}-quote-square.png`}>
          <QuoteSquareCanvas brand={brand} quote={quote} attribution={attribution} />
        </ExportCard>
        <ExportCard label="STORY · REEL" w={1080} h={1920} displayW={250} accent={brand.accent2} exportScale={exportScale} filename={`${brand.id}-quote-story.png`}>
          <QuoteStoryCanvas brand={brand} quote={quote} attribution={attribution} />
        </ExportCard>
      </div>
    </div>
  )
}
