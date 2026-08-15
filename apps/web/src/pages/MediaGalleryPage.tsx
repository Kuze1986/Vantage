// MediaGalleryPage — one browsable view of every asset this workspace has made.
//
// Media used to be reachable only from the surface that produced it: a piece's
// hero image on its Queue row, a render inside its DemoForge job, carousel
// slides nowhere at all once the modal closed. This is the index.
//
// Viewing reuses the shared MediaLightbox, and the whole filtered set is handed
// to it — so ←/→ walks the gallery, not just the tile that was clicked.

import React from 'react'
import { vantageApi } from '../api/vantage'
import type { MediaGalleryItem } from '../api/vantage'
import { Panel, Badge, MediaLightbox } from '../ds'
import type { LightboxItem, BadgeVariant } from '../ds'
import { uploadDataUrl } from '../lib/storage'

const PAGE_SIZE = 24
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024
const MAX_GIF_FRAMES = 12

const SOURCE_FILTERS: Array<{ value: string; label: string }> = [
  { value: '',           label: 'All' },
  { value: 'piece',      label: 'Content' },
  { value: 'demoforge',  label: 'DemoForge' },
  { value: 'brand_kit',  label: 'Brand kits' },
  { value: 'clip',       label: 'Clips' },
  { value: 'upload',     label: 'Uploads' },
]

const KIND_FILTERS: Array<{ value: string; label: string }> = [
  { value: '',      label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Video' },
]

const SOURCE_VARIANT: Record<MediaGalleryItem['source'], BadgeVariant> = {
  piece: 'active', demoforge: 'new', brand_kit: 'core', clip: 'default', upload: 'soon',
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`nx-btn nx-btn--sm${active ? ' nx-btn--primary' : ''}`}
      style={{
        fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.14em',
        textTransform: 'uppercase', padding: '5px 11px',
        opacity: active ? 1 : 0.65,
      }}
    >
      {label}
    </button>
  )
}

/** Tile poster: videos show their cover when they have one, else a play affordance. */
function Tile({ item, onOpen }: { item: MediaGalleryItem; onOpen: () => void }) {
  const poster = item.kind === 'video' ? item.thumbnail_url : item.url
  return (
    <button
      type="button"
      onClick={onOpen}
      title={item.label}
      style={{
        display: 'flex', flexDirection: 'column', gap: 6, padding: 0,
        background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
      }}
    >
      <div style={{
        position: 'relative', aspectRatio: '1 / 1', width: '100%',
        borderRadius: 6, overflow: 'hidden',
        border: '1px solid var(--nx-border)', background: 'var(--nx-surface-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {poster ? (
          <img
            src={poster}
            alt={item.label}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ fontSize: 26, opacity: 0.5 }}>🎬</span>
        )}
        {item.kind === 'video' && (
          <span style={{
            position: 'absolute', right: 6, bottom: 6,
            fontFamily: 'var(--nx-mono)', fontSize: 9, letterSpacing: '0.1em',
            padding: '2px 6px', borderRadius: 3,
            background: 'rgba(8,18,30,0.82)', color: 'var(--nx-text-2)',
            border: '1px solid var(--nx-border)',
          }}>▶ VIDEO</span>
        )}
      </div>
      <span style={{
        fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-3)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        letterSpacing: '0.04em',
      }}>{item.label}</span>
    </button>
  )
}

export default function MediaGalleryPage() {
  const [items, setItems]     = React.useState<MediaGalleryItem[]>([])
  const [total, setTotal]     = React.useState(0)
  const [next, setNext]       = React.useState<number | null>(null)
  const [scanLimit, setScan]  = React.useState(0)
  const [source, setSource]   = React.useState('')
  const [kind, setKind]       = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [more, setMore]       = React.useState(false)
  const [err, setErr]         = React.useState<string | null>(null)
  const [lightbox, setLightbox] = React.useState<number | null>(null)
  const [composerOpen, setComposerOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<string[]>([])
  const [delay, setDelay] = React.useState(500)
  const [creating, setCreating] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const uploadInputRef = React.useRef<HTMLInputElement | null>(null)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)

  const frameItems = items.filter((item) => item.kind === 'image' || item.thumbnail_url)
  const toggleFrame = (url: string) => setSelected((current) => {
    if (current.includes(url)) return current.filter((value) => value !== url)
    if (current.length >= MAX_GIF_FRAMES) {
      setCreateError(`Choose up to ${MAX_GIF_FRAMES} frames per GIF.`)
      return current
    }
    setCreateError(null)
    return [...current, url]
  })
  const createGif = async () => {
    if (selected.length < 2) return
    setCreating(true); setCreateError(null)
    try {
      const { GIFEncoder, quantize, applyPalette } = await import('gifenc')
      const frames: Uint8ClampedArray[] = []
      const width = selected.length > 6 ? 360 : 480
      const height = width
      for (const url of selected) {
        const image = new Image(); image.crossOrigin = 'anonymous'; image.src = url
        await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not load one of the selected frames')) })
        const scale = Math.min(width / image.width, height / image.height)
        const frameWidth = Math.max(2, Math.floor(image.width * scale)); const frameHeight = Math.max(2, Math.floor(image.height * scale))
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
        const context = canvas.getContext('2d')!; context.drawImage(image, Math.floor((width - frameWidth) / 2), Math.floor((height - frameHeight) / 2), frameWidth, frameHeight)
        frames.push(context.getImageData(0, 0, width, height).data)
      }
      const encoder = GIFEncoder()
      frames.forEach((frame) => {
        const palette = quantize(frame, 256)
        encoder.writeFrame(applyPalette(frame, palette), width, height, { palette, delay, repeat: 0 })
      })
      encoder.finish()
      const bytes = encoder.bytes()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not prepare the GIF for upload'))
        reader.readAsDataURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'image/gif' }))
      })
      await uploadDataUrl(`creative/gif-${Date.now()}.gif`, dataUrl)
      setComposerOpen(false); setSelected([])
      setKind(''); setSource('');
      const res = await vantageApi.mediaGallery({ limit: PAGE_SIZE }); setItems(res.items); setTotal(res.total); setNext(res.next_offset)
    } catch (error) { setCreateError(error instanceof Error ? error.message : 'GIF creation failed') }
    finally { setCreating(false) }
  }

  const uploadMedia = async (file: File) => {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      setUploadError('Choose an image or video file.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError('Choose a file smaller than 24MB.')
      return
    }
    setUploading(true); setUploadError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not read the selected file.'))
        reader.readAsDataURL(file)
      })
      await vantageApi.uploadMedia({
        path: `uploads/${Date.now()}-${file.name.replace(/[^a-z0-9._-]/gi, '-')}`,
        data_url: dataUrl,
        title: file.name.replace(/\.[^.]+$/, ''),
      })
      setSource('upload'); setKind('')
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed.')
    } finally {
      setUploading(false)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }

  const deleteAsset = async (item: MediaGalleryItem) => {
    const action = item.source === 'upload' ? 'permanently delete this uploaded file' : 'remove this asset from the gallery'
    if (!window.confirm(`Do you want to ${action}?`)) return
    setDeletingId(item.id); setErr(null)
    try {
      await vantageApi.deleteMediaAsset(item.id)
      setItems((current) => current.filter((asset) => asset.id !== item.id))
      setTotal((current) => Math.max(0, current - 1))
      setLightbox(null)
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Could not remove the asset.')
    } finally {
      setDeletingId(null)
    }
  }

  // Refetch from scratch whenever a filter changes.
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErr(null)
    vantageApi.mediaGallery({ source: source || undefined, kind: kind || undefined, limit: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return
        setItems(res.items)
        setTotal(res.total)
        setNext(res.next_offset)
        setScan(res.scan_limit)
      })
      .catch((e) => { if (!cancelled) setErr(String((e as Error).message)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [source, kind])

  const loadMore = async () => {
    if (next == null || more) return
    setMore(true)
    try {
      const res = await vantageApi.mediaGallery({
        source: source || undefined, kind: kind || undefined,
        limit: PAGE_SIZE, offset: next,
      })
      setItems((prev) => [...prev, ...res.items])
      setNext(res.next_offset)
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setMore(false)
    }
  }

  // The lightbox walks everything currently loaded, not just the clicked tile.
  const lightboxItems: LightboxItem[] = items.map((i) => ({
    kind: i.kind,
    url: i.url,
    label: i.label,
    poster: i.thumbnail_url ?? undefined,
  }))

  return (
    <>
      <div className="vg-page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="vg-page-title">Media</h1>
          <p className="vg-page-sub">Every image and video this workspace has produced</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input ref={uploadInputRef} type="file" accept="image/*,video/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadMedia(file) }} />
          <button type="button" className="nx-btn nx-btn--secondary" onClick={() => uploadInputRef.current?.click()} disabled={uploading}>{uploading ? 'UPLOADING…' : 'UPLOAD MEDIA'}</button>
          <button type="button" className="nx-btn nx-btn--primary" onClick={() => setComposerOpen(true)}>CREATE GIF</button>
          <Badge label={`${total} asset${total === 1 ? '' : 's'}`} variant={total ? 'active' : 'soon'} />
        </div>
      </div>

      {err && (
        <div style={{
          fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-red)',
          border: '1px solid var(--nx-red)', borderRadius: 4,
          padding: '8px 12px', marginBottom: 12,
        }}>{err}</div>
      )}

      {uploadError && (
        <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-red)', border: '1px solid var(--nx-red)', borderRadius: 4, padding: '8px 12px', marginBottom: 12 }}>{uploadError}</div>
      )}

      <Panel title="Library" titleAccent="cyan">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SOURCE_FILTERS.map((f) => (
              <Chip key={f.value} label={f.label} active={source === f.value} onClick={() => setSource(f.value)} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {KIND_FILTERS.map((f) => (
              <Chip key={f.value} label={f.label} active={kind === f.value} onClick={() => setKind(f.value)} />
            ))}
          </div>
        </div>

        {!loading && <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)', marginBottom: 14 }}>Showing {items.length} of {total} assets. Load more only when you need it.</div>}

        {loading ? (
          <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-4)' }}>Loading…</p>
        ) : items.length === 0 ? (
          <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-4)', lineHeight: 1.7 }}>
            No media yet. Generate a piece with an image, render a DemoForge video, or
            save a carousel from the Social Kit — anything you make shows up here.
          </p>
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 14,
            }}>
              {items.map((item, i) => (
                <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <Tile item={item} onOpen={() => setLightbox(i)} />
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Badge label={item.source.replace('_', ' ')} variant={SOURCE_VARIANT[item.source]} />
                    {item.piece_id && (
                      <a
                        href={`/queue?piece=${item.piece_id}`}
                        style={{
                          fontFamily: 'var(--nx-mono)', fontSize: 9, letterSpacing: '0.1em',
                          color: 'var(--nx-text-4)', textDecoration: 'none',
                        }}
                      >PIECE →</a>
                    )}
                    {item.job_id && !item.piece_id && (
                      <a
                        href="/demoforge"
                        style={{
                          fontFamily: 'var(--nx-mono)', fontSize: 9, letterSpacing: '0.1em',
                          color: 'var(--nx-text-4)', textDecoration: 'none',
                        }}
                      >JOB →</a>
                    )}
                    <button
                      type="button"
                      className="nx-btn nx-btn--sm"
                      onClick={() => void deleteAsset(item)}
                      disabled={deletingId === item.id}
                      style={{ color: 'var(--nx-red)', padding: '2px 6px' }}
                    >{deletingId === item.id ? 'REMOVING…' : item.source === 'upload' ? 'DELETE' : 'REMOVE'}</button>
                  </div>
                </div>
              ))}
            </div>

            {next != null && (
              <div style={{ marginTop: 16, textAlign: 'center' }}>
                <button
                  type="button"
                  className="nx-btn nx-btn--secondary"
                  onClick={() => void loadMore()}
                  disabled={more}
                  style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.14em' }}
                >
                  {more ? 'LOADING…' : `LOAD MORE (${total - items.length} LEFT)`}
                </button>
              </div>
            )}

            {total >= scanLimit && scanLimit > 0 && (
              <p style={{
                fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)',
                marginTop: 12, textAlign: 'center', letterSpacing: '0.06em',
              }}>
                Showing the most recent {scanLimit} records per source.
              </p>
            )}
          </>
        )}
      </Panel>

      {lightbox != null && lightboxItems.length > 0 && (
        <MediaLightbox
          items={lightboxItems}
          startIndex={lightbox}
          onClose={() => setLightbox(null)}
        />
      )}
      {composerOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(0,0,0,.72)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <Panel title="Create animated GIF" titleAccent="cyan">
            <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 11 }}>Select 2–{MAX_GIF_FRAMES} image frames in order. GIFs with 7–12 frames render at 360px for reliable export.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, maxHeight: 360, overflow: 'auto' }}>
              {frameItems.map((item) => {
                const frameUrl = item.kind === 'image' ? item.url : item.thumbnail_url!
                return <button key={item.id} type="button" onClick={() => toggleFrame(frameUrl)} style={{ padding: 3, border: selected.includes(frameUrl) ? '2px solid var(--nx-cyan)' : '1px solid var(--nx-border)', background: 'none' }}><img src={frameUrl} alt={item.label} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover' }} /></button>
              })}
            </div>
            <label style={{ display: 'block', marginTop: 12, fontFamily: 'var(--nx-mono)', fontSize: 11 }}>Frame delay: {delay}ms <input type="range" min="100" max="2000" step="100" value={delay} onChange={(event) => setDelay(Number(event.target.value))} /></label>
            {createError && <p style={{ color: 'var(--nx-red)', fontSize: 11 }}>{createError}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}><button type="button" className="nx-btn nx-btn--primary" disabled={selected.length < 2 || selected.length > MAX_GIF_FRAMES || creating} onClick={() => void createGif()}>{creating ? 'CREATING…' : `CREATE (${selected.length} FRAMES)`}</button><button type="button" className="nx-btn nx-btn--secondary" onClick={() => setComposerOpen(false)}>CANCEL</button></div>
          </Panel>
        </div>
      )}
    </>
  )
}
