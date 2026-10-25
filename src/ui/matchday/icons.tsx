/** Small SVG icons for the dashboard (no emoji): ball, cards, substitution, injury, whistle, arrows. */
import type { MatchEvent } from '@engine/types'

const box = { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true as const, className: 'md-icon' }

export function BallIcon() {
  return (
    <svg {...box}>
      <circle cx="7" cy="7" r="5.6" fill="#fff" stroke="#111" strokeWidth="1" />
      <path d="M7 4.3 9.4 6 8.5 8.8H5.5L4.6 6Z" fill="#111" />
    </svg>
  )
}

export function CardIcon({ red = false }: { red?: boolean }) {
  return (
    <svg {...box}>
      <rect x="3.5" y="1.5" width="7" height="11" rx="1.2" fill={red ? 'var(--danger)' : 'var(--gold)'} stroke="rgba(0,0,0,0.45)" strokeWidth="0.8" />
    </svg>
  )
}

export function SubIcon() {
  return (
    <svg {...box}>
      <path d="M4 12V3M4 3 1.5 5.5M4 3l2.5 2.5" stroke="var(--accent)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M10 2v9m0 0-2.5-2.5M10 11l2.5-2.5" stroke="var(--danger)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export function InjuryIcon() {
  return (
    <svg {...box}>
      <circle cx="7" cy="7" r="5.6" fill="var(--warn)" />
      <path d="M7 4v6M4 7h6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function WhistleIcon() {
  return (
    <svg {...box}>
      <circle cx="5.5" cy="8" r="3.6" fill="none" stroke="var(--text-2)" strokeWidth="1.4" />
      <path d="M8 5.5h5V8H8.8" fill="none" stroke="var(--text-2)" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

export function ChangeIcon() {
  return (
    <svg {...box}>
      <path d="M2 4h8l-2-2M12 10H4l2 2" stroke="var(--info)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ChanceIcon({ saved = false }: { saved?: boolean }) {
  return (
    <svg {...box}>
      <circle cx="7" cy="7" r="4.6" fill={saved ? 'rgba(0,0,0,0.25)' : 'none'} stroke="var(--text-2)" strokeWidth="1.3" strokeDasharray={saved ? undefined : '2 1.4'} />
    </svg>
  )
}

/** The sub arrow on a shirt or card: up and green for the man who came on. */
export function OnArrow() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="md-icon">
      <path d="M5 9V1.5M5 1.5 2 4.5M5 1.5l3 3" stroke="var(--accent)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export function EventIcon({ type }: { type: MatchEvent['type'] }) {
  switch (type) {
    case 'goal':
    case 'penalty':
    case 'own_goal':
      return <BallIcon />
    case 'yellow':
      return <CardIcon />
    case 'red':
      return <CardIcon red />
    case 'substitution':
      return <SubIcon />
    case 'injury':
      return <InjuryIcon />
    case 'chance':
      return <ChanceIcon />
    case 'save':
      return <ChanceIcon saved />
    default:
      return <WhistleIcon />
  }
}
