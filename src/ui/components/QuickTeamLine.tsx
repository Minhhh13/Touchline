import type { ReactNode } from 'react'
import type { Game } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import { LeagueFlag } from './Flag'
import { seasonLabel } from '../format'

/**
 * The header line of a quick season's screens: the user's team name only (never "as" the club whose place it takes),
 * the league's flag and a season chip, and anything the screen adds after them.
 */
export function QuickTeamLine({ game, u, children }: { game: Game; u: LoadedUniverse; children?: ReactNode }) {
  const s = game.settings
  const league = u.leagues.find((l) => l.id === s.leagueId)?.name ?? s.leagueId
  return (
    <div className="quick-team row wrap" data-testid="quick-team">
      <b className="quick-team-name">{s.teamName}</b>
      <LeagueFlag leagueId={s.leagueId} label={league} />
      <span className="chip">{seasonLabel(s.leagueSeason)}</span>
      {children}
    </div>
  )
}
