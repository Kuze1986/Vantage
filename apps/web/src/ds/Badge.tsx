import './Badge.css'

export type BadgeVariant = 'active' | 'pending' | 'critical' | 'new' | 'core' | 'soon' | 'default'

interface BadgeProps {
  label: string
  variant: BadgeVariant
}

export function Badge({ label, variant }: BadgeProps) {
  return <span className={`nx-badge nx-badge--${variant}`}>{label}</span>
}
