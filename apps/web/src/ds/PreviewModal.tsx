import React from 'react'
import { MediaLightbox, type LightboxItem } from './MediaLightbox'

type ContentPayload = Record<string, unknown>

type PreviewPiece = {
  id: string
  format: string
  channel_slug: string
  content_payload: ContentPayload
  image_url?: string | null
  video_url?: string | null
  media_status?: string | null
}

// Character limits per platform
const CHAR_LIMITS: Record<string, number> = {
  tweet:              280,
  threads_post:       500,
  bluesky_post:       300,
  linkedin_post:      3000,
  reddit_thread:      300,  // title limit
  email_newsletter:   Infinity,
  tiktok_script:      Infinity,
  instagram_caption:  2200,
  facebook_post:      63206,
}

function CharCount({ text, limit }: { text: string; limit: number }) {
  const n   = text.length
  const pct = limit === Infinity ? 0 : n / limit
  const color = pct > 0.9 ? '#ef4444' : pct > 0.7 ? 'var(--nx-amber)' : 'var(--nx-text-4)'
  if (limit === Infinity) return null
  return (
    <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color, marginTop: 4, textAlign: 'right' }}>
      {n} / {limit}
    </div>
  )
}

const expandHint: React.CSSProperties = {
  position: 'absolute', top: 6, right: 6,
  fontFamily: 'var(--nx-mono)', fontSize: 9, letterSpacing: '0.08em',
  background: 'rgba(5,12,20,0.8)', border: '1px solid var(--nx-border)',
  borderRadius: 3, padding: '2px 6px', color: 'var(--nx-text-2)',
  pointerEvents: 'none',
}

function MediaBlock({
  imageUrl,
  videoUrl,
  modeStills,
  carouselUrls,
  onExpand,
}: {
  imageUrl?: string | null
  videoUrl?: string | null
  modeStills?: Array<{ mode: string; url: string }>
  carouselUrls?: string[]
  onExpand: (items: LightboxItem[], index: number) => void
}) {
  if (!imageUrl && !videoUrl && !modeStills?.length && !carouselUrls?.length) return null

  // One flat list so ←/→ in the lightbox walks everything attached to the piece.
  const items: LightboxItem[] = [
    ...(videoUrl ? [{ kind: 'video' as const, url: videoUrl, label: 'Video', poster: imageUrl ?? undefined }] : []),
    ...(imageUrl ? [{ kind: 'image' as const, url: imageUrl, label: 'Attached image' }] : []),
    ...(carouselUrls ?? []).map((url, i) => ({
      kind: 'image' as const, url, label: `Slide ${String(i + 1).padStart(2, '0')}`,
    })),
    ...(modeStills ?? []).map((m) => ({
      kind: 'image' as const, url: m.url, label: m.mode.replace(/_/g, ' '),
    })),
  ]
  const indexOf = (url: string) => Math.max(0, items.findIndex((it) => it.url === url))

  return (
    <div style={{ marginTop: 14 }}>
      {videoUrl && (
        <button
          type="button"
          onClick={() => onExpand(items, indexOf(videoUrl))}
          title="Expand to full size"
          style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', position: 'relative' }}
        >
          <video
            src={videoUrl}
            poster={imageUrl ?? undefined}
            controls
            style={{ width: '100%', maxHeight: 360, borderRadius: 8, border: '1px solid var(--nx-border)', background: '#000' }}
          />
          <span style={expandHint}>⤢ FULL SIZE</span>
        </button>
      )}
      {imageUrl && (
        <button
          type="button"
          onClick={() => onExpand(items, indexOf(imageUrl))}
          title="Expand to full size"
          style={{ display: 'block', width: '100%', padding: 0, marginTop: videoUrl ? 10 : 0, border: 'none', background: 'none', cursor: 'zoom-in', position: 'relative' }}
        >
          <img
            src={imageUrl}
            alt="Attached media"
            style={{ width: '100%', borderRadius: 8, border: '1px solid var(--nx-border)', display: 'block' }}
          />
          <span style={expandHint}>⤢ FULL SIZE</span>
        </button>
      )}
      {carouselUrls && carouselUrls.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', letterSpacing: '0.1em', marginBottom: 6 }}>
            CAROUSEL · {carouselUrls.length} SLIDES
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
            {carouselUrls.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => onExpand(items, indexOf(url))}
                style={{ padding: 0, border: '1px solid var(--nx-border)', borderRadius: 6, overflow: 'hidden', background: 'none', cursor: 'zoom-in' }}
              >
                <img src={url} alt={`Slide ${i + 1}`} style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }} />
                <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-3)', padding: '4px 6px' }}>
                  {String(i + 1).padStart(2, '0')}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {modeStills && modeStills.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', letterSpacing: '0.1em', marginBottom: 6 }}>
            QUEUE MODES
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
            {modeStills.map((m) => (
              <button
                key={`${m.mode}-${m.url}`}
                type="button"
                onClick={() => onExpand(items, indexOf(m.url))}
                style={{ padding: 0, border: '1px solid var(--nx-border)', borderRadius: 6, overflow: 'hidden', background: 'none', cursor: 'zoom-in', textAlign: 'left' }}
              >
                <img src={m.url} alt={m.mode} style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', display: 'block' }} />
                <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-3)', padding: '4px 6px', textTransform: 'uppercase' }}>
                  {m.mode.replace(/_/g, ' ')}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TextPreview({ cp, label, limit }: { cp: ContentPayload; label: string; limit: number }) {
  const body = String(cp.body ?? cp.text ?? '')
  return (
    <div style={{
      border: '1px solid var(--nx-border)', borderRadius: 12, padding: '14px 16px',
      background: 'var(--nx-surface-2)', maxWidth: 500,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--nx-border)' }} />
        <div>
          <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 13, fontWeight: 700, color: 'var(--nx-text-1)' }}>@youraccount</div>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)' }}>{label} · Now</div>
        </div>
      </div>
      <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 14, color: 'var(--nx-text-1)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {body || <span style={{ color: 'var(--nx-text-4)' }}>(empty body)</span>}
      </div>
      <CharCount text={body} limit={limit} />
    </div>
  )
}

function LinkedInPreview({ cp }: { cp: ContentPayload }) {
  const headline = cp.headline ? String(cp.headline) : null
  const body     = String(cp.body ?? '')
  return (
    <div style={{ border: '1px solid var(--nx-border)', borderRadius: 8, padding: '14px 16px', background: 'var(--nx-surface-2)', maxWidth: 500 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--nx-border)' }} />
        <div>
          <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 13, fontWeight: 700, color: 'var(--nx-text-1)' }}>Your Name</div>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)' }}>Now · 🌐</div>
        </div>
      </div>
      {headline && (
        <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 15, fontWeight: 700, color: 'var(--nx-text-1)', marginBottom: 8 }}>
          {headline}
        </div>
      )}
      <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 13, color: 'var(--nx-text-1)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {body || <span style={{ color: 'var(--nx-text-4)' }}>(empty body)</span>}
      </div>
      <CharCount text={body} limit={CHAR_LIMITS.linkedin_post} />
    </div>
  )
}

function RedditPreview({ cp }: { cp: ContentPayload }) {
  const title = String(cp.title ?? '').slice(0, 300) || String(cp.body ?? '').slice(0, 80)
  const body  = String(cp.body ?? '')
  return (
    <div style={{ border: '1px solid var(--nx-border)', borderRadius: 6, background: 'var(--nx-surface-2)', overflow: 'hidden', maxWidth: 560 }}>
      <div style={{ background: 'var(--nx-surface-2)', padding: '10px 12px', borderBottom: '1px solid var(--nx-border)' }}>
        <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginBottom: 4 }}>
          r/subreddit · Posted by u/youraccount
        </div>
        <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 16, fontWeight: 700, color: 'var(--nx-text-1)', lineHeight: 1.3 }}>
          {title || '(untitled)'}
        </div>
        <CharCount text={title} limit={CHAR_LIMITS.reddit_thread} />
      </div>
      {body && (
        <div style={{ padding: '10px 12px', fontFamily: 'var(--nx-sans)', fontSize: 13, color: 'var(--nx-text-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {body}
        </div>
      )}
    </div>
  )
}

function EmailPreview({ cp }: { cp: ContentPayload }) {
  const subject = String(cp.subject ?? '(no subject)')
  const html    = String(cp.body ?? '')
  return (
    <div style={{ border: '1px solid var(--nx-border)', borderRadius: 6, overflow: 'hidden', maxWidth: 600 }}>
      <div style={{ background: 'var(--nx-surface-2)', padding: '8px 12px', borderBottom: '1px solid var(--nx-border)' }}>
        <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 13, fontWeight: 700, color: 'var(--nx-text-1)' }}>
          Subject: {subject}
        </div>
        <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)' }}>From: your@from.address</div>
      </div>
      <iframe
        srcDoc={html}
        title="Email preview"
        sandbox="allow-same-origin"
        style={{ width: '100%', minHeight: 300, border: 'none', background: '#fff' }}
      />
    </div>
  )
}

function VideoPreview({ cp, format }: { cp: ContentPayload; format: string }) {
  const platformLabel = format.replace(/_/g, ' ')
  const script = String(cp.script ?? cp.body ?? '')
  const caption = String(cp.caption ?? (format === 'instagram_caption' ? cp.body : '') ?? '')
  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-amber)', letterSpacing: '0.1em', marginBottom: 6 }}>
        {platformLabel.toUpperCase()}
      </div>
      {cp.hook != null && String(cp.hook) && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginBottom: 2 }}>HOOK</div>
          <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 14, fontWeight: 700, color: 'var(--nx-text-1)' }}>{String(cp.hook)}</div>
        </div>
      )}
      {script && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginBottom: 2 }}>SCRIPT / BODY</div>
          <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 12, color: 'var(--nx-text-2)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{script}</div>
        </div>
      )}
      {cp.on_screen_text != null && String(cp.on_screen_text) && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginBottom: 2 }}>ON-SCREEN</div>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 12, color: 'var(--nx-text-2)' }}>{String(cp.on_screen_text)}</div>
        </div>
      )}
      {Array.isArray(cp.hashtags) && cp.hashtags.length > 0 && (
        <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(cp.hashtags as string[]).map((h) => (
            <span key={h} style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-cyan)' }}>
              {h.startsWith('#') ? h : `#${h}`}
            </span>
          ))}
        </div>
      )}
      {caption && caption !== script && (
        <div>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginBottom: 2 }}>CAPTION</div>
          <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 13, color: 'var(--nx-text-1)', whiteSpace: 'pre-wrap' }}>{caption}</div>
          <CharCount text={caption} limit={CHAR_LIMITS[format] ?? Infinity} />
        </div>
      )}
      {!script && !caption && !cp.hook && (
        <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-4)' }}>No text fields on this piece yet.</div>
      )}
    </div>
  )
}

function parseModeStills(cp: ContentPayload): Array<{ mode: string; url: string }> {
  const raw = cp.mode_stills
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m): m is { mode: string; url: string } =>
      !!m && typeof m === 'object' && typeof (m as { mode?: unknown }).mode === 'string' && typeof (m as { url?: unknown }).url === 'string',
    )
}

export function parseCarouselUrls(cp: ContentPayload): string[] {
  const raw = cp.carousel_urls
  if (!Array.isArray(raw)) return []
  return raw.filter((u): u is string => typeof u === 'string' && u.length > 0)
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────
export function PreviewModal({
  piece,
  onClose,
}: {
  piece: PreviewPiece
  onClose: () => void
}) {
  const cp     = piece.content_payload ?? {}
  const format = piece.format
  const imageUrl =
    piece.image_url
    || (typeof cp.image_url === 'string' ? cp.image_url : null)
  const videoUrl =
    piece.video_url
    || (typeof cp.video_url === 'string' ? cp.video_url : null)
  const modeStills   = parseModeStills(cp)
  const carouselUrls = parseCarouselUrls(cp)

  const [lightbox, setLightbox] = React.useState<{ items: LightboxItem[]; index: number } | null>(null)

  // Close on Escape — but only when the lightbox isn't stacked on top, or a
  // single Escape would dismiss both layers at once.
  React.useEffect(() => {
    if (lightbox) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, lightbox])

  let preview: React.ReactNode
  switch (format) {
    case 'tweet':
      preview = <TextPreview cp={cp} label="X" limit={CHAR_LIMITS.tweet} />
      break
    case 'threads_post':
      preview = <TextPreview cp={cp} label="Threads" limit={CHAR_LIMITS.threads_post} />
      break
    case 'bluesky_post':
      preview = <TextPreview cp={cp} label="Bluesky" limit={CHAR_LIMITS.bluesky_post} />
      break
    case 'linkedin_post':
      preview = <LinkedInPreview cp={cp} />
      break
    case 'reddit_thread':
      preview = <RedditPreview cp={cp} />
      break
    case 'email_newsletter':
      preview = <EmailPreview cp={cp} />
      break
    case 'tiktok_script':
    case 'instagram_caption':
    case 'facebook_post':
      preview = <VideoPreview cp={cp} format={format} />
      break
    default:
      preview = (
        <pre style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {JSON.stringify(cp, null, 2)}
        </pre>
      )
  }

  return (
    <>
    {lightbox && (
      <MediaLightbox
        items={lightbox.items}
        startIndex={lightbox.index}
        onClose={() => setLightbox(null)}
      />
    )}
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--nx-surface-1)',
          border: '1px solid var(--nx-border)',
          borderRadius: 10,
          padding: 24,
          maxWidth: 720,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 14, fontWeight: 700, color: 'var(--nx-text-1)' }}>
              Preview
            </div>
            <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginTop: 2 }}>
              {format} · {piece.channel_slug}
              {piece.media_status ? ` · media:${piece.media_status}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid var(--nx-border)', borderRadius: 4,
              padding: '4px 10px', cursor: 'pointer',
              fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-3)',
            }}
          >
            ✕ Close
          </button>
        </div>

        {preview}
        <MediaBlock
          imageUrl={imageUrl}
          videoUrl={videoUrl}
          modeStills={modeStills}
          carouselUrls={carouselUrls}
          onExpand={(items, index) => setLightbox({ items, index })}
        />
      </div>
    </div>
    </>
  )
}
