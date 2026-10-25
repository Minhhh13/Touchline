/** Condition as Football Manager draws it: a small heart that empties as the legs go, coloured by band. */
import { useId } from 'react'
import { conditionColour } from '../format'
import { conditionBand } from './controls'

export function ConditionIcon({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  // The heart fills from the bottom: 100 full, 0 empty
  const top = 2 + (12 - 2) * (1 - v / 100)
  const id = `md-cond-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg className={`md-condition ${conditionBand(v)}`} width="14" height="14" viewBox="0 0 14 14" role="img" aria-label={`Condition ${v}%`}>
      <title>{`Condition ${v}%`}</title>
      <defs>
        <clipPath id={id}>
          <rect x="0" y={top} width="14" height={14 - top} />
        </clipPath>
      </defs>
      <path d="M7 12.2 1.9 7.3a3 3 0 0 1 4.3-4.2L7 3.9l.8-.8a3 3 0 0 1 4.3 4.2Z" fill="none" stroke={conditionColour(v)} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M7 12.2 1.9 7.3a3 3 0 0 1 4.3-4.2L7 3.9l.8-.8a3 3 0 0 1 4.3 4.2Z" fill={conditionColour(v)} clipPath={`url(#${id})`} />
    </svg>
  )
}
