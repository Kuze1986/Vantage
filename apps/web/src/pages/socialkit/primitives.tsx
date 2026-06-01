// primitives.tsx — Social Kit editing / export primitives, ported from
// kit-shared.jsx. The prototype hung these off window.*; here they are real
// ES module exports. The only external dependency is html-to-image.

import React, { useEffect, useRef, useState } from 'react'
import * as htmlToImage from 'html-to-image'

// ─────────────────────────────────────────────────────────────────────
// EXPORT — DOM node → PNG at native resolution
// ─────────────────────────────────────────────────────────────────────
export async function exportCanvasNode(
  node: HTMLElement | null,
  w: number,
  h: number,
  filename: string,
  scale = 2,
): Promise<void> {
  if (!node) {
    alert('Export engine still loading — try again in a moment.')
    return
  }
  node.classList.add('kit-exporting')
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  try {
    const dataUrl = await htmlToImage.toPng(node, {
      width: w, height: h, pixelRatio: scale, cacheBust: true,
      backgroundColor: '#050C14',
      style: { transform: 'none', transformOrigin: 'top left', margin: '0' },
    })
    const a = document.createElement('a')
    a.download = filename
    a.href = dataUrl
    a.click()
  } catch (e) {
    console.error('Export failed', e)
    alert('Export failed — see console.')
  } finally {
    node.classList.remove('kit-exporting')
  }
}

// ─────────────────────────────────────────────────────────────────────
// EDITABLE TEXT — uncontrolled contentEditable (cursor never jumps)
// ─────────────────────────────────────────────────────────────────────
type EditableTextProps = {
  as?: keyof React.JSX.IntrinsicElements
  text?: string
  className?: string
  style?: React.CSSProperties
  multiline?: boolean
} & Omit<React.HTMLAttributes<HTMLElement>, 'style' | 'className'>

export function EditableText({
  as = 'div', text = '', className = '', style, multiline = true, ...rest
}: EditableTextProps) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    // re-sync when the brand (and thus text) changes
    if (ref.current && ref.current.textContent !== text) ref.current.textContent = text
  }, [text])
  const Tag = as as React.ElementType
  return (
    <Tag
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      className={`kit-edit ${className}`}
      style={{ whiteSpace: multiline ? undefined : 'nowrap', ...style }}
      onKeyDown={(e: React.KeyboardEvent) => { if (!multiline && e.key === 'Enter') e.preventDefault() }}
      {...rest}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────
// IMAGE SLOT — drag-drop / click to fill, exportable
// ─────────────────────────────────────────────────────────────────────
export function KitImageSlot({
  label = 'DROP PHOTO', overlay = 0.55, style,
}: { label?: string; overlay?: number; style?: React.CSSProperties }) {
  const [src, setSrc] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const read = (file?: File | null) => {
    if (!file || !file.type.startsWith('image/')) return
    const fr = new FileReader()
    fr.onload = () => setSrc(fr.result as string)
    fr.readAsDataURL(file)
  }

  return (
    <div
      className="kit-imgslot"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: src ? '#050C14' : undefined, ...style }}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); read(e.dataTransfer.files[0]) }}
      onClick={() => inputRef.current && inputRef.current.click()}
    >
      {src ? (
        <>
          <img src={src} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, rgba(5,12,20,${overlay * 0.4}) 0%, rgba(5,12,20,${overlay}) 100%)` }} />
        </>
      ) : (
        <div
          className="kit-imgslot-empty"
          style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 14,
            background: over ? 'rgba(0,196,232,0.12)' : 'rgba(8,18,30,0.65)',
            border: `2px dashed ${over ? 'var(--nx-accent)' : 'var(--nx-border-strong)'}`,
            color: 'var(--nx-text-muted)', cursor: 'pointer', transition: 'all 140ms ease',
          }}
        >
          <svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor" strokeWidth="1.1">
            <rect x="3" y="5" width="18" height="14" /><path d="M3 17 L9 11 L13 15 L17 11 L21 17" /><circle cx="16" cy="9" r="1.2" />
          </svg>
          <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 13, letterSpacing: '0.22em', textAlign: 'center', padding: '0 20px' }}>{label}</span>
          <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.16em', opacity: 0.7 }}>CLICK OR DRAG IMAGE</span>
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => read(e.target.files?.[0])} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// COPY BUTTON
// ─────────────────────────────────────────────────────────────────────
export function CopyButton({
  value, label = 'COPY', copiedLabel = 'COPIED ✓', small, style,
}: { value: string; label?: string; copiedLabel?: string; small?: boolean; style?: React.CSSProperties }) {
  const [done, setDone] = useState(false)
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (navigator.clipboard) void navigator.clipboard.writeText(value)
    setDone(true)
    setTimeout(() => setDone(false), 1400)
  }
  return (
    <button onClick={copy} className="nx-btn" style={{
      padding: small ? '5px 10px' : '8px 14px',
      fontSize: small ? 10 : 11, letterSpacing: '0.16em',
      borderColor: done ? 'var(--nx-green)' : 'var(--nx-border-strong)',
      color: done ? 'var(--nx-green)' : 'var(--nx-text-2)', ...style,
    }}>
      {done ? copiedLabel : label}
    </button>
  )
}
