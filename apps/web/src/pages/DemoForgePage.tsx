import React from 'react'
import { vantageApi } from '../api/vantage'
import { Panel, Button, Badge } from '../ds'

type Format = 'tiktok' | 'linkedin' | 'instagram'
type ScriptStep = {
  action: string
  selector?: string
  text?: string
  ms?: number
  narration: string
}
type MusicTrack = { id: string; title: string; artist: string | null; mood: string; use_case: string }
type JobStatus = { id: string; status: string; output_url: string | null; error_message: string | null; updated_at: string }

const ACTIONS = ['click', 'fill', 'hover', 'wait', 'navigate', 'scroll']
const FORMATS: Format[] = ['tiktok', 'linkedin', 'instagram']

const STATUS_COLOR: Record<string, string> = {
  pending:     'var(--nx-text-4)',
  recording:   'var(--nx-cyan)',
  synthesizing:'var(--nx-amber)',
  mixing:      'var(--nx-amber)',
  uploading:   'var(--nx-amber)',
  done:        '#22c55e',
  failed:      '#ef4444',
}

const DEFAULT_STEP: ScriptStep = { action: 'click', selector: '', narration: '' }

export function DemoForgePage() {
  const [url, setUrl]       = React.useState('')
  const [format, setFormat] = React.useState<Format>('tiktok')
  const [steps, setSteps]   = React.useState<ScriptStep[]>([{ ...DEFAULT_STEP }])
  const [tracks, setTracks] = React.useState<MusicTrack[]>([])
  const [trackId, setTrackId] = React.useState<string>('')
  const [job, setJob]       = React.useState<JobStatus | null>(null)
  const [history, setHistory] = React.useState<JobStatus[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [polling, setPolling]       = React.useState(false)
  const [err, setErr]     = React.useState<string | null>(null)
  const [msg, setMsg]     = React.useState<string | null>(null)
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  // Load music tracks + job history on mount
  React.useEffect(() => {
    void vantageApi.listMusicTracks().then((r) => setTracks(r.tracks as MusicTrack[])).catch(() => {})
    void vantageApi.listDemoForgeJobs().then((r) => setHistory(r.jobs as unknown as JobStatus[])).catch(() => {})
  }, [])

  // Stop polling on unmount
  React.useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const startPolling = (jobId: string) => {
    setPolling(true)
    pollRef.current = setInterval(async () => {
      try {
        const j = await vantageApi.getDemoForgeJob(jobId)
        setJob(j as unknown as JobStatus)
        if (j.status === 'done' || j.status === 'failed') {
          clearInterval(pollRef.current!)
          setPolling(false)
          if (j.status === 'done') setMsg('Video ready!')
          else setErr(`Job failed: ${j.error_message ?? 'unknown'}`)
          void vantageApi.listDemoForgeJobs().then((r) => setHistory(r.jobs as unknown as JobStatus[])).catch(() => {})
        }
      } catch {
        clearInterval(pollRef.current!)
        setPolling(false)
      }
    }, 5000)
  }

  const handleSubmit = async () => {
    if (!url || steps.length === 0) return
    setSubmitting(true); setErr(null); setMsg(null); setJob(null)
    try {
      const r = await vantageApi.createDemoForgeJob({
        target_format: format,
        url,
        script: steps.map((s) => ({
          action:    s.action,
          narration: s.narration,
          ...(s.selector ? { selector: s.selector } : {}),
          ...(s.text     ? { text: s.text }         : {}),
          ...(s.ms       ? { ms: s.ms }              : {}),
        })),
        ...(trackId ? { music_track_id: trackId } : {}),
      })
      setJob({ id: r.job_id, status: r.status, output_url: null, error_message: null, updated_at: new Date().toISOString() })
      startPolling(r.job_id)
    } catch (e) { setErr(String((e as Error).message)) }
    finally { setSubmitting(false) }
  }

  // Step helpers
  const updateStep = (i: number, patch: Partial<ScriptStep>) =>
    setSteps((prev) => prev.map((s, j) => j === i ? { ...s, ...patch } : s))
  const addStep = () => setSteps((prev) => [...prev, { ...DEFAULT_STEP }])
  const removeStep = (i: number) => setSteps((prev) => prev.filter((_, j) => j !== i))
  const moveStep = (i: number, dir: -1 | 1) => setSteps((prev) => {
    const arr = [...prev]; const tmp = arr[i + dir]; arr[i + dir] = arr[i]; arr[i] = tmp; return arr
  })

  return (
    <>
      <div className="vg-page-header">
        <h1 className="vg-page-title">DemoForge</h1>
        <p className="vg-page-sub">Record a browser demo, add AI narration, and render a platform-ready video</p>
      </div>

      {err && <div className="vg-error" style={{ marginBottom: 16 }}>{err}</div>}
      {msg && <div className="vg-success" style={{ marginBottom: 16 }}>{msg}</div>}

      <div className="vg-grid-60-40">

        {/* ── Job builder ──────────────────────────────────────────────────── */}
        <div className="vg-stack">

          <Panel title="Target" titleAccent="amber">
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label className="vg-label" style={{ display: 'block', marginBottom: 4 }}>URL to record</label>
                <input
                  type="url"
                  className="vg-input"
                  placeholder="https://yourproduct.com/feature"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label className="vg-label" style={{ display: 'block', marginBottom: 6 }}>Output format</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {FORMATS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFormat(f)}
                      style={{
                        fontFamily: 'var(--nx-mono)', fontSize: 10, padding: '3px 10px',
                        border: `1px solid ${format === f ? 'var(--nx-amber)' : 'var(--nx-border)'}`,
                        borderRadius: 4,
                        background: format === f ? 'rgba(245,158,11,0.12)' : 'transparent',
                        color: format === f ? 'var(--nx-amber)' : 'var(--nx-text-3)',
                        cursor: 'pointer',
                      }}
                    >
                      {f === 'tiktok' ? 'TikTok (9:16)' : f === 'linkedin' ? 'LinkedIn (16:9)' : 'Instagram (9:16)'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Script Steps">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {steps.map((step, i) => (
                <div
                  key={i}
                  style={{
                    background: 'var(--nx-surface-2)', border: '1px solid var(--nx-border)',
                    borderRadius: 6, padding: '10px 12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', minWidth: 20 }}>#{i + 1}</span>
                    <select
                      className="vg-input"
                      value={step.action}
                      onChange={(e) => updateStep(i, { action: e.target.value })}
                      style={{ width: 90, fontSize: 10 }}
                    >
                      {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                      {i > 0 && (
                        <button type="button" onClick={() => moveStep(i, -1)}
                          style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, background: 'none', border: '1px solid var(--nx-border)', borderRadius: 3, padding: '2px 5px', cursor: 'pointer', color: 'var(--nx-text-4)' }}>
                          ↑
                        </button>
                      )}
                      {i < steps.length - 1 && (
                        <button type="button" onClick={() => moveStep(i, 1)}
                          style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, background: 'none', border: '1px solid var(--nx-border)', borderRadius: 3, padding: '2px 5px', cursor: 'pointer', color: 'var(--nx-text-4)' }}>
                          ↓
                        </button>
                      )}
                      <button type="button" onClick={() => removeStep(i)}
                        style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, background: 'none', border: '1px solid var(--nx-border)', borderRadius: 3, padding: '2px 5px', cursor: 'pointer', color: '#ef4444' }}>
                        ✕
                      </button>
                    </div>
                  </div>
                  {step.action !== 'wait' && (
                    <input
                      type="text"
                      className="vg-input"
                      placeholder="CSS selector (e.g. #button-id)"
                      value={step.selector ?? ''}
                      onChange={(e) => updateStep(i, { selector: e.target.value })}
                      style={{ width: '100%', marginBottom: 6, fontSize: 10 }}
                    />
                  )}
                  {step.action === 'fill' && (
                    <input
                      type="text"
                      className="vg-input"
                      placeholder="Text to type"
                      value={step.text ?? ''}
                      onChange={(e) => updateStep(i, { text: e.target.value })}
                      style={{ width: '100%', marginBottom: 6, fontSize: 10 }}
                    />
                  )}
                  {step.action === 'wait' && (
                    <input
                      type="number"
                      className="vg-input"
                      placeholder="Milliseconds (e.g. 1000)"
                      value={step.ms ?? ''}
                      onChange={(e) => updateStep(i, { ms: parseInt(e.target.value) || undefined })}
                      style={{ width: '100%', marginBottom: 6, fontSize: 10 }}
                    />
                  )}
                  <textarea
                    className="vg-input"
                    placeholder="Narration for this step (spoken by ElevenLabs voice)…"
                    value={step.narration}
                    onChange={(e) => updateStep(i, { narration: e.target.value })}
                    rows={2}
                    style={{ width: '100%', resize: 'vertical', fontSize: 10 }}
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={addStep}
                style={{
                  fontFamily: 'var(--nx-mono)', fontSize: 10, padding: '6px',
                  border: '1px dashed var(--nx-border)', borderRadius: 6, background: 'none',
                  color: 'var(--nx-text-4)', cursor: 'pointer',
                }}
              >
                + Add step
              </button>
            </div>
          </Panel>

          <Panel title="Music">
            {tracks.length === 0 ? (
              <p className="vg-empty" style={{ margin: 0 }}>No music tracks — upload via the Music Library API</p>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setTrackId('')}
                  style={{
                    fontFamily: 'var(--nx-mono)', fontSize: 10, padding: '4px 10px',
                    border: `1px solid ${trackId === '' ? 'var(--nx-amber)' : 'var(--nx-border)'}`,
                    borderRadius: 4,
                    background: trackId === '' ? 'rgba(245,158,11,0.12)' : 'transparent',
                    color: trackId === '' ? 'var(--nx-amber)' : 'var(--nx-text-4)',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  No music
                </button>
                {tracks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTrackId(t.id)}
                    style={{
                      fontFamily: 'var(--nx-mono)', fontSize: 10, padding: '4px 10px',
                      border: `1px solid ${trackId === t.id ? 'var(--nx-amber)' : 'var(--nx-border)'}`,
                      borderRadius: 4,
                      background: trackId === t.id ? 'rgba(245,158,11,0.12)' : 'transparent',
                      color: trackId === t.id ? 'var(--nx-amber)' : 'var(--nx-text-3)',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    {t.title}{t.artist ? ` — ${t.artist}` : ''}&ensp;
                    <span style={{ color: 'var(--nx-text-4)', fontSize: 9 }}>{t.mood} · {t.use_case}</span>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <div>
            <Button
              label={submitting ? 'Submitting…' : 'Submit Job'}
              variant="primary"
              size="sm"
              disabled={submitting || !url || steps.length === 0 || polling}
              onClick={() => void handleSubmit()}
            />
          </div>
        </div>

        {/* ── Status + history ─────────────────────────────────────────────── */}
        <div className="vg-stack">

          {/* Active job status */}
          {job && (
            <Panel title="Job Status" titleAccent={job.status === 'done' ? 'green' : 'amber'}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: STATUS_COLOR[job.status] ?? 'var(--nx-text-4)',
                  animation: ['recording','synthesizing','mixing','uploading'].includes(job.status) ? 'pulse 1s infinite' : undefined,
                }} />
                <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, color: STATUS_COLOR[job.status] ?? 'var(--nx-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {job.status}
                </span>
                {polling && <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)' }}>polling…</span>}
              </div>
              <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginBottom: 8 }}>
                Job ID: {job.id}
              </div>
              {/* Pipeline steps */}
              {['pending','recording','synthesizing','mixing','uploading','done'].map((s, i, arr) => {
                const statuses = ['pending','recording','synthesizing','mixing','uploading','done']
                const currentIdx = statuses.indexOf(job.status)
                const stepIdx    = statuses.indexOf(s)
                const done       = stepIdx < currentIdx || job.status === 'done'
                const active     = stepIdx === currentIdx && job.status !== 'done'
                return (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                      border: `1px solid ${done ? '#22c55e' : active ? 'var(--nx-amber)' : 'var(--nx-border)'}`,
                      background: done ? '#22c55e' : active ? 'rgba(245,158,11,0.2)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {done && <span style={{ fontSize: 8, color: '#fff' }}>✓</span>}
                    </div>
                    <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: done ? '#22c55e' : active ? 'var(--nx-amber)' : 'var(--nx-text-4)' }}>
                      {s}
                    </span>
                  </div>
                )
              })}
              {job.output_url && (
                <div style={{ marginTop: 12 }}>
                  <a
                    href={job.output_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-cyan)', textDecoration: 'underline' }}
                  >
                    ↓ Download video
                  </a>
                </div>
              )}
              {job.error_message && (
                <div style={{ marginTop: 10, fontFamily: 'var(--nx-mono)', fontSize: 10, color: '#ef4444' }}>
                  {job.error_message}
                </div>
              )}
            </Panel>
          )}

          {/* Job history */}
          {history.length > 0 && (
            <Panel title="Recent Jobs">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {history.slice(0, 10).map((j) => (
                  <div key={j.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 8px',
                    background: 'var(--nx-surface-2)', border: '1px solid var(--nx-border)', borderRadius: 6,
                  }}>
                    <div>
                      <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginBottom: 2 }}>
                        {j.id.slice(0, 8)}…
                      </div>
                      <Badge label={j.status} variant={j.status === 'done' ? 'active' : j.status === 'failed' ? 'critical' : 'pending'} />
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {j.output_url ? (
                        <a href={j.output_url} target="_blank" rel="noopener noreferrer"
                          style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-cyan)', textDecoration: 'underline' }}>
                          Download
                        </a>
                      ) : (
                        <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)' }}>
                          {new Date(j.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
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
