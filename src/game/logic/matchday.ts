/**
 * The rest of the round while the user's match is played: the other fixtures'
 * scores and the league table as they stand at the user's clock.
 *
 * The round is decided before the user's match is shown (`playMatchweek` plays
 * every other league fixture of the week in the same loop that begins the
 * user's; a live cup tie starts after the other ties of its round), so this is
 * a reveal, not a simulation: each match shows the goals scored by the user's
 * minute, every remaining goal once the user's match reaches its whistle.
 * Pure: it reads the game and never changes it.
 */
import type { Game, MatchContext } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { computeTable, USER_TEAM, type CupTie } from '@engine/season'
import type { Fixture, MatchResult, TableRow } from '@engine/types'
import { clubOf, tiesOf } from './week'
import { legAt } from '@engine/continental'

export interface RoundRef {
  competition: 'league' | 'cup' | 'continental'
  matchweek: number
  /** The user's tie in its competition's list (a knockout round). */
  cupTieIndex?: number
  /** A pre-season friendly: no table and no other matches. */
  friendly?: boolean
}

export function roundRefOf(ctx: MatchContext, cupTieIndex?: number): RoundRef {
  // An arena match is a knockout with no league around it: no table, no other scores
  return { competition: ctx.competition === 'arena' ? 'cup' : ctx.competition, matchweek: ctx.matchweek, cupTieIndex, ...(ctx.matchweek === 0 ? { friendly: true } : {}) }
}

export interface LatestScore {
  homeTeamId: string
  awayTeamId: string
  homeName: string
  awayName: string
  homeCode: string
  awayCode: string
  home: number
  away: number
  status: 'pre' | 'live' | 'HT' | 'FT'
  goals: Array<{ minute: number; side: 'home' | 'away'; scorer?: string }>
  penalties?: { home: number; away: number }
}

export interface LiveTableRow extends TableRow {
  position: number
  /** Position before the round. */
  previous: number
  /** Up (1), down (-1) or level (0) on the table before the round; always 0 in a knockout round. */
  movement: -1 | 0 | 1
  /** In the round and still being played at this minute. */
  playing: boolean
  name: string
  code: string
  isUser: boolean
}

const GOAL_TYPES = new Set(['goal', 'penalty', 'own_goal'])

function teamIds(game: Game): string[] {
  return [USER_TEAM, ...Object.keys(game.season?.ai ?? {})]
}

/** Display name and code of a team in the season: the user's side, a league rival or a Continental Cup club. */
export function teamLabel(game: Game, u: LoadedUniverse, teamId: string): { name: string; code: string } {
  if (teamId === USER_TEAM) return { name: game.settings.teamName, code: game.settings.shortName }
  const club = game.season ? clubOf(game.season, teamId) : undefined
  const code = club ? (u.clubById[club.clubId]?.code ?? club.shortName) : (u.clubById[teamId]?.code ?? teamId)
  return { name: club?.name ?? u.clubById[teamId]?.name ?? teamId, code: code.toUpperCase() }
}

/** The other matches of the round: league fixtures of the matchweek, or the ties of the user's knockout round. */
function otherMatches(game: Game, ref: RoundRef): Array<{ homeTeamId: string; awayTeamId: string; result?: MatchResult & { penalties?: { home: number; away: number } } }> {
  const season = game.season
  if (!season || ref.friendly) return []
  const isUser = (m: { homeTeamId: string; awayTeamId: string }) => m.homeTeamId === USER_TEAM || m.awayTeamId === USER_TEAM
  if (ref.competition === 'league') return season.fixtures.filter((f) => f.matchweek === ref.matchweek && !isUser(f))
  const c = season.continental
  if (ref.competition === 'continental' && c?.groups) {
    // Engine 7: the other group matches of the matchday, or the other legs of the midweek (each from its own sides)
    const groupMatches = c.groups.flatMap((g) => g.matches.filter((m) => m.matchweek === ref.matchweek && !isUser(m)))
    if (groupMatches.length) return groupMatches
    return c.ties.flatMap((t) => {
      const leg = legAt(t, ref.matchweek)
      if (!leg || isUser(t)) return []
      const result = leg.leg === 1 ? t.firstLeg?.result : t.result
      const pens = leg.leg === 2 && t.agg?.pens ? { home: t.agg.pens.away, away: t.agg.pens.home } : t.agg?.pens
      return [{ homeTeamId: leg.homeTeamId, awayTeamId: leg.awayTeamId, ...(result ? { result: leg.leg !== 1 && pens ? { ...result, penalties: pens } : result } : {}) }]
    })
  }
  const ties: CupTie[] = tiesOf(season, ref.competition)
  const own = ref.cupTieIndex !== undefined ? ties[ref.cupTieIndex] : undefined
  const round = own?.round ?? ties.find((t) => t.afterMatchweek === ref.matchweek && isUser(t))?.round
  if (!round) return []
  return ties.filter((t) => t.round === round && t !== own && !isUser(t))
}

function goalsOf(result: MatchResult | undefined): LatestScore['goals'] {
  if (!result) return []
  return result.events.filter((e) => GOAL_TYPES.has(e.type)).map((e) => ({ minute: e.minute, side: e.side, scorer: e.type === 'own_goal' ? (e.playerName ? `${e.playerName} (og)` : undefined) : e.playerName })).sort((a, b) => a.minute - b.minute)
}

/**
 * The round's other matches at the user's minute: the goals scored by then,
 * half time while the user's match stands at the break, all of them and full
 * time (with penalties in a knockout) once the user's match is `final`.
 */
export function latestScores(game: Game, u: LoadedUniverse, ref: RoundRef, minute: number, final: boolean): LatestScore[] {
  return otherMatches(game, ref).map((m) => {
    const all = goalsOf(m.result)
    const goals = final ? all : all.filter((g) => g.minute <= minute)
    const h = teamLabel(game, u, m.homeTeamId)
    const a = teamLabel(game, u, m.awayTeamId)
    const status: LatestScore['status'] = !m.result ? 'pre' : final ? 'FT' : minute <= 0 ? 'pre' : minute === 45 ? 'HT' : 'live'
    return {
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      homeName: h.name,
      awayName: a.name,
      homeCode: h.code,
      awayCode: a.code,
      home: goals.filter((g) => g.side === 'home').length,
      away: goals.filter((g) => g.side === 'away').length,
      status,
      goals,
      ...(final && m.result?.penalties ? { penalties: m.result.penalties } : {}),
    }
  })
}

/** The league table before the round (a league match) or as it stands (a knockout round). */
export function roundTable(game: Game, ref: RoundRef): TableRow[] {
  const season = game.season
  if (!season) return []
  const fixtures = ref.competition === 'league' ? season.fixtures.filter((f) => f.matchweek < ref.matchweek) : season.fixtures
  return computeTable(fixtures, teamIds(game), season.carryIn)
}

function scoreOnly(homeTeamId: string, awayTeamId: string, home: number, away: number): MatchResult {
  return { homeTeamId, awayTeamId, homeGoals: home, awayGoals: away, events: [], homeStats: [], awayStats: [], xg: { home: 0, away: 0 } }
}

/**
 * The league table as it stands at the user's minute: every match of the
 * round counts for points and goals from the first minute at its current score (P only once it ends), the user's at
 * `userScore` (the user's match, home side first); movement against the table before the round. A knockout round
 * shows the league table as it stands, without arrows; a friendly has none.
 */
export function liveTable(game: Game, u: LoadedUniverse, ref: RoundRef, minute: number, userScore: { home: number; away: number }, userIsHome: boolean, final: boolean): LiveTableRow[] | null {
  const season = game.season
  if (!season || ref.friendly) return null
  const before = roundTable(game, ref)
  const label = (r: TableRow, i: number, previous: number, playing: boolean): LiveTableRow => {
    const l = teamLabel(game, u, r.teamId)
    const position = i + 1
    return { ...r, position, previous, movement: ref.competition === 'league' ? (Math.sign(previous - position) as -1 | 0 | 1) : 0, playing, name: l.name, code: l.code, isUser: r.teamId === USER_TEAM }
  }
  if (ref.competition !== 'league') return before.map((r, i) => label(r, i, i + 1, false))
  const prevPos = new Map(before.map((r, i) => [r.teamId, i + 1]))
  const round = season.fixtures.filter((f) => f.matchweek === ref.matchweek)
  const counted: Fixture[] = season.fixtures.filter((f) => f.matchweek < ref.matchweek && f.result)
  const inRound = new Set<string>()
  if (minute >= 1 || final) {
    const others = new Map(latestScores(game, u, ref, minute, final).map((s) => [`${s.homeTeamId}|${s.awayTeamId}`, s]))
    for (const f of round) {
      // The user's match at its score (home side first, as the match is), the others as revealed
      const isUser = (userIsHome ? f.homeTeamId : f.awayTeamId) === USER_TEAM
      const s = isUser ? userScore : others.get(`${f.homeTeamId}|${f.awayTeamId}`)
      if (!s) continue
      counted.push({ ...f, result: scoreOnly(f.homeTeamId, f.awayTeamId, s.home, s.away) })
      inRound.add(f.homeTeamId)
      inRound.add(f.awayTeamId)
    }
  }
  const table = computeTable(counted, teamIds(game), season.carryIn)
  // Points and goal difference as it stands, but P counts finished games: a match in play is not a game played yet
  // (at 1' the whole round read P 1)
  return table.map((r, i) => {
    const playing = !final && inRound.has(r.teamId)
    const row = label(r, i, prevPos.get(r.teamId) ?? i + 1, playing)
    return playing ? { ...row, played: row.played - 1 } : row
  })
}
