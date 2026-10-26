/**
 * A manager's edge on the drafted XI, for the manager spin's guide and Squad complete: the same `managerBoost` the quick
 * season applies through `quickManagerBoost` (`managers.ts`), in per cent. Its own module so the season's code, which
 * the ranked boards' verifier bundles, stays byte for byte as it was. Pure, no draws.
 */
import type { Game } from '../types'
import type { PlayerSeason } from '@engine/types'
import { managerBoost, suitsStyle, YOUTH_AGE, type ManagerStyle } from '@engine/managers'

/** A manager's edge on this XI, as the season would apply it: per cent on the side's own expected goals and on the opponent's. */
export interface ManagerEdge {
  /** Per cent on the side's goals, one decimal: +3.0 is 3% more. */
  attack: number
  /** Per cent on the goals it concedes, one decimal: -1.0 is 1% fewer. */
  defence: number
  /** Whether the current team instructions suit the style (the edge grows when they do). */
  suits: boolean
  /** Starters aged 23 or under (what a youth manager feeds on). */
  young: number
  xi: number
}

const pct = (m: number) => Math.round((m - 1) * 1000) / 10

/**
 * What a manager of this style would do for the game's XI and team instructions (`managerBoost`, the same numbers the
 * quick season uses through `quickManagerBoost`), so the manager spin and Squad complete can show the lift of each
 * option before it is picked. Pure, no draws.
 */
export function managerEdge(game: Pick<Game, 'lineup' | 'tactics'>, style: ManagerStyle, get: (id: string) => PlayerSeason | undefined): ManagerEdge {
  const xi = Object.values(game.lineup)
    .map((id) => get(id))
    .filter((p): p is PlayerSeason => !!p)
  const b = managerBoost(style, game.tactics, xi)
  return { attack: pct(b.attack), defence: pct(b.defence), suits: suitsStyle(style, game.tactics), young: xi.filter((p) => p.age <= YOUTH_AGE).length, xi: xi.length }
}

const signed = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(1)}%`

/** The edge in words: "+3.0% goals · −1.0% conceded". */
export function edgeLine(e: Pick<ManagerEdge, 'attack' | 'defence'>): string {
  return `${signed(e.attack)} goals · ${signed(e.defence)} conceded`
}

/**
 * What this XI and these instructions add to a style's line (`MANAGER_STYLE_HELP` already says what suits each): how
 * many young starters a youth manager has to work with, or that the instructions suit him. Null when there is nothing
 * to add.
 */
export function edgeHint(style: ManagerStyle, e: ManagerEdge): string | null {
  if (style === 'youth') return `${e.young} of your ${e.xi} starters are ${YOUTH_AGE} or under`
  return e.suits ? 'Your team instructions suit him' : null
}
