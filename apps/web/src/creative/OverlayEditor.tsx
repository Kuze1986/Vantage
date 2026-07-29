import React from 'react'

export type OverlayConfig = {
  type: 'text' | 'image'
  // text
  content?: string
  font_size?: number
  font_color?: string
  font_family?: 'mono' | 'sans' | 'display'
  box_color?: string
  // image
  brand_kit_id?: string
  width?: number
  // position
  x: 'left' | 'center' | 'right' | number
  y: 'top' | 'center' | 'bottom' | number
  x_offset?: number
  y_offset?: number
  // timing
  start_sec?: number
  end_sec?: number
}

type BrandKit = {
  id: string
  name: string
  logo_url: string | null
  primary_color: string
  accent_color: string
}

type Props = {
  overlays: OverlayConfig[]
  brandKits: BrandKit[]
  onChange: (overlays: OverlayConfig[]) => void
}

const DEFAULT_TEXT_OVERLAY: OverlayConfig = {
  type: 'text',
  content: 'Book a Free Demo →',
  font_size: 48,
  font_color: '#FFFFFF',
  font_family: 'sans',
  x: 'center',
  y: 'bottom',
  y_offset: 60,
}

const DEFAULT_IMAGE_OVERLAY: OverlayConfig = {
  type: 'image',
  x: 'left',
  y: 'top',
  x_offset: 20,
  y_offset: 20,
  width: 180,
}

const mono: React.CSSProperties = { fontFamily: 'var(--nx-mono)' }
const label9: React.CSSProperties = { ...mono, fontSize: 9, letterSpacing: '0.12em', color: 'var(--nx-text-4)' }
const label10: React.CSSProperties = { ...mono, fontSize: 10, color: 'var(--nx-text-3)' }

function OverlayRow({
  overlay,
  index,
  brandKits,
  onChange,
  onRemove,
}: {
  overlay: OverlayConfig
  index: number
  brandKits: BrandKit[]
  onChange: (patch: Partial<OverlayConfig>) => void
  onRemove: () => void
}) {
  const [open, setOpen] = React.useState(true)

  const xOptions: Array<'left' | 'center' | 'right'> = ['left', 'center', 'right']
  const yOptions: Array<'top' | 'center' | 'bottom'> = ['top', 'center', 'bottom']
  const fontOptions: Array<'mono' | 'sans' | 'display'> = ['mono', 'sans', 'display']

  const xIsPreset = typeof overlay.x === 'string'

  return (
    <div style={{ border: '1px solid var(--nx-border)', borderRadius: 6, overflow: 'hidden' }}>
      {/* Header row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', background: 'var(--nx-surface-2)',
        cursor: 'pointer', userSelect: 'none',
      }} onClick={() => setOpen((o) => !o)}>
        <span style={{ ...mono, fontSize: 9, color: 'var(--nx-text-4)', minWidth: 16 }}>#{index + 1}</span>
        <span style={{
          ...mono, fontSize: 9, padding: '2px 6px',
          border: `1px solid ${overlay.type === 'text' ? 'var(--nx-cyan)' : 'var(--nx-amber)'}`,
          color: overlay.type === 'text' ? 'var(--nx-cyan)' : 'var(--nx-amber)',
          borderRadius: 3, letterSpacing: '0.1em',
        }}>
          {overlay.type.toUpperCase()}
        </span>
        <span style={{ ...mono, fontSize: 10, color: 'var(--nx-text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {overlay.type === 'text'
            ? (overlay.content || '(empty text)')
            : (brandKits.find((k) => k.id === overlay.brand_kit_id)?.name ?? '(no brand kit)')}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          style={{ ...mono, fontSize: 9, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0 4px' }}
        >
          ✕
        </button>
        <span style={{ ...mono, fontSize: 9, color: 'var(--nx-text-4)' }}>{open ? '▾' : '▸'}</span>
      </div>

      {open && (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Type toggle */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(['text', 'image'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onChange({ type: t, ...(t === 'text' ? { content: overlay.content ?? '' } : {}) })}
                style={{
                  ...mono, fontSize: 9, padding: '3px 10px', cursor: 'pointer', letterSpacing: '0.1em',
                  border: `1px solid ${overlay.type === t ? 'var(--nx-cyan)' : 'var(--nx-border)'}`,
                  background: overlay.type === t ? 'rgba(0,255,255,0.06)' : 'transparent',
                  color: overlay.type === t ? 'var(--nx-cyan)' : 'var(--nx-text-4)',
                  borderRadius: 3,
                }}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Text-specific fields */}
          {overlay.type === 'text' && (
            <>
              <div>
                <div style={{ ...label9, display: 'block', marginBottom: 4 }}>TEXT</div>
                <input
                  type="text"
                  className="vg-input"
                  value={overlay.content ?? ''}
                  onChange={(e) => onChange({ content: e.target.value })}
                  placeholder="e.g. Book a Free Demo →"
                  style={{ width: '100%', fontSize: 11 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 80 }}>
                  <div style={{ ...label9, display: 'block', marginBottom: 4 }}>FONT SIZE</div>
                  <input
                    type="number"
                    className="vg-input"
                    min={8} max={200}
                    value={overlay.font_size ?? 48}
                    onChange={(e) => onChange({ font_size: parseInt(e.target.value) || 48 })}
                    style={{ width: '100%', fontSize: 11 }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 80 }}>
                  <div style={{ ...label9, display: 'block', marginBottom: 4 }}>COLOR</div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                      type="color"
                      value={overlay.font_color ?? '#FFFFFF'}
                      onChange={(e) => onChange({ font_color: e.target.value })}
                      style={{ width: 28, height: 28, padding: 2, border: '1px solid var(--nx-border)', borderRadius: 4, cursor: 'pointer', background: 'none' }}
                    />
                    <input
                      type="text"
                      className="vg-input"
                      value={overlay.font_color ?? '#FFFFFF'}
                      onChange={(e) => onChange({ font_color: e.target.value })}
                      style={{ width: 80, fontSize: 10 }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ ...label9, display: 'block', marginBottom: 4 }}>FONT</div>
                  <select
                    className="vg-input"
                    value={overlay.font_family ?? 'sans'}
                    onChange={(e) => onChange({ font_family: e.target.value as 'mono' | 'sans' | 'display' })}
                    style={{ width: '100%', fontSize: 10 }}
                  >
                    {fontOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ ...label9, display: 'block', marginBottom: 4 }}>BOX BG</div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={!!overlay.box_color}
                      onChange={(e) => onChange({ box_color: e.target.checked ? '#000000@0.6' : undefined })}
                    />
                    {overlay.box_color && (
                      <input
                        type="text"
                        className="vg-input"
                        value={overlay.box_color}
                        onChange={(e) => onChange({ box_color: e.target.value })}
                        placeholder="#000000@0.6"
                        style={{ flex: 1, fontSize: 9 }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Image-specific fields */}
          {overlay.type === 'image' && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 2, minWidth: 120 }}>
                <div style={{ ...label9, display: 'block', marginBottom: 4 }}>BRAND KIT (LOGO)</div>
                <select
                  className="vg-input"
                  value={overlay.brand_kit_id ?? ''}
                  onChange={(e) => onChange({ brand_kit_id: e.target.value || undefined })}
                  style={{ width: '100%', fontSize: 10 }}
                >
                  <option value="">— none —</option>
                  {brandKits.map((k) => (
                    <option key={k.id} value={k.id}>{k.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 80 }}>
                <div style={{ ...label9, display: 'block', marginBottom: 4 }}>WIDTH (px)</div>
                <input
                  type="number"
                  className="vg-input"
                  min={20} max={800}
                  value={overlay.width ?? 180}
                  onChange={(e) => onChange({ width: parseInt(e.target.value) || 180 })}
                  style={{ width: '100%', fontSize: 11 }}
                />
              </div>
            </div>
          )}

          {/* Position */}
          <div>
            <div style={{ ...label9, display: 'block', marginBottom: 6 }}>POSITION</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div style={{ ...label9, marginBottom: 3 }}>HORIZONTAL</div>
                <div style={{ display: 'flex', gap: 3 }}>
                  {xOptions.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => onChange({ x: opt })}
                      style={{
                        ...mono, fontSize: 8, padding: '2px 7px', cursor: 'pointer', letterSpacing: '0.08em',
                        border: `1px solid ${overlay.x === opt ? 'var(--nx-amber)' : 'var(--nx-border)'}`,
                        background: overlay.x === opt ? 'rgba(239,160,32,0.12)' : 'transparent',
                        color: overlay.x === opt ? 'var(--nx-amber)' : 'var(--nx-text-4)',
                        borderRadius: 3,
                      }}
                    >
                      {opt}
                    </button>
                  ))}
                  {!xIsPreset && (
                    <span style={{ ...label9, alignSelf: 'center' }}>px: {overlay.x}</span>
                  )}
                </div>
              </div>
              <div>
                <div style={{ ...label9, marginBottom: 3 }}>VERTICAL</div>
                <div style={{ display: 'flex', gap: 3 }}>
                  {yOptions.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => onChange({ y: opt })}
                      style={{
                        ...mono, fontSize: 8, padding: '2px 7px', cursor: 'pointer', letterSpacing: '0.08em',
                        border: `1px solid ${overlay.y === opt ? 'var(--nx-amber)' : 'var(--nx-border)'}`,
                        background: overlay.y === opt ? 'rgba(239,160,32,0.12)' : 'transparent',
                        color: overlay.y === opt ? 'var(--nx-amber)' : 'var(--nx-text-4)',
                        borderRadius: 3,
                      }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={label9}>X OFFSET</span>
                <input
                  type="number"
                  className="vg-input"
                  value={overlay.x_offset ?? 20}
                  onChange={(e) => onChange({ x_offset: parseInt(e.target.value) || 0 })}
                  style={{ width: 60, fontSize: 10 }}
                />
                <span style={label9}>px</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={label9}>Y OFFSET</span>
                <input
                  type="number"
                  className="vg-input"
                  value={overlay.y_offset ?? 20}
                  onChange={(e) => onChange({ y_offset: parseInt(e.target.value) || 0 })}
                  style={{ width: 60, fontSize: 10 }}
                />
                <span style={label9}>px</span>
              </div>
            </div>
          </div>

          {/* Timing */}
          <div>
            <div style={{ ...label9, display: 'block', marginBottom: 6 }}>TIMING (leave blank = full duration)</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={label9}>START</span>
                <input
                  type="number"
                  className="vg-input"
                  min={0}
                  placeholder="0"
                  value={overlay.start_sec ?? ''}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    onChange({ start_sec: isNaN(v) ? undefined : v })
                  }}
                  style={{ width: 70, fontSize: 10 }}
                />
                <span style={label9}>s</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={label9}>END</span>
                <input
                  type="number"
                  className="vg-input"
                  min={0}
                  placeholder="end"
                  value={overlay.end_sec ?? ''}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    onChange({ end_sec: isNaN(v) ? undefined : v })
                  }}
                  style={{ width: 70, fontSize: 10 }}
                />
                <span style={label9}>s</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function OverlayEditor({ overlays, brandKits, onChange }: Props) {
  const [panelOpen, setPanelOpen] = React.useState(true)

  const addOverlay = (type: 'text' | 'image') => {
    const defaults = type === 'text' ? DEFAULT_TEXT_OVERLAY : DEFAULT_IMAGE_OVERLAY
    onChange([...overlays, { ...defaults }])
  }

  const updateOverlay = (index: number, patch: Partial<OverlayConfig>) => {
    onChange(overlays.map((ov, i) => i === index ? { ...ov, ...patch } : ov))
  }

  const removeOverlay = (index: number) => {
    onChange(overlays.filter((_, i) => i !== index))
  }

  const count = overlays.length

  return (
    <div>
      {/* Collapsible panel header */}
      <button
        type="button"
        onClick={() => setPanelOpen((o) => !o)}
        style={{
          width: '100%', textAlign: 'left', cursor: 'pointer',
          fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.1em',
          padding: '8px 12px',
          border: `1px solid ${count > 0 ? 'var(--nx-amber)' : 'var(--nx-border)'}`,
          borderRadius: panelOpen ? '4px 4px 0 0' : 4,
          background: count > 0 ? 'rgba(239,160,32,0.06)' : 'var(--nx-surface-2)',
          color: count > 0 ? 'var(--nx-amber)' : 'var(--nx-text-3)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        <span>{panelOpen ? '▾' : '▸'}</span>
        <span>⊞ OVERLAYS — text burns, CTAs, logos</span>
        {count > 0 && (
          <span style={{
            marginLeft: 'auto',
            background: 'rgba(239,160,32,0.2)',
            border: '1px solid var(--nx-amber)',
            borderRadius: 10,
            padding: '0px 7px',
            fontSize: 9,
          }}>
            {count}
          </span>
        )}
      </button>

      {panelOpen && (
        <div style={{
          border: `1px solid ${count > 0 ? 'var(--nx-amber)' : 'var(--nx-border)'}`,
          borderTop: 'none',
          borderRadius: '0 0 4px 4px',
          padding: 12,
          background: count > 0 ? 'rgba(239,160,32,0.02)' : 'var(--nx-surface)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {overlays.length === 0 && (
            <p style={{ ...label10, fontSize: 10, color: 'var(--nx-text-4)', margin: 0, lineHeight: 1.6 }}>
              No overlays yet. Add a text burn (CTA, headline) or a logo watermark from a brand kit.
            </p>
          )}

          {overlays.map((ov, i) => (
            <OverlayRow
              key={i}
              overlay={ov}
              index={i}
              brandKits={brandKits}
              onChange={(patch) => updateOverlay(i, patch)}
              onRemove={() => removeOverlay(i)}
            />
          ))}

          {/* Add overlay buttons */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => addOverlay('text')}
              style={{
                flex: 1, ...mono, fontSize: 10, letterSpacing: '0.08em', padding: '6px',
                border: '1px dashed var(--nx-cyan)', borderRadius: 4, background: 'none',
                color: 'var(--nx-cyan)', cursor: 'pointer',
              }}
            >
              + Text overlay
            </button>
            <button
              type="button"
              onClick={() => addOverlay('image')}
              style={{
                flex: 1, ...mono, fontSize: 10, letterSpacing: '0.08em', padding: '6px',
                border: '1px dashed var(--nx-amber)', borderRadius: 4, background: 'none',
                color: 'var(--nx-amber)', cursor: 'pointer',
              }}
            >
              + Logo / image
            </button>
          </div>

          {brandKits.length === 0 && (
            <p style={{ ...label9, fontSize: 9, margin: 0, lineHeight: 1.6 }}>
              No brand kits yet.{' '}
              <a href="/settings" style={{ color: 'var(--nx-cyan)' }}>
                Create one in Settings → Brand Kits
              </a>
              {' '}(logo upload required for image overlays).
            </p>
          )}
        </div>
      )}
    </div>
  )
}
