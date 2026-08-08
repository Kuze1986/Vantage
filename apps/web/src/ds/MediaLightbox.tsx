// MediaLightbox.tsx — full-viewport media viewer, shared by every surface that
// shows generated media (Queue rows, PreviewModal, Publish Pack, DemoForge).
//
// Sits at zIndex 1100 so it can be opened from inside the app's 1000-level
// modals. Escape / backdrop close, ←/→ walk a set of items, images toggle
// between fit-to-viewport and 100%.

import React from 'react'

export type LightboxItem = {
  kind: 'image' | 'video'
  url: string
  /** Short caption, e.g. the mode name or "Slide 03". */
  label?: string
  /** Poster frame for videos. */
  poster?: string
}

function fileNameFor(item: LightboxItem, index: number): string {
  try {
    const path = new URL(item.url).pathname
    const last = path.split('/').filter(Boolean).pop()
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return decodeURIComponent(last)
  } catch {
    // Not an absolute URL — fall through to the generated name.
  }
  return `${item.label?.replace(/\W+/g, '-').toLowerCase() || 'media'}-${index + 1}.${item.kind === 'video' ? 'mp4' : 'png'}`
}

/**
 * Supabase Storage honours `?download=<name>` by setting Content-Disposition.
 * The bare `download` attribute is ignored cross-origin, so without this the
 * link just navigates. Only applied to Storage URLs — appending a query param
 * to a signed third-party URL (DALL·E) can invalidate its signature.
 */
function downloadHref(item: LightboxItem, index: number): string {
  if (!item.url.includes('/storage/v1/object/')) return item.url
  const sep = item.url.includes('?') ? '&' : '?'
  return `${item.url}${sep}download=${encodeURIComponent(fileNameFor(item, index))}`
}

const ghostBtn: React.CSSProperties = {
  fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.1em',
  padding: '6px 12px', cursor: 'pointer',
  background: 'rgba(8,18,30,0.85)', border: '1px solid var(--nx-border)',
  borderRadius: 4, color: 'var(--nx-text-2)',
}

export function MediaLightbox({
  items,
  startIndex = 0,
  onClose,
  actionLabel,
  onAction,
}: {
  items: LightboxItem[]
  startIndex?: number
  onClose: () => void
  /**
   * Optional footer action, e.g. "Use as thumbnail". Pass a function to vary
   * the label per item, or to return null where the action doesn't apply
   * (a video can't become a still).
   */
  actionLabel?: string | ((item: LightboxItem, index: number) => string | null)
  onAction?: (item: LightboxItem, index: number) => void | Promise<void>
}) {
  const [index, setIndex]   = React.useState(startIndex)
  const [zoomed, setZoomed] = React.useState(false)
  const [busy, setBusy]     = React.useState(false)

  const count = items.length
  const safeIndex = Math.min(index, Math.max(0, count - 1))
  const item = items[safeIndex]

  const step = React.useCallback((delta: number) => {
    if (count < 2) return
    setZoomed(false)
    setIndex((i) => (i + delta + count) % count)
  }, [count])

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); step(-1) }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, step])

  if (!item) return null

  const resolvedActionLabel =
    typeof actionLabel === 'function' ? actionLabel(item, safeIndex) : actionLabel

  const runAction = async () => {
    if (!onAction || busy) return
    setBusy(true)
    try {
      await onAction(item, safeIndex)
    } finally {
      setBusy(false)
    }
  }

  const arrow = (dir: -1 | 1) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); step(dir) }}
      aria-label={dir === -1 ? 'Previous' : 'Next'}
      style={{
        ...ghostBtn, fontSize: 16, padding: '10px 14px', lineHeight: 1,
        flexShrink: 0, alignSelf: 'center',
      }}
    >
      {dir === -1 ? '‹' : '›'}
    </button>
  )

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex', flexDirection: 'column',
        padding: 20, gap: 12,
      }}
    >
      {/* Header */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--nx-sans)', fontSize: 13, fontWeight: 700, color: 'var(--nx-text-1)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {item.label ?? (item.kind === 'video' ? 'Video' : 'Image')}
          </div>
          {count > 1 && (
            <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginTop: 2 }}>
              {safeIndex + 1} / {count} · ← → to step
            </div>
          )}
        </div>
        <button type="button" onClick={onClose} style={ghostBtn}>✕ Close</button>
      </div>

      {/* Media */}
      <div
        onClick={onClose}
        style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}
      >
        {count > 1 && arrow(-1)}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1, minWidth: 0, height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: zoomed ? 'auto' : 'hidden',
          }}
        >
          {item.kind === 'video' ? (
            <video
              key={item.url}
              src={item.url}
              poster={item.poster}
              controls
              autoPlay
              playsInline
              style={{
                maxWidth: '100%', maxHeight: '100%',
                borderRadius: 6, border: '1px solid var(--nx-border)', background: '#000',
              }}
            />
          ) : (
            <img
              key={item.url}
              src={item.url}
              alt={item.label ?? 'Generated media'}
              onClick={() => setZoomed((z) => !z)}
              style={{
                ...(zoomed
                  ? { maxWidth: 'none', maxHeight: 'none' }
                  : { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }),
                cursor: zoomed ? 'zoom-out' : 'zoom-in',
                borderRadius: 6, border: '1px solid var(--nx-border)',
              }}
            />
          )}
        </div>
        {count > 1 && arrow(1)}
      </div>

      {/* Footer */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}
      >
        {item.kind === 'image' && (
          <button type="button" onClick={() => setZoomed((z) => !z)} style={ghostBtn}>
            {zoomed ? '⤡ Fit' : '⤢ 100%'}
          </button>
        )}
        <a
          href={downloadHref(item, safeIndex)}
          download={fileNameFor(item, safeIndex)}
          style={{ ...ghostBtn, textDecoration: 'none', display: 'inline-block' }}
        >
          ↓ Download
        </a>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          style={{ ...ghostBtn, textDecoration: 'none', display: 'inline-block' }}
        >
          ↗ Open original
        </a>
        {resolvedActionLabel && onAction && (
          <button
            type="button"
            onClick={() => void runAction()}
            disabled={busy}
            style={{
              ...ghostBtn,
              borderColor: 'var(--nx-accent)', color: 'var(--nx-accent)',
              opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer',
            }}
          >
            {busy ? '…' : resolvedActionLabel}
          </button>
        )}
      </div>
    </div>
  )
}
