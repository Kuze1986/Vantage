import React from 'react'
import { vantageApi } from '../../api/vantage'

type Slug = 'terms' | 'privacy'
type Page = { slug: string; title: string; content: string; updated_at: string }

// Public — no auth, no sidebar. Must render standalone since platform
// reviewers (e.g. TikTok's app review) load this URL directly, logged out.
export function LegalPage({ slug }: { slug: Slug }) {
  const [page, setPage] = React.useState<Page | null>(null)
  const [err, setErr] = React.useState<string | null>(null)

  React.useEffect(() => {
    setPage(null); setErr(null)
    vantageApi.getLegalPage(slug)
      .then((r) => setPage(r.page))
      .catch((e) => setErr(String((e as Error).message)))
  }, [slug])

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '64px 24px',
        fontFamily: 'var(--nx-mono, monospace)',
        color: 'var(--nx-text-1, #e5e5e5)',
        lineHeight: 1.7,
      }}
    >
      {err && <p style={{ color: 'var(--nx-red, #ff5555)' }}>Failed to load: {err}</p>}
      {!page && !err && <p>Loading…</p>}
      {page && (
        <>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>{page.title}</h1>
          <p style={{ fontSize: 11, opacity: 0.6, marginBottom: 32 }}>
            Last updated {new Date(page.updated_at).toLocaleDateString()}
          </p>
          {page.content.trim() === '' ? (
            <p style={{ opacity: 0.6 }}>This page has not been published yet.</p>
          ) : (
            page.content.split(/\n\s*\n/).map((para, i) => (
              <p key={i} style={{ marginBottom: 16, whiteSpace: 'pre-wrap' }}>{para}</p>
            ))
          )}
        </>
      )}
    </div>
  )
}
