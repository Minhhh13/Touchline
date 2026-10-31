import { Shuffle } from 'lucide-react'
import { TWIST_EVERY, type Twist } from '@engine/draft'
import { seasonLabel } from '../format'
import { TWIST_ICON } from './icons'
import { translator } from '../i18n'
import { setup } from '../i18n/en/setup'

const t = translator(setup)

/** A twist's emoji, title and rule; title and rule are read through `t()` when used, so they follow the language. */
function twistInfo(twist: Twist, icon: string): { icon: string; title: string; rule: string } {
  return {
    icon,
    get title() {
      return t(`twistTitle_${twist}`)
    },
    get rule() {
      return t(`twistRule_${twist}`)
    },
  }
}

/** `icon` is the emoji kept for share text and the summary; screens draw TWIST_ICON. */
export const TWIST_INFO: Record<Twist, { icon: string; title: string; rule: string }> = {
  golden: twistInfo('golden', '🥇'),
  basement: twistInfo('basement', '🪣'),
  blind: twistInfo('blind', '🙈'),
  decade: twistInfo('decade', '📅'),
}

/** The twist on the spin now showing (or the one coming), above the wheel. */
export function TwistCard({ twist, decade, next, every, coming }: { twist: Twist | null | undefined; decade: number | null; next: boolean; every?: boolean; coming?: Twist | null }) {
  if (twist) {
    const info = TWIST_INFO[twist]
    const Icon = TWIST_ICON[twist]
    const rule = twist === 'decade' && decade !== null ? t('decadeRule', { decade: String(decade), from: seasonLabel(decade), to: seasonLabel(decade + 9) }) : info.rule
    return (
      <div className={`twist-card ${twist}`} data-testid="twist-card">
        <span className="twist-icon" aria-hidden>
          <Icon size={20} />
        </span>
        <div>
          <div className="twist-title">{info.title}</div>
          <div className="small muted">{rule}</div>
        </div>
      </div>
    )
  }
  // A twist already decided for the next spin (a Crazy golden surprise): named, not left to the wheel
  if (next && coming) {
    const info = TWIST_INFO[coming]
    return (
      <div className={`twist-card next ${coming}`} data-testid="twist-card">
        <span className="twist-icon" aria-hidden>
          {info.icon}
        </span>
        <div>
          <div className="twist-title">{t('twistComing', { title: info.title })}</div>
          <div className="small muted">{info.rule}</div>
        </div>
      </div>
    )
  }
  if (next) {
    return (
      <div className="twist-card next" data-testid="twist-card">
        <span className="twist-icon" aria-hidden>
          <Shuffle size={20} />
        </span>
        <div>
          <div className="twist-title">{t('twistSpinNext')}</div>
          <div className="small muted">{t('twistEvery', { crazy: every ? 'yes' : 'no', nth: TWIST_EVERY === 3 ? t('third') : `${TWIST_EVERY}th` })}</div>
        </div>
      </div>
    )
  }
  return null
}
