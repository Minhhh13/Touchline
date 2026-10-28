import { describeFit } from '@engine/positions'
import type { PlayerSeason, Position } from '@engine/types'

/**
 * A draft row's slot chips: the open positions he plays naturally (green, "fits") apart from the ones he only covers
 * (amber, "can cover"), as the first-reveal tip promises. One chip of both kinds used to read "fits CB/DM/CM" for a
 * midfielder whose CB is a cover. Positions keep the formation's order, each once. Pure.
 */
export function fitGroups(p: Pick<PlayerSeason, 'positions'>, slotPositions: Position[]): { fits: Position[]; covers: Position[] } {
  const fits: Position[] = []
  const covers: Position[] = []
  for (const pos of slotPositions) {
    if (fits.includes(pos) || covers.includes(pos)) continue
    if (describeFit(p, pos) === 'natural') fits.push(pos)
    else covers.push(pos)
  }
  return { fits, covers }
}
