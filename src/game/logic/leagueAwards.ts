/**
 * League awards at the end of a Season or Dynasty season: the same awards as
 * the squad's own (`computeAwards`), judged over every player in the league,
 * the user's squad and every rival's, from the season statistics the squad
 * and AI club states already keep (all competitions). Pure, derived, never
 * saved; the squad awards that `finishSeason` parses stay as they are.
 */
import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { PlayerSeason, Position, SquadPlayer } from '@engine/types'
import { computeAwards, type AwardWinner } from '@engine/awards'
import { squadPlayers } from './players'

export interface LeagueAward extends AwardWinner {
  /** The user's team name or the rival's club name. */
  teamName: string
  /** One of the user's players. */
  mine: boolean
}

export interface LeagueAwards {
  playerOfTheSeason?: LeagueAward
  goldenBoot?: LeagueAward
  playmaker?: LeagueAward
  goldenGlove?: LeagueAward
  youngPlayer?: LeagueAward
  teamOfTheSeason: Array<{ position: Position; playerSeasonId: string; name: string; avgRating: number; teamName: string; mine: boolean }>
  /** How many of the user's players made the team of the season. */
  mineInTeam: number
}

/** The league's awards for the season in `game.season`, or null without one. */
export function leagueAwards(game: Game, u: LoadedUniverse): LeagueAwards | null {
  const season = game.season
  if (!season) return null
  const pool: Array<{ p: PlayerSeason; s: SquadPlayer }> = []
  const team = new Map<string, { name: string; mine: boolean }>()
  for (const x of squadPlayers(game, u)) {
    pool.push(x)
    team.set(x.p.id, { name: game.settings.teamName, mine: true })
  }
  for (const club of Object.values(season.ai)) {
    for (const id of club.squad) {
      const p = u.index[id]
      const s = club.state[id]
      if (!p || !s || team.has(id)) continue
      pool.push({ p, s })
      team.set(id, { name: club.name, mine: false })
    }
  }
  const a = computeAwards(pool, season.matchweeks)
  const tag = (w: AwardWinner | undefined): LeagueAward | undefined => (w ? { ...w, teamName: team.get(w.playerSeasonId)?.name ?? '', mine: !!team.get(w.playerSeasonId)?.mine } : undefined)
  const teamOfTheSeason = a.teamOfTheSeason.map((t) => ({ position: t.position, playerSeasonId: t.playerSeasonId, name: t.name, avgRating: t.avgRating, teamName: team.get(t.playerSeasonId)?.name ?? '', mine: !!team.get(t.playerSeasonId)?.mine }))
  return {
    playerOfTheSeason: tag(a.playerOfTheSeason),
    goldenBoot: tag(a.goldenBoot),
    playmaker: tag(a.playmaker),
    goldenGlove: tag(a.goldenGlove),
    youngPlayer: tag(a.youngPlayer),
    teamOfTheSeason,
    mineInTeam: teamOfTheSeason.filter((t) => t.mine).length,
  }
}
