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

const PAGE_SIZE = 60

const SOURCE_FILTERS: Array<{ value: string; label: string }> = [
  { value: '',           label: 'All' },
  { value: 'piece',      label: 'Content' },
  { value: 'demoforge',  label: 'DemoForge' },
  { value: 'brand_kit',  label: 'Brand kits' },
  { value: 'clip',       label: 'Clips' },
]

const KIND_FILTERS: Array<{ value: string; label: string }> = [
  { value: '',      label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Video' },
]

const SOURCE_VARIANT: Record<MediaGalleryItem['source'], BadgeVariant> = {
  piece: 'active', demoforge: 'new', brand_kit: 'core', clip: 'default',
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
        <Badge label={`${total} asset${total === 1 ? '' : 's'}`} variant={total ? 'active' : 'soon'} />
      </div>

      {err && (
        <div style={{
          fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-red)',
          border: '1px solid var(--nx-red)', borderRadius: 4,
          padding: '8px 12px', marginBottom: 12,
        }}>{err}</div>
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
    </>
  )
}
