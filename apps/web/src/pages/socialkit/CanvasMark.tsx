// CanvasMark.tsx — brand logos with LITERAL hex fills (export-safe) + the tiny
// Corners bracket primitive. Ported from kit-brands.jsx (CanvasMark) and
// nexus-components.jsx (Corners).
//
// SVG presentation attributes don't reliably resolve CSS var() through
// html-to-image, so these duplicate the nexus marks with hard hex.

import React from 'react'
import type { BrandId } from './brands'

export function CanvasMark({ id, size = 32 }: { id: BrandId; size?: number }) {
  switch (id) {
    case 'keystone':
      return (
        <svg viewBox="0 0 32 32" width={size} height={size}>
          <path d="M16 3 L28 11 L28 22 L16 30 L4 22 L4 11 Z" fill="none" stroke="#A4B8CC" strokeWidth="1.5" />
          <path d="M16 9 L22 13 L22 19 L16 23 L10 19 L10 13 Z" fill="#00C4E8" opacity="0.85" />
          <circle cx="16" cy="16" r="2" fill="#050C14" />
        </svg>
      )
    case 'scripta':
      return (
        <svg viewBox="0 0 32 32" width={size} height={size}>
          <rect x="5" y="5" width="22" height="3" fill="#00C4E8" />
          <rect x="5" y="10" width="16" height="3" fill="#00C4E8" opacity="0.65" />
          <rect x="5" y="15" width="22" height="3" fill="#00E47A" />
          <rect x="5" y="20" width="12" height="3" fill="#00E47A" opacity="0.65" />
          <rect x="5" y="25" width="22" height="3" fill="#00C4E8" opacity="0.4" />
        </svg>
      )
    case 'demoforge':
      return (
        <svg viewBox="0 0 32 32" width={size} height={size}>
          <polygon points="16,3 28,16 16,29 4,16" fill="none" stroke="#EFA020" strokeWidth="1.5" />
          <polygon points="16,9 22,16 16,23 10,16" fill="#E04040" />
          <circle cx="16" cy="16" r="2" fill="#EFA020" />
        </svg>
      )
    case 'crucible':
      return (
        <svg viewBox="0 0 32 32" width={size} height={size}>
          <path d="M6 5 L26 5 L24 12 L24 22 L20 28 L12 28 L8 22 L8 12 Z" fill="none" stroke="#E04040" strokeWidth="1.5" />
          <path d="M11 15 L21 15 L20 21 L18 25 L14 25 L12 21 Z" fill="#EFA020" opacity="0.85" />
          <rect x="14" y="2" width="4" height="5" fill="#E04040" />
        </svg>
      )
    case 'vantage':
      return (
        <svg viewBox="0 0 32 32" width={size} height={size}>
          <circle cx="16" cy="16" r="13" fill="none" stroke="#00C4E8" strokeWidth="1.2" opacity="0.6" />
          <circle cx="16" cy="16" r="8" fill="none" stroke="#00C4E8" strokeWidth="1.2" />
          <circle cx="16" cy="16" r="3" fill="#EFA020" />
          <line x1="16" y1="3" x2="16" y2="29" stroke="#00C4E8" strokeWidth="0.6" opacity="0.4" />
          <line x1="3" y1="16" x2="29" y2="16" stroke="#00C4E8" strokeWidth="0.6" opacity="0.4" />
        </svg>
      )
    case 'shift':
    default:
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} fill="none">
          {/* chamfered containment frame */}
          <path d="M9 4 H24 L28 8 V23 L23 28 H8 L4 24 V9 Z" stroke="#00C4E8" strokeWidth="1.3" opacity="0.45" />
          {/* outgoing arrow — amber, sweeps the top */}
          <path d="M9 12 A7 7 0 0 1 20 10" stroke="#EFA020" strokeWidth="2.1" strokeLinecap="round" />
          <path d="M20.4 6 L22.3 11.2 L16.8 11" fill="#EFA020" />
          {/* incoming arrow — cyan, sweeps the bottom */}
          <path d="M23 20 A7 7 0 0 1 12 22" stroke="#00C4E8" strokeWidth="2.1" strokeLinecap="round" />
          <path d="M11.6 26 L9.7 20.8 L15.2 21" fill="#00C4E8" />
          {/* pivot core */}
          <circle cx="16" cy="16" r="2.1" fill="#00C4E8" />
        </svg>
      )
  }
}

// Tiny corner brackets you can apply to any positioned container.
export function Corners({ color, inset = 0, size = 10 }: { color?: string; inset?: number; size?: number }) {
  const c = color || 'var(--nx-accent)'
  const s = size
  const ins = inset
  const base: React.CSSProperties = {
    position: 'absolute', width: s, height: s, borderColor: c, borderStyle: 'solid', pointerEvents: 'none',
  }
  return (
    <>
      <span style={{ ...base, top: ins, left: ins, borderWidth: '1px 0 0 1px' }} />
      <span style={{ ...base, top: ins, right: ins, borderWidth: '1px 1px 0 0' }} />
      <span style={{ ...base, bottom: ins, left: ins, borderWidth: '0 0 1px 1px' }} />
      <span style={{ ...base, bottom: ins, right: ins, borderWidth: '0 1px 1px 0' }} />
    </>
  )
}
