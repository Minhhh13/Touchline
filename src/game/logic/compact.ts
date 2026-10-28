import type { Game } from '../types'
import type { Fixture, MatchEvent, MatchResult } from '@engine/types'
import { USER_TEAM, type CupTie, type SeasonState } from '@engine/season'
import type { ContinentalGroup } from '@engine/continental'

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
 *
 * The match-day dashboard reveals the other scores of the round in play (and
 * of a replayed match's round) goal by goal at the user's clock, so with
 * `keepGoals` the other matches of those rounds also keep their goal events,
 * cut to minute, type, side and scorer (`text` empty): a few dozen bytes a
 * goal. Everything else is dropped as for any other result.
 */
export function compactResult(r: StoredResult, keepGoals = false): StoredResult {
  if (isCompact(r, keepGoals)) return r
  const events = keepGoals ? goalsOnly(r.events ?? []) : []
  const out: StoredResult = { homeTeamId: r.homeTeamId, awayTeamId: r.awayTeamId, homeGoals: r.homeGoals, awayGoals: r.awayGoals, events, homeStats: [], awayStats: [], xg: r.xg }
  if (r.penalties) out.penalties = r.penalties
  return out
}

const COMPACT_KEYS = new Set(['homeTeamId', 'awayTeamId', 'homeGoals', 'awayGoals', 'events', 'homeStats', 'awayStats', 'xg', 'penalties'])
const GOAL_TYPES = new Set(['goal', 'penalty', 'own_goal'])
const GOAL_KEYS = new Set(['minute', 'type', 'side', 'playerName', 'text'])

function goalsOnly(events: MatchEvent[]): MatchEvent[] {
  return events.filter((e) => GOAL_TYPES.has(e.type)).map((e) => ({ minute: e.minute, type: e.type, side: e.side, ...(e.playerName !== undefined ? { playerName: e.playerName } : {}), text: '' }))
}

function isGoalOnly(e: MatchEvent): boolean {
  return GOAL_TYPES.has(e.type) && e.text === '' && Object.keys(e).every((k) => GOAL_KEYS.has(k))
}

function isCompact(r: StoredResult, keepGoals: boolean): boolean {
  const events = r.events ?? []
  const eventsOk = keepGoals ? events.every(isGoalOnly) : !events.length
  return eventsOk && !r.homeStats?.length && !r.awayStats?.length && Object.keys(r).every((k) => COMPACT_KEYS.has(k))
}

const isUsers = (x: { homeTeamId: string; awayTeamId: string }) => x.homeTeamId === USER_TEAM || x.awayTeamId === USER_TEAM

function compactFixtures(fixtures: Fixture[], matchweek: number): Fixture[] {
  let changed = false
  const out = fixtures.map((f) => {
    // The user's recent matches stay whole; the rest of their rounds (the previous, the
    // current and, while a match is live, the one in play) keep their goals for the reveal
    const recent = f.matchweek >= matchweek - 1
    if (!f.result || (isUsers(f) && recent)) return f
    const result = compactResult(f.result, recent)
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
  // The rounds the dashboard can reveal: the user's last played tie's and the one in play
  const rounds = new Set<string>()
  if (lastMine >= 0) rounds.add(ties[lastMine].round)
  for (const t of ties) if (!t.result && isUsers(t)) rounds.add(t.round)
  let changed = false
  const out = ties.map((t, i) => {
    // A two-legged tie's first leg (engine 7's Continental Cup) is compacted as its second leg is
    const leg = t.firstLeg?.result
    const firstLeg = leg && i !== lastMine ? compactResult(leg, rounds.has(t.round)) : leg
    const result = !t.result || i === lastMine ? t.result : compactResult(t.result, rounds.has(t.round))
    if (result === t.result && firstLeg === leg) return t
    changed = true
    return { ...t, ...(result ? { result } : {}), ...(t.firstLeg ? { firstLeg: { ...t.firstLeg, ...(firstLeg ? { result: firstLeg } : {}) } } : {}) }
  })
  return changed ? out : ties
}

/**
 * Engine 7's Continental Cup groups: every played group match keeps its score, except the user's match of the latest
 * matchday played, which stays whole; the matches of that matchday and of one still to be played keep their goals for
 * the dashboard's reveal.
 */
function compactGroups(groups: ContinentalGroup[]): ContinentalGroup[] {
  const mine = groups.flatMap((g) => g.matches.filter((m) => m.result && isUsers(m)))
  const lastWeek = Math.max(-1, ...mine.map((m) => m.matchweek))
  const pending = groups.flatMap((g) => g.matches.filter((m) => !m.result && isUsers(m)).map((m) => m.matchweek))
  const reveal = new Set([lastWeek, ...(pending.length ? [Math.min(...pending)] : [])])
  let changed = false
  const out = groups.map((g) => {
    let touched = false
    const matches = g.matches.map((m) => {
      if (!m.result || (isUsers(m) && m.matchweek === lastWeek)) return m
      const result = compactResult(m.result, reveal.has(m.matchweek))
      if (result === m.result) return m
      touched = true
      return { ...m, result }
    })
    if (!touched) return g
    changed = true
    return { ...g, matches }
  })
  return changed ? out : groups
}

function compactSeason(s: SeasonState): SeasonState {
  const mw = s.matchweek
  const fixtures = Array.isArray(s.fixtures) ? compactFixtures(s.fixtures, mw) : s.fixtures
  const cup = Array.isArray(s.cup) ? compactTies(s.cup) : s.cup
  const ties = s.continental && Array.isArray(s.continental.ties) ? compactTies(s.continental.ties) : s.continental?.ties
  const groups = Array.isArray(s.continental?.groups) ? compactGroups(s.continental.groups) : s.continental?.groups
  if (fixtures === s.fixtures && cup === s.cup && ties === s.continental?.ties && groups === s.continental?.groups) return s
  return { ...s, fixtures, cup, ...(s.continental && ties ? { continental: { ...s.continental, ties, ...(groups ? { groups } : {}) } } : {}) }
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
