// EmailBuilderPage.tsx — Block-based email/newsletter template builder (3C-6).
// Route: /email-builder  (authenticated, sidebar nav entry)
// Blocks: header / hero / text / button / image / divider / footer
// Serializes to inline-styled email-safe HTML via emailSerializer.ts.
// Templates are saved/loaded via POST/PATCH /v1/email-templates.

import React, { useEffect, useState } from 'react'
import { Panel } from '../ds'
import { vantageApi } from '../api/vantage'
import { serializeToHtml, type Block, type BlockType } from '../creative/emailSerializer'

// ─────────────────────────────────────────────────────────────────────
// Block defaults
// ─────────────────────────────────────────────────────────────────────
function newBlock(type: BlockType): Block {
  const id = Math.random().toString(36).slice(2)
  switch (type) {
    case 'header':  return { id, type, props: { brandName: 'VANTAGE', tagline: 'NEXUS SIGNAL REACTOR', accent: '#00C4E8' } }
    case 'hero':    return { id, type, props: { heading: 'YOUR HEADLINE HERE', sub: 'A concise subheadline that introduces this send.', accent: '#00C4E8' } }
    case 'text':    return { id, type, props: { content: 'Write your body copy here.\n\nBreak paragraphs with a blank line.' } }
    case 'button':  return { id, type, props: { label: 'READ MORE', url: 'https://vantage.nexus', accent: '#00C4E8' } }
    case 'image':   return { id, type, props: { src: '', alt: '' } }
    case 'divider': return { id, type, props: { color: '#13263A' } }
    case 'footer':  return { id, type, props: { domain: 'vantage.bioloopnexus.com', unsubLink: '#unsubscribe' } }
  }
}

const BLOCK_TYPES: { type: BlockType; label: string; icon: string }[] = [
  { type: 'header',  label: 'Header',  icon: '▦' },
  { type: 'hero',    label: 'Hero',    icon: '★' },
  { type: 'text',    label: 'Text',    icon: '¶' },
  { type: 'button',  label: 'Button',  icon: '▶' },
  { type: 'image',   label: 'Image',   icon: '◎' },
  { type: 'divider', label: 'Divider', icon: '—' },
  { type: 'footer',  label: 'Footer',  icon: '≡' },
]

// ─────────────────────────────────────────────────────────────────────
// Block prop editors
// ─────────────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.14em', display: 'block', marginBottom: 3 }}>{label}</label>
      {children}
    </div>
  )
}

function BlockEditor({ block, onChange }: { block: Block; onChange: (props: Record<string, unknown>) => void }) {
  const p    = block.props
  const upd  = (k: string, v: unknown) => onChange({ ...p, [k]: v })
  const inp  = (k: string, placeholder = '') => (
    <input value={String(p[k] ?? '')} onChange={(e) => upd(k, e.target.value)} className="vg-input" placeholder={placeholder} style={{ width: '100%', fontSize: 12 }} />
  )
  const area = (k: string, rows = 4, placeholder = '') => (
    <textarea rows={rows} value={String(p[k] ?? '')} onChange={(e) => upd(k, e.target.value)} className="vg-input" placeholder={placeholder} style={{ width: '100%', fontSize: 12, resize: 'vertical' }} />
  )

  switch (block.type) {
    case 'header':
      return (<><Field label="BRAND NAME">{inp('brandName', 'VANTAGE')}</Field><Field label="TAGLINE">{inp('tagline', 'NEXUS SIGNAL REACTOR')}</Field><Field label="ACCENT HEX">{inp('accent', '#00C4E8')}</Field></>)
    case 'hero':
      return (<><Field label="HEADING">{area('heading', 2, 'Main headline')}</Field><Field label="SUBHEADLINE">{area('sub', 2, 'Supporting copy')}</Field><Field label="ACCENT HEX">{inp('accent', '#00C4E8')}</Field></>)
    case 'text':
      return (<><Field label="CONTENT (blank line = new paragraph)">{area('content', 6, 'Write your body copy here.')}</Field></>)
    case 'button':
      return (<><Field label="LABEL">{inp('label', 'READ MORE')}</Field><Field label="URL">{inp('url', 'https://')}</Field><Field label="ACCENT HEX">{inp('accent', '#00C4E8')}</Field></>)
    case 'image':
      return (<><Field label="IMAGE URL">{inp('src', 'https://...')}</Field><Field label="ALT TEXT">{inp('alt', 'Descriptive alt text')}</Field></>)
    case 'divider':
      return (<><Field label="LINE COLOR">{inp('color', '#13263A')}</Field></>)
    case 'footer':
      return (<><Field label="DOMAIN">{inp('domain', 'vantage.nexus')}</Field><Field label="UNSUBSCRIBE URL">{inp('unsubLink', '#unsubscribe')}</Field></>)
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────
type SavedTemplate = { id: string; name: string; description: string; updated_at: string }

export function EmailBuilderPage() {
  const [blocks,    setBlocks]    = useState<Block[]>([newBlock('header'), newBlock('hero'), newBlock('text'), newBlock('footer')])
  const [selected,  setSelected]  = useState<number | null>(1)
  const [tplName,   setTplName]   = useState('My template')
  const [tplDesc,   setTplDesc]   = useState('')
  const [saved,     setSaved]     = useState<SavedTemplate[]>([])
  const [activeId,  setActiveId]  = useState<string | null>(null)
  const [saving,    setSaving]    = useState(false)
  const [err,       setErr]       = useState<string | null>(null)
  const [msg,       setMsg]       = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  useEffect(() => { void loadTemplates() }, [])

  const loadTemplates = async () => {
    try {
      const r = await vantageApi.listEmailTemplates()
      setSaved(r.templates as SavedTemplate[])
    } catch { /* list is best-effort */ }
  }

  const addBlock = (type: BlockType) => {
    const ins = selected != null ? selected + 1 : blocks.length
    const next = [...blocks.slice(0, ins), newBlock(type), ...blocks.slice(ins)]
    setBlocks(next); setSelected(ins)
  }

  const removeBlock = (i: number) => {
    const next = [...blocks]; next.splice(i, 1)
    setBlocks(next); setSelected(Math.max(0, i - 1))
  }

  const moveBlock = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= blocks.length) return
    const next = [...blocks]; [next[i], next[j]] = [next[j], next[i]]
    setBlocks(next); setSelected(j)
  }

  const updateBlock = (i: number, props: Record<string, unknown>) =>
    setBlocks((prev) => prev.map((b, idx) => idx === i ? { ...b, props } : b))

  const preview = () => setPreviewHtml(serializeToHtml(blocks))

  const copyHtml = () => {
    if (navigator.clipboard) void navigator.clipboard.writeText(serializeToHtml(blocks))
  }

  const saveTemplate = async () => {
    setSaving(true); setErr(null)
    try {
      const tpl = await vantageApi.saveEmailTemplate({ name: tplName, description: tplDesc, blocks })
      setActiveId((tpl.template as { id: string }).id)
      setMsg('Template saved')
      await loadTemplates()
    } catch (e) { setErr(String((e as Error).message)) }
    finally { setSaving(false) }
  }

  const patchTemplate = async () => {
    if (!activeId) return saveTemplate()
    setSaving(true); setErr(null)
    try {
      await vantageApi.patchEmailTemplate(activeId, { name: tplName, description: tplDesc, blocks })
      setMsg('Saved')
      await loadTemplates()
    } catch (e) { setErr(String((e as Error).message)) }
    finally { setSaving(false) }
  }

  const loadTemplate = async (id: string) => {
    try {
      const r = await vantageApi.getEmailTemplate(id)
      const t = r.template as { name: string; description: string; blocks: Block[] }
      setBlocks(t.blocks ?? []); setTplName(t.name); setTplDesc(t.description ?? ''); setActiveId(id); setSelected(0)
    } catch (e) { setErr(String((e as Error).message)) }
  }

  const deleteTemplate = async (id: string) => {
    try {
      await vantageApi.deleteEmailTemplate(id)
      if (activeId === id) setActiveId(null)
      await loadTemplates()
    } catch (e) { setErr(String((e as Error).message)) }
  }

  return (
    <>
      {/* Preview modal */}
      {previewHtml && (
        <div onClick={() => setPreviewHtml(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, width: '100%', maxWidth: 680, overflow: 'hidden' }}>
            <div style={{ background: 'var(--nx-surface)', display: 'flex', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--nx-border)' }}>
              <span className="nx-mono" style={{ fontSize: 10, color: 'var(--nx-accent)', letterSpacing: '0.16em' }}>EMAIL PREVIEW</span>
              <button type="button" onClick={() => setPreviewHtml(null)} style={{ background: 'none', border: '1px solid var(--nx-border)', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-3)' }}>✕ Close</button>
            </div>
            <iframe srcDoc={previewHtml} title="Email preview" sandbox="allow-same-origin" style={{ width: '100%', minHeight: 500, border: 'none', background: '#050C14' }} />
          </div>
        </div>
      )}

      <div className="vg-page-header">
        <h1 className="vg-page-title">Email Builder</h1>
        <p className="vg-page-sub">Block-based newsletter template builder — produces inline-styled, email-client-safe HTML</p>
      </div>

      {err && <div className="vg-error" style={{ marginBottom: 12 }}>{err}</div>}
      {msg && <div className="vg-success" style={{ marginBottom: 12 }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>

        {/* ── Block canvas (left) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {blocks.map((b, i) => (
            <div key={b.id}
              onClick={() => setSelected(i)}
              style={{ border: `1px solid ${selected === i ? 'var(--nx-accent)' : 'var(--nx-border)'}`, borderLeft: `3px solid ${selected === i ? 'var(--nx-accent)' : 'var(--nx-border)'}`, borderRadius: 4, padding: '10px 12px', background: selected === i ? 'rgba(0,196,232,0.05)' : 'var(--nx-surface)', cursor: 'pointer', transition: 'all 100ms' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: selected === i ? 12 : 0 }}>
                <span className="nx-mono" style={{ fontSize: 10, color: 'var(--nx-text-muted)', minWidth: 16 }}>{BLOCK_TYPES.find((t) => t.type === b.type)?.icon}</span>
                <span className="nx-mono" style={{ fontSize: 10, color: selected === i ? 'var(--nx-accent)' : 'var(--nx-text-3)', letterSpacing: '0.14em', flex: 1 }}>{b.type.toUpperCase()}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); moveBlock(i, -1) }} disabled={i === 0} style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, background: 'none', border: '1px solid var(--nx-border)', borderRadius: 3, padding: '2px 5px', cursor: 'pointer', color: 'var(--nx-text-4)' }}>↑</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); moveBlock(i, 1) }} disabled={i === blocks.length - 1} style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, background: 'none', border: '1px solid var(--nx-border)', borderRadius: 3, padding: '2px 5px', cursor: 'pointer', color: 'var(--nx-text-4)' }}>↓</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); removeBlock(i) }} style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, background: 'none', border: '1px solid var(--nx-border)', borderRadius: 3, padding: '2px 5px', cursor: 'pointer', color: '#ef4444' }}>✕</button>
                </div>
              </div>
              {selected === i && (
                <div onClick={(e) => e.stopPropagation()}>
                  <BlockEditor block={b} onChange={(props) => updateBlock(i, props)} />
                </div>
              )}
            </div>
          ))}

          {/* Add block row */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 0' }}>
            {BLOCK_TYPES.map((t) => (
              <button key={t.type} type="button" onClick={() => addBlock(t.type)} style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, letterSpacing: '0.1em', padding: '5px 10px', cursor: 'pointer', border: '1px dashed var(--nx-border)', borderRadius: 3, background: 'none', color: 'var(--nx-text-4)' }}>
                + {t.label}
              </button>
            ))}
          </div>

          {/* Action bar */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={preview} className="nx-btn" style={{ flex: 1, justifyContent: 'center', fontSize: 11, letterSpacing: '0.14em', color: 'var(--nx-accent)', borderColor: 'var(--nx-accent)', padding: '9px' }}>👁 Preview</button>
            <button type="button" onClick={copyHtml} className="nx-btn" style={{ flex: 1, justifyContent: 'center', fontSize: 11, letterSpacing: '0.14em', color: 'var(--nx-text-2)', padding: '9px' }}>⎘ Copy HTML</button>
            <button type="button" onClick={patchTemplate} disabled={saving} className="nx-btn nx-btn--primary" style={{ flex: 1, justifyContent: 'center', fontSize: 11, letterSpacing: '0.14em', padding: '9px', opacity: saving ? 0.6 : 1 }}>
              {saving ? '…' : activeId ? '↑ Update' : '↑ Save'}
            </button>
          </div>
        </div>

        {/* ── Sidebar (right) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Template meta */}
          <Panel title="Template">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.14em', display: 'block', marginBottom: 3 }}>NAME</label>
                <input value={tplName} onChange={(e) => setTplName(e.target.value)} className="vg-input" style={{ width: '100%', fontSize: 12 }} />
              </div>
              <div>
                <label className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.14em', display: 'block', marginBottom: 3 }}>DESCRIPTION</label>
                <textarea rows={2} value={tplDesc} onChange={(e) => setTplDesc(e.target.value)} className="vg-input" style={{ width: '100%', fontSize: 12, resize: 'vertical' }} />
              </div>
            </div>
          </Panel>

          {/* Saved templates */}
          {saved.length > 0 && (
            <Panel title="Saved Templates">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {saved.map((t) => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', border: `1px solid ${activeId === t.id ? 'var(--nx-accent)' : 'var(--nx-border)'}`, borderRadius: 4, background: activeId === t.id ? 'rgba(0,196,232,0.06)' : 'var(--nx-surface-2)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="nx-mono" style={{ fontSize: 10, color: activeId === t.id ? 'var(--nx-accent)' : 'var(--nx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                      <div className="nx-mono" style={{ fontSize: 8, color: 'var(--nx-text-4)' }}>{new Date(t.updated_at).toLocaleDateString()}</div>
                    </div>
                    <button type="button" onClick={() => void loadTemplate(t.id)} style={{ fontFamily: 'var(--nx-mono)', fontSize: 8, padding: '3px 7px', cursor: 'pointer', border: '1px solid var(--nx-border)', borderRadius: 3, background: 'none', color: 'var(--nx-accent)' }}>Load</button>
                    <button type="button" onClick={() => void deleteTemplate(t.id)} style={{ fontFamily: 'var(--nx-mono)', fontSize: 8, padding: '3px 6px', cursor: 'pointer', border: '1px solid var(--nx-border)', borderRadius: 3, background: 'none', color: '#ef4444' }}>✕</button>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  )
}
