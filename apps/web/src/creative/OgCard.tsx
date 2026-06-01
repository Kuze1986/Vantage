// OgCard.tsx — 1200×630 Open Graph share-card canvas, with an optional
// "Attach to piece" flow that uploads the PNG to vantage-media Storage.

import { useRef, useState } from 'react'
import { exportCanvasNode } from '../pages/socialkit/primitives'
import { CanvasMark } from '../pages/socialkit/CanvasMark'
import { EditableText, KitImageSlot } from '../pages/socialkit/primitives'
import { CanvasBG } from './canvasFurniture'
import { BRANDS } from './index'
import type { Brand, BrandId } from './index'
import { uploadDataUrl } from '../lib/storage'
import '../pages/socialkit/socialkit.css'

// ─────────────────────────────────────────────────────────────────────
// OG canvas  1200×630
// ─────────────────────────────────────────────────────────────────────
function OgCanvas({ brand, headline, sub, channel }: { brand: Brand; headline: string; sub: string; channel: string }) {
  return (
    <CanvasBG glow={brand.accent}>
      {/* background image slot */}
      <KitImageSlot label="DROP BACKGROUND IMAGE" overlay={0.75} />
      {/* corners */}
      <span style={{ position: 'absolute', top: 24, left: 24, width: 36, height: 36, borderTop: `3px solid ${brand.accent}`, borderLeft: `3px solid ${brand.accent}`, pointerEvents: 'none' }} />
      <span style={{ position: 'absolute', top: 24, right: 24, width: 36, height: 36, borderTop: `3px solid ${brand.accent}`, borderRight: `3px solid ${brand.accent}`, pointerEvents: 'none' }} />
      <span style={{ position: 'absolute', bottom: 24, left: 24, width: 36, height: 36, borderBottom: `3px solid ${brand.accent}`, borderLeft: `3px solid ${brand.accent}`, pointerEvents: 'none' }} />
      <span style={{ position: 'absolute', bottom: 24, right: 24, width: 36, height: 36, borderBottom: `3px solid ${brand.accent}`, borderRight: `3px solid ${brand.accent}`, pointerEvents: 'none' }} />

      <div style={{ position: 'absolute', inset: 0, padding: '44px 56px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <CanvasMark id={brand.id} size={28} />
            <span className="nx-display" style={{ fontSize: 24, letterSpacing: '0.18em', color: 'var(--nx-text)' }}>{brand.name}</span>
          </div>
          {channel && (
            <span className="nx-mono" style={{ fontSize: 14, color: brand.accent, letterSpacing: '0.2em', border: `1px solid ${brand.accent}`, padding: '4px 12px' }}>
              {channel.toUpperCase()}
            </span>
          )}
        </div>

        {/* Content */}
        <div>
          <span style={{ display: 'block', width: 50, height: 3, background: brand.accent, boxShadow: `0 0 10px ${brand.accent}`, marginBottom: 20 }} />
          <EditableText as="h2" text={headline} className="nx-display" style={{ margin: 0, fontSize: 64, lineHeight: 0.95, color: 'var(--nx-text)' }} />
          <EditableText as="p" text={sub} style={{ margin: '16px 0 0', fontSize: 22, lineHeight: 1.4, color: 'var(--nx-text-2)', fontFamily: 'var(--nx-body)', fontWeight: 500, maxWidth: 900 }} />
        </div>

        {/* Footer */}
        <div className="nx-mono" style={{ fontSize: 13, color: 'var(--nx-text-muted)', letterSpacing: '0.16em' }}>{brand.domain}</div>
      </div>
    </CanvasBG>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Public component
// ─────────────────────────────────────────────────────────────────────
export function OgCardStudio({
  pieceId,
  initialHeadline = '',
  initialSub = '',
  channel = '',
  brandId = 'vantage',
  exportScale = 2,
  onAttached,
}: {
  pieceId?: string
  initialHeadline?: string
  initialSub?: string
  channel?: string
  brandId?: BrandId
  exportScale?: number
  onAttached?: (url: string) => void
}) {
  const [headline, setHeadline] = useState(initialHeadline || 'PUT YOUR HEADLINE HERE')
  const [sub, setSub]           = useState(initialSub || 'A short description that appears in link previews.')
  const canvasRef = useRef<HTMLDivElement>(null)
  const [attaching, setAttaching] = useState(false)
  const [attached, setAttached]   = useState<string | null>(null)
  const [err, setErr]             = useState<string | null>(null)

  const brand = BRANDS[brandId]
  const DISPLAY = 480
  const scale   = DISPLAY / 1200
  const displayH = Math.round(630 * scale)

  const doExport = () => exportCanvasNode(canvasRef.current, 1200, 630, `${brand.id}-og-${pieceId ?? 'card'}.png`, exportScale)

  const doAttach = async () => {
    if (!canvasRef.current || !pieceId) return
    setAttaching(true); setErr(null)
    try {
      canvasRef.current.classList.add('kit-exporting')
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      const { toPng } = await import('html-to-image')
      const dataUrl = await toPng(canvasRef.current, { width: 1200, height: 630, pixelRatio: exportScale, backgroundColor: '#050C14', style: { transform: 'none', transformOrigin: 'top left', margin: '0' } })
      canvasRef.current.classList.remove('kit-exporting')
      const url = await uploadDataUrl(`og/${pieceId}.png`, dataUrl)
      setAttached(url)
      onAttached?.(url)
    } catch (e) {
      canvasRef.current?.classList.remove('kit-exporting')
      setErr(String((e as Error).message))
    } finally {
      setAttaching(false)
    }
  }

  return (
    <div className={`vg-socialkit ${brand.theme}`} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Text inputs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.16em', display: 'block', marginBottom: 3 }}>HEADLINE</label>
          <textarea rows={2} value={headline} onChange={(e) => setHeadline(e.target.value)} className="vg-input" style={{ width: '100%', resize: 'vertical', fontSize: 12, fontFamily: 'var(--nx-display)' }} />
        </div>
        <div>
          <label className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.16em', display: 'block', marginBottom: 3 }}>DESCRIPTION</label>
          <textarea rows={2} value={sub} onChange={(e) => setSub(e.target.value)} className="vg-input" style={{ width: '100%', resize: 'vertical', fontSize: 12 }} />
        </div>
      </div>

      {/* Canvas */}
      <div className="kit-frame" style={{ width: DISPLAY, height: displayH, position: 'relative', overflow: 'hidden', border: '1px solid var(--nx-border-strong)', background: '#050C14' }}>
        <div ref={canvasRef} className="kit-canvas" style={{ width: 1200, height: 630, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
          <OgCanvas brand={brand} headline={headline} sub={sub} channel={channel} />
        </div>
      </div>

      {err && <div className="vg-error">{err}</div>}
      {attached && <div className="vg-success" style={{ fontFamily: 'var(--nx-mono)', fontSize: 10 }}>✓ Attached: {attached}</div>}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={doExport} className="nx-btn" style={{ flex: 1, justifyContent: 'center', padding: '9px', fontSize: 10, letterSpacing: '0.16em', color: brand.accent, borderColor: brand.accent }}>↓ EXPORT PNG</button>
        {pieceId && (
          <button onClick={doAttach} disabled={attaching} className="nx-btn nx-btn--primary" style={{ flex: 1, justifyContent: 'center', padding: '9px', fontSize: 10, letterSpacing: '0.16em', color: brand.accent2, borderColor: brand.accent2, opacity: attaching ? 0.6 : 1 }}>
            {attaching ? 'UPLOADING…' : attached ? '✓ RE-ATTACH' : '☁ ATTACH TO PIECE'}
          </button>
        )}
      </div>
    </div>
  )
}
