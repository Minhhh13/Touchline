import type { Game } from '../types'
import type { Fixture, MatchResult } from '@engine/types'
import { USER_TEAM, type CupTie, type SeasonState } from '@engine/season'

/** A stored result: what a fixture or a tie keeps once nothing will show its detail again. */
export type StoredResult = MatchResult & { penalties?: { home: number; away: number } }

/**
 * Save compaction (section 15 of the design doc). A played fixture keeps its
 * whole match result in memory, but once the week has moved on nothing reads
 * more than the score: the tables, the fixtures list, the season records, the
 * objectives, the briefing and the event context read `homeGoals` and
 * `awayGoals`; a cup tie adds its penalties and `winnerId`. The match screen
 * shows `game.lastMatch` and `game.lastCupMatch`, which are kept whole, and
 * the season statistics and awards come from the squad and AI club states.
 * So the save keeps the score, the xG pair and empty event and stat lists (the
 * stored shape stays a valid `MatchResult`), except for the user's league
 * matches of the current and the previous matchweek and the user's last tie
 * in each knockout, which stay complete.
 */
export function compactResult(r: StoredResult): StoredResult {
  if (isCompact(r)) return r
  const out: StoredResult = { homeTeamId: r.homeTeamId, awayTeamId: r.awayTeamId, homeGoals: r.homeGoals, awayGoals: r.awayGoals, events: [], homeStats: [], awayStats: [], xg: r.xg }
  if (r.penalties) out.penalties = r.penalties
  return out
}

const COMPACT_KEYS = new Set(['homeTeamId', 'awayTeamId', 'homeGoals', 'awayGoals', 'events', 'homeStats', 'awayStats', 'xg', 'penalties'])

function isCompact(r: StoredResult): boolean {
  return !r.events?.length && !r.homeStats?.length && !r.awayStats?.length && Object.keys(r).every((k) => COMPACT_KEYS.has(k))
}

const isUsers = (x: { homeTeamId: string; awayTeamId: string }) => x.homeTeamId === USER_TEAM || x.awayTeamId === USER_TEAM

function compactFixtures(fixtures: Fixture[], matchweek: number): Fixture[] {
  let changed = false
  const out = fixtures.map((f) => {
    if (!f.result || (isUsers(f) && f.matchweek >= matchweek - 1)) return f
    const result = compactResult(f.result)
    if (result === f.result) return f
    changed = true
    return { ...f, result }
  })
  return changed ? out : fixtures
}

function compactTies(ties: CupTie[]): CupTie[] {
  // The user's most recent played tie in this knockout stays whole (the last cup tie)
  let lastMine = -1
  ties.forEach((t, i) => {
    if (t.result && isUsers(t) && (lastMine < 0 || t.afterMatchweek >= ties[lastMine].afterMatchweek)) lastMine = i
  })
  let changed = false
  const out = ties.map((t, i) => {
    if (!t.result || i === lastMine) return t
    const result = compactResult(t.result)
    if (result === t.result) return t
    changed = true
    return { ...t, result }
  })
  return changed ? out : ties
}

function compactSeason(s: SeasonState): SeasonState {
  const mw = s.matchweek
  const fixtures = Array.isArray(s.fixtures) ? compactFixtures(s.fixtures, mw) : s.fixtures
  const cup = Array.isArray(s.cup) ? compactTies(s.cup) : s.cup
  const ties = s.continental && Array.isArray(s.continental.ties) ? compactTies(s.continental.ties) : s.continental?.ties
  if (fixtures === s.fixtures && cup === s.cup && ties === s.continental?.ties) return s
  return { ...s, fixtures, cup, ...(s.continental && ties ? { continental: { ...s.continental, ties } } : {}) }
}

/**
 * The game as it is saved: the same object when there is nothing to compact,
 * otherwise a copy sharing every untouched part (the input is never mutated,
 * so it is safe on the store's frozen state).
 */
export function compactGame(g: Game): Game {
  if (!g.season || typeof g.season !== 'object') return g
  const season = compactSeason(g.season)
  return season === g.season ? g : { ...g, season }
}
