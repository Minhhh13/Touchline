import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { Tactics } from '@engine/types'
import { Rng } from '@engine/rng'
import { USER_TEAM } from '@engine/season'
import { summaryHighlights, type HighlightMoment, type MatchHighlights } from '@engine/highlights'
import { playbackResults, quickSeasonStart, replayUserMatch } from './quick'

/** The highlights of one quick-season game, ready for the live pitch. */
export interface QuickHighlights extends MatchHighlights {
  matchweek: number
  /** The user was the home side. */
  userHome: boolean
  homeTeamId: string
  awayTeamId: string
  homeName: string
  awayName: string
  homeShort: string
  awayShort: string
  homeTactics: Tactics
  awayTactics: Tactics
}

/** Whether the quick season on show can replay its games: its start state was kept (saves from before it was are not). */
export function canShowHighlights(game: Game): boolean {
  return !!quickSeasonStart(game) && playbackResults(game).length > 0
}

/**
 * The highlights of the user's quick-season game of matchweek `matchweek`, rebuilt from the season's start state:
 * the season is played again up to that game (nothing on `game` moves) and its key moments are taken from the match
 * the season played. Null when the game cannot be rebuilt, or when the rebuilt game does not end on the score the
 * season recorded (league data changed under the save), so a reel never shows a different result. Pure.
 */
export function quickHighlights(game: Game, u: LoadedUniverse, matchweek: number): QuickHighlights | null {
  const r = playbackResults(game).find((x) => x.matchweek === matchweek)
  if (!r) return null
  const m = replayUserMatch(game, u, matchweek)
  if (!m) return null
  const userHome = m.home.teamId === USER_TEAM
  const res = m.result
  const gf = userHome ? res.homeGoals : res.awayGoals
  const ga = userHome ? res.awayGoals : res.homeGoals
  const opp = userHome ? m.away.teamId : m.home.teamId
  if (userHome !== r.home || opp !== r.opponentId || gf !== r.gf || ga !== r.ga) return null
  // The reel's own draws come from a fork of a copy of the state the match kicked off from: the season never moves
  const hl = summaryHighlights(res, m.home, m.away, Rng.fromState(m.before).fork(`highlights-${matchweek}`))
  return { ...hl, matchweek, userHome, homeTeamId: m.home.teamId, awayTeamId: m.away.teamId, homeName: m.home.teamName, awayName: m.away.teamName, homeShort: m.home.shortName, awayShort: m.away.shortName, homeTactics: m.home.tactics, awayTactics: m.away.tactics }
}

/** Match minutes of build-up the reel plays before each moment. */
export const HIGHLIGHT_BUILDUP = 2

/** Where moment `i`'s build-up starts: two minutes before it, never back over the moment before (one goal would play twice). */
export function buildUpFrom(moments: HighlightMoment[], i: number): number {
  const m = moments[i]
  if (!m) return 0
  const prev = moments[i - 1]
  return Math.min(m.minute, Math.max(1, m.minute - HIGHLIGHT_BUILDUP, prev ? prev.minute + 1 : 1))
}
