/**
 * In-season development. Every five matchweeks young players who are playing
 * grow a little, veterans fade a little, and a good coach speeds the former.
 * The dynasty summer (`ageOneYear`) still does the big yearly step.
 */
import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { Rng } from '@engine/rng'
import type { PlayerSeason } from '@engine/types'
import { overallOf } from '@engine/positions'
import { staffTier } from '@engine/staff'
import { playerLookup } from './players'

export const DEVELOPMENT_INTERVAL = 5

export interface DevelopmentChange {
  id: string
  name: string
  from: number
  to: number
}

/** Expected growth per block for a player of this age who played every minute. */
export function growthRate(age: number): number {
  if (age <= 20) return 0.9
  if (age <= 23) return 0.55
  if (age <= 26) return 0.2
  if (age <= 29) return 0
  if (age <= 32) return -0.15
  return -0.3
}

export function developSquad(game: Game, u: LoadedUniverse, rng: Rng): DevelopmentChange[] {
  const get = playerLookup(game, u)
  const dev = (game.development ??= {})
  const coach = staffTier(game.staff, 'coach')
  const changes: DevelopmentChange[] = []
  for (const [id, s] of Object.entries(game.squad)) {
    const p = get(id)
    if (!p) continue
    const seen = dev[id] ?? { minutes: 0, base: p.overall }
    const played = Math.max(0, s.seasonStats.minutes - seen.minutes)
    dev[id] = { minutes: s.seasonStats.minutes, base: seen.base }
    const share = Math.min(1, played / (DEVELOPMENT_INTERVAL * 90))
    let delta = growthRate(p.age)
    if (delta > 0) {
      delta *= Math.sqrt(share) * (1 + 0.25 * coach)
      const potential = p.overall + Math.max(0, 27 - p.age) * 1.3
      delta = Math.min(delta, Math.max(0, potential - p.overall))
    }
    if (delta === 0) continue
    const next = applyDelta(p, delta, rng)
    if (next.overall === p.overall && sameAttributes(next, p)) continue
    game.customPlayers[id] = next
    if (next.overall !== p.overall) changes.push({ id, name: p.name, from: p.overall, to: next.overall })
  }
  return changes
}

function sameAttributes(a: PlayerSeason, b: PlayerSeason): boolean {
  return (Object.keys(a.attributes) as Array<keyof PlayerSeason['attributes']>).every((k) => a.attributes[k] === b.attributes[k])
}

function applyDelta(p: PlayerSeason, delta: number, rng: Rng): PlayerSeason {
  const attrs = { ...p.attributes }
  const isGk = p.positions[0] === 'GK'
  const keys: Array<keyof typeof attrs> = isGk ? ['goalkeeping', 'mentality', 'passing', 'physical', 'stamina', 'strength', 'jumping'] : ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'mentality', 'stamina', 'strength', 'jumping', 'aggression', 'workRate']
  for (const k of keys) {
    // Probabilistic rounding keeps fractional growth honest over the season
    const step = Math.floor(delta + rng.next() * 0.999)
    // The legs go first when a veteran fades: pace, physical and stamina lose a little extra
    const extra = delta < 0 && (k === 'pace' || k === 'physical' || k === 'stamina') ? -Math.floor(0.3 + rng.next()) : 0
    attrs[k] = Math.max(1, Math.min(99, attrs[k] + step + extra))
  }
  const next: PlayerSeason = { ...p, attributes: attrs, overall: 0 }
  next.overall = overallOf(next)
  if (next.overall !== p.overall) {
    next.value = Math.round(p.value * Math.pow(1.21, next.overall - p.overall) * 10) / 10
  }
  return next
}
