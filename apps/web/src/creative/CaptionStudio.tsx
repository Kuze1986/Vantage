// CaptionStudio.tsx — AI Caption Studio panel (3C-2).
// Generates fresh on-voice captions from a free-text prompt via
// POST /v1/captions (Kuze + brand voice + BioLoop weights).
// Renders inline inside the Social Kit caption section.

import { useState } from 'react'
import { vantageApi } from '../api/vantage'

const CHANNELS = ['x', 'linkedin', 'instagram', 'tiktok', 'facebook', 'reddit', 'email'] as const
const TONES    = ['confident', 'educational', 'tactical', 'energetic', 'authoritative', 'playful'] as const

export function CaptionStudio({ accent = 'var(--nx-accent)' }: { accent?: string }) {
  const [prompt,  setPrompt]  = useState('')
  const [channel, setChannel] = useState<string>('x')
  const [tone,    setTone]    = useState('')
  const [count,   setCount]   = useState(3)
  const [results, setResults] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState<string | null>(null)
  const [copied,  setCopied]  = useState<number | null>(null)

  const generate = async () => {
    if (!prompt.trim()) return
    setLoading(true); setErr(null)
    try {
      const r = await vantageApi.generateCaptions({ prompt: prompt.trim(), channel, count, ...(tone ? { tone } : {}) })
      setResults(r.captions)
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setLoading(false)
    }
  }

  const copy = (text: string, i: number) => {
    if (navigator.clipboard) void navigator.clipboard.writeText(text)
    setCopied(i); setTimeout(() => setCopied(null), 1400)
  }

  return (
    <div style={{ marginTop: 32, border: `1px dashed ${accent}`, borderRadius: 6, padding: 20, background: `${accent}08` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ width: 7, height: 7, background: accent, boxShadow: `0 0 8px ${accent}` }} />
        <span className="nx-label" style={{ color: accent }}>✨ AI CAPTION GENERATOR</span>
        <span className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.1em' }}>Kuze · brand voice · BioLoop weights</span>
      </div>

      {/* Topic / angle */}
      <div style={{ marginBottom: 12 }}>
        <label className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.14em', display: 'block', marginBottom: 4 }}>TOPIC / ANGLE</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          className="vg-input"
          placeholder="e.g. Vantage is live — autonomous ad spend reallocation, real-time, across 7 channels"
          style={{ width: '100%', resize: 'vertical', fontSize: 12 }}
        />
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div>
          <label className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.14em', display: 'block', marginBottom: 4 }}>PLATFORM</label>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {CHANNELS.map((ch) => (
              <button key={ch} type="button" onClick={() => setChannel(ch)} style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, letterSpacing: '0.1em', padding: '4px 9px', cursor: 'pointer', border: `1px solid ${channel === ch ? accent : 'var(--nx-border)'}`, borderRadius: 3, background: channel === ch ? `${accent}1a` : 'transparent', color: channel === ch ? accent : 'var(--nx-text-3)' }}>
                {ch}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.14em', display: 'block', marginBottom: 4 }}>TONE (optional)</label>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setTone('')} style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, letterSpacing: '0.1em', padding: '4px 9px', cursor: 'pointer', border: `1px solid ${tone === '' ? accent : 'var(--nx-border)'}`, borderRadius: 3, background: tone === '' ? `${accent}1a` : 'transparent', color: tone === '' ? accent : 'var(--nx-text-3)' }}>auto</button>
            {TONES.map((t) => (
              <button key={t} type="button" onClick={() => setTone(t)} style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, letterSpacing: '0.1em', padding: '4px 9px', cursor: 'pointer', border: `1px solid ${tone === t ? accent : 'var(--nx-border)'}`, borderRadius: 3, background: tone === t ? `${accent}1a` : 'transparent', color: tone === t ? accent : 'var(--nx-text-3)' }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.14em' }}>COUNT</label>
          {[1, 2, 3, 4].map((n) => (
            <button key={n} type="button" onClick={() => setCount(n)} style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, padding: '4px 9px', cursor: 'pointer', border: `1px solid ${count === n ? accent : 'var(--nx-border)'}`, borderRadius: 3, background: count === n ? `${accent}1a` : 'transparent', color: count === n ? accent : 'var(--nx-text-3)' }}>{n}</button>
          ))}
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={loading || !prompt.trim()}
          style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.14em', padding: '8px 18px', cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer', background: loading || !prompt.trim() ? 'rgba(0,0,0,0.2)' : accent, color: '#000', border: 'none', borderRadius: 4, opacity: loading || !prompt.trim() ? 0.5 : 1, transition: 'all 120ms' }}
        >
          {loading ? 'GENERATING…' : '✨ GENERATE'}
        </button>
      </div>

      {err && <div className="vg-error" style={{ marginBottom: 12, fontSize: 11 }}>{err}</div>}

      {/* Results */}
      {results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {results.map((cap, i) => (
            <div key={i} style={{ border: '1px solid var(--nx-border)', borderLeft: `3px solid ${accent}`, background: 'rgba(0,0,0,0.2)', borderRadius: '0 4px 4px 0', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px dashed var(--nx-border)' }}>
                <span className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.14em' }}>VARIANT {i + 1}</span>
                <button type="button" onClick={() => copy(cap, i)} className="nx-btn" style={{ padding: '3px 10px', fontSize: 9, letterSpacing: '0.12em', borderColor: copied === i ? 'var(--nx-green)' : 'var(--nx-border-strong)', color: copied === i ? 'var(--nx-green)' : 'var(--nx-text-2)' }}>
                  {copied === i ? 'COPIED ✓' : 'COPY'}
                </button>
              </div>
              <p style={{ margin: 0, padding: '12px', fontSize: 13, lineHeight: 1.6, color: 'var(--nx-text-2)', whiteSpace: 'pre-line', fontFamily: 'var(--nx-body)' }}>{cap}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
