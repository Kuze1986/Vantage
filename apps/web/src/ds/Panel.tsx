import type { ReactNode } from 'react'
import './Panel.css'

interface PanelProps {
  title: string
  titleAccent?: 'amber' | 'cyan' | 'green' | 'red'
  action?: { label: string; onClick: () => void }
  children: ReactNode
}

export function Panel({ title, titleAccent, action, children }: PanelProps) {
  const titleMod = titleAccent ? ` nx-panel__title--${titleAccent}` : ''
  return (
    <section className="nx-panel">
      <header className="nx-panel__head">
        <h2 className={`nx-panel__title${titleMod}`}>{title}</h2>
        {action != null && (
          <button type="button" className="nx-panel__action" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </header>
      <div className="nx-panel__divider" aria-hidden />
      <div className="nx-panel__body">{children}</div>
    </section>
  )
}
