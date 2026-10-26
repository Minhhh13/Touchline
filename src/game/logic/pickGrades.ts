/**
 * Pick grades for a finished draft (draft-preserving: it only reads the draft log). Each XI pick is graded A to D by
 * his rating in the slot he was drafted into (`inSlotRating`: the number on his pitch disc and the headline of the
 * Draft's slot chips, so the recap and the pitch agree) against the best play his spin offered for the slots still
 * open (`pickGrades`), leaving out players already drafted by then. Every man is rated as the draft rated him (`get`: under Prime ratings at his
 * career best), so the pick and the rest of his squad compare like with like. Display only: nothing about spins,
 * picks or power-ups changes.
 */
import type { DraftRules, DraftState } from '@engine/draft'
import { isIcons } from '@engine/icons'
import type { LoadedUniverse } from '@engine/universe'
import type { PlayerSeason, Position } from '@engine/types'
import { discRating } from './slotSheet'

export type PickGrade = 'A' | 'B' | 'C' | 'D'

/**
 * A man's rating in a slot as the recap, the pick grades and the Hindsight XI count it: the pitch disc's number
 * (`discRating`, his overall less the out-of-position cost; `slotRating.ts`), so a recap's "84 at CB" is the 84 on
 * his disc there.
 */
export function inSlotRating(p: Pick<PlayerSeason, 'overall' | 'positions'>, position: Position): number {
  return discRating(p, position)
}

/**
 * XI rating points a pick left on the table for each grade (`GradedPick.left`): none (the best play, or level with it)
 * an A, up to 2 a B, up to 4 a C, more a D. Calibrated in round 5 over seeded drafts (`docs/GAME_DESIGN.md`): the
 * assistant's draft (the highest rating who fits, spin by spin) averages a B, a pick at random from what fits a D.
 */
export function gradeFor(left: number): PickGrade {
  return left <= 0 ? 'A' : left <= 2 ? 'B' : left <= 4 ? 'C' : 'D'
}

export interface GradedPick {
  /** Index of the spin in the draft history. */
  spin: number
  pickedId: string
  slotId: string
  /** His rating in the slot you put him in (`inSlotRating`, the pitch disc's number). */
  rating: number
  /** The best play on this spin: the man (and the open slot, `bestSlotId`) that would have made the XI strongest. */
  best: number
  bestName: string
  bestSlotId: string
  /**
   * XI rating points the pick left on the table (0 or more): the best XI the open slots could still hold from this spin
   * and the ones after it, against the best with your man in your slot. The grade is `gradeFor(left)`.
   */
  left: number
  grade: PickGrade
}

type DraftLog = Pick<DraftState, 'history' | 'formation'> & { rules?: Pick<DraftRules, 'budget' | 'chain' | 'draftMode' | 'modes'> }

/**
 * Grades for every XI pick with a slot, in spin order (bench picks, re-spins and the Icons case are not graded).
 *
 * Each pick is measured against what its spin offered: the best man the spun squad held for any slot still open, valued
 * the way the Hindsight XI search values it, by how strong an XI the open slots could still be from this spin and the
 * spins that came after it (an exact search over the open slot sets, the later spins each filling one slot with their
 * best man there). `left` is how many XI rating points your man in your slot gave away against the best play; taking
 * the highest rating who fits is not always the best play, when a later spin would have filled that slot as well and
 * this one held the better man for another. Under Position First and in Crazy (a slot fixed before the spin) and under
 * the salary cap or the teammate chain (the spins could not be rearranged freely) only the slot you filled counts:
 * `left` is then the gap to the best man the spin held there. Pure, no draws; it only reads the draft log.
 */
export function pickGrades(u: LoadedUniverse, d: DraftLog, get: (id: string) => PlayerSeason | undefined): GradedPick[] {
  const slots = d.formation.slots
  const spins: Array<{ spin: number; picked: PlayerSeason; slot: number; best: Array<{ p: PlayerSeason; r: number }> }> = []
  const taken = new Set<string>()
  d.history.forEach((h, spin) => {
    const picked = h.pickedId ? get(h.pickedId) : undefined
    const slot = h.slotId ? slots.findIndex((s) => s.id === h.slotId) : -1
    if (picked && slot >= 0 && !isIcons(h)) {
      // Every man as the draft rated him (`get`: Prime ratings, an upgrade), as the man you took is, so like meets like
      const pool = (u.clubSeasonByKey[`${h.clubId}@${h.season}`]?.squad ?? []).filter((p) => p.id === picked.id || !taken.has(p.playerId)).map((p) => (p.id === picked.id ? picked : get(p.id) ?? p))
      if (!pool.some((p) => p.id === picked.id)) pool.push(picked)
      // The best man of this spin in each slot: the rating, then your own pick, then squad order
      const best = slots.map((sl) => {
        let top = { p: picked, r: inSlotRating(picked, sl.position) }
        for (const p of pool) {
          const r = inSlotRating(p, sl.position)
          if (r > top.r) top = { p, r }
        }
        return top
      })
      spins.push({ spin, picked, slot, best })
    }
    if (picked) taken.add(picked.playerId)
  })
  // The slots the graded spins filled, in the order the spins filled them (an Icon's slot is not in play)
  const n = spins.length
  const fixed = !!d.rules && (d.rules.budget !== undefined || !!d.rules.chain || d.rules.draftMode === 'position' || !!d.rules.modes?.includes('crazy'))
  const bit = new Map(spins.map((x, i) => [x.slot, i]))
  const free = !fixed && bit.size === n && n <= 15
  // after[mask]: the best total the last popcount(mask) graded spins make in the slots of mask, each with its best man
  const after = new Array<number>(free ? 1 << n : 1).fill(-Infinity)
  after[0] = 0
  if (free)
    for (let mask = 1; mask < 1 << n; mask++) {
      let p = 0
      for (let m = mask; m; m &= m - 1) p++
      const x = spins[n - p]
      for (let j = 0; j < n; j++) if (mask & (1 << j)) after[mask] = Math.max(after[mask], x.best[spins[j].slot].r + after[mask & ~(1 << j)])
    }
  const out: GradedPick[] = []
  let open = (1 << n) - 1
  for (const x of spins) {
    const rating = inSlotRating(x.picked, slots[x.slot].position)
    const mine = bit.get(x.slot)!
    let play = { j: mine, value: x.best[x.slot].r + (free ? after[open & ~(1 << mine)] : 0) }
    if (free)
      for (let j = 0; j < n; j++) {
        if (!(open & (1 << j)) || j === mine) continue
        const value = x.best[spins[j].slot].r + after[open & ~(1 << j)]
        if (value > play.value) play = { j, value }
      }
    const yours = rating + (free ? after[open & ~(1 << mine)] : 0)
    const left = Math.max(0, play.value - yours)
    // Level with the best play: the play is yours
    const bestAt = left === 0 ? { p: x.picked, r: rating, slot: x.slot } : { ...x.best[spins[play.j].slot], slot: spins[play.j].slot }
    out.push({ spin: x.spin, pickedId: x.picked.id, slotId: slots[x.slot].id, rating, best: bestAt.r, bestName: bestAt.p.name, bestSlotId: slots[bestAt.slot].id, left, grade: gradeFor(left) })
    open &= ~(1 << mine)
  }
  return out
}

/** A graded pick in a line, for the pick's tooltip: his number in his slot and, short of the best play, what it was. */
export function gradeNote(g: GradedPick, slotName: (slotId: string) => string): string {
  const own = `${g.rating} at ${slotName(g.slotId)}`
  if (g.left <= 0) return `${own}: the best play on that spin`
  return `${own}; the best play on that spin was ${g.bestName}, ${g.best} at ${slotName(g.bestSlotId)} (${g.left} XI ${g.left === 1 ? 'point' : 'points'} left)`
}

/** The pick to boast about: the best grade, then the highest rating, earliest first. */
export function bestPick(grades: GradedPick[]): GradedPick | null {
  const order: Record<PickGrade, number> = { A: 0, B: 1, C: 2, D: 3 }
  return [...grades].sort((a, b) => order[a.grade] - order[b.grade] || b.rating - a.rating || a.spin - b.spin)[0] ?? null
}
