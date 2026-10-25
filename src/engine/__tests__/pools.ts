import type { LoadedUniverse } from '../universe'
import { teamInputFromPool, type MatchTeamInput } from '../match'
import { tacticsForStyle } from '../tactics'
import type { PlayerSeason, PlayStyle } from '../types'

/** Best distinct players per position within an overall band, so every slot has a natural fit (the match tests' pools). */
export function bestXIpool(all: PlayerSeason[], minOverall: number, maxOverall: number): PlayerSeason[] {
  const seen = new Set<string>()
  const pool: PlayerSeason[] = []
  const perPos: Record<string, number> = { GK: 2, CB: 4, LB: 2, RB: 2, DM: 2, CM: 3, AM: 2, LW: 2, RW: 2, ST: 3 }
  const sorted = all.filter((p) => p.overall >= minOverall && p.overall <= maxOverall).sort((a, b) => b.overall - a.overall)
  for (const pos of Object.keys(perPos)) {
    let n = 0
    for (const p of sorted) {
      if (n >= perPos[pos]) break
      if (seen.has(p.playerId) || p.positions[0] !== pos) continue
      seen.add(p.playerId)
      pool.push(p)
      n++
    }
  }
  return pool
}

export interface Sides {
  home: MatchTeamInput
  away: MatchTeamInput
}

/** A factory of fresh sides for match `i`: three strength bands and a rotation of styles and shapes. */
export function sidesFactory(u: LoadedUniverse): (i: number, styles?: { home?: PlayStyle; away?: PlayStyle }) => Sides {
  const all = Object.values(u.index)
  const pools = [bestXIpool(all, 86, 99), bestXIpool(all, 72, 76), bestXIpool(all, 62, 66)]
  const rotation: PlayStyle[] = ['balanced', 'press', 'counter', 'defensive']
  const shapes = ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2', '4-1-4-1', '5-3-2', '3-4-3', '4-4-2-diamond']
  return (i, styles = {}) => ({
    home: teamInputFromPool('H', 'Home', 'HOM', tacticsForStyle(styles.home ?? rotation[i % 4], shapes[i % shapes.length]), pools[i % 3]),
    away: teamInputFromPool('A', 'Away', 'AWA', tacticsForStyle(styles.away ?? rotation[(i >> 2) % 4], shapes[(i + 3) % shapes.length]), pools[(i + 1) % 3]),
  })
}
