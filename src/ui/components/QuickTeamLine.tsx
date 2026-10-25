import type { ReactNode } from 'react'
import type { Game } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import { QuickLeagueFlag } from './Flag'
import { quickLeagueName } from '@game/logic/superLeague'
import { seasonLabel } from '../format'

/**
 * The header line of a quick season's screens: the user's team name only (never "as" the club whose place it takes)
 * and the league's flag, plus a season chip on the Daily, and anything the screen adds after them.
 */
export function QuickTeamLine({ game, u, children }: { game: Game; u: LoadedUniverse; children?: ReactNode }) {
  const s = game.settings
  const league = quickLeagueName(u, s)
  return (
    <div className="quick-team row wrap" data-testid="quick-team">
      <b className="quick-team-name">{s.teamName}</b>
      <QuickLeagueFlag settings={s} label={league} />
      {/* Quick Draft's goal is just the season: the team and a flag; the Daily keeps its season */}
      {s.mode !== 'quick' && <span className="chip">{seasonLabel(s.leagueSeason)}</span>}
      {children}
    </div>
  )
}
