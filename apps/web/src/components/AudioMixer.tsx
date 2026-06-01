import React from 'react'

type AudioMixerProps = {
  hasMusic: boolean
  effectCount: number
  narrationVolume: number
  musicVolume: number
  effectVolumes: number[] // per-effect volume percentages
  masterVolume: number
  onNarrationVolumeChange: (vol: number) => void
  onMusicVolumeChange: (vol: number) => void
  onEffectVolumeChange: (index: number, vol: number) => void
  onMasterVolumeChange: (vol: number) => void
  onReset: () => void
}

/**
 * AudioMixer — Per-track volume control for DemoForge video generation.
 * Manages narration, music, effects, and master volume with visual feedback.
 */
export function AudioMixer(props: AudioMixerProps) {
  const [mutedTracks, setMutedTracks] = React.useState<Set<string>>(new Set())

  const toggleMute = (track: string) => {
    setMutedTracks((prev) => {
      const next = new Set(prev)
      next.has(track) ? next.delete(track) : next.add(track)
      return next
    })
  }

  const isMuted = (track: string) => mutedTracks.has(track)

  return (
    <div style={{ border: '1px solid var(--nx-border)', borderRadius: 8, padding: 16, background: 'var(--nx-surface-2)' }}>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, letterSpacing: '0.12em', color: 'var(--nx-text-2)', margin: '0 0 12px 0' }}>
          🔊 AUDIO MIXER
        </h3>
        <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', margin: 0, lineHeight: 1.5 }}>
          Adjust per-track volumes. Muted tracks don't export. Master volume applies to final mix.
        </p>
      </div>

      {/* Master Volume */}
      <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--nx-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-3)', letterSpacing: '0.08em', display: 'block', marginBottom: 6 }}>
              MASTER VOLUME
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range"
                min="0"
                max="100"
                value={props.masterVolume}
                onChange={(e) => props.onMasterVolumeChange(parseInt(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-2)', minWidth: 28 }}>
                {props.masterVolume}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Per-Track Controls */}
      <div style={{ display: 'grid', gap: 12 }}>
        {/* Narration */}
        <div style={{ background: 'var(--nx-surface-1)', border: '1px solid var(--nx-border)', borderRadius: 6, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => toggleMute('narration')}
              title={isMuted('narration') ? 'Unmute narration' : 'Mute narration'}
              style={{
                fontFamily: 'var(--nx-mono)', fontSize: 11, width: 24, height: 24, borderRadius: 3,
                border: `1px solid ${isMuted('narration') ? '#ef4444' : 'var(--nx-border)'}`,
                background: isMuted('narration') ? 'rgba(239,68,68,0.1)' : 'transparent',
                color: isMuted('narration') ? '#ef4444' : 'var(--nx-text-3)',
                cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {isMuted('narration') ? '🔇' : '🔊'}
            </button>
            <label style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-2)', letterSpacing: '0.08em', flex: 1 }}>
              NARRATION
            </label>
            <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-2)', minWidth: 28 }}>
              {props.narrationVolume}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={props.narrationVolume}
            onChange={(e) => props.onNarrationVolumeChange(parseInt(e.target.value))}
            style={{ width: '100%' }}
            disabled={isMuted('narration')}
            title={isMuted('narration') ? 'Narration muted' : ''}
          />
        </div>

        {/* Music */}
        {props.hasMusic && (
          <div style={{ background: 'var(--nx-surface-1)', border: '1px solid var(--nx-border)', borderRadius: 6, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => toggleMute('music')}
                title={isMuted('music') ? 'Unmute music' : 'Mute music'}
                style={{
                  fontFamily: 'var(--nx-mono)', fontSize: 11, width: 24, height: 24, borderRadius: 3,
                  border: `1px solid ${isMuted('music') ? '#ef4444' : 'var(--nx-border)'}`,
                  background: isMuted('music') ? 'rgba(239,68,68,0.1)' : 'transparent',
                  color: isMuted('music') ? '#ef4444' : 'var(--nx-text-3)',
                  cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {isMuted('music') ? '🔇' : '🔊'}
              </button>
              <label style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-2)', letterSpacing: '0.08em', flex: 1 }}>
                MUSIC
              </label>
              <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-2)', minWidth: 28 }}>
                {props.musicVolume}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={props.musicVolume}
              onChange={(e) => props.onMusicVolumeChange(parseInt(e.target.value))}
              style={{ width: '100%' }}
              disabled={isMuted('music')}
              title={isMuted('music') ? 'Music muted' : ''}
            />
          </div>
        )}

        {/* Effects */}
        {props.effectCount > 0 && (
          <div style={{ background: 'var(--nx-surface-1)', border: '1px solid var(--nx-border)', borderRadius: 6, padding: 12 }}>
            <label style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-2)', letterSpacing: '0.08em', display: 'block', marginBottom: 8 }}>
              SOUND EFFECTS ({props.effectCount})
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {props.effectVolumes.map((vol, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => toggleMute(`effect-${idx}`)}
                    title={isMuted(`effect-${idx}`) ? `Unmute effect ${idx + 1}` : `Mute effect ${idx + 1}`}
                    style={{
                      fontFamily: 'var(--nx-mono)', fontSize: 9, width: 20, height: 20, borderRadius: 2,
                      border: `1px solid ${isMuted(`effect-${idx}`) ? '#ef4444' : 'var(--nx-border)'}`,
                      background: isMuted(`effect-${idx}`) ? 'rgba(239,68,68,0.1)' : 'transparent',
                      color: isMuted(`effect-${idx}`) ? '#ef4444' : 'var(--nx-text-4)',
                      cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {isMuted(`effect-${idx}`) ? '✕' : '✓'}
                  </button>
                  <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 8, color: 'var(--nx-text-4)', minWidth: 32 }}>
                    EFX {idx + 1}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={vol}
                    onChange={(e) => props.onEffectVolumeChange(idx, parseInt(e.target.value))}
                    style={{ flex: 1 }}
                    disabled={isMuted(`effect-${idx}`)}
                  />
                  <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-3)', minWidth: 24 }}>
                    {vol}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Reset Button */}
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={props.onReset}
          style={{
            fontFamily: 'var(--nx-mono)', fontSize: 9, letterSpacing: '0.08em',
            padding: '6px 12px', cursor: 'pointer',
            background: 'transparent', color: 'var(--nx-text-4)',
            border: '1px solid var(--nx-border)', borderRadius: 4,
            transition: 'all 120ms',
          }}
        >
          ↻ Reset to defaults
        </button>
      </div>
    </div>
  )
}
