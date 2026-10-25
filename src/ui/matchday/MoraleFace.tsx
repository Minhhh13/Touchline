/** Morale as a small face: the mouth turns down and the colour cools as morale falls. */
import { moraleWord } from '../format'
import { moraleBand, type MoraleBand } from './controls'

const MOUTH: Record<MoraleBand, string> = {
  superb: 'M4.2 8.2q2.8 3 5.6 0',
  good: 'M4.4 8.6q2.6 1.8 5.2 0',
  okay: 'M4.5 9h5',
  poor: 'M4.4 9.8q2.6-1.6 5.2 0',
  'very-poor': 'M4.2 10.4q2.8-2.8 5.6 0',
}

const TONE: Record<MoraleBand, string> = {
  superb: 'var(--good)',
  good: 'var(--good)',
  okay: 'var(--meter-mid)',
  poor: 'var(--warn)',
  'very-poor': 'var(--danger)',
}

export function MoraleFace({ value }: { value: number }) {
  const band = moraleBand(value)
  const label = `Morale: ${moraleWord(value)}`
  return (
    <svg className={`md-morale ${band}`} width="14" height="14" viewBox="0 0 14 14" role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx="7" cy="7" r="5.9" fill="none" stroke={TONE[band]} strokeWidth="1.3" />
      <circle cx="5" cy="5.6" r="0.85" fill={TONE[band]} />
      <circle cx="9" cy="5.6" r="0.85" fill={TONE[band]} />
      <path d={MOUTH[band]} fill="none" stroke={TONE[band]} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
