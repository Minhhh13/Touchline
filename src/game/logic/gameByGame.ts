import type { Fixture, MatchEvent } from '@engine/types'
import { computeTable, positionOf } from '@engine/season'
import type { QuickGameResult, QuickScorer } from '../types'

const GOAL_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal'])

/**
 * The user's games of a simulated season, game by game: score, scorers and the
 * league position after each matchweek. Pure bookkeeping over fixtures that
 * already carry their results, so it never touches the RNG; the table is
 * computed once per matchweek, not per fixture.
 */
export function recordUserGames(fixtures: Fixture[], teamIds: string[], userId: string, nameOf: (playerSeasonId: string) => string | undefined): QuickGameResult[] {
  const played = fixtures.filter((f) => f.result)
  const mine = played.filter((f) => f.homeTeamId === userId || f.awayTeamId === userId).sort((a, b) => a.matchweek - b.matchweek)
  const positions = new Map<number, number>()
  for (const f of mine) {
    if (positions.has(f.matchweek)) continue
    const table = computeTable(played.filter((x) => x.matchweek <= f.matchweek), teamIds)
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

/** Milliseconds between two games of the season playback at 1x: 38 games in about 27 seconds. */
export const PLAYBACK_STEP_MS = 700
/** The playback speeds offered: 1x (700 ms a game), 2x (350 ms) and 4x (175 ms). */
export const PLAYBACK_SPEEDS = [1, 2, 4] as const
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

/** Milliseconds between two games at a speed. */
export function playbackDelay(speed: PlaybackSpeed): number {
  return PLAYBACK_STEP_MS / speed
}

/** One tick of the playback: one more game revealed, never past `stopAt` (the January pause) or the last game. */
export function nextReveal(revealed: number, total: number, stopAt = total): number {
  const cap = Math.min(total, Math.max(0, stopAt))
  return revealed >= cap ? revealed : Math.min(cap, revealed + 1)
}

export interface PlaybackFrame {
  /** Games shown, from the first. */
  revealed: number
  /** The game just revealed, null before the first. */
  latest: QuickGameResult | null
  /** The running record over the games shown. */
  totals: RunningTotals
  /** Nothing more to reveal before `stopAt`. */
  done: boolean
}

/** What the playback shows after `revealed` games: the latest game and the running totals over every game so far. */
export function playbackFrame(results: QuickGameResult[], revealed: number, stopAt = results.length): PlaybackFrame {
  const n = Math.max(0, Math.min(revealed, results.length))
  return { revealed: n, latest: n ? results[n - 1] : null, totals: foldResults(results, n), done: n >= Math.min(results.length, stopAt) }
}

/** "January: signed Rice (£45M), Fernandes out" or "January: swapped Fernandes for Rice", for the share text. */
export function januaryLine(j: { kind: 'sign' | 'swap'; inName: string; outName: string; fee: number } | undefined): string | null {
  if (!j) return null
  return j.kind === 'sign' ? `January: signed ${shortName(j.inName)} (£${j.fee}M), ${shortName(j.outName)} out` : `January: swapped ${shortName(j.outName)} for ${shortName(j.inName)}`
}

const EURO_ROUND: Record<'R16' | 'QF' | 'SF' | 'F' | 'W', string> = { R16: 'round of 16', QF: 'quarter-finals', SF: 'semi-finals', F: 'final', W: 'winners' }

/** "🌍 Continental Cup winners" or "🌍 Continental Cup: semi-finals", for the share text. */
export function europeLine(e: { reached: 'R16' | 'QF' | 'SF' | 'F' | 'W' } | undefined): string | null {
  if (!e) return null
  return e.reached === 'W' ? '🌍 Continental Cup winners' : `🌍 Continental Cup: ${EURO_ROUND[e.reached]}`
}

export function europeRoundLabel(r: 'R16' | 'QF' | 'SF' | 'F' | 'W'): string {
  return EURO_ROUND[r]
}
