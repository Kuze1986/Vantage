import type { ReactNode } from 'react'
import './NavItem.css'

interface NavItemProps {
  label: string
  active?: boolean
  onClick?: () => void
  icon?: ReactNode
}

export function NavItem({ label, active, onClick, icon }: NavItemProps) {
  return (
    <button
      type="button"
      className={`nx-nav-item${active ? ' nx-nav-item--active' : ''}`}
      onClick={onClick}
    >
      {icon != null && <span className="nx-nav-item__icon">{icon}</span>}
      <span className="nx-nav-item__label">{label}</span>
    </button>
  )
}
