import type { PlayerSeason, Position, SquadPlayer } from '@engine/types'
import { USER_TEAM, type SeasonState } from '@engine/season'

/**
 * The Stats tab's sortable tables (display only, pure, no RNG): every player's season numbers in the league (the
 * user's squad and every AI club's) and every side's team numbers from the league results. Only the score of a
 * result is read (`compact.ts`: an older result keeps its score), so a compacted save gives the same tables.
 */

export interface PlayerStatRow {
  id: string
  teamId: string
  mine: boolean
  name: string
  position: Position
  overall: number
  apps: number
  starts: number
  minutes: number
  goals: number
  assists: number
  /** Goals and assists. */
  ga: number
  /** Average match rating, null without an appearance. */
  avg: number | null
  motm: number
  /** Keepers only; null for an outfielder. */
  cleanSheets: number | null
  /** Goals and assists per 90 minutes, null under 90 minutes. */
  per90: number | null
}

export type PlayerStatKey = 'name' | 'team' | 'position' | 'apps' | 'minutes' | 'goals' | 'assists' | 'ga' | 'avg' | 'motm' | 'cleanSheets' | 'per90'

/** Every man with an appearance (and all of the user's squad), from the squad and AI states. */
export function playerStatRows(squad: Record<string, SquadPlayer>, season: Pick<SeasonState, 'ai'>, get: (id: string) => PlayerSeason | undefined): PlayerStatRow[] {
  const out: PlayerStatRow[] = []
  const add = (id: string, teamId: string, s: SquadPlayer) => {
    const p = get(id)
    if (!p) return
    const st = s.seasonStats
    const gk = p.positions[0] === 'GK'
    out.push({
      id,
      teamId,
      mine: teamId === USER_TEAM,
      name: p.name,
      position: p.positions[0],
      overall: p.overall,
      apps: st.apps,
      starts: st.starts,
      minutes: st.minutes,
      goals: st.goals,
      assists: st.assists,
      ga: st.goals + st.assists,
      avg: st.apps ? st.ratingSum / st.apps : null,
      motm: st.motm,
      cleanSheets: gk ? st.cleanSheets : null,
      per90: st.minutes >= 90 ? ((st.goals + st.assists) * 90) / st.minutes : null,
    })
  }
  for (const [id, s] of Object.entries(squad)) add(id, USER_TEAM, s)
  for (const club of Object.values(season.ai)) for (const [id, s] of Object.entries(club.state)) if (s.seasonStats.apps > 0) add(id, club.id, s)
  return out
}

/** Text columns sort A to Z; numbers high first. `reverse` flips it. A missing figure (null) always sorts last. */
export function sortPlayerStats(rows: PlayerStatRow[], key: PlayerStatKey, reverse = false, teamName: (id: string) => string = (id) => id): PlayerStatRow[] {
  const text = key === 'name' || key === 'team' || key === 'position'
  const dir = reverse ? -1 : 1
  const value = (r: PlayerStatRow): string | number | null => (key === 'team' ? teamName(r.teamId) : r[key])
  return [...rows].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va === null || vb === null) return va === vb ? tie(a, b) : va === null ? 1 : -1
    const c = text ? String(va).localeCompare(String(vb)) : (vb as number) - (va as number)
    return dir * c || tie(a, b)
  })
}

const tie = (a: PlayerStatRow, b: PlayerStatRow) => b.minutes - a.minutes || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

export interface Record3 {
  won: number
  drawn: number
  lost: number
}

export interface TeamStatRow {
  teamId: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  points: number
  cleanSheets: number
  failedToScore: number
  home: Record3 & { goalsFor: number; goalsAgainst: number }
  away: Record3 & { goalsFor: number; goalsAgainst: number }
  /** Average goals scored and conceded a game, 0 before a game. */
  forPerGame: number
  againstPerGame: number
  /** The biggest win's margin, 0 without a win. */
  biggestWin: number
}

export type TeamStatKey = 'points' | 'played' | 'won' | 'drawn' | 'lost' | 'goalsFor' | 'goalsAgainst' | 'goalDiff' | 'cleanSheets' | 'failedToScore' | 'homePoints' | 'awayPoints'

const blank = () => ({ won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 })

/**
 * Every side's numbers from the league fixtures played this season (a run-in counts only the games after the
 * takeover, as the results hold them). Ordered by points, goal difference, goals scored, then id.
 */
export function teamStatRows(season: Pick<SeasonState, 'fixtures' | 'ai'>): TeamStatRow[] {
  const by = new Map<string, TeamStatRow>()
  const row = (teamId: string): TeamStatRow => {
    let r = by.get(teamId)
    if (!r) {
      r = { teamId, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0, cleanSheets: 0, failedToScore: 0, home: blank(), away: blank(), forPerGame: 0, againstPerGame: 0, biggestWin: 0 }
      by.set(teamId, r)
    }
    return r
  }
  for (const id of [USER_TEAM, ...Object.keys(season.ai)]) row(id)
  for (const f of season.fixtures) {
    if (!f.result) continue
    const sides: Array<[string, number, number, 'home' | 'away']> = [
      [f.homeTeamId, f.result.homeGoals, f.result.awayGoals, 'home'],
      [f.awayTeamId, f.result.awayGoals, f.result.homeGoals, 'away'],
    ]
    for (const [teamId, gf, ga, venue] of sides) {
      const r = row(teamId)
      const v = r[venue]
      r.played++
      r.goalsFor += gf
      r.goalsAgainst += ga
      v.goalsFor += gf
      v.goalsAgainst += ga
      if (gf > ga) {
        r.won++
        v.won++
        r.biggestWin = Math.max(r.biggestWin, gf - ga)
      } else if (gf === ga) {
        r.drawn++
        v.drawn++
      } else {
        r.lost++
        v.lost++
      }
      if (ga === 0) r.cleanSheets++
      if (gf === 0) r.failedToScore++
    }
  }
  const rows = [...by.values()]
  for (const r of rows) {
    r.points = 3 * r.won + r.drawn
    r.goalDiff = r.goalsFor - r.goalsAgainst
    r.forPerGame = r.played ? r.goalsFor / r.played : 0
    r.againstPerGame = r.played ? r.goalsAgainst / r.played : 0
  }
  return rows.sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor || a.teamId.localeCompare(b.teamId))
}

/** The figure a team column sorts by. */
export function teamStatValue(r: TeamStatRow, key: TeamStatKey): number {
  switch (key) {
    case 'homePoints':
      return 3 * r.home.won + r.home.drawn
    case 'awayPoints':
      return 3 * r.away.won + r.away.drawn
    default:
      return r[key]
  }
}

/** Where fewer is better: goals conceded, defeats, games without a goal. */
export const LOWER_IS_BETTER: ReadonlySet<TeamStatKey> = new Set<TeamStatKey>(['goalsAgainst', 'lost', 'failedToScore'])

/** Best first for the column (fewest first where fewer is better); `reverse` flips it. Ties keep the table order. */
export function sortTeamStats(rows: TeamStatRow[], key: TeamStatKey, reverse = false): TeamStatRow[] {
  const sign = (LOWER_IS_BETTER.has(key) ? 1 : -1) * (reverse ? -1 : 1)
  return rows.map((r, i) => ({ r, i })).sort((a, b) => sign * (teamStatValue(a.r, key) - teamStatValue(b.r, key)) || a.i - b.i).map((x) => x.r)
}

/** A side's rank in the league for one figure (1 = best; equals share a rank). */
export function teamRank(rows: TeamStatRow[], teamId: string, key: TeamStatKey): number {
  const me = rows.find((r) => r.teamId === teamId)
  if (!me) return 0
  const v = teamStatValue(me, key)
  const lower = LOWER_IS_BETTER.has(key)
  return 1 + rows.filter((r) => (lower ? teamStatValue(r, key) < v : teamStatValue(r, key) > v)).length
}
