import React from 'react'
import { vantageApi } from '../api/vantage'
import type { TikTokPostSettings } from '../api/vantage'
import { TikTokComposeModal } from './TikTokComposeModal'
import { Panel, Badge, DataTable, PreviewModal, MediaLightbox } from '../ds'
import { QuoteCardStudio } from '../creative/QuoteCard'
import { OgCardStudio } from '../creative/OgCard'
import { CarouselBuilder } from '../creative/CarouselBuilder'
import { BRANDS } from '../creative'
import type { BrandId } from '../creative'
import type { BadgeVariant, LightboxItem } from '../ds'
import type { ReactNode } from 'react'

export type Piece = {
  id: string
  status: string
  channel_slug: string
  format: string
  content_payload: Record<string, unknown>
  audit_notes: string | null
  audit_category?: string | null
  audit_iterations: number
  created_at: string
  image_url?: string | null
  video_url?: string | null
  media_status?: string | null
  variant_group_id?: string | null
  retry_count?: number
  retry_after?: string | null
}

function pieceBrandId(p: Piece): BrandId {
  const id = p.content_payload?.brand_id
  if (typeof id === 'string' && id in BRANDS) return id as BrandId
  return 'shift'
}

function mediaBadgeVariant(status: string | null | undefined): BadgeVariant {
  switch (status) {
    case 'ready': return 'active'
    case 'pending': return 'pending'
    case 'failed': return 'critical'
    default: return 'default'
  }
}

function isMediaGated(p: Piece): boolean {
  if (p.content_payload?.force_media === true) return false
  if (p.media_status === 'pending' || p.media_status === 'failed') return true
  if (p.content_payload?.needs_social_kit === true && !p.image_url && !p.content_payload?.image_url) {
    return true
  }
  return false
}

function isAutopilotQueued(p: Piece): boolean {
  return p.status === 'queued' && Boolean(p.content_payload?.visual_type || p.content_payload?.campaign_id)
}

// Mirrors MANUAL_PUBLISH_CHANNELS in apps/api/src/lib/publish-pack.ts. Reddit's
// API refuses cloud egress, so it's posted by hand via the Publish Pack.
const MANUAL_CHANNELS = new Set<string>(['reddit'])
const VIDEO_FORMATS   = new Set(['tiktok_script', 'instagram_caption', 'facebook_post'])

const STATUS_FILTERS = ['all', 'auditing', 'approved', 'queued', 'published', 'rejected', 'failed'] as const

function statusBadge(status: string): BadgeVariant {
  switch (status) {
    case 'approved':  return 'active'
    case 'auditing':  return 'pending'
    case 'queued':    return 'new'
    case 'published': return 'core'
    case 'rejected':
    case 'failed':    return 'critical'
    default:          return 'default'
  }
}

// ── Video script panel for manual channels ────────────────────────────────────
function VideoScriptPanel({ piece }: { piece: Piece }) {
  const cp = piece.content_payload
  const [copied, setCopied] = React.useState(false)

  const copyText = [
    cp.hook        ? `HOOK:\n${String(cp.hook)}`                         : '',
    cp.script      ? `SCRIPT:\n${String(cp.script)}`                     : '',
    cp.caption     ? `CAPTION:\n${String(cp.caption)}`                   : '',
    cp.text        ? `TEXT:\n${String(cp.text)}`                         : '',
    cp.on_screen_text ? `ON-SCREEN:\n${String(cp.on_screen_text)}`       : '',
    cp.hashtags && Array.isArray(cp.hashtags) ? `\nHASHTAGS:\n${(cp.hashtags as string[]).join(' ')}` : '',
    cp.instructions ? `\nINSTRUCTIONS:\n${String(cp.instructions)}`      : '',
  ].filter(Boolean).join('\n\n')

  const handleCopy = () => {
    void navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--nx-surface-2)', borderRadius: 6, border: '1px solid var(--nx-border)' }}>
      {cp.hook != null && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-amber)', letterSpacing: '0.1em', marginBottom: 2 }}>HOOK</div>
          <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 12, color: 'var(--nx-text-1)' }}>{String(cp.hook)}</div>
        </div>
      )}
      {cp.script != null && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-cyan)', letterSpacing: '0.1em', marginBottom: 2 }}>SCRIPT</div>
          <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 11, color: 'var(--nx-text-2)', whiteSpace: 'pre-wrap' }}>{String(cp.script)}</div>
        </div>
      )}
      {cp.on_screen_text != null && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', letterSpacing: '0.1em', marginBottom: 2 }}>ON-SCREEN TEXT</div>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-2)' }}>{String(cp.on_screen_text)}</div>
        </div>
      )}
      {Array.isArray(cp.hashtags) && cp.hashtags.length > 0 && (
        <div style={{ marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(cp.hashtags as string[]).map((h) => (
            <span key={h} style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-cyan)', background: 'rgba(6,182,212,0.08)', padding: '1px 6px', borderRadius: 4 }}>
              {h.startsWith('#') ? h : `#${h}`}
            </span>
          ))}
        </div>
      )}
      {cp.instructions != null && (
        <div style={{ borderTop: '1px solid var(--nx-border)', paddingTop: 6, marginTop: 6 }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', letterSpacing: '0.1em', marginBottom: 2 }}>UPLOAD INSTRUCTIONS</div>
          <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 11, color: 'var(--nx-text-3)' }}>{String(cp.instructions)}</div>
        </div>
      )}
      <button
        type="button"
        onClick={handleCopy}
        style={{
          marginTop: 8, fontFamily: 'var(--nx-mono)', fontSize: 10, padding: '3px 10px',
          background: 'none', border: '1px solid var(--nx-border)', borderRadius: 4,
          color: copied ? 'var(--nx-green, #22c55e)' : 'var(--nx-text-3)', cursor: 'pointer',
        }}
      >
        {copied ? '✓ Copied' : '⎘ Copy script'}
      </button>
    </div>
  )
}

// ── Media helpers ─────────────────────────────────────────────────────────────
function parseModeStills(cp: Record<string, unknown>): Array<{ mode: string; url: string }> {
  const raw = cp?.mode_stills
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m): m is { mode?: string; url: string } => !!m && typeof m === 'object' && typeof (m as { url?: unknown }).url === 'string')
    .map((m) => ({ mode: String(m.mode ?? 'mode'), url: m.url }))
}

/**
 * Seed lines for the carousel builder: prefer an existing outline/bullet list,
 * otherwise split the body into sentences so each becomes one point slide.
 */
function seedLinesFromPiece(p: Piece): string[] {
  const cp = p.content_payload ?? {}
  const outline = cp.outline ?? cp.key_points ?? cp.bullets
  if (Array.isArray(outline)) {
    const lines = outline.filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
    if (lines.length) return lines
  }
  const body = String(cp.body ?? cp.text ?? cp.script ?? '')
  if (!body.trim()) return []
  const byLine = body.split('\n').map((l) => l.trim()).filter(Boolean)
  if (byLine.length > 1) return byLine
  return body.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
}

/** Which DemoForge mode a still came from, for the thumbnail_mode payload field. */
function modeOfStill(pieces: Piece[], pieceId: string, url: string): string | undefined {
  const p = pieces.find((x) => x.id === pieceId)
  return p ? parseModeStills(p.content_payload).find((m) => m.url === url)?.mode : undefined
}

function parseCarouselUrls(cp: Record<string, unknown>): string[] {
  const raw = cp?.carousel_urls
  if (!Array.isArray(raw)) return []
  return raw.filter((u): u is string => typeof u === 'string' && u.length > 0)
}

function pieceVideoUrl(p: Piece): string | null {
  if (p.video_url) return p.video_url
  const fromPayload = p.content_payload?.video_url
  return typeof fromPayload === 'string' && fromPayload ? fromPayload : null
}

/**
 * Everything attached to a piece as one ordered list, so ←/→ in the lightbox
 * walks the whole set. Order matches how the row renders them.
 */
function pieceMediaItems(p: Piece): LightboxItem[] {
  const videoUrl = pieceVideoUrl(p)
  const stills   = parseModeStills(p.content_payload)
  return [
    ...(videoUrl ? [{ kind: 'video' as const, url: videoUrl, label: 'Rendered video', poster: p.image_url ?? stills[0]?.url }] : []),
    ...(p.image_url ? [{ kind: 'image' as const, url: p.image_url, label: 'Attached image' }] : []),
    ...parseCarouselUrls(p.content_payload).map((url, i) => ({
      kind: 'image' as const, url, label: `Slide ${String(i + 1).padStart(2, '0')}`,
    })),
    ...stills.map((m) => ({ kind: 'image' as const, url: m.url, label: m.mode.replace(/_/g, ' ') })),
  ]
}

const expandHint: React.CSSProperties = {
  position: 'absolute', top: 4, right: 4,
  fontFamily: 'var(--nx-mono)', fontSize: 8, letterSpacing: '0.08em',
  background: 'rgba(5,12,20,0.82)', border: '1px solid var(--nx-border)',
  borderRadius: 3, padding: '1px 5px', color: 'var(--nx-text-2)',
  pointerEvents: 'none',
}

// ── Image preview ─────────────────────────────────────────────────────────────
function ImagePreview({ url, onOpen }: { url: string; onOpen: () => void }) {
  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={onOpen}
        title="Expand to full size"
        style={{ display: 'block', padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', position: 'relative', width: '100%', maxWidth: 260 }}
      >
        <img
          src={url}
          alt="Generated"
          style={{ width: '100%', borderRadius: 4, border: '1px solid var(--nx-border)', display: 'block' }}
          loading="lazy"
        />
        <span style={expandHint}>⤢</span>
      </button>
    </div>
  )
}

type PublishPack = Awaited<ReturnType<typeof vantageApi.getPublishPack>>

function PublishPackModal({
  pack,
  onClose,
}: {
  pack: PublishPack
  onClose: () => void
}) {
  const [copied, setCopied] = React.useState<string | null>(null)
  const [lightbox, setLightbox] = React.useState<{ items: LightboxItem[]; index: number } | null>(null)

  // Reddit is title + body on a submit form; hashtags are meaningless there and
  // the API deliberately leaves them empty. Mirror copy_all's labelling.
  const isReddit  = pack.channel === 'reddit'
  const bodyLabel = isReddit ? 'Body' : 'Caption'
  const subreddit = pack.fields?.subreddit
  const title     = pack.fields?.title
  const captionWithTags = isReddit
    ? pack.caption
    : [pack.caption, pack.hashtags].filter(Boolean).join('\n\n')

  const mediaItems: LightboxItem[] = [
    ...(pack.video_url ? [{ kind: 'video' as const, url: pack.video_url, label: 'Rendered video', poster: pack.thumbnail_url ?? undefined }] : []),
    ...(pack.thumbnail_url ? [{ kind: 'image' as const, url: pack.thumbnail_url, label: 'Thumbnail / still' }] : []),
  ]

  const copy = (key: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  const monoLabel: React.CSSProperties = {
    fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)',
    letterSpacing: '0.12em', marginBottom: 4, textTransform: 'uppercase',
  }
  const body: React.CSSProperties = {
    fontFamily: 'var(--nx-sans)', fontSize: 13, color: 'var(--nx-text-1)',
    whiteSpace: 'pre-wrap', lineHeight: 1.45,
  }
  const ghostBtn: React.CSSProperties = {
    fontFamily: 'var(--nx-mono)', fontSize: 10, padding: '4px 10px',
    background: 'none', border: '1px solid var(--nx-border)', borderRadius: 4,
    color: 'var(--nx-text-3)', cursor: 'pointer',
  }

  return (
    <>
    {lightbox && (
      <MediaLightbox items={lightbox.items} startIndex={lightbox.index} onClose={() => setLightbox(null)} />
    )}
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 24, overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--nx-bg)', border: '1px solid var(--nx-border)',
          borderRadius: 10, padding: 24, width: '100%', maxWidth: 560,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span className="nx-mono" style={{ fontSize: 11, color: 'var(--nx-accent)', letterSpacing: '0.18em' }}>
            ⎘ PUBLISH PACK · {pack.channel.toUpperCase()}
          </span>
          <button type="button" onClick={onClose} style={ghostBtn}>✕ Close</button>
        </div>

        {!pack.media_ready && (
          <div className="vg-error" style={{ marginBottom: 12, fontSize: 12 }}>
            Media not ready yet — attach a DemoForge video or image before uploading.
          </div>
        )}

        {subreddit && (
          <div style={{ marginBottom: 14, padding: '10px 12px', border: '1px solid var(--nx-border)', borderRadius: 6, background: 'var(--nx-surface-2)' }}>
            <div style={monoLabel}>Post to</div>
            <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 15, color: 'var(--nx-accent)', letterSpacing: '0.04em' }}>
              {subreddit}
            </div>
          </div>
        )}

        {title && (
          <div style={{ marginBottom: 14 }}>
            <div style={monoLabel}>Title</div>
            <div style={{ ...body, fontWeight: 700 }}>{title}</div>
            <button
              type="button"
              style={{ ...ghostBtn, marginTop: 8, color: copied === 'title' ? 'var(--nx-green, #22c55e)' : ghostBtn.color }}
              onClick={() => copy('title', title)}
            >
              {copied === 'title' ? '✓ Copied' : '⎘ Copy title'}
            </button>
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <div style={monoLabel}>{bodyLabel}</div>
          <div style={body}>{pack.caption || '—'}</div>
          {!isReddit && pack.hashtags ? (
            <div style={{ marginTop: 8, fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-cyan)' }}>
              {pack.hashtags}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              style={{ ...ghostBtn, color: copied === 'caption' ? 'var(--nx-green, #22c55e)' : ghostBtn.color }}
              onClick={() => copy('caption', captionWithTags)}
            >
              {copied === 'caption' ? '✓ Copied' : `⎘ Copy ${bodyLabel.toLowerCase()}`}
            </button>
            <button
              type="button"
              style={{ ...ghostBtn, color: copied === 'all' ? 'var(--nx-green, #22c55e)' : ghostBtn.color }}
              onClick={() => copy('all', pack.copy_all)}
            >
              {copied === 'all' ? '✓ Copied' : '⎘ Copy all'}
            </button>
          </div>
        </div>

        {pack.fields?.script && (
          <div style={{ marginBottom: 14 }}>
            <div style={monoLabel}>Script</div>
            <div style={{ ...body, fontSize: 12, color: 'var(--nx-text-2)' }}>{pack.fields.script}</div>
          </div>
        )}

        {mediaItems.length > 0 && (
          <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={monoLabel}>Media — click to review full size</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {mediaItems.map((item, i) => (
                <button
                  key={item.url}
                  type="button"
                  onClick={() => setLightbox({ items: mediaItems, index: i })}
                  title={item.label}
                  style={{
                    padding: 0, border: '1px solid var(--nx-border)', borderRadius: 4, overflow: 'hidden',
                    background: '#000', cursor: 'pointer', position: 'relative', width: 148, height: 90,
                  }}
                >
                  {(item.poster ?? (item.kind === 'image' ? item.url : null)) ? (
                    <img
                      src={item.poster ?? item.url}
                      alt={item.label ?? 'Media'}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: item.kind === 'video' ? 0.75 : 1 }}
                    />
                  ) : (
                    <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg, #0b1a2a, #050c14)' }} />
                  )}
                  {item.kind === 'video' && (
                    <span style={{
                      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 22, color: '#fff', textShadow: '0 0 12px rgba(0,0,0,0.8)',
                    }}>▶</span>
                  )}
                </button>
              ))}
            </div>
            {/* A manual post needs the file on disk, so the download links stay. */}
            {pack.video_url && (
              <a href={pack.video_url} target="_blank" rel="noreferrer" download style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-cyan)' }}>
                ↓ Download video
              </a>
            )}
            {pack.thumbnail_url && (
              <a href={pack.thumbnail_url} target="_blank" rel="noreferrer" download style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-cyan)' }}>
                ↓ Download thumbnail / still
              </a>
            )}
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--nx-border)', paddingTop: 12 }}>
          <div style={monoLabel}>Instructions</div>
          <div style={{ ...body, fontSize: 12, color: 'var(--nx-text-3)' }}>{pack.instructions}</div>
        </div>
      </div>
    </div>
    </>
  )
}

export function QueuePage() {
  const [pieces, setPieces] = React.useState<Piece[]>([])
  const [filter, setFilter] = React.useState<typeof STATUS_FILTERS[number]>('all')
  const [err, setErr] = React.useState<string | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [busy, setBusy]           = React.useState<string | null>(null)
  const [manualUrl, setManualUrl] = React.useState<Record<string, string>>({})
  const [expandedScript, setExpandedScript] = React.useState<Set<string>>(new Set())
  const [previewPiece, setPreviewPiece] = React.useState<Piece | null>(null)
  const [quotifyPiece, setQuotifyPiece] = React.useState<Piece | null>(null)
  const [ogPiece, setOgPiece]           = React.useState<Piece | null>(null)
  const [carouselPiece, setCarouselPiece] = React.useState<Piece | null>(null)
  const [lightbox, setLightbox]         = React.useState<{ pieceId: string; items: LightboxItem[]; index: number } | null>(null)
  const [publishPack, setPublishPack]   = React.useState<PublishPack | null>(null)
  const [tiktokCompose, setTikTokCompose] = React.useState<Piece | null>(null)
  const [packBusy, setPackBusy]         = React.useState<string | null>(null)
  const [selected, setSelected]         = React.useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy]         = React.useState(false)

  const load = React.useCallback(async () => {
    setErr(null)
    try {
      const { pieces } = await vantageApi.getQueue()
      // Fetch also includes variant_group_id and image_url via the view now
      setPieces(pieces as Piece[])
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const visible = filter === 'all' ? pieces : pieces.filter((p) => p.status === filter)

  const action = async (fn: () => Promise<unknown>, successMsg: string) => {
    setErr(null)
    setMsg(null)
    try {
      await fn()
      setMsg(successMsg)
      await load()
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }

  const toggleScript = (id: string) =>
    setExpandedScript((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const openLightbox = (p: Piece, index: number) =>
    setLightbox({ pieceId: p.id, items: pieceMediaItems(p), index })

  /**
   * Promote the visible still to the piece's thumbnail. This used to fire on a
   * single click of a 72px tile — now it's an explicit action taken after
   * looking at the image full size.
   */
  const useAsThumbnail = async (pieceId: string, url: string) => {
    setLightbox(null)
    await action(
      () => vantageApi.patchQueuePiece(pieceId, {
        image_url: url,
        media_status: 'ready',
        content_payload_patch: { image_url: url, thumbnail_mode: modeOfStill(pieces, pieceId, url) },
      }),
      'Thumbnail updated',
    )
  }

  const counts: Record<string, number> = {}
  for (const p of pieces) counts[p.status] = (counts[p.status] ?? 0) + 1

  // Group variants so they render together
  const variantGroups = new Map<string, Piece[]>()
  for (const p of visible) {
    if (p.variant_group_id) {
      const g = variantGroups.get(p.variant_group_id) ?? []
      g.push(p)
      variantGroups.set(p.variant_group_id, g)
    }
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const approvedSelected = [...selected].filter((id) =>
    pieces.some((p) => p.id === id && p.status === 'approved'),
  )

  const bulkSchedule = async (force: boolean) => {
    if (!approvedSelected.length) return
    setBulkBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const r = await vantageApi.bulkSchedule(approvedSelected, force)
      setMsg(`Bulk scheduled ${r.scheduled}/${approvedSelected.length}${force ? ' (force)' : ''}`)
      setSelected(new Set())
      await load()
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBulkBusy(false)
    }
  }

  const tableRows: Record<string, ReactNode>[] = visible.map((p) => ({
    pick: (
      <input
        type="checkbox"
        checked={selected.has(p.id)}
        disabled={p.status !== 'approved'}
        onChange={() => toggleSelect(p.id)}
        title={p.status === 'approved' ? 'Select for bulk schedule' : 'Only approved pieces can be bulk-scheduled'}
      />
    ),
    channel: (
      <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--nx-text-3)' }}>
        {p.channel_slug}
        {p.variant_group_id && (
          <span style={{ display: 'block', fontSize: 8, color: 'var(--nx-amber)', marginTop: 1 }}>A/B</span>
        )}
        {isAutopilotQueued(p) && (
          <span style={{ display: 'block', fontSize: 8, color: 'var(--nx-green, #00E47A)', marginTop: 1 }}>AUTOPILOT</span>
        )}
      </span>
    ),
    content: (
      <div>
        <div className="vg-piece-preview">
          {String(p.content_payload?.body ?? p.content_payload?.text ?? p.content_payload?.hook ?? p.content_payload?.title ?? p.content_payload?.caption ?? '—')}
        </div>
        {p.audit_notes && (
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginTop: 3 }}>
            {p.audit_category && <Badge label={p.audit_category.replace(/_/g, ' ')} variant="pending" />}
            {' '}Ilita: {p.audit_notes.slice(0, 300)}{p.audit_notes.length > 300 ? '…' : ''}
          </div>
        )}
        {/* Media status + previews */}
        {p.media_status && p.media_status !== 'none' && (
          <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <Badge label={`media: ${p.media_status}`} variant={mediaBadgeVariant(p.media_status)} />
            {isMediaGated(p) && <Badge label="gated" variant="pending" />}
          </div>
        )}
        {(() => {
          const items = pieceMediaItems(p)
          if (!items.length) return null
          const videoUrl   = pieceVideoUrl(p)
          const stills     = parseModeStills(p.content_payload)
          const slides     = parseCarouselUrls(p.content_payload)
          const openAt     = (url: string) => openLightbox(p, Math.max(0, items.findIndex((it) => it.url === url)))
          const posterUrl  = p.image_url ?? stills[0]?.url ?? null
          return (
            <>
              {videoUrl && (
                <div style={{ marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => openAt(videoUrl)}
                    title="Play full size"
                    style={{
                      padding: 0, border: '1px solid var(--nx-border)', borderRadius: 4, overflow: 'hidden',
                      background: '#000', cursor: 'pointer', position: 'relative', width: 160, height: 90, display: 'block',
                    }}
                  >
                    {posterUrl
                      ? <img src={posterUrl} alt="Video poster" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0.75 }} loading="lazy" />
                      : <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg, #0b1a2a, #050c14)' }} />}
                    <span style={{
                      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 22, color: '#fff', textShadow: '0 0 12px rgba(0,0,0,0.8)',
                    }}>▶</span>
                    <span style={expandHint}>VIDEO</span>
                  </button>
                </div>
              )}
              {p.image_url && <ImagePreview url={p.image_url} onOpen={() => openAt(p.image_url!)} />}
              {slides.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 8, color: 'var(--nx-text-4)', letterSpacing: '0.08em', marginBottom: 4 }}>
                    CAROUSEL · {slides.length} SLIDES
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {slides.map((url, i) => (
                      <button
                        key={url}
                        type="button"
                        title={`Slide ${i + 1}`}
                        onClick={() => openAt(url)}
                        style={{ padding: 0, border: '1px solid var(--nx-border)', borderRadius: 4, overflow: 'hidden', background: 'none', cursor: 'zoom-in', width: 64 }}
                      >
                        <img src={url} alt={`Slide ${i + 1}`} style={{ width: 64, height: 64, objectFit: 'cover', display: 'block' }} loading="lazy" />
                        <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 7, color: 'var(--nx-text-3)', padding: '2px 3px' }}>
                          {String(i + 1).padStart(2, '0')}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {stills.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 8, color: 'var(--nx-text-4)', letterSpacing: '0.08em', marginBottom: 4 }}>
                    MODE STILLS — click to enlarge
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {stills.map((m) => (
                      <button
                        key={`${m.mode}-${m.url}`}
                        type="button"
                        title={m.mode}
                        onClick={() => openAt(m.url)}
                        style={{
                          padding: 0, border: '1px solid var(--nx-border)', borderRadius: 4,
                          overflow: 'hidden', background: 'none', cursor: 'zoom-in', width: 96,
                        }}
                      >
                        <img src={m.url} alt={m.mode} style={{ width: 96, height: 60, objectFit: 'cover', display: 'block' }} loading="lazy" />
                        <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 7, color: 'var(--nx-text-3)', padding: '2px 3px', textTransform: 'uppercase' }}>
                          {m.mode.replace(/_/g, ' ')}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )
        })()}
        {/* Video script expand */}
        {VIDEO_FORMATS.has(p.format) && (
          <>
            <button
              type="button"
              onClick={() => toggleScript(p.id)}
              style={{
                marginTop: 4, fontFamily: 'var(--nx-mono)', fontSize: 9, background: 'none',
                border: 'none', color: 'var(--nx-text-4)', cursor: 'pointer', padding: 0,
              }}
            >
              {expandedScript.has(p.id) ? '▲ Hide script' : '▼ Show script'}
            </button>
            {expandedScript.has(p.id) && <VideoScriptPanel piece={p} />}
          </>
        )}
      </div>
    ),
    status: <Badge label={p.status} variant={statusBadge(p.status)} />,
    iterations: (
      <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)' }}>
        {p.audit_iterations ?? 0}
      </span>
    ),
    created: (
      <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)' }}>
        {new Date(p.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </span>
    ),
    actions: (
      <div className="vg-row">
        {/* 3B-5: Preview button — opens per-format preview modal */}
        <button
          type="button"
          className="nx-btn nx-btn--ghost nx-btn--sm"
          onClick={() => setPreviewPiece(p)}
          title="Preview how this content will render on the platform"
        >
          👁 Preview
        </button>
        {/* 3C-5: Quotify — open pull-quote card studio pre-seeded with piece body */}
        <button
          type="button"
          className="nx-btn nx-btn--ghost nx-btn--sm"
          onClick={() => setQuotifyPiece(p)}
          title="Create a branded pull-quote graphic from this piece"
        >
          ❝ Quote
        </button>
        {/* 3C-3: OG share card */}
        <button
          type="button"
          className="nx-btn nx-btn--ghost nx-btn--sm"
          onClick={() => setOgPiece(p)}
          title="Create a branded Open Graph share card for this piece"
        >
          ◫ Share card
        </button>
        {/* Carousel — builds slides and saves them onto the piece directly */}
        <button
          type="button"
          className="nx-btn nx-btn--ghost nx-btn--sm"
          onClick={() => setCarouselPiece(p)}
          title="Build a multi-slide carousel and save it to this piece"
        >
          ▦ Carousel
        </button>
        {(p.media_status === 'pending' || p.media_status === 'failed' || Boolean(p.content_payload?.needs_social_kit)) && (
          <button
            type="button"
            className="nx-btn nx-btn--ghost nx-btn--sm"
            onClick={() => {
              if (Boolean(p.content_payload?.needs_social_kit) || p.content_payload?.visual_type === 'social_graphic') {
                setOgPiece(p)
              } else {
                setBusy(p.id)
                void action(
                  () => vantageApi.createDemoForgeJobFromTemplate({
                    content_piece_id: p.id,
                    template_id: typeof p.content_payload?.demoforge_template_id === 'string'
                      ? p.content_payload.demoforge_template_id
                      : undefined,
                    channel: p.channel_slug,
                  }),
                  'DemoForge job queued',
                ).finally(() => setBusy(null))
              }
            }}
            disabled={busy === p.id}
            title={p.content_payload?.needs_social_kit ? 'Open Social Kit / share card' : 'Retry DemoForge render'}
          >
            {Boolean(p.content_payload?.needs_social_kit) || p.content_payload?.visual_type === 'social_graphic'
              ? 'Social Kit'
              : busy === p.id ? '…' : '↺ DemoForge'}
          </button>
        )}
        {p.status === 'auditing' && (
          <button
            type="button"
            className="nx-btn nx-btn--secondary nx-btn--sm"
            disabled={busy === p.id}
            onClick={() => {
              setBusy(p.id)
              void action(() => vantageApi.audit(p.id), 'Audit complete').finally(() => setBusy(null))
            }}
          >
            {busy === p.id ? '…' : 'Audit'}
          </button>
        )}
        {p.status === 'approved' && (
          <>
            <button
              type="button"
              className="nx-btn nx-btn--ghost nx-btn--sm"
              disabled={busy === p.id}
              onClick={() => {
                setBusy(p.id)
                void action(() => vantageApi.schedule(p.id), 'Queued for cadence').finally(() => setBusy(null))
              }}
              title={isMediaGated(p) ? 'Blocked until media is ready — use Force Queue' : 'Queue for cadence'}
            >
              Queue
            </button>
            {isMediaGated(p) && (
              <button
                type="button"
                className="nx-btn nx-btn--secondary nx-btn--sm"
                disabled={busy === p.id}
                onClick={() => {
                  setBusy(p.id)
                  void action(() => vantageApi.schedule(p.id, undefined, true), 'Force-queued').finally(() => setBusy(null))
                }}
                title="Bypass media gate and queue anyway"
              >
                Force Queue
              </button>
            )}
          </>
        )}
        {MANUAL_CHANNELS.has(p.channel_slug) && (
          <button
            type="button"
            className="nx-btn nx-btn--secondary nx-btn--sm"
            disabled={packBusy === p.id}
            onClick={() => {
              setPackBusy(p.id)
              setErr(null)
              void vantageApi.getPublishPack(p.id)
                .then((pack) => setPublishPack(pack))
                .catch((e) => setErr(String((e as Error).message)))
                .finally(() => setPackBusy(null))
            }}
            title="Copy caption, hashtags, and media download links for manual upload"
          >
            {packBusy === p.id ? '…' : '⎘ Publish Pack'}
          </button>
        )}
        {(p.status === 'approved' || p.status === 'queued') && MANUAL_CHANNELS.has(p.channel_slug) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 }}>
            <input
              type="url"
              className="vg-input"
              placeholder="Paste post URL after uploading"
              value={manualUrl[p.id] ?? ''}
              onChange={(e) => setManualUrl((prev) => ({ ...prev, [p.id]: e.target.value }))}
              style={{ fontSize: 10, padding: '3px 6px' }}
            />
            <button
              type="button"
              className="nx-btn nx-btn--primary nx-btn--sm"
              disabled={busy === p.id || !manualUrl[p.id]}
              onClick={() => {
                setBusy(p.id)
                void action(
                  () => vantageApi.publish(p.channel_slug, p.id, manualUrl[p.id]),
                  'Manual post recorded',
                ).finally(() => setBusy(null))
              }}
            >
              {busy === p.id ? '…' : 'Mark Published'}
            </button>
          </div>
        )}
        {(p.status === 'approved' || p.status === 'queued') && !MANUAL_CHANNELS.has(p.channel_slug) && (
          <>
            <button
              type="button"
              className="nx-btn nx-btn--primary nx-btn--sm"
              disabled={busy === p.id}
              onClick={() => {
                // TikTok can't be published in one click: the Content Posting
                // API requires the user to choose privacy, interaction and
                // disclosure settings against live creator info first.
                if (p.channel_slug === 'tiktok') { setTikTokCompose(p); return }
                setBusy(p.id)
                void action(() => vantageApi.publish(p.channel_slug, p.id), 'Published').finally(() => setBusy(null))
              }}
              title={
                p.channel_slug === 'tiktok'
                  ? 'Open the TikTok posting form'
                  : isMediaGated(p) ? 'Blocked until media is ready — use Force Publish' : 'Publish now'
              }
            >
              {busy === p.id ? '…' : p.channel_slug === 'tiktok' ? 'Post to TikTok…' : 'Publish'}
            </button>
            {isMediaGated(p) && (
              <button
                type="button"
                className="nx-btn nx-btn--secondary nx-btn--sm"
                disabled={busy === p.id}
                onClick={() => {
                  setBusy(p.id)
                  void action(
                    () => vantageApi.publish(p.channel_slug, p.id, undefined, true),
                    'Force-published',
                  ).finally(() => setBusy(null))
                }}
                title="Bypass media gate and publish anyway"
              >
                Force Publish
              </button>
            )}
          </>
        )}
        {/* 3A-6: Retry button for permanently-failed pieces */}
        {p.status === 'failed' && (
          <div>
            <button
              type="button"
              className="nx-btn nx-btn--ghost nx-btn--sm"
              disabled={busy === p.id}
              onClick={() => {
                setBusy(p.id)
                void action(() => vantageApi.retryPiece(p.id), 'Re-queued for retry').finally(() => setBusy(null))
              }}
              title="Reset retry counter and re-queue this piece for immediate publish attempt"
            >
              {busy === p.id ? '…' : '↺ Retry'}
            </button>
            {(p.retry_count ?? 0) > 0 && (
              <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 8, color: 'var(--nx-text-4)', marginTop: 2 }}>
                {p.retry_count} auto-retry{(p.retry_count ?? 0) !== 1 ? 's' : ''} attempted
              </div>
            )}
          </div>
        )}
        {p.status !== 'publishing' && p.status !== 'rejected' && (
          <button
            type="button"
            className="nx-btn nx-btn--ghost nx-btn--sm"
            disabled={busy === p.id}
            onClick={() => {
              if (!confirm('Dismiss this piece? It will move to Rejected and will not be published.')) return
              setBusy(p.id)
              void action(() => vantageApi.rejectPiece(p.id), 'Dismissed').finally(() => setBusy(null))
            }}
            title="Mark as rejected — keeps a record on the Rejected tab"
          >
            Dismiss
          </button>
        )}
        {p.status !== 'publishing' && (
          <button
            type="button"
            className="nx-btn nx-btn--ghost nx-btn--sm"
            disabled={busy === p.id}
            onClick={() => {
              const publishedNote = p.status === 'published'
                ? ' This was already published on the platform — only the Vantage copy is deleted.'
                : ''
              if (!confirm(`Permanently delete this piece?${publishedNote}`)) return
              setBusy(p.id)
              void action(() => vantageApi.deletePiece(p.id), 'Deleted').finally(() => setBusy(null))
            }}
            title="Permanently remove this piece from the queue"
            style={{ color: 'var(--nx-danger, #f87171)' }}
          >
            {busy === p.id ? '…' : 'Remove'}
          </button>
        )}
      </div>
    ),
  }))

  return (
    <>
      {/* Full-size media viewer — shared by thumbnails, stills, carousels and video */}
      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
          actionLabel={(item) => (item.kind === 'image' ? '★ Use as thumbnail' : null)}
          onAction={(item) => useAsThumbnail(lightbox.pieceId, item.url)}
        />
      )}
      {/* 3B-5: Preview modal */}
      {previewPiece && (
        <PreviewModal piece={previewPiece} onClose={() => setPreviewPiece(null)} />
      )}
      {tiktokCompose && (
        <TikTokComposeModal
          pieceId={tiktokCompose.id}
          videoUrl={pieceVideoUrl(tiktokCompose)}
          initialTitle={String(
            (tiktokCompose.content_payload?.hook as string | undefined) ??
            (tiktokCompose.content_payload?.body as string | undefined) ?? '',
          )}
          initial={tiktokCompose.content_payload?.tiktok_post_settings as Partial<TikTokPostSettings> | undefined}
          onClose={() => setTikTokCompose(null)}
          onPublished={() => {
            setTikTokCompose(null)
            setMsg('Posted to TikTok')
            void load()
          }}
        />
      )}
      {publishPack && (
        <PublishPackModal pack={publishPack} onClose={() => setPublishPack(null)} />
      )}
      {/* 3C-5: Quotify modal */}
      {/* 3C-3: OG share card modal */}
      {ogPiece && (
        <div onClick={() => setOgPiece(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--nx-bg)', border: '1px solid var(--nx-border)', borderRadius: 10, padding: 24, width: '100%', maxWidth: 600 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span className="nx-mono" style={{ fontSize: 11, color: 'var(--nx-accent)', letterSpacing: '0.18em' }}>◫ OG SHARE CARD</span>
              <button type="button" onClick={() => setOgPiece(null)} style={{ background: 'none', border: '1px solid var(--nx-border)', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-3)' }}>✕ Close</button>
            </div>
            <OgCardStudio
              pieceId={ogPiece.id}
              initialHeadline={String(ogPiece.content_payload?.headline ?? ogPiece.content_payload?.title ?? ogPiece.content_payload?.body ?? '').slice(0, 100)}
              initialSub={String(ogPiece.content_payload?.body ?? ogPiece.content_payload?.text ?? '').slice(0, 160)}
              channel={ogPiece.channel_slug}
              brandId={pieceBrandId(ogPiece)}
              onAttached={async (url) => {
                await vantageApi.patchQueuePiece(ogPiece.id, {
                  image_url: url,
                  media_status: 'ready',
                  content_payload_patch: { needs_social_kit: false, image_url: url },
                })
                setMsg('Share card attached to piece')
                await load()
              }}
            />
          </div>
        </div>
      )}

      {carouselPiece && (
        <div onClick={() => setCarouselPiece(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--nx-bg)', border: '1px solid var(--nx-border)', borderRadius: 10, padding: 24, width: '100%', maxWidth: 1000 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span className="nx-mono" style={{ fontSize: 11, color: 'var(--nx-accent)', letterSpacing: '0.18em' }}>▦ CAROUSEL</span>
              <button type="button" onClick={() => setCarouselPiece(null)} style={{ background: 'none', border: '1px solid var(--nx-border)', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-3)' }}>✕ Close</button>
            </div>
            <CarouselBuilder
              pieceId={carouselPiece.id}
              channelSlug={carouselPiece.channel_slug}
              initialBrandId={pieceBrandId(carouselPiece)}
              initialSlideText={seedLinesFromPiece(carouselPiece)}
              onAttached={async (urls) => {
                await vantageApi.patchQueuePiece(carouselPiece.id, {
                  // image_url satisfies the media gate; the full set lives in the payload.
                  image_url: urls[0],
                  media_status: 'ready',
                  content_payload_patch: { carousel_urls: urls, needs_social_kit: false },
                })
                setMsg(`Carousel saved to piece (${urls.length} slides)`)
                await load()
              }}
            />
          </div>
        </div>
      )}

      {quotifyPiece && (
        <div onClick={() => setQuotifyPiece(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--nx-bg)', border: '1px solid var(--nx-border)', borderRadius: 10, padding: 24, width: '100%', maxWidth: 900 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span className="nx-mono" style={{ fontSize: 11, color: 'var(--nx-accent)', letterSpacing: '0.18em' }}>❝ PULL-QUOTE CARD</span>
              <button type="button" onClick={() => setQuotifyPiece(null)} style={{ background: 'none', border: '1px solid var(--nx-border)', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-3)' }}>✕ Close</button>
            </div>
            <QuoteCardStudio
              pieceId={quotifyPiece.id}
              initialQuote={String(quotifyPiece.content_payload?.body ?? quotifyPiece.content_payload?.text ?? quotifyPiece.content_payload?.hook ?? '').split(/[.!?]\s+/)[0] ?? ''}
              initialBrandId={pieceBrandId(quotifyPiece)}
              onAttached={async (url) => {
                await vantageApi.patchQueuePiece(quotifyPiece.id, {
                  image_url: url,
                  media_status: 'ready',
                  content_payload_patch: { needs_social_kit: false, image_url: url },
                })
                setMsg('Quote card attached to piece')
                await load()
              }}
            />
          </div>
        </div>
      )}
      <div className="vg-page-header">
        <h1 className="vg-page-title">Content Queue</h1>
        <p className="vg-page-sub">Review, audit, and publish generated content</p>
      </div>

      {err && <div className="vg-error" style={{ marginBottom: 16 }}>{err}</div>}
      {msg && <div className="vg-success" style={{ marginBottom: 16 }}>{msg}</div>}

      {/* Filter tabs */}
      <div className="vg-filter-bar">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            className={`vg-filter-tab${filter === s ? ' vg-filter-tab--active' : ''}`}
            onClick={() => setFilter(s)}
          >
            {s}
            {s !== 'all' && counts[s] ? ` (${counts[s]})` : s === 'all' && pieces.length ? ` (${pieces.length})` : ''}
          </button>
        ))}
        <button
          type="button"
          className="vg-filter-tab"
          style={{ marginLeft: 'auto' }}
          onClick={() => void load()}
        >
          ↻ Refresh
        </button>
      </div>

      {approvedSelected.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <span className="nx-mono" style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>
            {approvedSelected.length} selected
          </span>
          <button
            type="button"
            className="nx-btn nx-btn--ghost nx-btn--sm"
            disabled={bulkBusy}
            onClick={() => void bulkSchedule(false)}
          >
            {bulkBusy ? '…' : 'Bulk Schedule'}
          </button>
          <button
            type="button"
            className="nx-btn nx-btn--secondary nx-btn--sm"
            disabled={bulkBusy}
            onClick={() => void bulkSchedule(true)}
          >
            Force Bulk Schedule
          </button>
          <button
            type="button"
            className="nx-btn nx-btn--ghost nx-btn--sm"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {/* A/B variant groups notice */}
      {variantGroups.size > 0 && (
        <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-amber)', marginBottom: 8 }}>
          {variantGroups.size} A/B variant group{variantGroups.size > 1 ? 's' : ''} in view — pieces marked A/B share a topic
        </div>
      )}

      <Panel title={filter === 'all' ? 'All Content' : `${filter.charAt(0).toUpperCase()}${filter.slice(1)}`}>
        {visible.length === 0 ? (
          <p className="vg-empty">No items in this status</p>
        ) : (
          <DataTable
            columns={[
              { key: 'pick',       label: '',           width: '36px' },
              { key: 'channel',    label: 'Channel',    width: '90px' },
              { key: 'content',    label: 'Content',    width: '38%' },
              { key: 'status',     label: 'Status',     width: '100px' },
              { key: 'iterations', label: 'Iters',      width: '56px' },
              { key: 'created',    label: 'Created',    width: '130px' },
              { key: 'actions',    label: 'Actions' },
            ]}
            rows={tableRows}
          />
        )}
      </Panel>
    </>
  )
}
