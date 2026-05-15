import './Button.css'

interface ButtonProps {
  label: string
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  onClick?: () => void
  disabled?: boolean
  fullWidth?: boolean
}

export function Button({ label, variant = 'primary', size = 'md', onClick, disabled, fullWidth }: ButtonProps) {
  return (
    <button
      type="button"
      className={`nx-btn nx-btn--${variant} nx-btn--${size}${fullWidth ? ' nx-btn--full' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  )
}
