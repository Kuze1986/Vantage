import React from 'react'
import { vantageApi } from '../api/vantage'
import { Panel, Button, Badge } from '../ds'
import { ThumbnailStudio } from '../creative/Thumbnail'
import { AudioMixer } from '../components/AudioMixer'

type Format = 'tiktok' | 'linkedin' | 'instagram'
type ScriptStep = {
  action: string
  selector?: string
  text?: string
  ms?: number
  narration: string
  soundEffect?: {
    effectId: string
    delayMs: number
    volumePercent: number
  }
}
type MusicTrack = { id: string; title: string; artist: string | null; mood: string; use_case: string }
type SoundEffect = { id: string; title: string; category: string; duration_ms: number | null; storage_path: string; use_case: string; created_at: string }
type JobStatus = { id: string; status: string; target_format?: string; output_url: string | null; error_message: string | null; updated_at: string }

const ACTIONS = ['navigate', 'click', 'fill', 'scroll', 'narrate']
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

// ── Template gallery ──────────────────────────────────────────────────────────
// Each template records a specific Vantage feature story.
// {BASE} is replaced with the operator-supplied base URL on load.

type VantageTemplate = {
  id: string
  name: string
  tagline: string
  audience: string
  format: Format
  estimatedSec: number
  steps: ScriptStep[]
}

const VANTAGE_TEMPLATES: VantageTemplate[] = [
  // ── A: Full pipeline (flagship) ───────────────────────────────────────────
  {
    id: 'full-pipeline',
    name: 'The Full Pipeline',
    tagline: 'Content lifecycle end-to-end — from topic to published post.',
    audience: 'B2B prospects · investors · agency demos',
    format: 'linkedin',
    estimatedSec: 90,
    steps: [
      { action: 'navigate', selector: '{BASE}/',          ms: 2500, narration: 'This is Vantage — an automated content pipeline that runs across seven channels simultaneously.' },
      { action: 'scroll',   selector: '',                 ms: 2000, narration: 'The dashboard shows live pipeline health: topics ingested, pieces auditing, and today\'s publish count vs. target.' },
      { action: 'navigate', selector: '{BASE}/queue',     ms: 2500, narration: 'Every generated piece flows through a strict status machine — draft, auditing, approved, queued, published.' },
      { action: 'scroll',   selector: '',                 ms: 2000, narration: 'Ilita, our AI brand-safety auditor, reviews every piece. Failed content is regenerated with the feedback inline.' },
      { action: 'navigate', selector: '{BASE}/calendar',  ms: 2500, narration: 'The calendar shows exactly how posts are distributed across the week — no clustering, no gaps.' },
      { action: 'navigate', selector: '{BASE}/analytics', ms: 2500, narration: 'BioLoop closes the loop. Engagement data feeds back into generation weights so Kuze learns which patterns perform.' },
      { action: 'scroll',   selector: '',                 ms: 2000, narration: 'Engagement by posting hour tells us exactly when our audience is active — so the cadence engine schedules accordingly.' },
      { action: 'navigate', selector: '{BASE}/',          ms: 2000, narration: 'Vantage runs 24/7. Cadence tick every 60 seconds. Auto-generate every 5 minutes. Pulse scans every 30. Automated content. Real signal.' },
    ],
  },

  // ── B: 60-second tour ─────────────────────────────────────────────────────
  {
    id: '60s-tour',
    name: '60-Second Tour',
    tagline: 'Fast sweep of every page. Hook-first, no filler.',
    audience: 'Social media · awareness campaigns · TikTok/Reels',
    format: 'tiktok',
    estimatedSec: 60,
    steps: [
      { action: 'navigate', selector: '{BASE}/',          ms: 1800, narration: 'Seven channels. One pipeline. Zero manual posts.' },
      { action: 'navigate', selector: '{BASE}/queue',     ms: 1800, narration: 'Every piece of content flows through a strict status machine.' },
      { action: 'navigate', selector: '{BASE}/calendar',  ms: 1800, narration: 'See exactly when every post goes out, weeks in advance.' },
      { action: 'navigate', selector: '{BASE}/analytics', ms: 1800, narration: 'And engagement data feeds straight back into the AI.' },
      { action: 'navigate', selector: '{BASE}/channels',  ms: 1800, narration: 'X. LinkedIn. Reddit. Email. TikTok. Instagram. Facebook.' },
      { action: 'navigate', selector: '{BASE}/voice',     ms: 1800, narration: 'Your brand voice shapes every word Kuze writes.' },
      { action: 'navigate', selector: '{BASE}/',          ms: 1800, narration: 'Vantage. Automated content. Real signal. No noise.' },
    ],
  },

  // ── C: BioLoop ────────────────────────────────────────────────────────────
  {
    id: 'bioloop',
    name: 'BioLoop: AI That Learns',
    tagline: 'The feedback loop that makes content measurably better over time.',
    audience: 'Technical buyers · growth teams · AI-curious prospects',
    format: 'linkedin',
    estimatedSec: 75,
    steps: [
      { action: 'navigate', selector: '{BASE}/',          ms: 2000, narration: 'Most content tools generate and forget. Vantage learns.' },
      { action: 'narrate',  selector: '',                           narration: 'BioLoop is a closed-loop feedback system. Every published piece is tracked. Every engagement event — click, share, reply — is recorded and attributed to the content patterns that drove it.' },
      { action: 'navigate', selector: '{BASE}/analytics', ms: 2500, narration: 'Here\'s what that data looks like. Engagement over time, broken down by channel and vertical.' },
      { action: 'scroll',   selector: '',                 ms: 2000, narration: 'Posting hour analysis reveals exactly when your audience is active.' },
      { action: 'narrate',  selector: '',                           narration: 'BioLoop computes 13 content patterns per piece — whether it opens with a question, has a call to action, is data-driven. Patterns that correlate with engagement get higher weights. Kuze reads those weights before every generation.' },
      { action: 'navigate', selector: '{BASE}/',          ms: 2000, narration: 'The result: content that gets measurably better over time. Automatically. Vantage — content intelligence that compounds.' },
    ],
  },

  // ── D: Queue deep-dive ────────────────────────────────────────────────────
  {
    id: 'queue-dive',
    name: 'Queue Deep Dive',
    tagline: 'The operator workflow — audit, preview, schedule, publish.',
    audience: 'Content managers · marketing ops · operator demos',
    format: 'instagram',
    estimatedSec: 60,
    steps: [
      { action: 'navigate', selector: '{BASE}/queue', ms: 2500, narration: 'Every piece of content Vantage generates lands here.' },
      { action: 'scroll',   selector: '',             ms: 2000, narration: 'Filter by status. See exactly what\'s auditing, what\'s approved, and what\'s queued for publish.' },
      { action: 'narrate',  selector: '',                       narration: 'Ilita — our AI brand-safety auditor — reviews every piece before it moves forward. Fail once, Kuze regenerates with the feedback inline. Fail twice, it\'s marked rejected.' },
      { action: 'scroll',   selector: '',             ms: 2000, narration: 'A/B variants share a variant group, so you can see which version performed before scaling it.' },
      { action: 'narrate',  selector: '',             ms: 1500, narration: 'For API channels — X, LinkedIn, Reddit, Email — one click publishes directly. For manual channels, the upload script is right here.' },
    ],
  },

  // ── E: Channel setup ──────────────────────────────────────────────────────
  {
    id: 'channel-setup',
    name: 'Channel Setup',
    tagline: 'Connect your platforms and configure automated cadence.',
    audience: 'New users · onboarding · channel partners',
    format: 'tiktok',
    estimatedSec: 50,
    steps: [
      { action: 'navigate', selector: '{BASE}/channels', ms: 2500, narration: 'Connect your channels. Vantage supports seven platforms out of the box.' },
      { action: 'scroll',   selector: '',                ms: 2000, narration: 'X, LinkedIn, and Reddit use full OAuth. Email sends through Resend to your subscriber list.' },
      { action: 'scroll',   selector: '',                ms: 2000, narration: 'For each channel, configure how many posts per day, which UTC hours to schedule, and whether to auto-approve Ilita-passing content.' },
      { action: 'narrate',  selector: '',                ms: 1500, narration: 'With auto-approve on, Vantage runs end-to-end without any manual steps. Content flows from topic to published post, automatically.' },
    ],
  },

  // ── F: Brand voice ────────────────────────────────────────────────────────
  {
    id: 'brand-voice',
    name: 'Brand Voice',
    tagline: 'The config that makes every Kuze output sound like you.',
    audience: 'Brand managers · creative directors · founder-led demos',
    format: 'linkedin',
    estimatedSec: 45,
    steps: [
      { action: 'navigate', selector: '{BASE}/voice', ms: 2500, narration: 'Kuze — our AI copywriter — writes in your brand\'s voice, not a generic one.' },
      { action: 'scroll',   selector: '',             ms: 2000, narration: 'You define the brand identity: who you are, what you stand for, and what you never say.' },
      { action: 'narrate',  selector: '',                       narration: 'Per-channel tone lets you sound professional on LinkedIn and punchy on X — from a single config. Off-topics are hard stops. Kuze will never write about them, regardless of the source topic.' },
      { action: 'navigate', selector: '{BASE}/voice', ms: 2000, narration: 'Every generation call loads the brand voice first. Your identity shapes every word.' },
    ],
  },
]

// ── Template card ─────────────────────────────────────────────────────────────

function formatLabel(f: Format) {
  if (f === 'tiktok')    return 'TikTok · 9:16'
  if (f === 'linkedin')  return 'LinkedIn · 16:9'
  return 'Instagram · 9:16'
}

function TemplateCard({
  tpl, isLoaded, onLoad,
}: {
  tpl: VantageTemplate; isLoaded: boolean; onLoad: () => void
}) {
  return (
    <div style={{
      border: isLoaded ? '1px solid var(--nx-amber)' : '1px solid var(--nx-border)',
      background: isLoaded ? 'rgba(239,160,32,0.06)' : 'var(--nx-surface)',
      borderRadius: 6, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 12, fontWeight: 700, color: isLoaded ? 'var(--nx-amber)' : 'var(--nx-text)', lineHeight: 1.3 }}>
          {tpl.name}
        </p>
        <span style={{
          fontFamily: 'var(--nx-mono)', fontSize: 9, letterSpacing: '0.1em',
          padding: '2px 7px', border: `1px solid ${isLoaded ? 'var(--nx-amber)' : 'var(--nx-border)'}`,
          color: isLoaded ? 'var(--nx-amber)' : 'var(--nx-text-3)', borderRadius: 2, whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {formatLabel(tpl.format)}
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--nx-text-2)', lineHeight: 1.5 }}>{tpl.tagline}</p>
      <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', letterSpacing: '0.1em' }}>
        {tpl.audience}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)' }}>
          {tpl.steps.length} steps · ~{tpl.estimatedSec}s
        </span>
        <button
          type="button"
          onClick={onLoad}
          style={{
            fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.1em',
            padding: '4px 12px', cursor: 'pointer',
            background: isLoaded ? 'rgba(239,160,32,0.15)' : 'transparent',
            border: `1px solid ${isLoaded ? 'var(--nx-amber)' : 'var(--nx-border-strong)'}`,
            color: isLoaded ? 'var(--nx-amber)' : 'var(--nx-text-2)',
            borderRadius: 3, transition: 'all 120ms',
          }}
        >
          {isLoaded ? '✓ Loaded' : 'Load →'}
        </button>
      </div>
    </div>
  )
}

// ── Script paste parser ───────────────────────────────────────────────────────
// Accepts the plain-text "STEP N - ACTION" format and returns ScriptStep[].
//
// Format per block:
//   STEP N - Navigate           → action: navigate, URL on next bare line
//   STEP N - Click              → action: click, Selector: <css>
//   STEP N - Fill               → action: fill,   Selector: <css>, Text: <value>
//   STEP N - Scroll             → action: scroll
//   STEP N - Wait               → action: wait,   Wait: <N>ms
//   STEP N - Narrate            → action: narrate
//   Narration: <text>           → narration field (any action)
//   Wait: <N>ms (non-wait)      → appends an implicit wait step after

function parseScriptText(raw: string): ScriptStep[] {
  const out: ScriptStep[] = []

  // Split on step headers — keep delimiter so each block starts with the action line
  const blocks = raw.split(/^\s*STEP\s+\d+\s*[-–]\s*/im).filter((b) => b.trim())

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length) continue

    // First line is the action name (may include trailing text, e.g. "Navigate" or "Navigate\r")
    const actionRaw = lines[0].toLowerCase().replace(/[^a-z]/g, '')
    let action: ScriptStep['action'] = 'narrate'
    if (actionRaw.includes('navigate')) action = 'navigate'
    else if (actionRaw.includes('click'))    action = 'click'
    else if (actionRaw.includes('fill'))     action = 'fill'
    else if (actionRaw.includes('scroll'))   action = 'scroll'
    else if (actionRaw.includes('wait'))     action = 'wait'
    else if (actionRaw.includes('narrate'))  action = 'narrate'

    let selector  = ''
    let text      = ''
    let ms: number | undefined
    let narration = ''
    let soundEffectId: string | undefined
    let soundDelayMs: number = 0
    let soundVolumePercent: number = 80

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      const lower = line.toLowerCase()

      if (lower.startsWith('narration:')) {
        narration = line.slice('narration:'.length).trim()
      } else if (lower.startsWith('selector:')) {
        selector = line.slice('selector:'.length).trim()
      } else if (lower.startsWith('text:')) {
        text = line.slice('text:'.length).trim()
      } else if (lower.startsWith('wait:')) {
        const parsed = parseInt(line.slice('wait:'.length).trim().replace(/ms.*$/i, ''), 10)
        if (!isNaN(parsed)) ms = parsed
      } else if (lower.startsWith('sound:')) {
        soundEffectId = line.slice('sound:'.length).trim()
      } else if (lower.startsWith('sounddelay:')) {
        const parsed = parseInt(line.slice('sounddelay:'.length).trim().replace(/ms.*$/i, ''), 10)
        if (!isNaN(parsed)) soundDelayMs = parsed
      } else if (lower.startsWith('soundvolume:')) {
        const parsed = parseInt(line.slice('soundvolume:'.length).trim().replace(/%.*$/i, ''), 10)
        if (!isNaN(parsed)) soundVolumePercent = parsed
      } else if (action === 'navigate' && !selector && (line.startsWith('http') || line.startsWith('/'))) {
        // bare URL line for navigate steps
        selector = line
      }
    }

    // Skip standalone wait-only blocks from old-format scripts — merge into prior step
    if (action === 'wait' && ms !== undefined && out.length > 0 && !narration) {
      out[out.length - 1] = { ...out[out.length - 1], ms }
      continue
    }

    const step: ScriptStep = { action, narration }
    if (selector) step.selector = selector
    if (text)     step.text     = text
    if (ms !== undefined) step.ms = ms
    if (soundEffectId) step.soundEffect = { effectId: soundEffectId, delayMs: soundDelayMs, volumePercent: soundVolumePercent }
    out.push(step)
  }

  return out
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function DemoForgePage() {
  const [mode, setMode]         = React.useState<'templates' | 'custom'>('templates')
  const [baseUrl, setBaseUrl]   = React.useState(() => typeof window !== 'undefined' ? window.location.origin : '')
  const [loadedTplId, setLoadedTplId] = React.useState<string | null>(null)

  const [url, setUrl]           = React.useState('')
  const [format, setFormat]     = React.useState<Format>('linkedin')
  const [steps, setSteps]       = React.useState<ScriptStep[]>([{ ...DEFAULT_STEP }])
  const [tracks, setTracks]     = React.useState<MusicTrack[]>([])
  const [trackId, setTrackId]   = React.useState<string>('')
  const [soundEffects, setSoundEffects] = React.useState<SoundEffect[]>([])
  const [narrationVolume, setNarrationVolume] = React.useState(100)
  const [musicVolume, setMusicVolume] = React.useState(15)
  const [effectVolumes, setEffectVolumes] = React.useState<number[]>([])
  const [masterVolume, setMasterVolume] = React.useState(100)
  const [job, setJob]           = React.useState<JobStatus | null>(null)
  const [history, setHistory]   = React.useState<JobStatus[]>([])
  const [thumbJob, setThumbJob] = React.useState<JobStatus | null>(null)
  const [submitting, setSubmitting]     = React.useState(false)
  const [polling, setPolling]           = React.useState(false)
  const [err, setErr]                   = React.useState<string | null>(null)
  const [msg, setMsg]                   = React.useState<string | null>(null)
  const [pasteOpen, setPasteOpen]       = React.useState(false)
  const [pasteText, setPasteText]       = React.useState('')
  const [parseError, setParseError]     = React.useState<string | null>(null)
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  // Load music tracks + sound effects + job history on mount
  React.useEffect(() => {
    void vantageApi.listMusicTracks().then((r) => setTracks(r.tracks as MusicTrack[])).catch(() => {})
    void vantageApi.listSoundEffects().then((r) => setSoundEffects(r.effects as SoundEffect[])).catch(() => {})
    void vantageApi.listDemoForgeJobs().then((r) => setHistory(r.jobs as unknown as JobStatus[])).catch(() => {})
  }, [])

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

  // Load a template — interpolate {BASE} and collapse any orphaned wait-only steps
  const loadTemplate = (tpl: VantageTemplate) => {
    const base = baseUrl.replace(/\/$/, '')
    const interpolated = tpl.steps.reduce<ScriptStep[]>((acc, s) => {
      const step = { ...s, selector: s.selector?.replace('{BASE}', base) ?? s.selector }
      // Absorb a bare wait step (no narration) into the preceding step's ms
      if (step.action === 'wait' && !step.narration && step.ms !== undefined && acc.length > 0) {
        acc[acc.length - 1] = { ...acc[acc.length - 1], ms: step.ms }
        return acc
      }
      return [...acc, step]
    }, [])
    setSteps(interpolated)
    setFormat(tpl.format)
    setUrl(base)
    setLoadedTplId(tpl.id)
    setMode('custom') // switch to editor so operator can review/tweak
  }

  const handleSubmit = async () => {
    if (!url || steps.length === 0) return
    setSubmitting(true); setErr(null); setMsg(null); setJob(null)
    try {
      // Expand inline ms into trailing wait steps for the processor; preserve soundEffect
      const expandedScript = steps.flatMap((s) => {
        const base = {
          action: s.action,
          narration: s.narration,
          ...(s.selector ? { selector: s.selector } : {}),
          ...(s.text     ? { text: s.text }         : {}),
          ...(s.soundEffect ? { soundEffect: s.soundEffect } : {}),
        }
        const trail = s.ms ? [{ action: 'wait' as const, narration: '', ms: s.ms }] : []
        return [base, ...trail]
      })
      const r = await vantageApi.createDemoForgeJob({
        target_format: format,
        url,
        script: expandedScript,
        ...(trackId ? { music_track_id: trackId } : {}),
        narration_volume: narrationVolume,
        music_volume: musicVolume,
        master_volume: masterVolume,
      })
      setJob({ id: r.job_id, status: r.status, output_url: null, error_message: null, updated_at: new Date().toISOString() })
      startPolling(r.job_id)
    } catch (e) { setErr(String((e as Error).message)) }
    finally { setSubmitting(false) }
  }

  const handleParseScript = () => {
    setParseError(null)
    try {
      const parsed = parseScriptText(pasteText)
      if (!parsed.length) { setParseError('No steps found — check the format (STEP 1 - Navigate, etc.)'); return }
      setSteps(parsed)
      // Auto-fill URL from the first navigate step
      const firstNav = parsed.find((s) => s.action === 'navigate' && s.selector)
      if (firstNav?.selector && !url) setUrl(firstNav.selector)
      setLoadedTplId(null)
      setPasteOpen(false)
      setPasteText('')
    } catch (e) {
      setParseError(String((e as Error).message))
    }
  }

  // Step helpers
  const updateStep = (i: number, patch: Partial<ScriptStep>) =>
    setSteps((prev) => prev.map((s, j) => j === i ? { ...s, ...patch } : s))
  const addStep    = () => setSteps((prev) => [...prev, { ...DEFAULT_STEP }])
  const removeStep = (i: number) => setSteps((prev) => prev.filter((_, j) => j !== i))
  const moveStep   = (i: number, dir: -1 | 1) => setSteps((prev) => {
    const arr = [...prev]; const tmp = arr[i + dir]; arr[i + dir] = arr[i]; arr[i] = tmp; return arr
  })

  // Mixer helpers
  const updateEffectVolume = (idx: number, vol: number) => {
    setEffectVolumes((prev) => {
      const next = [...prev]
      next[idx] = vol
      return next
    })
  }

  const resetMixerVolumes = () => {
    setNarrationVolume(100)
    setMusicVolume(15)
    setEffectVolumes((prev) => prev.map(() => 80))
    setMasterVolume(100)
  }

  return (
    <>
      {/* 3C-4: Thumbnail modal */}
      {thumbJob && (
        <div onClick={() => setThumbJob(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--nx-bg)', border: '1px solid var(--nx-border)', borderRadius: 10, padding: 24, width: '100%', maxWidth: 560 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span className="nx-mono" style={{ fontSize: 11, color: 'var(--nx-amber)', letterSpacing: '0.18em' }}>▦ THUMBNAIL · {thumbJob.target_format?.toUpperCase()}</span>
              <button type="button" onClick={() => setThumbJob(null)} style={{ background: 'none', border: '1px solid var(--nx-border)', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-3)' }}>✕ Close</button>
            </div>
            <ThumbnailStudio
              jobId={thumbJob.id}
              format={(thumbJob.target_format as 'tiktok' | 'instagram' | 'linkedin') ?? 'tiktok'}
              brandId="vantage"
            />
          </div>
        </div>
      )}

      <div className="vg-page-header">
        <h1 className="vg-page-title">DemoForge</h1>
        <p className="vg-page-sub">Record a Vantage demo, add AI narration, and render a platform-ready video</p>
      </div>

      {err && <div className="vg-error" style={{ marginBottom: 16 }}>{err}</div>}
      {msg && <div className="vg-success" style={{ marginBottom: 16 }}>{msg}</div>}

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--nx-border)' }}>
        {(['templates', 'custom'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={{
              fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.14em',
              padding: '8px 16px', cursor: 'pointer', background: 'none',
              border: 'none', borderBottom: `2px solid ${mode === m ? 'var(--nx-amber)' : 'transparent'}`,
              color: mode === m ? 'var(--nx-amber)' : 'var(--nx-text-3)',
              textTransform: 'uppercase', transition: 'all 120ms', marginBottom: -1,
            }}
          >
            {m === 'templates' ? '⬡ Templates' : '✎ Custom'}
          </button>
        ))}
      </div>

      <div className="vg-grid-60-40">

        <div className="vg-stack">

          {/* ── TEMPLATE GALLERY ────────────────────────────────────────────── */}
          {mode === 'templates' && (
            <>
              <Panel title="Base URL" titleAccent="amber">
                <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-3)', marginBottom: 10, letterSpacing: '0.08em' }}>
                  The Vantage instance Playwright will record. Auto-filled from your current origin.
                </p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="url"
                    className="vg-input"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://app.vantage.your-domain.com"
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button
                    type="button"
                    onClick={() => setBaseUrl(window.location.origin)}
                    style={{
                      whiteSpace: 'nowrap', cursor: 'pointer',
                      fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.08em',
                      padding: '7px 12px', flexShrink: 0,
                      border: '1px solid var(--nx-border-strong)',
                      background: 'var(--nx-surface-2)', color: 'var(--nx-text-3)',
                      borderRadius: 4,
                    }}
                  >
                    Use this origin
                  </button>
                </div>
              </Panel>

              <Panel title="Demo Templates">
                <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-3)', marginBottom: 14, letterSpacing: '0.08em', lineHeight: 1.6 }}>
                  Pre-built scripts for each Vantage feature story. Load one → review and tweak in the editor → submit.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {VANTAGE_TEMPLATES.map((tpl) => (
                    <TemplateCard
                      key={tpl.id}
                      tpl={tpl}
                      isLoaded={loadedTplId === tpl.id}
                      onLoad={() => loadTemplate(tpl)}
                    />
                  ))}
                </div>
              </Panel>
            </>
          )}

          {/* ── CUSTOM SCRIPT EDITOR ────────────────────────────────────────── */}
          {mode === 'custom' && (
            <>
              {loadedTplId && (
                <div style={{
                  fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-amber)',
                  padding: '8px 12px', border: '1px solid var(--nx-amber)',
                  background: 'rgba(239,160,32,0.06)', borderRadius: 4, letterSpacing: '0.1em',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <span>✓ Template loaded: {VANTAGE_TEMPLATES.find(t => t.id === loadedTplId)?.name}</span>
                  <button type="button" onClick={() => setMode('templates')}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--nx-amber)', cursor: 'pointer', fontSize: 10, fontFamily: 'var(--nx-mono)' }}>
                    ← Back to templates
                  </button>
                </div>
              )}

              <Panel title="Target" titleAccent="amber">
                <div style={{ display: 'grid', gap: 12 }}>
                  <div>
                    <label className="vg-label" style={{ display: 'block', marginBottom: 4 }}>Entry URL (first page to load)</label>
                    <input
                      type="url"
                      className="vg-input"
                      placeholder="https://app.vantage.your-domain.com"
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

              {/* ── Paste-to-parse ──────────────────────────────────────────── */}
              <div>
                <button
                  type="button"
                  onClick={() => { setPasteOpen((o) => !o); setParseError(null) }}
                  style={{
                    width: '100%', textAlign: 'left', cursor: 'pointer',
                    fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.1em',
                    padding: '8px 12px',
                    border: `1px solid ${pasteOpen ? 'var(--nx-amber)' : 'var(--nx-border)'}`,
                    borderRadius: 4,
                    background: pasteOpen ? 'rgba(239,160,32,0.06)' : 'var(--nx-surface-2)',
                    color: pasteOpen ? 'var(--nx-amber)' : 'var(--nx-text-3)',
                  }}
                >
                  {pasteOpen ? '▾' : '▸'}&ensp;📋 PASTE SCRIPT — import from text format
                </button>

                {pasteOpen && (
                  <div style={{ marginTop: 6, border: '1px solid var(--nx-amber)', borderRadius: 4, padding: 12, background: 'rgba(239,160,32,0.04)' }}>
                    <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginBottom: 8, lineHeight: 1.7, letterSpacing: '0.06em' }}>
                      FORMAT &mdash; one block per step, separated by a blank line:<br />
                      <span style={{ color: 'var(--nx-amber)' }}>STEP 1 - Navigate</span><br />
                      https://example.com<br />
                      Narration: Your narration here.<br />
                      Wait: 2000ms<br /><br />
                      <span style={{ color: 'var(--nx-amber)' }}>STEP 2 - Click</span><br />
                      Selector: .my-button<br />
                      Narration: Clicking the button.<br /><br />
                      <span style={{ color: 'var(--nx-amber)' }}>STEP 3 - Wait</span><br />
                      Wait: 1500ms
                    </p>
                    <textarea
                      className="vg-input"
                      rows={14}
                      placeholder={"STEP 1 - Navigate\nhttps://example.com\nNarration: Welcome!\nWait: 2000ms\n\nSTEP 2 - Scroll\nNarration: Scrolling down...\nWait: 1500ms"}
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      style={{ width: '100%', resize: 'vertical', fontSize: 10, fontFamily: 'var(--nx-mono)', marginBottom: 8 }}
                    />
                    {parseError && (
                      <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: '#ef4444', marginBottom: 8 }}>
                        {parseError}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        onClick={handleParseScript}
                        disabled={!pasteText.trim()}
                        style={{
                          fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.08em',
                          padding: '6px 16px', cursor: pasteText.trim() ? 'pointer' : 'not-allowed',
                          background: 'var(--nx-amber)', color: '#000', border: 'none', borderRadius: 3,
                          opacity: pasteText.trim() ? 1 : 0.4,
                        }}
                      >
                        Load Steps →
                      </button>
                      <button
                        type="button"
                        onClick={() => { setPasteText(''); setParseError(null) }}
                        style={{
                          fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.08em',
                          padding: '6px 12px', cursor: 'pointer',
                          background: 'none', color: 'var(--nx-text-3)',
                          border: '1px solid var(--nx-border)', borderRadius: 3,
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}
              </div>

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
                      {step.action === 'navigate' && (
                        <input
                          type="url"
                          className="vg-input"
                          placeholder="URL to navigate to"
                          value={step.selector ?? ''}
                          onChange={(e) => updateStep(i, { selector: e.target.value })}
                          style={{ width: '100%', marginBottom: 6, fontSize: 10 }}
                        />
                      )}
                      {(step.action === 'click' || step.action === 'fill' || step.action === 'scroll') && (
                        <input
                          type="text"
                          className="vg-input"
                          placeholder="CSS selector (e.g. .nx-panel__head or button[type='submit'])"
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
                      <textarea
                        className="vg-input"
                        placeholder="Narration for this step (spoken by ElevenLabs voice). Leave blank for silent steps."
                        value={step.narration}
                        onChange={(e) => updateStep(i, { narration: e.target.value })}
                        rows={2}
                        style={{ width: '100%', resize: 'vertical', fontSize: 10, marginBottom: 6 }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <label style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>WAIT AFTER</label>
                        <input
                          type="number"
                          className="vg-input"
                          placeholder="ms (e.g. 2000)"
                          value={step.ms ?? ''}
                          onChange={(e) => updateStep(i, { ms: parseInt(e.target.value) || undefined })}
                          style={{ width: 120, fontSize: 10 }}
                        />
                        <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)' }}>ms</span>
                        {step.ms && step.ms > 0 && (
                          <button type="button" onClick={() => updateStep(i, { ms: undefined })}
                            style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, background: 'none', border: 'none', color: 'var(--nx-text-4)', cursor: 'pointer', padding: '0 2px' }}>
                            ✕
                          </button>
                        )}
                      </div>

                      {/* Sound effect selector + delay + volume */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, padding: '8px 0' }}>
                        <div>
                          <label style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.12em', display: 'block', marginBottom: 4 }}>SOUND EFFECT</label>
                          <select
                            className="vg-input"
                            value={step.soundEffect?.effectId ?? ''}
                            onChange={(e) => {
                              if (e.target.value) {
                                updateStep(i, { soundEffect: { effectId: e.target.value, delayMs: step.soundEffect?.delayMs ?? 0, volumePercent: step.soundEffect?.volumePercent ?? 80 } })
                              } else {
                                updateStep(i, { soundEffect: undefined })
                              }
                            }}
                            style={{ width: '100%', fontSize: 10 }}
                          >
                            <option value="">— none —</option>
                            {soundEffects.map((eff) => (
                              <option key={eff.id} value={eff.id}>{eff.title} ({eff.category})</option>
                            ))}
                          </select>
                        </div>
                        {step.soundEffect && (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <label style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', whiteSpace: 'nowrap' }}>DELAY</label>
                              <input
                                type="number"
                                className="vg-input"
                                placeholder="ms"
                                value={step.soundEffect.delayMs}
                                onChange={(e) => updateStep(i, { soundEffect: { ...step.soundEffect!, delayMs: parseInt(e.target.value) || 0 } })}
                                style={{ width: 100, fontSize: 10 }}
                              />
                              <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)' }}>ms</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <label style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', whiteSpace: 'nowrap' }}>VOLUME</label>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={step.soundEffect.volumePercent}
                                onChange={(e) => updateStep(i, { soundEffect: { ...step.soundEffect!, volumePercent: parseInt(e.target.value) } })}
                                style={{ flex: 1, fontSize: 10 }}
                              />
                              <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', minWidth: 25 }}>{step.soundEffect.volumePercent}%</span>
                            </div>
                          </>
                        )}
                      </div>
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
                    {[{ id: '', title: 'No music', artist: null, mood: '', use_case: '' }, ...tracks].map((t) => (
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
                        {t.mood && <span style={{ color: 'var(--nx-text-4)', fontSize: 9 }}>{t.mood} · {t.use_case}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </Panel>

              {/* Audio Mixer */}
              <AudioMixer
                hasMusic={trackId !== ''}
                effectCount={steps.filter((s) => s.soundEffect).length}
                narrationVolume={narrationVolume}
                musicVolume={musicVolume}
                effectVolumes={effectVolumes.length === 0 ? steps.map((s) => s.soundEffect?.volumePercent ?? 80).filter((_, i) => steps[i]?.soundEffect) : effectVolumes}
                masterVolume={masterVolume}
                onNarrationVolumeChange={setNarrationVolume}
                onMusicVolumeChange={setMusicVolume}
                onEffectVolumeChange={updateEffectVolume}
                onMasterVolumeChange={setMasterVolume}
                onReset={resetMixerVolumes}
              />

              <div>
                <Button
                  label={submitting ? 'Submitting…' : 'Submit Job'}
                  variant="primary"
                  size="sm"
                  disabled={submitting || !url || steps.length === 0 || polling}
                  onClick={() => void handleSubmit()}
                />
              </div>
            </>
          )}
        </div>

        {/* ── Status + history ─────────────────────────────────────────────── */}
        <div className="vg-stack">

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
              {['pending','recording','synthesizing','mixing','uploading','done'].map((s) => {
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
                  <a href={job.output_url} target="_blank" rel="noopener noreferrer"
                    style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-cyan)', textDecoration: 'underline' }}>
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
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
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
                      {/* 3C-4: Thumbnail button */}
                      <button type="button" onClick={() => setThumbJob(j)}
                        style={{ fontFamily: 'var(--nx-mono)', fontSize: 8, letterSpacing: '0.1em', padding: '2px 7px', cursor: 'pointer', background: 'none', border: '1px solid var(--nx-border)', borderRadius: 3, color: 'var(--nx-text-4)' }}>
                        ▦ Thumbnail
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {mode === 'templates' && !job && (
            <Panel title="How it works">
              <ol style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-3)', lineHeight: 2, paddingLeft: 16, letterSpacing: '0.08em' }}>
                <li>Set the Vantage base URL above</li>
                <li>Pick a template and click Load</li>
                <li>Review and tweak steps in the editor</li>
                <li>Select a music track (optional)</li>
                <li>Submit — Playwright records, ElevenLabs narrates, FFmpeg renders</li>
              </ol>
            </Panel>
          )}
        </div>
      </div>
    </>
  )
}
