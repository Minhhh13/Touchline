/** Small shared pieces of the dashboard panels. */
import type { ReactNode } from 'react'
import { textColourFor } from '../../format'
import type { SideView } from '../types'

/** A side's code on its colours. */
export function TeamCode({ view }: { view: Pick<SideView, 'code' | 'colour'> }) {
  return (
    <span className="md-code" style={{ background: view.colour, color: textColourFor(view.colour) }}>
      {view.code}
    </span>
  )
}

/** A match rating pill: green from 7.5, red under 6, a dash before he has played. */
export function RatingPill({ value }: { value: number | undefined }) {
  const band = value === undefined ? 'none' : value >= 7.5 ? 'good' : value < 6 ? 'bad' : 'mid'
  return <span className={`md-rating ${band}`}>{value === undefined ? '–' : value.toFixed(1)}</span>
}

export function Swatch({ colour }: { colour: string }) {
  return <span className="swatch" style={{ background: colour }} />
}

/** A panel's quiet empty state. */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="md-empty">{children}</div>
}

/** A small two-way toggle (home / away / both) for the map widgets. */
export function SideToggle<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="md-toggle" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'active' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
