import { eligibleSlots, type DraftState } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { canCover, describeFit, positionFactor, ratingAt, type Fit } from '@engine/positions'
import type { Formation, FormationSlot, PlayerSeason, Position, SquadPlayer } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import type { Game } from '../types'
import { isAvailable, playerLookup, squadPlayers } from './players'

/**
 * The slot picker: tapping a pitch slot in the Dugout lists everyone who can play
 * there. Cover is `canCover(p, position, 'accomplished')`, the same line auto-pick's
 * first pass draws (ACCOMPLISHED_FACTOR); availability is `isAvailable`, the test
 * auto-pick filters on and `lineupProblems` reports (injured or suspended).
 */

export type Whereabouts = { kind: 'starting'; slotId: string; position: Position } | { kind: 'bench' } | { kind: 'unused' }

export interface SlotOption {
  p: PlayerSeason
  s: SquadPlayer
  fit: Fit
  /** `ratingAt` there: attributes weighted for the position, times the fit factor. The list is sorted by it. */
  rating: number
  /** The number his pitch disc would show in that slot. */
  disc: number
  where: Whereabouts
  /** Why he cannot be picked: lineupProblems would flag him. */
  unavailable?: 'injured' | 'suspended'
}

export interface SlotSheetData {
  slot: FormationSlot
  /** 'RW', or 'left CB' when the formation has more than one of that position. */
  label: string
  occupant?: SlotOption
  /** Natural and accomplished cover, best first. */
  cover: SlotOption[]
  /** Awkward or unsuited fits (the pitch's awk.), best penalised rating first. */
  outOfPosition: SlotOption[]
}

/** The rating on a pitch disc: the player's overall times his fit factor in that position. */
export function discRating(p: Pick<PlayerSeason, 'overall' | 'positions'>, position: Position): number {
  return Math.round(p.overall * positionFactor(p, position))
}

/** A slot's name for the picker: the position, with left, centre or right when the shape repeats it. */
export function slotLabel(formation: Formation, slot: FormationSlot): string {
  const same = formation.slots.filter((s) => s.position === slot.position).sort((a, b) => a.x - b.x)
  if (same.length < 2) return slot.position
  const i = same.findIndex((s) => s.id === slot.id)
  const sides = same.length === 2 ? ['left', 'right'] : same.length === 3 ? ['left', 'centre', 'right'] : same.map((_, k) => `#${k + 1}`)
  return `${sides[i]} ${slot.position}`
}

export function unavailableReason(s: SquadPlayer): SlotOption['unavailable'] {
  if (isAvailable(s)) return undefined
  return s.injury ? 'injured' : 'suspended'
}

export function whereabouts(game: Game, id: string): Whereabouts {
  const formation = getFormation(game.tactics.formationId)
  const slot = formation.slots.find((sl) => game.lineup[sl.id] === id)
  if (slot) return { kind: 'starting', slotId: slot.id, position: slot.position }
  return game.bench.includes(id) ? { kind: 'bench' } : { kind: 'unused' }
}

export function whereaboutsLabel(w: Whereabouts): string {
  return w.kind === 'starting' ? `Starting at ${w.position}` : w.kind === 'bench' ? 'Bench' : 'Unused'
}

/** Everyone in the squad, rated in the slot, split into cover and out of position. Null for a slot the shape does not have. */
export function slotSheet(game: Game, u: LoadedUniverse, slotId: string): SlotSheetData | null {
  const formation = getFormation(game.tactics.formationId)
  const slot = formation.slots.find((s) => s.id === slotId)
  if (!slot) return null
  const option = ({ p, s }: { p: PlayerSeason; s: SquadPlayer }): SlotOption => {
    const why = unavailableReason(s)
    return { p, s, fit: describeFit(p, slot.position), rating: ratingAt(p, slot.position), disc: discRating(p, slot.position), where: whereabouts(game, p.id), ...(why ? { unavailable: why } : {}) }
  }
  const occupantId = game.lineup[slot.id]
  const all = squadPlayers(game, u)
  const occ = all.find((x) => x.p.id === occupantId)
  const best = (a: SlotOption, b: SlotOption) => b.rating - a.rating || b.disc - a.disc || a.p.name.localeCompare(b.p.name)
  const others = all.filter((x) => x.p.id !== occupantId).map(option)
  return {
    slot,
    label: slotLabel(formation, slot),
    ...(occ ? { occupant: option(occ) } : {}),
    cover: others.filter((o) => canCover(o.p, slot.position, 'accomplished')).sort(best),
    outOfPosition: others.filter((o) => !canCover(o.p, slot.position, 'accomplished')).sort(best),
  }
}

/** Particles that belong to a surname: De Bruyne, van Dijk, da Silva. */
const PARTICLES = new Set(['de', 'van', 'von', 'der', 'den', 'da', 'das', 'do', 'dos', 'di', 'del', 'della', 'du', 'le', 'la', 'ter', 'ten', 'mac', 'st.'])

/** The name a toast uses: the last word with any particles before it ('Saka', 'De Bruyne'). */
export function surname(name: string): string {
  const words = name.trim().split(/\s+/)
  let i = words.length - 1
  while (i > 0 && PARTICLES.has(words[i - 1].toLowerCase())) i--
  return words.slice(i).join(' ')
}

/**
 * What `assignPlayer(game, u, id, slotId)` is about to do, in words, read before it runs:
 * 'Saka in at RW, Bowen to the bench', or 'Saka in at RW, Bowen to CM' when the two swap.
 */
export function assignmentNote(game: Game, u: LoadedUniverse, id: string, slotId: string | 'bench'): string {
  const get = playerLookup(game, u)
  const p = get(id)
  if (!p) return ''
  const formation = getFormation(game.tactics.formationId)
  const from = whereabouts(game, id)
  const name = surname(p.name)
  if (slotId === 'bench') return from.kind === 'starting' ? `${name} to the bench, ${from.position} is empty` : `${name} to the bench`
  const slot = formation.slots.find((s) => s.id === slotId)
  if (!slot) return ''
  const label = slotLabel(formation, slot)
  if (from.kind === 'starting' && from.slotId === slotId) return `${name} stays at ${label}`
  const displacedId = game.lineup[slotId]
  const displaced = displacedId ? get(displacedId) : undefined
  if (displaced) return `${name} in at ${label}, ${surname(displaced.name)} ${from.kind === 'starting' ? `to ${slotLabel(formation, formation.slots.find((s) => s.id === from.slotId)!)}` : 'to the bench'}`
  return from.kind === 'starting' ? `${name} in at ${label}, ${slotLabel(formation, formation.slots.find((s) => s.id === from.slotId)!)} is empty` : `${name} in at ${label}`
}

export interface DraftSlotChoice {
  slotId: string
  label: string
  position: Position
  /** Math.round(ratingAt) in that position. */
  rating: number
  fit: 'fits' | 'can cover'
}

/** The inline chips in the Draft for a player with several open slots: exactly `eligibleSlots`, so every chip is a pick the draft accepts. */
export function draftSlotChoices(d: DraftState, p: PlayerSeason): DraftSlotChoice[] {
  return eligibleSlots(d, p).map((s) => ({ slotId: s.id, label: slotLabel(d.formation, s), position: s.position, rating: Math.round(ratingAt(p, s.position)), fit: describeFit(p, s.position) === 'natural' ? 'fits' : 'can cover' }))
}
