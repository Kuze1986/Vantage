import React from 'react'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/WorkspaceContext'
import { Panel } from '../ds'
import { BRAND_ORDER, BRANDS, type BrandId } from './socialkit/brands'

const CHANNELS = ['x', 'linkedin', 'reddit', 'email', 'tiktok', 'instagram', 'facebook', 'threads', 'bluesky']

export function VoicePage() {
  const { workspaceId } = useWorkspace()
  const [product, setProduct] = React.useState<BrandId>('shift')
  const [id, setId] = React.useState<string | null>(null)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [tones, setTones] = React.useState<Record<string, string>>(
    Object.fromEntries(CHANNELS.map((c) => [c, '']))
  )
  const [offTopics, setOffTopics] = React.useState('')
  const [err, setErr] = React.useState<string | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [loading, setLoading] = React.useState(false)

  const loadProduct = React.useCallback(async (slug: BrandId) => {
    setLoading(true)
    setErr(null)
    setMsg(null)
    const pack = BRANDS[slug]
    let q = supabase.from('brand_voice').select('*').eq('product_slug', slug).limit(1)
    if (workspaceId) q = q.eq('workspace_id', workspaceId)
    const { data, error } = await q.maybeSingle()
    if (error) { setErr(error.message); setLoading(false); return }

    if (data) {
      setId(data.id as string)
      setName((data.name as string) ?? pack.name)
      setDescription((data.description as string) ?? `${pack.essence}\n\nVoice: ${pack.voice.register}`)
      const pt = (data.per_channel_tone ?? {}) as Record<string, string>
      setTones(Object.fromEntries(CHANNELS.map((c) => [c, pt[c] ?? ''])))
      setOffTopics(((data.off_topics as string[]) ?? []).join('\n'))
    } else {
      setId(null)
      setName(pack.name)
      setDescription(`${pack.essence}\n\nVoice: ${pack.voice.register}`)
      setTones(Object.fromEntries(CHANNELS.map((c) => [c, ''])))
      setOffTopics('')
    }
    setLoading(false)
  }, [workspaceId])

  React.useEffect(() => {
    void loadProduct(product)
  }, [product, loadProduct])

  const save = async () => {
    if (!workspaceId) { setErr('Workspace not ready'); return }
    setSaving(true)
    setErr(null)
    setMsg(null)
    const toneObj: Record<string, string> = {}
    for (const [k, v] of Object.entries(tones)) {
      if (v.trim()) toneObj[k] = v.trim()
    }
    const off = offTopics.split('\n').map((s) => s.trim()).filter(Boolean)
    const pack = BRANDS[product]
    const row = {
      workspace_id: workspaceId,
      product_slug: product,
      name,
      description: description || null,
      per_channel_tone: toneObj,
      off_topics: off,
      pack: {
        id: pack.id,
        name: pack.name,
        essence: pack.essence,
        handle: pack.handle,
        domain: pack.domain,
        accent: pack.accent,
        accent2: pack.accent2,
        statusLabel: pack.statusLabel,
        statusTone: pack.statusTone,
        accentName: pack.accentName,
        eyebrowMeta: pack.eyebrowMeta,
        palette: pack.palette,
        voice: pack.voice,
        captions: pack.captions,
        hashtags: pack.hashtags,
        launch: pack.launch,
        insight: pack.insight,
      },
      updated_at: new Date().toISOString(),
    }
    if (id) {
      const { error } = await supabase.from('brand_voice').update(row).eq('id', id)
      if (error) setErr(error.message)
      else setMsg(`${pack.name} brand voice saved`)
    } else {
      const { data, error } = await supabase.from('brand_voice').insert(row).select('id').single()
      if (error) setErr(error.message)
      else { setId(data?.id as string); setMsg(`${pack.name} brand voice created`) }
    }
    setSaving(false)
  }

  return (
    <>
      <div className="vg-page-header">
        <h1 className="vg-page-title">Brand Voice</h1>
        <p className="vg-page-sub">Configure how Kuze writes for each NEXUS product in the portfolio</p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
        {BRAND_ORDER.map((slug) => (
          <button
            key={slug}
            type="button"
            onClick={() => setProduct(slug)}
            style={{
              fontFamily: 'var(--nx-mono)', fontSize: 10, padding: '4px 10px',
              border: `1px solid ${product === slug ? 'var(--nx-amber)' : 'var(--nx-border)'}`,
              borderRadius: 4,
              background: product === slug ? 'rgba(245,158,11,0.12)' : 'transparent',
              color: product === slug ? 'var(--nx-amber)' : 'var(--nx-text-3)',
              cursor: 'pointer',
            }}
          >
            {BRANDS[slug].name}
          </button>
        ))}
      </div>

      {err && <div className="vg-error" style={{ marginBottom: 16 }}>{err}</div>}
      {msg && <div className="vg-success" style={{ marginBottom: 16 }}>{msg}</div>}
      {loading && <p className="vg-empty" style={{ marginBottom: 16 }}>Loading {BRANDS[product].name}…</p>}

      <div className="vg-stack">
        <Panel title={`${BRANDS[product].name} Identity`} titleAccent="amber">
          <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginTop: 0 }}>
            {BRANDS[product].essence}
          </p>
          <div className="vg-form">
            <div className="vg-field">
              <label className="vg-field__label" htmlFor="voice-name">Voice name</label>
              <input
                id="voice-name"
                className="vg-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`e.g. ${BRANDS[product].name}`}
              />
            </div>
            <div className="vg-field">
              <label className="vg-field__label" htmlFor="voice-desc">Description</label>
              <textarea
                id="voice-desc"
                className="vg-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the voice and brand personality for this product…"
                rows={4}
                style={{ fontFamily: 'var(--nx-sans)', fontSize: 13 }}
              />
            </div>
          </div>
        </Panel>

        <Panel title="Per-channel Tone" titleAccent="cyan">
          <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', letterSpacing: '0.06em', marginTop: 0, marginBottom: 16 }}>
            Describe the tone Kuze should use for each channel. Leave blank to use the product voice.
          </p>
          <div className="vg-form">
            {CHANNELS.map((channel) => (
              <div key={channel} className="vg-field">
                <label className="vg-field__label" htmlFor={`tone-${channel}`}>{channel}</label>
                <input
                  id={`tone-${channel}`}
                  className="vg-input"
                  value={tones[channel] ?? ''}
                  onChange={(e) => setTones((prev) => ({ ...prev, [channel]: e.target.value }))}
                  placeholder="Channel-specific tone guidance…"
                />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Off-limits Topics" titleAccent="red">
          <div className="vg-field">
            <label className="vg-field__label" htmlFor="off-topics">Off topics (one per line)</label>
            <textarea
              id="off-topics"
              className="vg-textarea"
              value={offTopics}
              onChange={(e) => setOffTopics(e.target.value)}
              placeholder={'competitor promotions\npolitical content\nunverified medical claims'}
              rows={6}
            />
            <p className="vg-field__hint">Ilita will reject any content that touches these topics</p>
          </div>
        </Panel>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="nx-btn nx-btn--primary nx-btn--md"
            disabled={saving || loading}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : `Save ${BRANDS[product].name} voice`}
          </button>
        </div>
      </div>
    </>
  )
}
