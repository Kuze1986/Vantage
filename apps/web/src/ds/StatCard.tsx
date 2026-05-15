import './StatCard.css'

interface StatCardProps {
  label: string
  value: string | number
  delta?: string
  deltaDirection?: 'up' | 'down' | 'neutral'
  accent?: 'amber' | 'cyan' | 'green' | 'red' | 'gold' | 'none'
  fillPercent?: number
}

export function StatCard({ label, value, delta, deltaDirection = 'neutral', accent = 'none', fillPercent = 0 }: StatCardProps) {
  const ac = accent ?? 'none'
  const pct = Math.min(100, Math.max(0, fillPercent ?? 0))
  const deltaCls =
    deltaDirection === 'up' ? 'nx-stat-card__delta--up'
    : deltaDirection === 'down' ? 'nx-stat-card__delta--down'
    : 'nx-stat-card__delta--neutral'

  return (
    <div className={`nx-stat-card nx-stat-card--${ac}`}>
      <p className="nx-stat-card__label">{label}</p>
      <p className="nx-stat-card__value">{value}</p>
      {delta != null && delta !== '' && (
        <p className={`nx-stat-card__delta ${deltaCls}`}>{delta}</p>
      )}
      <div className="nx-stat-card__bar" aria-hidden>
        <div className="nx-stat-card__bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
