/**
 * The data hub (FM-depth Batch 2): expected goals and expected assists for the
 * user's players across the season. Every full-detail match of the user's
 * (league and cup; friendlies do not count) adds each attempt's `shotXg` to the
 * shooter and, for a goal with an assist, the same xG to the assister. Kept in
 * `game.dataHub`, outside `seasonStats`, and pure bookkeeping: no draws.
 */
import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { MatchResult } from '@engine/types'
import { isAttempt, shotXg } from '@engine/matchStats'
import { squadPlayers } from './players'
import { postNews } from './news'

/** An analyst's note lands in the inbox every this many matchweeks. */
export const ANALYST_INTERVAL = 5
/** Attempts a player needs before the analyst judges his finishing. */
export const ANALYST_MIN_SHOTS = 6

/** Add one match's attempts and assisted goals for the user's side to the data hub. */
export function recordMatchData(game: Game, res: Pick<MatchResult, 'events'>, side: 'home' | 'away'): void {
  for (const e of res.events) {
    if (e.side !== side || !isAttempt(e)) continue
    const xg = shotXg(e)
    if (e.playerId && game.squad[e.playerId]) {
      const row = ((game.dataHub ??= {})[e.playerId] ??= { xg: 0, xa: 0, shots: 0 })
      row.xg = Math.round((row.xg + xg) * 1000) / 1000
      row.shots += 1
    }
    if ((e.type === 'goal' || e.type === 'penalty') && e.secondaryId && game.squad[e.secondaryId]) {
      const row = ((game.dataHub ??= {})[e.secondaryId] ??= { xg: 0, xa: 0, shots: 0 })
      row.xa = Math.round((row.xa + xg) * 1000) / 1000
    }
  }
}

export interface DataHubRow {
  id: string
  name: string
  minutes: number
  goals: number
  assists: number
  shots: number
  xg: number
  xa: number
  /** Goals minus expected goals: above zero he finishes better than his chances. */
  finishing: number
  /** Goals and assists per 90 minutes. */
  gaPer90: number
  /** Expected goals and assists per 90 minutes. */
  xgaPer90: number
}

const r2 = (v: number) => Math.round(v * 100) / 100

/** The squad's season in numbers: per-90 figures and goals against expected goals, most involved first. */
export function dataHubRows(game: Game, u: LoadedUniverse): DataHubRow[] {
  return squadPlayers(game, u)
    .filter((x) => x.s.seasonStats.minutes > 0)
    .map((x) => {
      const d = game.dataHub?.[x.p.id] ?? { xg: 0, xa: 0, shots: 0 }
      const per90 = x.s.seasonStats.minutes / 90
      return { id: x.p.id, name: x.p.name, minutes: x.s.seasonStats.minutes, goals: x.s.seasonStats.goals, assists: x.s.seasonStats.assists, shots: d.shots, xg: r2(d.xg), xa: r2(d.xa), finishing: r2(x.s.seasonStats.goals - d.xg), gaPer90: r2((x.s.seasonStats.goals + x.s.seasonStats.assists) / per90), xgaPer90: r2((d.xg + d.xa) / per90) }
    })
    .sort((a, b) => b.xg + b.xa - (a.xg + a.xa) || b.minutes - a.minutes)
}

/** The team's numbers: goals and expected goals for the whole squad. */
export function dataHubTotals(rows: DataHubRow[]): { goals: number; xg: number; assists: number; xa: number; shots: number } {
  return rows.reduce((t, r) => ({ goals: t.goals + r.goals, xg: r2(t.xg + r.xg), assists: t.assists + r.assists, xa: r2(t.xa + r.xa), shots: t.shots + r.shots }), { goals: 0, xg: 0, assists: 0, xa: 0, shots: 0 })
}

/** The biggest over- and under-performer against expected goals, among players with enough attempts. */
export function analystPicks(rows: DataHubRow[]): { over?: DataHubRow; under?: DataHubRow } {
  const judged = rows.filter((r) => r.shots >= ANALYST_MIN_SHOTS)
  const byFinish = [...judged].sort((a, b) => b.finishing - a.finishing)
  const over = byFinish[0] && byFinish[0].finishing > 0 ? byFinish[0] : undefined
  const last = byFinish[byFinish.length - 1]
  const under = last && last.finishing < 0 && last !== over ? last : undefined
  return { over, under }
}

/** Every five matchweeks the analyst posts the biggest over- and under-performer to the inbox. */
export function analystReport(game: Game, u: LoadedUniverse): void {
  const season = game.season
  if (!season || season.matchweek === 0 || season.matchweek % ANALYST_INTERVAL !== 0) return
  const { over, under } = analystPicks(dataHubRows(game, u))
  if (!over && !under) return
  const line = (r: DataHubRow, word: string) => `${r.name} ${word}: ${r.goals} goal${r.goals === 1 ? '' : 's'} from ${r.xg.toFixed(1)} xG (${r.finishing > 0 ? '+' : ''}${r.finishing.toFixed(1)})`
  postNews(game, { matchweek: season.matchweek, kind: 'info', title: 'Analyst: finishing report', body: [over ? line(over, 'is beating his numbers') : '', under ? line(under, 'is behind his') : ''].filter(Boolean).join('. ') + '. More in the Stats tab.', playerId: (over ?? under)?.id })
}
