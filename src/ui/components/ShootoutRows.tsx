import { translator } from '../i18n'
import { arena } from '../i18n/en/arena'

const t = translator(arena)

/** The first round of kicks each side takes before sudden death. */
const FIRST_ROUND = 5

export interface ShootoutKick {
  us: boolean
  takerId: string
  scored: boolean
}

/**
 * A shoot-out as a scoreboard (r9): one row a side, the side's code first, each kick a chip in the order taken (a tick
 * or a cross, the name, its words for a screen reader). With `pending`, a row still short of five kicks is filled out
 * with dashed places for the kicks to come, so a reveal fills the board kick by kick; sudden death adds chips beyond.
 */
export function ShootoutRows({ kicks, ourCode, theirCode, name, pending = false }: { kicks: readonly ShootoutKick[]; ourCode: string; theirCode: string; name: (k: ShootoutKick) => string; pending?: boolean }) {
  return (
    <div className="shootout-rows">
      {[true, false].map((us) => {
        const side = kicks.filter((k) => k.us === us)
        const open = pending ? Math.max(0, FIRST_ROUND - side.length) : 0
        return (
          <div key={us ? 'us' : 'them'} className="row wrap shootout-side" style={{ gap: 6 }} role="group" aria-label={t(us ? 'ours' : 'theirs')} data-testid={us ? 'shootout-ours' : 'shootout-theirs'}>
            <span className="shootout-code" aria-hidden="true">
              {us ? ourCode : theirCode}
            </span>
            {side.map((k, i) => {
              const who = name(k)
              return (
                <span key={i} className={`chip ${k.scored ? 'good' : 'bad'}`} aria-label={t(k.scored ? 'kickScored' : 'kickMissed', { name: who })} data-testid="shootout-kick">
                  {who} <span aria-hidden="true">{k.scored ? '✓' : '✗'}</span>
                </span>
              )
            })}
            {Array.from({ length: open }, (_, i) => (
              <span key={`open-${i}`} className="chip shootout-open" aria-hidden="true">
                {side.length + i + 1}
              </span>
            ))}
          </div>
        )
      })}
    </div>
  )
}
