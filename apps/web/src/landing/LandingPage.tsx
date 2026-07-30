import React from 'react'
import { Link } from 'react-router-dom'
import { Chip, Corners, SectionHead, Sparkline, TelemetryStrip, VantageMark } from './primitives'
import './landing.css'

const V_CHANNELS = [
  { name: 'TIKTOK', color: '#00C4E8' },
  { name: 'YOUTUBE', color: '#E04040' },
  { name: 'META', color: '#EFA020' },
  { name: 'SEARCH', color: '#00E47A' },
  { name: 'DISPLAY', color: '#A4B8CC' },
  { name: 'AUDIO', color: '#7B9FE0' },
]

const V_OBJECTIVES = ['MAXIMIZE CONVERSIONS', 'MAXIMIZE REACH', 'TARGET ROAS 4.0x', 'LOWER CPA']

const V_SUBSYSTEMS = [
  { n: '01', name: 'SIGNAL INTAKE', color: 'var(--nx-accent)', desc: 'Ingests performance signals from every connected channel in real time — impressions, clicks, conversions, watch-through, dwell.', tags: ['REAL-TIME', '6 CHANNELS', 'EVENT STREAM'] },
  { n: '02', name: 'AUTONOMOUS ALLOCATION', color: 'var(--nx-green)', desc: 'Continuously moves budget toward what is converting against your objective. No weekly check-ins, no gut calls — the loop never sleeps.', tags: ['24/7', 'OBJECTIVE-LED', 'SELF-CORRECTING'] },
  { n: '03', name: 'CREATIVE ROTATION', color: 'var(--nx-accent-2)', desc: 'Tests every creative variant against live response and promotes the winners automatically, retiring fatigue before it costs you.', tags: ['MULTIVARIATE', 'FATIGUE GUARD', 'AUTO-PROMOTE'] },
  { n: '04', name: 'ATTRIBUTION CORE', color: 'var(--nx-silver)', desc: 'Multi-touch attribution that closes the loop — every conversion is traced back to the signals that earned it, then fed forward.', tags: ['MULTI-TOUCH', 'TRACEABLE', 'FEEDS THE LOOP'] },
]

const V_LOOP = [
  { k: 'OBSERVE', color: 'var(--nx-accent)', d: 'Read every signal across channels, creatives, and audiences — live.' },
  { k: 'ALLOCATE', color: 'var(--nx-green)', d: 'Move spend toward the combinations beating your objective right now.' },
  { k: 'MEASURE', color: 'var(--nx-accent-2)', d: 'Attribute outcomes back to the signals that drove them.' },
  { k: 'REBALANCE', color: 'var(--nx-red)', d: 'Feed the result forward and adjust — then start again, continuously.' },
]

function LandingNav() {
  const [scrolled, setScrolled] = React.useState(false)
  React.useEffect(() => {
    const on = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', on)
    return () => window.removeEventListener('scroll', on)
  }, [])
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 50,
      borderBottom: `1px solid ${scrolled ? 'var(--nx-border-strong)' : 'transparent'}`,
      background: scrolled ? 'rgba(5,12,20,0.82)' : 'transparent',
      backdropFilter: scrolled ? 'blur(10px)' : 'none', transition: 'all 200ms ease',
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '16px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <VantageMark size={28} />
          <span className="nx-display" style={{ fontSize: 24, letterSpacing: '0.22em', color: 'var(--nx-text)' }}>VANTAGE</span>
          <span className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-muted)', letterSpacing: '0.2em', borderLeft: '1px solid var(--nx-border-strong)', paddingLeft: 12 }}>SIGNAL REACTOR</span>
        </div>
        <nav style={{ display: 'flex', gap: 30, alignItems: 'center' }} className="v-nav">
          {['REACTOR', 'SUBSYSTEMS', 'THE LOOP', 'PROOF'].map((l) => (
            <a key={l} href={`#${l.replace(/\s/g, '').toLowerCase()}`} className="nx-mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--nx-text-2)', textDecoration: 'none' }}>{l}</a>
          ))}
          <Link to="/login" className="nx-btn nx-btn--primary" style={{ textDecoration: 'none' }}>▶ LAUNCH A CAMPAIGN</Link>
        </nav>
      </div>
    </div>
  )
}

function HeroReactorPreview() {
  const [t, setT] = React.useState(0)
  React.useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 50)
    return () => clearInterval(id)
  }, [])
  const channels = [
    { name: 'TIKTOK', color: 'var(--nx-accent)' },
    { name: 'YOUTUBE', color: 'var(--nx-red)' },
    { name: 'META', color: 'var(--nx-accent-2)' },
    { name: 'SEARCH', color: 'var(--nx-green)' },
    { name: 'DISPLAY', color: 'var(--nx-silver)' },
    { name: 'AUDIO', color: 'var(--nx-accent)' },
  ]
  const cx = 200, cy = 200, R = 140
  return (
    <div className="nx-panel" style={{ position: 'relative', padding: 0, overflow: 'hidden', background: 'radial-gradient(ellipse at center, rgba(0,196,232,0.06), transparent 70%), linear-gradient(180deg, var(--nx-surface), #061321)' }}>
      <Corners color="var(--nx-accent)" />
      <div style={{ position: 'absolute', top: 14, left: 16, right: 16, display: 'flex', justifyContent: 'space-between', zIndex: 3 }}>
        <span className="nx-label nx-label--accent">● REACTOR · LIVE</span>
        <span className="nx-mono" style={{ fontSize: 10, color: 'var(--nx-text-muted)' }}>OBJ: CONVERSIONS</span>
      </div>
      <svg viewBox="0 0 400 400" style={{ width: '100%', display: 'block' }}>
        {[R, R - 34, R - 68].map((r, i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke="var(--nx-border-strong)" strokeWidth="0.8" strokeDasharray={i === 0 ? '2 5' : undefined} opacity={0.5} />
        ))}
        <line x1={cx} y1={cy} x2={cx + Math.cos(t * 0.03) * R} y2={cy + Math.sin(t * 0.03) * R} stroke="var(--nx-accent)" strokeWidth="1" opacity="0.3" />
        <circle cx={cx} cy={cy} r="34" fill="rgba(0,196,232,0.08)" stroke="var(--nx-accent)" strokeWidth="1" />
        <circle cx={cx} cy={cy} r={20 + Math.sin(t * 0.06) * 3} fill="none" stroke="var(--nx-accent)" strokeWidth="0.6" opacity="0.5" />
        <text x={cx} y={cy - 2} textAnchor="middle" fontFamily="Bebas Neue, Impact, sans-serif" fontSize="20" fill="var(--nx-text)" letterSpacing="1">VTG</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontFamily="Share Tech Mono, monospace" fontSize="7" fill="var(--nx-accent)" letterSpacing="2">CORE</text>
        {channels.map((ch, i) => {
          const a = (i / channels.length) * Math.PI * 2 + t * 0.006
          const x = cx + Math.cos(a) * R
          const y = cy + Math.sin(a) * R
          const pulse = 0.5 + 0.5 * Math.sin(t * 0.05 + i)
          return (
            <g key={ch.name}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke={ch.color} strokeWidth="0.7" opacity={0.2 + pulse * 0.3} />
              <circle cx={x} cy={y} r={5 + pulse * 2} fill={ch.color} opacity="0.9" style={{ filter: `drop-shadow(0 0 6px ${ch.color})` }} />
              <text x={x} y={y - 12} textAnchor="middle" fontFamily="Share Tech Mono, monospace" fontSize="8" fill="var(--nx-text-2)" letterSpacing="1">{ch.name}</text>
            </g>
          )
        })}
      </svg>
      <div style={{ position: 'absolute', bottom: 14, left: 16, right: 16, display: 'flex', justifyContent: 'space-between', zIndex: 3, fontFamily: 'var(--nx-mono)', fontSize: 10 }}>
        <span style={{ color: 'var(--nx-green)' }}>▲ ROAS 3.8x</span>
        <span style={{ color: 'var(--nx-text-muted)' }}>REALLOCATING…</span>
      </div>
    </div>
  )
}

function LandingHero() {
  return (
    <header className="nx-grid-bg nx-scanlines" style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '-10%', right: '-5%', width: 700, height: 700, background: 'radial-gradient(circle, rgba(0,196,232,0.14), transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '-20%', left: '-10%', width: 600, height: 600, background: 'radial-gradient(circle, rgba(0,228,122,0.08), transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '64px 40px 80px', position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 56, alignItems: 'center' }} className="v-hero-grid">
          <div>
            <Chip tone="cyan" dot>AUTOPILOT · SIGNAL REACTOR v4.2</Chip>
            <h1 className="nx-display" style={{ fontSize: 'clamp(52px, 6.4vw, 104px)', lineHeight: 0.92, letterSpacing: '0.01em', margin: '22px 0 0', color: 'var(--nx-text)' }}>
              PUT YOUR<br />CAMPAIGNS ON<br /><span style={{ color: 'var(--nx-accent)' }}>AUTOPILOT.</span>
            </h1>
            <p style={{ fontSize: 19, lineHeight: 1.5, color: 'var(--nx-text-2)', maxWidth: 520, margin: '26px 0 0', fontWeight: 500 }}>
              An autonomous signal reactor for advertising and content distribution. Set the objective — Vantage allocates spend across every channel, reads the response in real time, and rebalances on its own.
            </p>
            <div style={{ display: 'flex', gap: 14, marginTop: 32, flexWrap: 'wrap' }}>
              <Link to="/login" className="nx-btn nx-btn--primary" style={{ padding: '14px 24px', fontSize: 13, textDecoration: 'none' }}>▶ LAUNCH A CAMPAIGN</Link>
              <a href="#reactor" className="nx-btn" style={{ padding: '14px 24px', fontSize: 13, textDecoration: 'none' }}>WATCH THE REACTOR ↓</a>
            </div>
            <div style={{ marginTop: 40, paddingTop: 24, borderTop: '1px solid var(--nx-border)', display: 'flex', gap: 36, flexWrap: 'wrap' }}>
              {([['6', 'CHANNELS ORCHESTRATED'], ['24/7', 'AUTONOMOUS REBALANCE'], ['<60s', 'SIGNAL-TO-ACTION']] as const).map(([v, l]) => (
                <div key={l}>
                  <div className="nx-display" style={{ fontSize: 36, color: 'var(--nx-text)', lineHeight: 0.9 }}>{v}</div>
                  <div className="nx-mono" style={{ fontSize: 9.5, color: 'var(--nx-text-muted)', letterSpacing: '0.16em', marginTop: 6 }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            <HeroReactorPreview />
          </div>
        </div>
        <div style={{ marginTop: 48 }}>
          <TelemetryStrip />
        </div>
      </div>
    </header>
  )
}

function ReactorMetric({ label, value, unit, color }: { label: string; value: string | number; unit?: string; color: string }) {
  return (
    <div className="nx-tile" style={{ padding: '12px 14px' }}>
      <div className="nx-label" style={{ fontSize: 9 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 6 }}>
        <span className="nx-display" style={{ fontSize: 30, color, lineHeight: 0.9 }}>{value}</span>
        {unit && <span className="nx-mono" style={{ fontSize: 12, color: 'var(--nx-text-2)' }}>{unit}</span>}
      </div>
    </div>
  )
}

function SignalReactor() {
  const [alloc, setAlloc] = React.useState([24, 18, 22, 16, 12, 8])
  const [objective, setObjective] = React.useState(0)
  const [log, setLog] = React.useState([{ t: '00:00', m: 'Reactor engaged · baseline allocation set', c: 'var(--nx-accent)' }])
  const [metrics, setMetrics] = React.useState({ reach: 2.41, conv: 412, cpm: 4.2, roas: 3.8 })
  const [running, setRunning] = React.useState(true)
  const clock = React.useRef(0)

  React.useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      clock.current += 3
      setAlloc((prev) => {
        const next = [...prev]
        const up = Math.floor(Math.random() * next.length)
        let down = Math.floor(Math.random() * next.length)
        if (down === up) down = (down + 1) % next.length
        const move = 2 + Math.floor(Math.random() * 5)
        if (next[down]! - move < 4) return prev
        next[up]! += move
        next[down]! -= move
        const mm = String(Math.floor(clock.current / 60)).padStart(2, '0')
        const ss = String(clock.current % 60).padStart(2, '0')
        setLog((l) => [{
          t: `${mm}:${ss}`,
          m: `↑ ${V_CHANNELS[up]!.name} +${move}%   ↓ ${V_CHANNELS[down]!.name} −${move}%`,
          c: 'var(--nx-text)',
        }, ...l].slice(0, 6))
        return next
      })
      setMetrics((m) => ({
        reach: +(m.reach + (Math.random() * 0.06 - 0.01)).toFixed(2),
        conv: m.conv + Math.floor(Math.random() * 6 - 1),
        cpm: +(Math.max(3.4, m.cpm + (Math.random() * 0.12 - 0.07))).toFixed(2),
        roas: +(Math.max(3.2, Math.min(4.6, m.roas + (Math.random() * 0.14 - 0.06))).toFixed(1)),
      }))
    }, 1800)
    return () => clearInterval(id)
  }, [running])

  const total = alloc.reduce((a, b) => a + b, 0)

  return (
    <section id="reactor" className="nx-grid-bg" style={{ padding: '90px 40px', borderTop: '1px solid var(--nx-border)', position: 'relative' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <SectionHead
          n="01"
          eyebrow="THE SHOWPIECE · LIVE"
          title={<>The <span style={{ color: 'var(--nx-accent)' }}>Signal Reactor.</span></>}
          sub="This is Vantage thinking out loud. Watch it move budget toward what's converting — autonomously, every few seconds, with no one at the wheel."
        />
        <div className="nx-panel nx-scan" style={{ position: 'relative', padding: 0, overflow: 'hidden' }}>
          <Corners color="var(--nx-accent)" />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', borderBottom: '1px solid var(--nx-border)', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span className="nx-pulse" style={{ background: running ? 'var(--nx-green)' : 'var(--nx-amber)', boxShadow: `0 0 8px ${running ? 'var(--nx-green)' : 'var(--nx-amber)'}` }} />
              <span className="nx-label" style={{ color: running ? 'var(--nx-green)' : 'var(--nx-amber)' }}>{running ? 'AUTOPILOT ENGAGED' : 'AUTOPILOT PAUSED'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="nx-mono" style={{ fontSize: 10, color: 'var(--nx-text-muted)', letterSpacing: '0.14em' }}>OBJECTIVE</span>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {V_OBJECTIVES.map((o, i) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => {
                      setObjective(i)
                      setLog((l) => [{ t: '··:··', m: `Objective reset → ${o}`, c: 'var(--nx-accent-2)' }, ...l].slice(0, 6))
                    }}
                    className="nx-mono"
                    style={{
                      fontSize: 10, letterSpacing: '0.1em', padding: '6px 10px', cursor: 'pointer',
                      background: objective === i ? 'rgba(0,196,232,0.12)' : 'transparent',
                      border: `1px solid ${objective === i ? 'var(--nx-accent)' : 'var(--nx-border-strong)'}`,
                      color: objective === i ? 'var(--nx-accent)' : 'var(--nx-text-2)',
                    }}
                  >{o}</button>
                ))}
              </div>
              <button type="button" onClick={() => setRunning((r) => !r)} className="nx-btn" style={{ padding: '6px 12px', fontSize: 10 }}>{running ? '❚❚ PAUSE' : '▶ RESUME'}</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 0 }} className="v-reactor-grid">
            <div style={{ padding: 24, borderRight: '1px solid var(--nx-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
                <span className="nx-label">CHANNEL ALLOCATION · % OF SPEND</span>
                <span className="nx-mono" style={{ fontSize: 10, color: 'var(--nx-accent-2)' }}>{V_OBJECTIVES[objective]}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {V_CHANNELS.map((ch, i) => {
                  const pct = Math.round((alloc[i]! / total) * 100)
                  return (
                    <div key={ch.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className="nx-mono" style={{ fontSize: 11, color: 'var(--nx-text-2)', width: 74, flexShrink: 0, letterSpacing: '0.08em' }}>{ch.name}</span>
                      <div style={{ flex: 1, height: 22, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--nx-border)', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: `linear-gradient(90deg, ${ch.color}cc, ${ch.color}66)`, boxShadow: `0 0 12px -2px ${ch.color}`, transition: 'width 1400ms cubic-bezier(.2,.7,.2,1)' }} />
                      </div>
                      <span className="nx-mono" style={{ fontSize: 12, color: ch.color, width: 38, textAlign: 'right', flexShrink: 0 }}>{pct}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <div className="nx-label" style={{ marginBottom: 12 }}>LIVE PERFORMANCE</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <ReactorMetric label="REACH" value={metrics.reach.toFixed(2)} unit="M" color="var(--nx-accent)" />
                  <ReactorMetric label="CONVERSIONS" value={metrics.conv} color="var(--nx-green)" />
                  <ReactorMetric label="CPM" value={`$${metrics.cpm.toFixed(2)}`} color="var(--nx-accent-2)" />
                  <ReactorMetric label="ROAS" value={`${metrics.roas.toFixed(1)}x`} color="var(--nx-green)" />
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div className="nx-label" style={{ marginBottom: 12 }}>● AUTONOMOUS DECISION LOG</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontFamily: 'var(--nx-mono)', fontSize: 11 }}>
                  {log.map((row, i) => (
                    <div key={`${row.t}-${i}`} style={{ display: 'flex', gap: 10, opacity: 1 - i * 0.13, animation: i === 0 ? 'vg-landing-log 400ms ease' : 'none' }}>
                      <span style={{ color: 'var(--nx-text-muted)', flexShrink: 0 }}>{row.t}</span>
                      <span style={{ color: row.c }}>{row.m}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        <p className="nx-mono" style={{ fontSize: 11, color: 'var(--nx-text-muted)', letterSpacing: '0.1em', marginTop: 14, textAlign: 'center' }}>
          ▸ SIMULATED FEED · Reactor decisions shown are illustrative of live autopilot behavior
        </p>
      </div>
    </section>
  )
}

function LandingSubsystems() {
  return (
    <section id="subsystems" className="nx-grid-bg" style={{ padding: '90px 40px', borderTop: '1px solid var(--nx-border)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <SectionHead
          n="02"
          eyebrow="CORE · FOUR SYSTEMS"
          accent="var(--nx-accent-2)"
          title={<>What's inside the <span style={{ color: 'var(--nx-accent-2)' }}>reactor.</span></>}
          sub="Four subsystems run as one continuous loop. You set the objective; they handle the orchestration."
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} className="v-sub-grid">
          {V_SUBSYSTEMS.map((s) => (
            <div key={s.name} className="nx-panel v-card" style={{ position: 'relative', padding: 26, overflow: 'hidden' }}>
              <Corners color={s.color} />
              <div style={{ position: 'absolute', top: -10, right: 14, fontFamily: 'var(--nx-display)', fontSize: 96, color: 'rgba(255,255,255,0.03)', lineHeight: 1 }}>{s.n}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <span style={{ width: 8, height: 8, background: s.color, boxShadow: `0 0 10px ${s.color}` }} />
                <span className="nx-mono" style={{ fontSize: 10, color: s.color, letterSpacing: '0.18em' }}>{s.n} · SUBSYSTEM</span>
              </div>
              <h3 className="nx-display" style={{ fontSize: 34, margin: '0 0 12px', color: 'var(--nx-text)', letterSpacing: '0.03em' }}>{s.name}</h3>
              <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--nx-text-2)', margin: '0 0 18px', fontWeight: 500 }}>{s.desc}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {s.tags.map((t) => <span key={t} className="nx-chip">{t}</span>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function LandingLoop() {
  const [active, setActive] = React.useState(0)
  React.useEffect(() => {
    const id = setInterval(() => setActive((a) => (a + 1) % V_LOOP.length), 2000)
    return () => clearInterval(id)
  }, [])
  return (
    <section id="theloop" style={{ padding: '90px 40px', borderTop: '1px solid var(--nx-border)', background: 'linear-gradient(180deg, #061321, var(--nx-bg))', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '50%', left: '50%', width: 900, height: 900, transform: 'translate(-50%,-50%)', background: 'radial-gradient(circle, rgba(0,196,232,0.06), transparent 60%)', pointerEvents: 'none' }} />
      <div style={{ maxWidth: 1280, margin: '0 auto', position: 'relative' }}>
        <SectionHead
          n="03"
          eyebrow="MECHANISM · NEVER STOPS"
          title={<>One loop. <span style={{ color: 'var(--nx-accent)' }}>Always running.</span></>}
          sub="Manual media buying is a series of snapshots. Vantage is a continuous loop — the four stages run on repeat, every cycle sharper than the last."
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 48, alignItems: 'center' }} className="v-loop-grid">
          <div style={{ position: 'relative', aspectRatio: '1/1', maxWidth: 460, margin: '0 auto', width: '100%' }}>
            <svg viewBox="0 0 400 400" style={{ width: '100%' }}>
              <circle cx="200" cy="200" r="150" fill="none" stroke="var(--nx-border-strong)" strokeWidth="1" strokeDasharray="3 6" />
              {V_LOOP.map((s, i) => {
                const a = (i / V_LOOP.length) * Math.PI * 2 - Math.PI / 2
                const x = 200 + Math.cos(a) * 150
                const y = 200 + Math.sin(a) * 150
                const on = i === active
                return (
                  <g key={s.k}>
                    {on && <circle cx={x} cy={y} r="42" fill={s.color} opacity="0.12" />}
                    <circle cx={x} cy={y} r="30" fill="var(--nx-surface)" stroke={s.color} strokeWidth={on ? 2 : 1} style={{ filter: on ? `drop-shadow(0 0 10px ${s.color})` : 'none', transition: 'all 300ms ease' }} />
                    <text x={x} y={y + 4} textAnchor="middle" fontFamily="Share Tech Mono, monospace" fontSize="9" fill={on ? s.color : 'var(--nx-text-2)'} letterSpacing="1">{String(i + 1).padStart(2, '0')}</text>
                  </g>
                )
              })}
              {(() => {
                const a = (active / V_LOOP.length) * Math.PI * 2 - Math.PI / 2
                const x = 200 + Math.cos(a) * 150
                const y = 200 + Math.sin(a) * 150
                return <line x1="200" y1="200" x2={x} y2={y} stroke={V_LOOP[active]!.color} strokeWidth="1.5" opacity="0.5" style={{ transition: 'all 400ms ease' }} />
              })()}
              <circle cx="200" cy="200" r="26" fill="rgba(0,196,232,0.06)" stroke="var(--nx-accent)" strokeWidth="1" />
              <text x="200" y="197" textAnchor="middle" fontFamily="Bebas Neue, Impact, sans-serif" fontSize="16" fill="var(--nx-text)" letterSpacing="1">VTG</text>
              <text x="200" y="210" textAnchor="middle" fontFamily="Share Tech Mono, monospace" fontSize="6" fill="var(--nx-accent)" letterSpacing="2">LOOP</text>
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {V_LOOP.map((s, i) => {
              const on = i === active
              return (
                <button
                  key={s.k}
                  type="button"
                  onClick={() => setActive(i)}
                  style={{
                    textAlign: 'left', cursor: 'pointer', padding: '16px 18px', display: 'flex', gap: 16, alignItems: 'center',
                    background: on ? `linear-gradient(90deg, ${s.color}1c, transparent)` : 'rgba(0,0,0,0.2)',
                    border: `1px solid ${on ? s.color : 'var(--nx-border)'}`,
                    borderLeft: `3px solid ${on ? s.color : 'var(--nx-border-strong)'}`,
                    transition: 'all 200ms ease',
                  }}
                >
                  <span className="nx-display" style={{ fontSize: 30, color: on ? s.color : 'var(--nx-text-muted)', width: 36, flexShrink: 0 }}>{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <div className="nx-display" style={{ fontSize: 24, letterSpacing: '0.06em', color: on ? 'var(--nx-text)' : 'var(--nx-text-2)' }}>{s.k}</div>
                    <div style={{ fontSize: 14, color: 'var(--nx-text-2)', lineHeight: 1.45, marginTop: 2, fontWeight: 500 }}>{s.d}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

function LandingProof() {
  const stats = [
    { v: '2.4M', l: 'MONTHLY REACH ORCHESTRATED', spark: [10, 14, 12, 18, 22, 20, 26, 30], c: 'var(--nx-accent)' },
    { v: '3.8x', l: 'AVERAGE ROAS HELD', spark: [20, 18, 22, 26, 24, 30, 32, 38], c: 'var(--nx-green)' },
    { v: '−31%', l: 'CPA VS MANUAL BUYING', spark: [40, 36, 34, 30, 28, 24, 22, 18], c: 'var(--nx-accent-2)' },
    { v: '1,400+', l: 'AUTONOMOUS DECISIONS / DAY', spark: [8, 12, 16, 14, 20, 24, 28, 34], c: 'var(--nx-silver)' },
  ]
  return (
    <section id="proof" style={{ padding: '70px 40px', borderTop: '1px solid var(--nx-border)', background: 'var(--nx-bg)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <span className="nx-pulse nx-pulse--green" />
          <span className="nx-label nx-label--green">FIELD TELEMETRY · TRAILING 30 DAYS</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }} className="v-proof-grid">
          {stats.map((s) => (
            <div key={s.l} className="nx-panel" style={{ position: 'relative', padding: 22 }}>
              <Corners color={s.c} />
              <div className="nx-display" style={{ fontSize: 56, color: s.c, lineHeight: 0.85 }}>{s.v}</div>
              <div className="nx-mono" style={{ fontSize: 10, color: 'var(--nx-text-muted)', letterSpacing: '0.14em', margin: '10px 0 14px', minHeight: 26 }}>{s.l}</div>
              <Sparkline data={s.spark} color={s.c} height={26} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function LandingComparison() {
  const rows = [
    ['Budget moves', 'Weekly, by hand', 'Continuous, autonomous'],
    ['Reaction time', 'Days behind the signal', 'Under 60 seconds'],
    ['Creative testing', 'Manual, sporadic', 'Always-on, auto-promote'],
    ['Attribution', 'Last-click guesswork', 'Multi-touch, fed forward'],
    ['After hours', 'Spend runs blind', 'Reactor never sleeps'],
    ['Scales with channels', 'Linear headcount', 'One loop, any number'],
  ]
  return (
    <section style={{ padding: '90px 40px', borderTop: '1px solid var(--nx-border)' }} className="nx-grid-bg">
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <SectionHead
          n="04"
          eyebrow="THE DELTA · OLD VS AUTOPILOT"
          accent="var(--nx-red)"
          title={<>Manual buying vs <span style={{ color: 'var(--nx-accent)' }}>the reactor.</span></>}
        />
        <div className="nx-panel" style={{ overflow: 'hidden', padding: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr' }}>
            <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--nx-border-strong)', borderRight: '1px solid var(--nx-border)' }}>
              <span className="nx-label">DIMENSION</span>
            </div>
            <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--nx-border-strong)', borderRight: '1px solid var(--nx-border)' }}>
              <span className="nx-mono" style={{ fontSize: 12, color: 'var(--nx-text-muted)', letterSpacing: '0.12em' }}>MANUAL MEDIA BUYING</span>
            </div>
            <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--nx-border-strong)', background: 'rgba(0,196,232,0.05)' }}>
              <span className="nx-mono" style={{ fontSize: 12, color: 'var(--nx-accent)', letterSpacing: '0.12em' }}>● VANTAGE AUTOPILOT</span>
            </div>
            {rows.map((r, i) => (
              <React.Fragment key={r[0]}>
                <div style={{ padding: '16px 22px', borderTop: i ? '1px solid var(--nx-border)' : 'none', borderRight: '1px solid var(--nx-border)', fontSize: 14.5, color: 'var(--nx-text)', fontWeight: 600 }}>{r[0]}</div>
                <div style={{ padding: '16px 22px', borderTop: i ? '1px solid var(--nx-border)' : 'none', borderRight: '1px solid var(--nx-border)', fontSize: 14, color: 'var(--nx-text-muted)' }}>
                  <span style={{ color: 'var(--nx-red)', marginRight: 8 }}>✕</span>{r[1]}
                </div>
                <div style={{ padding: '16px 22px', borderTop: i ? '1px solid var(--nx-border)' : 'none', background: 'rgba(0,196,232,0.04)', fontSize: 14, color: 'var(--nx-text-2)' }}>
                  <span style={{ color: 'var(--nx-green)', marginRight: 8 }}>✓</span>{r[2]}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function LandingCTA() {
  return (
    <section className="nx-grid-bg nx-scanlines" style={{ padding: '110px 40px', borderTop: '1px solid var(--nx-border)', position: 'relative', overflow: 'hidden', textAlign: 'center' }}>
      <div style={{ position: 'absolute', top: '50%', left: '50%', width: 800, height: 800, transform: 'translate(-50%,-50%)', background: 'radial-gradient(circle, rgba(0,196,232,0.12), transparent 60%)', pointerEvents: 'none' }} />
      <div style={{ maxWidth: 820, margin: '0 auto', position: 'relative' }}>
        <Chip tone="green" dot>AUTOPILOT · STANDING BY</Chip>
        <h2 className="nx-display" style={{ fontSize: 'clamp(48px, 7vw, 96px)', lineHeight: 0.92, margin: '24px 0 0', color: 'var(--nx-text)' }}>
          READY TO ENGAGE<br /><span style={{ color: 'var(--nx-accent)' }}>AUTOPILOT?</span>
        </h2>
        <p style={{ fontSize: 18, color: 'var(--nx-text-2)', maxWidth: 560, margin: '24px auto 0', lineHeight: 1.5, fontWeight: 500 }}>
          Connect your channels, set one objective, and let the reactor run. You stay in command — Vantage handles the orchestration.
        </p>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 36, flexWrap: 'wrap' }}>
          <Link to="/login" className="nx-btn nx-btn--primary" style={{ padding: '16px 32px', fontSize: 14, textDecoration: 'none' }}>▶ LAUNCH A CAMPAIGN</Link>
          <a href="#reactor" className="nx-btn" style={{ padding: '16px 32px', fontSize: 14, textDecoration: 'none' }}>REPLAY THE REACTOR</a>
        </div>
      </div>
    </section>
  )
}

function LandingFooter() {
  return (
    <footer style={{ background: 'var(--nx-bg)', borderTop: '2px solid var(--nx-border-strong)', padding: '48px 40px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 24 }}>
          <div style={{ maxWidth: 320 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <VantageMark size={26} />
              <span className="nx-display" style={{ fontSize: 22, letterSpacing: '0.2em', color: 'var(--nx-text)' }}>VANTAGE</span>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--nx-text-muted)', lineHeight: 1.5 }}>The autonomous signal reactor for advertising and content distribution. A BioLoop Nexus module.</p>
          </div>
          <div style={{ display: 'flex', gap: 56, flexWrap: 'wrap' }}>
            {([['PRODUCT', ['Reactor', 'Subsystems', 'The Loop']], ['OPERATOR', ['Console', 'Channels', 'Campaigns']], ['NEXUS', ['The Shift', 'Keystone', 'Scripta', 'DemoForge']]] as const).map(([h, items]) => (
              <div key={h}>
                <div className="nx-label" style={{ marginBottom: 14 }}>{h}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {items.map((it) => (
                    <Link
                      key={it}
                      to={it === 'Console' || it === 'Channels' || it === 'Campaigns' ? '/login' : '/'}
                      style={{ fontSize: 13.5, color: 'var(--nx-text-2)', textDecoration: 'none' }}
                    >{it}</Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 40, paddingTop: 22, borderTop: '1px solid var(--nx-border)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, fontFamily: 'var(--nx-mono)', fontSize: 10.5, color: 'var(--nx-text-muted)', letterSpacing: '0.16em' }}>
          <span>vantage.bioloopnexus.com · © 2026 BIOLOOP NEXUS</span>
          <span><span className="nx-pulse" style={{ width: 5, height: 5 }} /> ALL SYSTEMS NOMINAL</span>
        </div>
      </div>
    </footer>
  )
}

export function LandingPage() {
  React.useEffect(() => {
    document.title = 'Vantage — Autonomous Signal Reactor'
  }, [])

  return (
    <div className="vg-landing theme-vantage nx-app">
      <LandingNav />
      <LandingHero />
      <SignalReactor />
      <LandingSubsystems />
      <LandingLoop />
      <LandingProof />
      <LandingComparison />
      <LandingCTA />
      <LandingFooter />
    </div>
  )
}
