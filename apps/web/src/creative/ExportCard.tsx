// ExportCard.tsx — generic scaled-canvas wrapper with EXPORT PNG button.
// Any creative tool wraps its canvas children in this to get the scaled preview
// frame + export behaviour for free.

import React, { useRef, useState } from 'react'
import { exportCanvasNode } from '../pages/socialkit/primitives'

export function ExportCard({
  label,
  w,
  h,
  displayW,
  accent = 'var(--nx-accent)',
  filename,
  exportScale = 2,
  children,
}: {
  label?: string
  w: number
  h: number
  displayW: number
  accent?: string
  filename: string
  exportScale?: number
  children: React.ReactNode
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const scale    = displayW / w
  const displayH = Math.round(h * scale)

  const doExport = async () => {
    setBusy(true)
    await exportCanvasNode(canvasRef.current, w, h, filename, exportScale)
    setBusy(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {label && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ width: 7, height: 7, background: accent, boxShadow: `0 0 8px ${accent}`, flexShrink: 0 }} />
          <span className="nx-mono" style={{ fontSize: 11, color: 'var(--nx-text)', letterSpacing: '0.16em' }}>{label}</span>
          <span className="nx-mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--nx-text-muted)' }}>{w}×{h}</span>
        </div>
      )}
      <div className="kit-frame" style={{ width: displayW, height: displayH, position: 'relative', overflow: 'hidden', border: '1px solid var(--nx-border-strong)', background: '#050C14', flexShrink: 0 }}>
        <div ref={canvasRef} className="kit-canvas" style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
          {children}
        </div>
      </div>
      <button
        onClick={doExport}
        disabled={busy}
        className="nx-btn nx-btn--primary"
        style={{ marginTop: 10, justifyContent: 'center', padding: '11px 14px', fontSize: 11, letterSpacing: '0.18em', borderColor: accent, color: accent, opacity: busy ? 0.6 : 1, width: displayW }}
      >
        {busy ? 'RENDERING…' : '↓ EXPORT PNG'}
      </button>
    </div>
  )
}
