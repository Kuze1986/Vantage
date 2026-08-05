import React from 'react'
import { vantageApi } from '../api/vantage'
import { Panel, Button } from '../ds'

type Slug = 'terms' | 'privacy'
type Page = { slug: string; title: string; content: string; updated_at: string }

const TABS: { slug: Slug; label: string }[] = [
  { slug: 'terms', label: 'Terms & Conditions' },
  { slug: 'privacy', label: 'Privacy Policy' },
]

export function LegalEditorPage() {
  const [active, setActive] = React.useState<Slug>('terms')
  const [page, setPage] = React.useState<Page | null>(null)
  const [draft, setDraft] = React.useState<{ title: string; content: string } | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)

  const load = React.useCallback(async (slug: Slug) => {
    setErr(null)
    try {
      const r = await vantageApi.getLegalPage(slug)
      setPage(r.page)
      setDraft({ title: r.page.title, content: r.page.content })
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }, [])

  React.useEffect(() => { void load(active) }, [active, load])

  const isDirty = !!page && !!draft && (draft.title !== page.title || draft.content !== page.content)

  const handleSave = async () => {
    if (!draft) return
    setSaving(true); setErr(null)
    try {
      const r = await vantageApi.updateLegalPage(active, draft)
      setPage(r.page)
      setDraft({ title: r.page.title, content: r.page.content })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="vg-page-header">
        <h1 className="vg-page-title">Legal</h1>
        <p className="vg-page-sub">
          Edit the content served at /terms and /privacy — changes go live immediately, no deploy needed.
        </p>
      </div>

      {err && <div className="vg-error" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="vg-stack">
        <Panel
          title={TABS.find((t) => t.slug === active)?.label ?? ''}
          titleAccent="amber"
          action={{
            label: saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save',
            onClick: () => { void handleSave() },
          }}
        >
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {TABS.map((t) => (
              <Button
                key={t.slug}
                label={t.label}
                variant={active === t.slug ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setActive(t.slug)}
              />
            ))}
          </div>

          {!draft ? (
            <p className="vg-empty">Loading…</p>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <label className="vg-label" style={{ display: 'block', marginBottom: 6 }}>Page title</label>
                <input
                  className="vg-input"
                  value={draft.title}
                  onChange={(e) => setDraft((prev) => prev ? { ...prev, title: e.target.value } : prev)}
                  style={{ width: '100%', maxWidth: 420 }}
                />
              </div>
              <div>
                <label className="vg-label" style={{ display: 'block', marginBottom: 6 }}>Content</label>
                <textarea
                  className="vg-input"
                  value={draft.content}
                  onChange={(e) => setDraft((prev) => prev ? { ...prev, content: e.target.value } : prev)}
                  rows={24}
                  style={{ width: '100%', fontFamily: 'var(--nx-mono)', fontSize: 12, lineHeight: 1.6, resize: 'vertical' }}
                  placeholder="Paste your Terms & Conditions or Privacy Policy text here. Separate paragraphs with a blank line."
                />
                <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginTop: 4 }}>
                  Plain text — blank lines become paragraph breaks on the public page. No markup needed.
                  {page && ` Last updated ${new Date(page.updated_at).toLocaleString()}.`}
                </div>
              </div>
              {isDirty && (
                <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-amber)' }}>
                  Unsaved changes
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}
