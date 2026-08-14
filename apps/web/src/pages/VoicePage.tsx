import React from 'react'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/WorkspaceContext'
import { Panel } from '../ds'

// Must stay in step with DEFAULT_CHANNELS in apps/api/src/lib/workspace.ts —
// a channel missing here silently generates with no per-channel tone.
const CHANNELS = ['x', 'linkedin', 'reddit', 'threads', 'bluesky', 'email', 'tiktok', 'instagram', 'facebook']

export function VoicePage() {
  const { workspaceId } = useWorkspace()
  const [id, setId] = React.useState<string | null>(null)
  const [name, setName] = React.useState('Brandon default')
  const [description, setDescription] = React.useState('')
  const [tones, setTones] = React.useState<Record<string, string>>(
    Object.fromEntries(CHANNELS.map((c) => [c, '']))
  )
  const [offTopics, setOffTopics] = React.useState('')
  const [err, setErr] = React.useState<string | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  // Scoped by workspace: brand_voice is one row per workspace (unique index
  // brand_voice_workspace_uidx). Without the filter this loads whichever row
  // RLS happens to return first, which is the wrong product's voice as soon as
  // the operator belongs to more than one workspace.
  React.useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase
        .from('brand_voice')
        .select('*')
        .eq('workspace_id', workspaceId)
        .maybeSingle()
      if (cancelled) return
      if (error) { setErr(error.message); return }
      if (data) {
        setId(data.id as string)
        setName((data.name as string) ?? '')
        setDescription((data.description as string) ?? '')
        const pt = (data.per_channel_tone ?? {}) as Record<string, string>
        setTones((prev) => ({ ...prev, ...pt }))
        setOffTopics(((data.off_topics as string[]) ?? []).join('\n'))
      } else {
        // Switched into a workspace with no voice yet — clear the previous one
        // rather than leaving it on screen ready to be saved over the new id.
        setId(null)
        setName('')
        setDescription('')
        setTones(Object.fromEntries(CHANNELS.map((c) => [c, ''])))
        setOffTopics('')
      }
    })()
    return () => { cancelled = true }
  }, [workspaceId])

  const save = async () => {
    if (!workspaceId) { setErr('No active workspace'); return }
    setSaving(true)
    setErr(null)
    setMsg(null)
    const toneObj: Record<string, string> = {}
    for (const [k, v] of Object.entries(tones)) {
      if (v.trim()) toneObj[k] = v.trim()
    }
    const off = offTopics.split('\n').map((s) => s.trim()).filter(Boolean)
    const row = {
      name,
      description: description || null,
      per_channel_tone: toneObj,
      off_topics: off,
      updated_at: new Date().toISOString(),
    }
    if (id) {
      // Scope the update by workspace too, so a stale id from a previous
      // workspace can never overwrite another product's voice.
      const { error } = await supabase
        .from('brand_voice')
        .update(row)
        .eq('id', id)
        .eq('workspace_id', workspaceId)
      if (error) setErr(error.message)
      else setMsg('Brand voice saved')
    } else {
      const { data, error } = await supabase
        .from('brand_voice')
        .insert({ ...row, workspace_id: workspaceId })
        .select('id')
        .single()
      if (error) setErr(error.message)
      else { setId(data?.id as string); setMsg('Brand voice created') }
    }
    setSaving(false)
  }

  return (
    <>
      <div className="vg-page-header">
        <h1 className="vg-page-title">Brand Voice</h1>
        <p className="vg-page-sub">Configure how Kuze writes content across all channels</p>
      </div>

      {err && <div className="vg-error" style={{ marginBottom: 16 }}>{err}</div>}
      {msg && <div className="vg-success" style={{ marginBottom: 16 }}>{msg}</div>}

      <div className="vg-stack">
        {/* Core identity */}
        <Panel title="Identity" titleAccent="amber">
          <div className="vg-form">
            <div className="vg-field">
              <label className="vg-field__label" htmlFor="voice-name">Voice name</label>
              <input
                id="voice-name"
                className="vg-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Brandon default"
              />
            </div>
            <div className="vg-field">
              <label className="vg-field__label" htmlFor="voice-desc">Description</label>
              <textarea
                id="voice-desc"
                className="vg-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the overall voice and brand personality…"
                rows={4}
                style={{ fontFamily: 'var(--nx-sans)', fontSize: 13 }}
              />
            </div>
          </div>
        </Panel>

        {/* Per-channel tone */}
        <Panel title="Per-channel Tone" titleAccent="cyan">
          <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', letterSpacing: '0.06em', marginTop: 0, marginBottom: 16 }}>
            Describe the tone Kuze should use for each channel. Leave blank to use the default voice.
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
                  placeholder={
                    channel === 'x'         ? 'Punchy, direct, education hook…' :
                    channel === 'linkedin'   ? 'Professional, insight-led, thought leadership…' :
                    channel === 'reddit'     ? 'Conversational, value-first, no hard sell…' :
                    channel === 'email'      ? 'Warm, informative, newsletter format…' :
                    'Casual, engaging, short-form…'
                  }
                />
              </div>
            ))}
          </div>
        </Panel>

        {/* Off-topics */}
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
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save brand voice'}
          </button>
        </div>
      </div>
    </>
  )
}
