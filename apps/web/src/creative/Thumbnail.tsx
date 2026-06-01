// Thumbnail.tsx — branded cover/thumbnail canvas for DemoForge video jobs.
// Sized to match the job's target_format: portrait 1080×1920 (TikTok/Instagram)
// or landscape 1920×1080 (LinkedIn). Background image slot accepts a captured
// frame dropped by the operator.

import { useRef, useState } from 'react'
import { exportCanvasNode } from '../pages/socialkit/primitives'
import { CanvasMark } from '../pages/socialkit/CanvasMark'
import { EditableText, KitImageSlot } from '../pages/socialkit/primitives'
import { CanvasCorners } from './canvasFurniture'
import { BRANDS } from './index'
import type { Brand, BrandId } from './index'
import '../pages/socialkit/socialkit.css'

type Format = 'tiktok' | 'instagram' | 'linkedin'

function dims(format: Format): { w: number; h: number; displayW: number } {
  if (format === 'linkedin') return { w: 1920, h: 1080, displayW: 480 }
  return { w: 1080, h: 1920, displayW: 240 }
}

// ─────────────────────────────────────────────────────────────────────
// Thumbnail canvas
// ─────────────────────────────────────────────────────────────────────
function ThumbnailCanvas({ brand, title, sub, format }: { brand: Brand; title: string; sub: string; format: Format }) {
  const landscape = format === 'linkedin'
  const pad       = landscape ? 72 : 96

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#050C14', overflow: 'hidden' }}>
      {/* Background image slot */}
      <KitImageSlot label="DROP FRAME / SCREENSHOT" overlay={landscape ? 0.65 : 0.75} />

      {/* Grid overlay */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(rgba(0,196,232,0.03) 1px, transparent 1px) 0 0 / 60px 60px, linear-gradient(90deg, rgba(0,196,232,0.03) 1px, transparent 1px) 0 0 / 60px 60px', pointerEvents: 'none' }} />

      <CanvasCorners color={brand.accent} pad={landscape ? 32 : 40} len={landscape ? 40 : 54} weight={3} />

      {/* Top bar */}
      <div style={{ position: 'absolute', top: pad, left: pad, right: pad, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: landscape ? 14 : 20 }}>
          <CanvasMark id={brand.id} size={landscape ? 28 : 36} />
          <span className="nx-display" style={{ fontSize: landscape ? 22 : 30, letterSpacing: '0.18em', color: 'var(--nx-text)' }}>{brand.name}</span>
        </div>
        <span className="nx-mono" style={{ fontSize: landscape ? 14 : 18, color: brand.statusTone, letterSpacing: '0.2em' }}>● {brand.statusLabel}</span>
      </div>

      {/* Bottom content */}
      <div style={{ position: 'absolute', left: pad, right: pad, bottom: pad }}>
        <span style={{ display: 'block', width: 50, height: 3, background: brand.accent, boxShadow: `0 0 10px ${brand.accent}`, marginBottom: landscape ? 16 : 24 }} />
        <EditableText
          as="h2"
          text={title}
          className="nx-display"
          style={{ margin: 0, fontSize: landscape ? 72 : 88, lineHeight: 0.95, color: 'var(--nx-text)' }}
        />
        <EditableText
          as="p"
          text={sub}
          style={{ margin: `${landscape ? 14 : 20}px 0 0`, fontSize: landscape ? 22 : 28, lineHeight: 1.4, color: 'var(--nx-text-2)', fontFamily: 'var(--nx-body)', fontWeight: 500, maxWidth: landscape ? 1200 : 880 }}
        />
        <div style={{ marginTop: landscape ? 18 : 28, display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, border: `1px solid ${brand.accent}`, background: `${brand.accent}1a`, padding: landscape ? '8px 16px' : '10px 20px' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: brand.accent, boxShadow: `0 0 10px ${brand.accent}` }} />
            <span className="nx-mono" style={{ fontSize: landscape ? 14 : 18, color: brand.accent, letterSpacing: '0.2em' }}>WATCH NOW</span>
          </span>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Public component
// ─────────────────────────────────────────────────────────────────────
export function ThumbnailStudio({
  jobId,
  format = 'tiktok',
  brandId = 'vantage',
  exportScale = 2,
}: {
  jobId?: string
  format?: Format
  brandId?: BrandId
  exportScale?: number
}) {
  const [title, setTitle]   = useState('YOUR DEMO TITLE')
  const [sub, setSub]       = useState('Watch how it works in under 90 seconds.')
  const canvasRef = useRef<HTMLDivElement>(null)

  const brand = BRANDS[brandId]
  const { w, h, displayW } = dims(format)
  const scale   = displayW / w
  const displayH = Math.round(h * scale)

  const doExport = () => exportCanvasNode(canvasRef.current, w, h, `${brand.id}-thumb-${jobId ?? format}.png`, exportScale)

  return (
    <div className={`vg-socialkit ${brand.theme}`} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.14em', display: 'block', marginBottom: 3 }}>TITLE</label>
          <textarea rows={2} value={title} onChange={(e) => setTitle(e.target.value)} className="vg-input" style={{ width: '100%', fontSize: 12, fontFamily: 'var(--nx-display)', resize: 'vertical' }} />
        </div>
        <div>
          <label className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.14em', display: 'block', marginBottom: 3 }}>SUBTITLE</label>
          <textarea rows={2} value={sub} onChange={(e) => setSub(e.target.value)} className="vg-input" style={{ width: '100%', fontSize: 12, resize: 'vertical' }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="kit-frame" style={{ width: displayW, height: displayH, position: 'relative', overflow: 'hidden', border: '1px solid var(--nx-border-strong)', background: '#050C14', flexShrink: 0 }}>
          <div ref={canvasRef} className="kit-canvas" style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
            <ThumbnailCanvas brand={brand} title={title} sub={sub} format={format} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 120 }}>
          <span className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.14em' }}>{w}×{h} · {format.toUpperCase()}</span>
          <button onClick={doExport} className="nx-btn" style={{ justifyContent: 'center', padding: '8px', fontSize: 10, letterSpacing: '0.14em', color: brand.accent, borderColor: brand.accent }}>↓ EXPORT PNG</button>
        </div>
      </div>
    </div>
  )
}
