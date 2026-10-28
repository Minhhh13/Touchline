import { CalendarDays, SlidersHorizontal } from 'lucide-react'
import type { FirstNext as Step } from '@game/logic/onboarding'

/** After the first result ever: where to go next, today's Daily and a Quick Draft set up your way (`firstResultNext` decides). */
export function FirstNext({ steps, onDaily, onSetup }: { steps: Step[]; onDaily: () => void; onSetup: () => void }) {
  return (
    <section className="panel first-next" data-testid="first-next" aria-labelledby="first-next-title">
      <h3 id="first-next-title">Your first season is in</h3>
      <div className="first-next-options">
        {steps.includes('daily') && (
          <div className="first-next-option">
            <p>
              <b>Today's Daily</b> Everyone gets the same spins today, so your score compares.
            </p>
            <button type="button" className="btn primary" onClick={onDaily} data-testid="first-next-daily">
              <CalendarDays size={16} aria-hidden="true" /> Play today's Daily
            </button>
          </div>
        )}
        {steps.includes('quick') && (
          <div className="first-next-option">
            <p>
              <b>Your next draft</b> Pick the formation, the league and modes such as Hard, Legends or Moneyball.
            </p>
            <button type="button" className={`btn${steps.includes('daily') ? '' : ' primary'}`} onClick={onSetup} data-testid="first-next-setup">
              <SlidersHorizontal size={16} aria-hidden="true" /> Set up a Quick Draft
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
