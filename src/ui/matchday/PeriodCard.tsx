import { textColourFor } from '../format'
import { translator } from '../i18n'
import { match } from '../i18n/en/match'

const tx = translator(match)

export interface PeriodSide {
  code: string
  colour: string
}

/**
 * The whistle's card over the pitch at half time and full time: the period, both codes and the score. It slides in
 * when the clock stops there and settles at the pitch's foot so the stop's decisions can come up over the match;
 * presentation only (matchday-motion.css), not announced (the scoreboard's own line says the score).
 */
export function PeriodCard({ kind, home, away, score }: { kind: 'ht' | 'ft'; home: PeriodSide; away: PeriodSide; score: { home: number; away: number } }) {
  return (
    <div className={`md-period ${kind}`} aria-hidden="true" data-testid="period-card" data-period={kind}>
      <div className="md-period-card">
        <span className="md-period-kicker">{tx(kind === 'ht' ? 'periodHalfTime' : 'periodFullTime')}</span>
        <span className="md-period-score">
          <span className="md-period-code" style={{ background: home.colour, color: textColourFor(home.colour) }}>
            {home.code}
          </span>
          <b className="mono">
            {score.home} - {score.away}
          </b>
          <span className="md-period-code" style={{ background: away.colour, color: textColourFor(away.colour) }}>
            {away.code}
          </span>
        </span>
      </div>
    </div>
  )
}
