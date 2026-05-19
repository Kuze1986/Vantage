import React from 'react'

type ContentPayload = Record<string, unknown>

// Character limits per platform
const CHAR_LIMITS: Record<string, number> = {
  tweet:              280,
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

function TweetPreview({ cp }: { cp: ContentPayload }) {
  const body = String(cp.body ?? '')
  return (
    <div style={{
      border: '1px solid var(--nx-border)', borderRadius: 12, padding: '14px 16px',
      background: 'var(--nx-surface-2)', maxWidth: 500,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--nx-border)' }} />
        <div>
          <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 13, fontWeight: 700, color: 'var(--nx-text-1)' }}>@youraccount</div>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)' }}>Now</div>
        </div>
      </div>
      <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 14, color: 'var(--nx-text-1)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {body}
      </div>
      <CharCount text={body} limit={CHAR_LIMITS.tweet} />
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
        {body}
      </div>
      <CharCount text={body} limit={CHAR_LIMITS.linkedin_post} />
      {cp.image_url && (
        <img src={String(cp.image_url)} alt="LinkedIn post image" style={{ width: '100%', borderRadius: 6, marginTop: 10 }} />
      )}
    </div>
  )
}

function RedditPreview({ cp }: { cp: ContentPayload }) {
  const title = String(cp.title ?? cp.body ?? '').slice(0, 300)
  const body  = String(cp.body ?? '')
  return (
    <div style={{ border: '1px solid var(--nx-border)', borderRadius: 6, background: 'var(--nx-surface-2)', overflow: 'hidden', maxWidth: 560 }}>
      <div style={{ background: 'var(--nx-surface-2)', padding: '10px 12px', borderBottom: '1px solid var(--nx-border)' }}>
        <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginBottom: 4 }}>
          r/subreddit · Posted by u/youraccount
        </div>
        <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 16, fontWeight: 700, color: 'var(--nx-text-1)', lineHeight: 1.3 }}>
          {title}
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
  const caption = String(cp.caption ?? cp.body ?? cp.text ?? '')
  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-amber)', letterSpacing: '0.1em', marginBottom: 6 }}>
        {platformLabel.toUpperCase()}
      </div>
      {cp.hook && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginBottom: 2 }}>HOOK</div>
          <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 14, fontWeight: 700, color: 'var(--nx-text-1)' }}>{String(cp.hook)}</div>
        </div>
      )}
      {cp.script && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginBottom: 2 }}>SCRIPT</div>
          <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 12, color: 'var(--nx-text-2)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{String(cp.script)}</div>
        </div>
      )}
      {caption && (
        <div>
          <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginBottom: 2 }}>CAPTION</div>
          <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 13, color: 'var(--nx-text-1)', whiteSpace: 'pre-wrap' }}>{caption}</div>
          <CharCount text={caption} limit={CHAR_LIMITS[format] ?? Infinity} />
        </div>
      )}
    </div>
  )
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────
export function PreviewModal({
  piece,
  onClose,
}: {
  piece: { id: string; format: string; channel_slug: string; content_payload: Record<string, unknown> }
  onClose: () => void
}) {
  const cp     = piece.content_payload
  const format = piece.format

  // Close on Escape
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  let preview: React.ReactNode
  switch (format) {
    case 'tweet':              preview = <TweetPreview cp={cp} />; break
    case 'linkedin_post':      preview = <LinkedInPreview cp={cp} />; break
    case 'reddit_thread':      preview = <RedditPreview cp={cp} />; break
    case 'email_newsletter':   preview = <EmailPreview cp={cp} />; break
    case 'tiktok_script':
    case 'instagram_caption':
    case 'facebook_post':      preview = <VideoPreview cp={cp} format={format} />; break
    default:
      preview = (
        <pre style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {JSON.stringify(cp, null, 2)}
        </pre>
      )
  }

  return (
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
          maxWidth: 680,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 14, fontWeight: 700, color: 'var(--nx-text-1)' }}>
              Preview
            </div>
            <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginTop: 2 }}>
              {format} · {piece.channel_slug}
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
      </div>
    </div>
  )
}
