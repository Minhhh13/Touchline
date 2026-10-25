import { TWIST_EVERY, type Twist } from '@engine/draft'
import { seasonLabel } from '../format'

export const TWIST_INFO: Record<Twist, { icon: string; title: string; rule: string }> = {
  golden: { icon: '🥇', title: 'Golden spin', rule: 'The wheel only stops on title-winning sides.' },
  basement: { icon: '🪣', title: 'Basement spin', rule: 'The wheel only stops on the bottom three of their league that season.' },
  blind: { icon: '🙈', title: 'Blind spin', rule: 'Ratings are hidden until you have picked. Trust the name.' },
  decade: { icon: '📅', title: 'Decade spin', rule: 'The wheel stays in the decade of your last pick.' },
}

/** The twist on the spin now showing (or the one coming), above the wheel. */
export function TwistCard({ twist, decade, next, every }: { twist: Twist | null | undefined; decade: number | null; next: boolean; every?: boolean }) {
  if (twist) {
    const info = TWIST_INFO[twist]
    const rule = twist === 'decade' && decade !== null ? `The wheel stays in the ${decade}s: ${seasonLabel(decade)} to ${seasonLabel(decade + 9)}.` : info.rule
    return (
      <div className={`twist-card ${twist}`} data-testid="twist-card">
        <span className="twist-icon" aria-hidden>
          {info.icon}
        </span>
        <div>
          <div className="twist-title">{info.title}</div>
          <div className="small muted">{rule}</div>
        </div>
      </div>
    )
  }
  if (next) {
    return (
      <div className="twist-card next" data-testid="twist-card">
        <span className="twist-icon" aria-hidden>
          🎲
        </span>
        <div>
          <div className="twist-title">Twist spin next</div>
          <div className="small muted">{every ? 'Crazy: every' : `Every ${TWIST_EVERY === 3 ? 'third' : `${TWIST_EVERY}th`}`} spin is golden, basement, blind or decade. The wheel decides which.</div>
        </div>
      </div>
    )
  }
  return null
}
