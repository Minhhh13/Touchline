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

/**
 * The "Where does he play?" chips in the order a player reads them: the slots he fits first, then the ones he only
 * covers, each group in the formation's order (a stable partition, so a winger offered LW, ST and RW leads with ST).
 * Display only: the choices are the logic's own (`draftSlotChoices`), none added or dropped. Pure.
 */
export function fitsFirst<T extends { fit: string }>(choices: readonly T[]): T[] {
  return [...choices.filter((c) => c.fit === 'fits'), ...choices.filter((c) => c.fit !== 'fits')]
}

/** A slot's label as a chip's first word: "left CM" reads "Left CM" (the label comes from the bundled `slotSheet.ts`, left as it is). Pure. */
export function slotLabelText(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1)
}
