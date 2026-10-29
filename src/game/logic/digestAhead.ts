/**
 * The digest's last word (r10): where the run leaves the manager for the next match. Who it is against and which of
 * his men cannot play in it, injured or banned, longest out first. Read from the game as it stands after the run, so
 * it says what still matters rather than repeating what happened. Pure, RNG-free, display only; kept out of
 * `digest.ts` and `week.ts` so the first download carries only this.
 */
import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { USER_TEAM } from '@engine/season'
import { playerLookup } from './players'

export interface AheadMan {
  id: string
  name: string
  why: 'injury' | 'suspension'
  /** Matchweeks out (an injury) or matches banned (a suspension). */
  weeks: number
}

export interface DigestAhead {
  /** The matchweek to play next. */
  matchweek: number
  /** Its league opponent, or none on a free weekend. */
  opponentId?: string
  home?: boolean
  /** The squad's men who cannot play in it, longest out first. */
  out: AheadMan[]
}

/** At most this many names; the rest are counted. */
export const AHEAD_CAP = 5

/** The next match and who misses it, or null once the season is over (or sacked). */
export function digestAhead(game: Game, u: LoadedUniverse): DigestAhead | null {
  const season = game.season
  if (!season || season.sacked || season.matchweek >= season.matchweeks) return null
  const matchweek = season.matchweek + 1
  const f = season.fixtures.find((x) => x.matchweek === matchweek && (x.homeTeamId === USER_TEAM || x.awayTeamId === USER_TEAM))
  const get = playerLookup(game, u)
  const out: AheadMan[] = []
  for (const [id, s] of Object.entries(game.squad)) {
    const name = get(id)?.name ?? id
    if (s.injury && s.injury.weeksOut > 0) out.push({ id, name, why: 'injury', weeks: s.injury.weeksOut })
    else if (s.suspension > 0) out.push({ id, name, why: 'suspension', weeks: s.suspension })
  }
  out.sort((a, b) => b.weeks - a.weeks || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return { matchweek, ...(f ? { opponentId: f.homeTeamId === USER_TEAM ? f.awayTeamId : f.homeTeamId, home: f.homeTeamId === USER_TEAM } : {}), out }
}
