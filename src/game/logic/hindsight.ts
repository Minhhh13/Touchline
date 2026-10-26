/**
 * The Hindsight XI on the draft recap: the best XI the same spins could have given, had you known every spin in
 * advance. Each XI spin (the club-seasons you drafted a starter from) fills one of the slots you filled, with the man
 * from that squad who rates best there, and the spins are matched to the slots to make the XI's total the highest it
 * can be (an exact search over the 2^11 slot sets, no draws). A man drafted from two spins is used once.
 *
 * It reads the draft log the way `pickGrades` does (the same squads, the same rating in a slot). Your own slots, each
 * with its spin's best man, are always one of the XIs it weighs, so the Hindsight XI is never below yours. Pure and draft-preserving: nothing about a seed moves.
 * A draft under the salary cap or the teammate chain has no hindsight (the same spins could not be rearranged freely).
 */
import type { DraftRules, DraftState } from '@engine/draft'
import { isIcons } from '@engine/icons'
import { ratingAt } from '@engine/positions'
import type { LoadedUniverse } from '@engine/universe'
import type { PlayerSeason } from '@engine/types'

export interface HindsightPick {
  /** The spin (index in the draft history) the man comes from. */
  spin: number
  slotId: string
  /** The player-season id. */
  id: string
  name: string
  /** His rating in the slot, rounded as the pick grades show it. */
  rating: number
  /** The man you drafted into this slot, from the same spin. */
  yours: boolean
}

export interface Hindsight {
  /** In the formation's slot order. */
  xi: HindsightPick[]
  /** The Hindsight XI's mean rating in its slots, one decimal. */
  rating: number
  /** Your XI's mean rating in the slots you drafted, one decimal (the recap's "XI in its slots"). */
  yours: number
  /** `rating - yours`, one decimal; 0 when you made the best of every spin. */
  gap: number
  /** How many of the Hindsight XI are your own picks in your own slots. */
  kept: number
}

type DraftLog = Pick<DraftState, 'history' | 'formation'> & { rules?: Pick<DraftRules, 'budget' | 'chain'> }

const round1 = (x: number) => Math.round(x * 10) / 10

/** The best XI the same spins could have given, or null with nothing to rearrange (fewer than two XI spins, a cap or a chain). */
export function hindsightXI(u: LoadedUniverse, d: DraftLog, get: (id: string) => PlayerSeason | undefined): Hindsight | null {
  if (d.rules?.budget !== undefined || d.rules?.chain) return null
  // The XI spins, in order: the squad you drafted a starter from, and that starter
  const spins: Array<{ spin: number; squad: PlayerSeason[]; picked: PlayerSeason; slotId: string }> = []
  d.history.forEach((h, spin) => {
    const picked = h.pickedId ? get(h.pickedId) : undefined
    if (!picked || !h.slotId || isIcons(h) || !d.formation.slots.some((s) => s.id === h.slotId)) return
    // Each man as the draft rated him (Prime ratings, an upgrade), as `get` resolves the man you took
    const squad = (u.clubSeasonByKey[`${h.clubId}@${h.season}`]?.squad ?? []).map((p) => (p.id === picked.id ? picked : get(p.id) ?? p))
    if (!squad.some((p) => p.id === picked.id)) squad.push(picked)
    spins.push({ spin, squad, picked, slotId: h.slotId })
  })
  const slots = d.formation.slots.filter((s) => spins.some((x) => x.slotId === s.id))
  const n = spins.length
  if (n < 2 || slots.length !== n) return null

  const banned: Array<Set<string>> = spins.map(() => new Set())
  for (let round = 0; round <= n; round++) {
    // The best man of each spin in each slot: rating first, then your own pick, then squad order
    const best = spins.map((x, i) =>
      slots.map((sl) => {
        let top: { p: PlayerSeason; r: number } | null = null
        for (const p of x.squad) {
          if (banned[i].has(p.playerId)) continue
          const r = Math.round(ratingAt(p, sl.position))
          if (!top || r > top.r || (r === top.r && p.id === x.picked.id && sl.id === x.slotId)) top = { p, r }
        }
        return top
      }),
    )
    // Weight: the rating, with a tie going to the assignment that keeps more of your picks where you put them
    const weight = (i: number, j: number) => {
      const b = best[i][j]
      if (!b) return -Infinity
      return b.r * 100 + (b.p.id === spins[i].picked.id && slots[j].id === spins[i].slotId ? 1 : 0)
    }
    // dp[mask]: the best total with spins 0..popcount(mask)-1 placed in the slots of mask
    const size = 1 << n
    const dp = new Array<number>(size).fill(-Infinity)
    const from = new Array<number>(size).fill(-1)
    dp[0] = 0
    for (let mask = 0; mask < size; mask++) {
      if (dp[mask] === -Infinity) continue
      let i = 0
      for (let m = mask; m; m &= m - 1) i++
      if (i >= n) continue
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) continue
        const w = weight(i, j)
        if (w === -Infinity) continue
        const next = mask | (1 << j)
        if (dp[mask] + w > dp[next]) {
          dp[next] = dp[mask] + w
          from[next] = j
        }
      }
    }
    if (dp[size - 1] === -Infinity) return null
    // Walk back: the last slot added holds the last spin
    const slotOf = new Array<number>(n)
    for (let mask = size - 1, i = n - 1; mask; i--) {
      const j = from[mask]
      slotOf[i] = j
      mask &= ~(1 << j)
    }
    // A man on two of the spun squads can play once: ban him from one spin (never the spin you drafted him from, so
    // your own XI stays possible and the Hindsight XI never falls below it) and search again
    const seen = new Map<string, number>()
    let clash = false
    for (let i = 0; i < n; i++) {
      const p = best[i][slotOf[i]]!.p
      const k = seen.get(p.playerId)
      if (k === undefined) {
        seen.set(p.playerId, i)
        continue
      }
      banned[spins[i].picked.playerId === p.playerId ? k : i].add(p.playerId)
      clash = true
    }
    if (clash) continue
    const picks: HindsightPick[] = spins.map((x, i) => {
      const b = best[i][slotOf[i]]!
      const slotId = slots[slotOf[i]].id
      return { spin: x.spin, slotId, id: b.p.id, name: b.p.name, rating: b.r, yours: b.p.id === x.picked.id && slotId === x.slotId }
    })
    const order = new Map(d.formation.slots.map((s, k) => [s.id, k]))
    picks.sort((a, b) => (order.get(a.slotId) ?? 0) - (order.get(b.slotId) ?? 0))
    const rating = round1(picks.reduce((s, p) => s + p.rating, 0) / n)
    const yours = round1(spins.reduce((s, x) => s + Math.round(ratingAt(x.picked, slots.find((sl) => sl.id === x.slotId)!.position)), 0) / n)
    return { xi: picks, rating, yours, gap: round1(rating - yours), kept: picks.filter((p) => p.yours).length }
  }
  return null
}
