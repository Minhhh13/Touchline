import type { Attributes, AttributeKey, PlayerSeason, Position, PositionGroup } from './types'

export const POSITIONS: readonly Position[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST']

export const POSITION_GROUP: Record<Position, PositionGroup> = {
  GK: 'GK',
  CB: 'DEF',
  LB: 'DEF',
  RB: 'DEF',
  DM: 'MID',
  CM: 'MID',
  AM: 'MID',
  LW: 'ATT',
  RW: 'ATT',
  ST: 'ATT',
}

export const POSITION_LABEL: Record<Position, string> = {
  GK: 'Goalkeeper',
  CB: 'Centre-back',
  LB: 'Left-back',
  RB: 'Right-back',
  DM: 'Defensive midfielder',
  CM: 'Central midfielder',
  AM: 'Attacking midfielder',
  LW: 'Left winger',
  RW: 'Right winger',
  ST: 'Striker',
}

/**
 * How much each attribute contributes to a player's rating in a given position.
 * Weights are normalised at use, so they only need to be relative.
 */
export const POSITION_WEIGHTS: Record<Position, Partial<Record<AttributeKey, number>>> = {
  GK: { goalkeeping: 0.7, mentality: 0.12, physical: 0.1, passing: 0.08 },
  CB: { defending: 0.42, physical: 0.22, mentality: 0.14, pace: 0.12, passing: 0.1 },
  LB: { defending: 0.3, pace: 0.24, physical: 0.14, passing: 0.12, dribbling: 0.1, mentality: 0.1 },
  RB: { defending: 0.3, pace: 0.24, physical: 0.14, passing: 0.12, dribbling: 0.1, mentality: 0.1 },
  DM: { defending: 0.3, passing: 0.22, mentality: 0.2, physical: 0.18, dribbling: 0.1 },
  CM: { passing: 0.3, mentality: 0.2, dribbling: 0.15, defending: 0.13, physical: 0.12, shooting: 0.1 },
  AM: { passing: 0.26, dribbling: 0.24, shooting: 0.2, mentality: 0.16, pace: 0.14 },
  LW: { pace: 0.26, dribbling: 0.26, shooting: 0.18, passing: 0.16, mentality: 0.14 },
  RW: { pace: 0.26, dribbling: 0.26, shooting: 0.18, passing: 0.16, mentality: 0.14 },
  ST: { shooting: 0.38, pace: 0.18, physical: 0.16, dribbling: 0.14, mentality: 0.14 },
}

/**
 * Position fitness multipliers when a player is used outside their natural slot.
 * Natural position = 1.0. Values below reflect how transferable the skills are.
 * Anything not listed is "unsuited" (see UNSUITED_FACTOR).
 */
const RELATED: Record<Position, Partial<Record<Position, number>>> = {
  GK: {},
  CB: { DM: 0.88, LB: 0.86, RB: 0.86 },
  LB: { RB: 0.9, CB: 0.86, LW: 0.84, DM: 0.82 },
  RB: { LB: 0.9, CB: 0.86, RW: 0.84, DM: 0.82 },
  DM: { CM: 0.93, CB: 0.86, LB: 0.8, RB: 0.8 },
  CM: { DM: 0.92, AM: 0.9, LW: 0.8, RW: 0.8 },
  AM: { CM: 0.9, LW: 0.88, RW: 0.88, ST: 0.86 },
  LW: { RW: 0.94, AM: 0.9, ST: 0.86, LB: 0.78, CM: 0.78 },
  RW: { LW: 0.94, AM: 0.9, ST: 0.86, RB: 0.78, CM: 0.78 },
  ST: { LW: 0.88, RW: 0.88, AM: 0.86 },
}

export const UNSUITED_FACTOR = 0.62
/** Outfield players in goal (or keepers outfield) are a disaster. */
export const WRONG_GROUP_GK_FACTOR = 0.35

export type Fit = 'natural' | 'accomplished' | 'awkward' | 'unsuited'

/** The lowest position factor that still counts as accomplished cover (`canCover`'s default and auto-pick's first pass). */
export const ACCOMPLISHED_FACTOR = 0.86

/** Multiplier applied to a player's rating when playing `position`. */
export function positionFactor(player: Pick<PlayerSeason, 'positions'>, position: Position): number {
  if (player.positions.includes(position)) return 1
  let best = 0
  for (const natural of player.positions) {
    if ((natural === 'GK') !== (position === 'GK')) {
      best = Math.max(best, WRONG_GROUP_GK_FACTOR)
      continue
    }
    const f = RELATED[natural]?.[position] ?? UNSUITED_FACTOR
    best = Math.max(best, f)
  }
  return best
}

export function describeFit(player: Pick<PlayerSeason, 'positions'>, position: Position): Fit {
  const f = positionFactor(player, position)
  if (f >= 1) return 'natural'
  if (f >= ACCOMPLISHED_FACTOR) return 'accomplished'
  if (f >= 0.75) return 'awkward'
  return 'unsuited'
}

/** Raw rating of a set of attributes if played at `position`, ignoring fit. */
export function rateAttributesAt(attrs: Attributes, position: Position): number {
  const weights = POSITION_WEIGHTS[position]
  let total = 0
  let sum = 0
  for (const key in weights) {
    const w = weights[key as AttributeKey] ?? 0
    total += w
    sum += w * attrs[key as AttributeKey]
  }
  return total > 0 ? sum / total : 0
}

/** Effective rating of a player at a position, including position fit. */
export function ratingAt(player: Pick<PlayerSeason, 'positions' | 'attributes'>, position: Position): number {
  return rateAttributesAt(player.attributes, position) * positionFactor(player, position)
}

/** Rating at the player's primary position. */
export function overallOf(player: Pick<PlayerSeason, 'positions' | 'attributes'>): number {
  return Math.round(rateAttributesAt(player.attributes, player.positions[0]))
}

/** Fits from best to worst. */
export const FIT_ORDER: Fit[] = ['natural', 'accomplished', 'awkward', 'unsuited']

/** The best of several fits. */
export function bestFit(fits: Fit[]): Fit | undefined {
  return [...fits].sort((a, b) => FIT_ORDER.indexOf(a) - FIT_ORDER.indexOf(b))[0]
}

/** Can a player reasonably fill a slot? Natural or accomplished only, by default. */
export function canCover(
  player: Pick<PlayerSeason, 'positions'>,
  position: Position,
  minimum: Fit = 'accomplished',
): boolean {
  const fit = describeFit(player, position)
  return FIT_ORDER.indexOf(fit) <= FIT_ORDER.indexOf(minimum)
}

export function groupOf(position: Position): PositionGroup {
  return POSITION_GROUP[position]
}
