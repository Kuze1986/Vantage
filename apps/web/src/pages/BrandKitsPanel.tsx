import React from 'react'
import { vantageApi, type BrandKitRecord } from '../api/vantage'
import { Panel, Button, Badge } from '../ds'

const FONTS = ['sans', 'mono', 'display'] as const

type Draft = {
  name: string
  primary_color: string
  secondary_color: string
  accent_color: string
  font_heading: string
  font_body: string
}

const emptyDraft = (): Draft => ({
  name: '',
  primary_color: '#FFFFFF',
  secondary_color: '#000000',
  accent_color: '#EFA020',
  font_heading: 'sans',
  font_body: 'sans',
})

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

type Props = {
  onKitsChange?: (kits: BrandKitRecord[]) => void
}

export function BrandKitsPanel({ onKitsChange }: Props) {
  const [kits, setKits] = React.useState<BrandKitRecord[]>([])
  const [draft, setDraft] = React.useState<Draft>(emptyDraft)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [logoDataUrl, setLogoDataUrl] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const r = await vantageApi.listBrandKits()
      setKits(r.kits)
      onKitsChange?.(r.kits)
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }, [onKitsChange])

  React.useEffect(() => { void load() }, [load])

  const startEdit = (kit: BrandKitRecord) => {
    setEditingId(kit.id)
    setDraft({
      name: kit.name,
      primary_color: kit.primary_color || '#FFFFFF',
      secondary_color: kit.secondary_color || '#000000',
      accent_color: kit.accent_color || '#EFA020',
      font_heading: kit.font_heading || 'sans',
      font_body: kit.font_body || 'sans',
    })
    setLogoDataUrl(null)
    setMsg(null)
    setErr(null)
  }

  const resetForm = () => {
    setEditingId(null)
    setDraft(emptyDraft())
    setLogoDataUrl(null)
  }

  const onPickLogo = async (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setErr('Logo must be an image file')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setErr('Logo must be 5MB or smaller')
      return
    }
    try {
      setLogoDataUrl(await readFileAsDataUrl(file))
      setErr(null)
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }

  const save = async () => {
    if (!draft.name.trim()) {
      setErr('Name is required')
      return
    }
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      if (editingId) {
        const r = await vantageApi.updateBrandKit(editingId, draft)
        let kit = r.kit
        if (logoDataUrl) {
          const up = await vantageApi.uploadBrandKitLogo(editingId, logoDataUrl)
          kit = up.kit
        }
        setKits((prev) => prev.map((k) => (k.id === kit.id ? kit : k)))
        setMsg(`Updated “${kit.name}”`)
      } else {
        const r = await vantageApi.createBrandKit({
          ...draft,
          ...(logoDataUrl ? { data_url: logoDataUrl } : {}),
        })
        setKits((prev) => [...prev, r.kit].sort((a, b) => a.name.localeCompare(b.name)))
        setMsg(`Created “${r.kit.name}”`)
      }
      resetForm()
      const list = await vantageApi.listBrandKits()
      setKits(list.kits)
      onKitsChange?.(list.kits)
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (kit: BrandKitRecord) => {
    if (!confirm(`Delete brand kit “${kit.name}”?`)) return
    setBusy(true)
    setErr(null)
    try {
      await vantageApi.deleteBrandKit(kit.id)
      const next = kits.filter((k) => k.id !== kit.id)
      setKits(next)
      onKitsChange?.(next)
      if (editingId === kit.id) resetForm()
      setMsg(`Deleted “${kit.name}”`)
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Brand Kits" titleAccent="amber">
      <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)', margin: '0 0 14px', lineHeight: 1.6 }}>
        Workspace logos and colors for DemoForge image overlays. Logos upload to Storage
        (<span style={{ color: 'var(--nx-cyan)' }}>brand-kits/…</span>) and set{' '}
        <span style={{ color: 'var(--nx-cyan)' }}>logo_storage_path</span> for FFmpeg burns.
      </p>

      {err && <div className="vg-error" style={{ marginBottom: 12 }}>{err}</div>}
      {msg && <div className="vg-success" style={{ marginBottom: 12 }}>{msg}</div>}

      <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
        {kits.length === 0 ? (
          <p className="vg-empty" style={{ margin: 0 }}>No brand kits yet — create one below.</p>
        ) : (
          kits.map((kit) => (
            <div
              key={kit.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                padding: '10px 12px', border: '1px solid var(--nx-border)', borderRadius: 6,
                background: 'var(--nx-surface-2)',
              }}
            >
              {kit.logo_url ? (
                <img
                  src={kit.logo_url}
                  alt=""
                  style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 4, background: '#111', border: '1px solid var(--nx-border)' }}
                />
              ) : (
                <div style={{
                  width: 40, height: 40, borderRadius: 4, border: '1px dashed var(--nx-border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)',
                }}>
                  —
                </div>
              )}
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ fontFamily: 'var(--nx-sans)', fontSize: 13, color: 'var(--nx-text-1)' }}>{kit.name}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                  {([kit.primary_color, kit.secondary_color, kit.accent_color] as string[]).map((c, i) => (
                    <span
                      key={i}
                      title={c}
                      style={{ width: 12, height: 12, borderRadius: 2, background: c, border: '1px solid var(--nx-border)' }}
                    />
                  ))}
                  <Badge
                    label={kit.logo_storage_path ? 'logo ready' : 'no logo'}
                    variant={kit.logo_storage_path ? 'active' : 'pending'}
                  />
                </div>
                <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginTop: 4 }}>
                  {kit.id}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button label="Edit" variant="secondary" size="sm" onClick={() => startEdit(kit)} disabled={busy} />
                <Button label="Delete" variant="secondary" size="sm" onClick={() => void remove(kit)} disabled={busy} />
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{
        display: 'grid', gap: 12, padding: 14,
        border: '1px solid var(--nx-border)', borderRadius: 6,
      }}>
        <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--nx-amber)' }}>
          {editingId ? 'EDIT BRAND KIT' : 'NEW BRAND KIT'}
        </div>

        <div>
          <label className="vg-label" style={{ display: 'block', marginBottom: 6 }}>Name</label>
          <input
            className="vg-input"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="e.g. The Shift"
            style={{ width: '100%', maxWidth: 360 }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, maxWidth: 480 }}>
          {([
            ['primary_color', 'Primary'] as const,
            ['secondary_color', 'Secondary'] as const,
            ['accent_color', 'Accent'] as const,
          ]).map(([key, label]) => (
            <div key={key}>
              <label className="vg-label" style={{ display: 'block', marginBottom: 6 }}>{label}</label>
              <input
                type="color"
                value={draft[key]}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value.toUpperCase() }))}
                style={{ width: '100%', height: 36, border: '1px solid var(--nx-border)', background: 'transparent' }}
              />
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 360 }}>
          {([
            ['font_heading', 'Heading font'] as const,
            ['font_body', 'Body font'] as const,
          ]).map(([key, label]) => (
            <div key={key}>
              <label className="vg-label" style={{ display: 'block', marginBottom: 6 }}>{label}</label>
              <select
                className="vg-input"
                value={draft[key]}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                style={{ width: '100%' }}
              >
                {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          ))}
        </div>

        <div>
          <label className="vg-label" style={{ display: 'block', marginBottom: 6 }}>Logo</label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => void onPickLogo(e.target.files?.[0] ?? null)}
          />
          {logoDataUrl && (
            <img
              src={logoDataUrl}
              alt="Logo preview"
              style={{ display: 'block', marginTop: 8, maxHeight: 64, objectFit: 'contain', border: '1px solid var(--nx-border)', borderRadius: 4 }}
            />
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button
            label={busy ? 'Saving…' : editingId ? 'Save changes' : 'Create brand kit'}
            variant="secondary"
            size="sm"
            onClick={() => void save()}
            disabled={busy}
          />
          {editingId && (
            <Button label="Cancel" variant="secondary" size="sm" onClick={resetForm} disabled={busy} />
          )}
        </div>
      </div>
    </Panel>
  )
}
