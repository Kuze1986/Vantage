import { Badge } from './Badge'
import type { BadgeVariant } from './Badge'
import './ModeTile.css'

interface ModeTileProps {
  name: string
  description: string
  icon: string
  meta?: string[]
  badge?: { label: string; variant: BadgeVariant }
  accent?: 'amber' | 'cyan' | 'green' | 'red' | 'gold'
  featured?: boolean
  disabled?: boolean
  onClick?: () => void
}

export function ModeTile({ name, description, icon, meta, badge, accent = 'amber', featured, disabled, onClick }: ModeTileProps) {
  const className = `nx-mode-tile nx-mode-tile--${accent}${featured ? ' nx-mode-tile--featured' : ''}${disabled ? ' nx-mode-tile--disabled' : ''}`

  const body = (
    <>
      <div className="nx-mode-tile__icon" aria-hidden>{icon}</div>
      <div className="nx-mode-tile__main">
        <div className="nx-mode-tile__row">
          <h3 className="nx-mode-tile__name">{name}</h3>
          {badge != null && <Badge label={badge.label} variant={badge.variant} />}
        </div>
        <p className="nx-mode-tile__desc">{description}</p>
        {meta != null && meta.length > 0 && (
          <div className="nx-mode-tile__meta">
            {meta.map((m, idx) => (
              <span key={`${m}-${idx}`} className="nx-mode-tile__meta-item">{m}</span>
            ))}
          </div>
        )}
      </div>
    </>
  )

  if (disabled) return <div className={className}>{body}</div>

  return (
    <button type="button" className={className} onClick={onClick}>
      {body}
    </button>
  )
}
