import type { Fixture, MatchEvent } from '@engine/types'
import { computeTable, positionOf, type CarryRow } from '@engine/season'
import type { QuickGameResult, QuickScorer } from '../types'

const GOAL_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal'])

/**
 * The user's games of a simulated season, game by game: score, scorers and the
 * league position after each matchweek. Pure bookkeeping over fixtures that
 * already carry their results, so it never touches the RNG; the table is
 * computed once per matchweek, not per fixture, over the rows a run-in carried
 * in (`carryIn`).
 */
export function recordUserGames(fixtures: Fixture[], teamIds: string[], userId: string, nameOf: (playerSeasonId: string) => string | undefined, carryIn?: Record<string, CarryRow>): QuickGameResult[] {
  const played = fixtures.filter((f) => f.result)
  const mine = played.filter((f) => f.homeTeamId === userId || f.awayTeamId === userId).sort((a, b) => a.matchweek - b.matchweek)
  const positions = new Map<number, number>()
  for (const f of mine) {
    if (positions.has(f.matchweek)) continue
    const table = computeTable(played.filter((x) => x.matchweek <= f.matchweek), teamIds, carryIn)
    positions.set(f.matchweek, positionOf(table, userId))
  }
  return mine.map((f) => {
    const res = f.result!
    const home = f.homeTeamId === userId
    const side = home ? 'home' : 'away'
    const scorers: QuickScorer[] = res.events
      .filter((e) => GOAL_TYPES.has(e.type) && e.side === side)
      .sort((a, b) => a.minute - b.minute)
      .map((e) => (e.type === 'own_goal' ? { name: 'OG', minute: e.minute } : { name: (e.playerId && nameOf(e.playerId)) ?? e.playerName ?? 'Unknown', minute: e.minute, ...(e.playerId ? { playerSeasonId: e.playerId } : {}) }))
    return { matchweek: f.matchweek, opponentId: home ? f.awayTeamId : f.homeTeamId, home, gf: home ? res.homeGoals : res.awayGoals, ga: home ? res.awayGoals : res.homeGoals, scorers, position: positions.get(f.matchweek) ?? 0 }
  })
}

export type Outcome = 'W' | 'D' | 'L'

export function outcomeOf(r: Pick<QuickGameResult, 'gf' | 'ga'>): Outcome {
  return r.gf > r.ga ? 'W' : r.gf < r.ga ? 'L' : 'D'
}

export interface RunningTotals {
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  points: number
  /** League position after the last game counted, 0 before any game. */
  position: number
}

/** Fold the first `upTo` games (all of them by default) into a running record for the replay strip. */
export function foldResults(results: QuickGameResult[], upTo = results.length): RunningTotals {
  const t: RunningTotals = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, position: 0 }
  for (const r of results.slice(0, Math.max(0, upTo))) {
    t.played++
    t.goalsFor += r.gf
    t.goalsAgainst += r.ga
    const o = outcomeOf(r)
    if (o === 'W') {
      t.won++
      t.points += 3
    } else if (o === 'D') {
      t.drawn++
      t.points++
    } else t.lost++
    t.position = r.position
  }
  return t
}

/** The biggest win of the season: widest margin, then most goals scored, then the earliest matchweek. Null without a win. */
export function bestWin(results: QuickGameResult[]): QuickGameResult | null {
  let best: QuickGameResult | null = null
  for (const r of results) {
    if (r.gf <= r.ga) continue
    if (!best || r.gf - r.ga > best.gf - best.ga || (r.gf - r.ga === best.gf - best.ga && r.gf > best.gf)) best = r
  }
  return best
}

/** "Best win: 5-0 v Chelsea (MW 23)" for the share text, or null without a win. */
export function bestWinLine(results: QuickGameResult[] | undefined, nameOf: (teamId: string) => string): string | null {
  const w = results ? bestWin(results) : null
  if (!w) return null
  return `Best win: ${w.gf}-${w.ga} ${w.home ? 'v' : 'at'} ${nameOf(w.opponentId)} (MW ${w.matchweek})`
}

/** "Haaland 12', 67', OG 80'": one entry per scorer in order of his first goal, minutes grouped. */
export function scorersLabel(scorers: QuickScorer[]): string {
  const order: string[] = []
  const minutes = new Map<string, number[]>()
  for (const s of [...scorers].sort((a, b) => a.minute - b.minute)) {
    const key = s.playerSeasonId ?? s.name
    if (!minutes.has(key)) {
      order.push(key)
      minutes.set(key, [])
    }
    minutes.get(key)!.push(s.minute)
  }
  return order
    .map((key) => {
      const first = scorers.find((s) => (s.playerSeasonId ?? s.name) === key)!
      return `${shortName(first.name)} ${minutes.get(key)!.map((m) => `${m}'`).join(', ')}`
    })
    .join(' · ')
}

/** "E. Haaland" → "Haaland"; a single-word name or "OG" is kept. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name
  // Drop leading initials ("K. De Bruyne" → "De Bruyne"), keep particles
  const rest = parts.filter((p, i) => !(i < parts.length - 1 && /^[A-Z]\.?$/.test(p)))
  return rest.join(' ')
}
