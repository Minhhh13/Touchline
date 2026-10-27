import { CalendarDays, SlidersHorizontal } from 'lucide-react'
import type { FirstNext as Step } from '@game/logic/onboarding'
import { B, rich } from '../i18n/rich'
import { translator } from '../i18n'
import { summary } from '../i18n/en/summary'

const t = translator(summary)

/** After the first result ever: where to go next, today's Daily and a Quick Draft set up your way (`firstResultNext` decides). */
export function FirstNext({ steps, onDaily, onSetup }: { steps: Step[]; onDaily: () => void; onSetup: () => void }) {
  return (
    <section className="panel first-next" data-testid="first-next" aria-labelledby="first-next-title">
      <h3 id="first-next-title">{t('firstSeasonIn')}</h3>
      <div className="first-next-options">
        {steps.includes('daily') && (
          <div className="first-next-option">
            <p>{rich(t('firstDailyLine'), B)}</p>
            <button type="button" className="btn primary" onClick={onDaily} data-testid="first-next-daily">
              <CalendarDays size={16} aria-hidden="true" /> {t('playTodaysDaily')}
            </button>
          </div>
        )}
        {steps.includes('quick') && (
          <div className="first-next-option">
            <p>{rich(t('firstSetupLine'), B)}</p>
            <button type="button" className={`btn${steps.includes('daily') ? '' : ' primary'}`} onClick={onSetup} data-testid="first-next-setup">
              <SlidersHorizontal size={16} aria-hidden="true" /> {t('setUpQuickDraft')}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
