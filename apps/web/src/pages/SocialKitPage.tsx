import React from 'react'
import { BRANDS, BRAND_ORDER, type BrandId } from './socialkit/brands'
import { CanvasMark } from './socialkit/CanvasMark'
import { KitHero, BrandEssentials, CaptionLibrary, KitFooter } from './socialkit/sections'
import { TemplateGallery } from './socialkit/templates'
import { QuoteCardStudio } from '../creative/QuoteCard'
import { CarouselBuilder } from '../creative/CarouselBuilder'
import './socialkit/socialkit.css'

const EXPORT_SCALES = [1, 2, 3] as const
type KitTab = 'kit' | 'carousel' | 'quote'

export function SocialKitPage() {
  const [active, setActive] = React.useState<BrandId>('vantage')
  const [guides, setGuides] = React.useState(true)
  const [exportScale, setExportScale] = React.useState<number>(2)
  const [tab, setTab] = React.useState<KitTab>('kit')

  const brand = BRANDS[active] ?? BRANDS.vantage

  return (
    <>
      <div className="vg-page-header">
        <h1 className="vg-page-title">Social Kit</h1>
        <p className="vg-page-sub">On-brand social assets for every Nexus module — logos, palette, voice, captions, editable post templates, carousel builder, and pull-quote cards</p>
      </div>

      {/* ── Top tabs ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid var(--nx-border)' }}>
        {([
          { id: 'kit',      label: '◈ Kit' },
          { id: 'carousel', label: '▦ Carousel' },
          { id: 'quote',    label: '❝ Quote Cards' },
        ] as { id: KitTab; label: string }[]).map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} style={{
            fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.14em',
            padding: '8px 16px', cursor: 'pointer', background: 'none', border: 'none',
            borderBottom: `2px solid ${tab === t.id ? 'var(--nx-accent)' : 'transparent'}`,
            color: tab === t.id ? 'var(--nx-accent)' : 'var(--nx-text-3)',
            textTransform: 'uppercase', transition: 'all 120ms', marginBottom: -1,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Control bar: module switcher + editing guides + export scale ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
        marginBottom: 20, padding: '12px 14px',
        border: '1px solid var(--nx-border)', borderRadius: 6, background: 'var(--nx-surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="nx-mono" style={{ fontSize: 10, color: 'var(--nx-text-muted)', letterSpacing: '0.24em' }}>MODULE ▸</span>
          {BRAND_ORDER.map((id) => {
            const b = BRANDS[id]
            const on = id === active
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActive(id)}
                className={b.theme}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                  fontFamily: 'var(--nx-display)', fontSize: 15, letterSpacing: '0.12em',
                  padding: '6px 12px', background: on ? `${b.accent}1c` : 'transparent',
                  border: `1px solid ${on ? b.accent : 'var(--nx-border-strong)'}`,
                  color: on ? '#E8F4FF' : 'var(--nx-text-2)', borderRadius: 4,
                  boxShadow: on ? `0 0 20px -8px ${b.accent}` : 'none', transition: 'all 130ms ease',
                }}
              >
                <CanvasMark id={id} size={16} />
                {b.name}
              </button>
            )
          })}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          {tab === 'kit' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-2)', letterSpacing: '0.1em' }}>
              <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} />
              EDITING GUIDES
            </label>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="nx-mono" style={{ fontSize: 10, color: 'var(--nx-text-muted)', letterSpacing: '0.1em' }}>EXPORT</span>
            {EXPORT_SCALES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setExportScale(s)}
                style={{
                  fontFamily: 'var(--nx-mono)', fontSize: 10, padding: '4px 9px', cursor: 'pointer',
                  border: `1px solid ${exportScale === s ? 'var(--nx-accent)' : 'var(--nx-border)'}`,
                  borderRadius: 3,
                  background: exportScale === s ? 'rgba(0,196,232,0.12)' : 'transparent',
                  color: exportScale === s ? 'var(--nx-accent)' : 'var(--nx-text-3)',
                }}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab content ── */}
      {tab === 'kit' && (
        <div className={`vg-socialkit ${brand.theme}${guides ? '' : ' kit-guides-off'}`}>
          <KitHero brand={brand} />
          {/* key remounts the editable content when the module changes, so text re-syncs */}
          <div key={active}>
            <BrandEssentials brand={brand} />
            <CaptionLibrary brand={brand} />
            <TemplateGallery brand={brand} exportScale={exportScale} />
          </div>
          <KitFooter brand={brand} />
        </div>
      )}

      {tab === 'carousel' && (
        <CarouselBuilder initialBrandId={active} exportScale={exportScale} />
      )}

      {tab === 'quote' && (
        <QuoteCardStudio initialBrandId={active} exportScale={exportScale} />
      )}
    </>
  )
}
