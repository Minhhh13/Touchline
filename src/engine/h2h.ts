/**
 * Head-to-head hot-seat draft: two managers on one device draft from the same
 * spins. Picks alternate in snake order, a player can be drafted by only one
 * of them, and a manager with nothing usable on a spin simply misses out.
 */
import type { ClubSeason, Formation, PlayerSeason } from './types'
import type { Rng } from './rng'
import type { LoadedUniverse } from './universe'
import { canUse, eligibleSlots, isComplete, newDraft, pick, wheelPool, type DraftRules, type DraftState } from './draft'

export interface H2HDraft {
  drafts: [DraftState, DraftState]
  /** Index of the manager who picks first on the current spin. */
  first: 0 | 1
  /** Index of the manager whose pick it is now, or null when waiting for a spin. */
  picking: 0 | 1 | null
  current: { clubId: string; season: number } | null
  /** Picks made on the current spin. */
  picksThisSpin: number
  spins: number
  log: string[]
}

export function newH2HDraft(formations: [Formation, Formation], rules: DraftRules): H2HDraft {
  return { drafts: [newDraft(formations[0], rules), newDraft(formations[1], rules)], first: 0, picking: null, current: null, picksThisSpin: 0, spins: 0, log: [] }
}

export function h2hComplete(h: H2HDraft): boolean {
  return isComplete(h.drafts[0]) && isComplete(h.drafts[1])
}

function activeManagers(h: H2HDraft): Array<0 | 1> {
  const out: Array<0 | 1> = []
  if (!isComplete(h.drafts[0])) out.push(0)
  if (!isComplete(h.drafts[1])) out.push(1)
  return out
}

/** The pool a head-to-head spin draws from: club-seasons useful to everyone still drafting, else the first picker's wheel. */
function h2hPool(u: LoadedUniverse, h: H2HDraft, active: Array<0 | 1>, firstIdx: 0 | 1): ClubSeason[] {
  const pools = active.map((i) => wheelPool(u, h.drafts[i]))
  const both = pools.length === 2 ? pools[0].filter((cs) => pools[1].some((x) => x.clubId === cs.clubId && x.season === cs.season)) : pools[0]
  return both.length ? both : pools[active.indexOf(firstIdx)]
}

/** A club-season's weight within its season on a head-to-head spin: stronger sides a little more. */
export function h2hWeight(cs: ClubSeason): number {
  return cs.position > 0 ? 1 + 0.06 * (21 - cs.position) : 1.6
}

/** The exact chance of each club-season on the next head-to-head spin: a season uniformly, then `h2hWeight`. Empty once the draft is complete. No RNG. */
export function h2hSpinOdds(u: LoadedUniverse, h: H2HDraft): Array<{ cs: ClubSeason; p: number }> {
  const active = activeManagers(h)
  if (!active.length) return []
  const pool = h2hPool(u, h, active, active.includes(h.first) ? h.first : active[0])
  const seasons = [...new Set(pool.map((cs) => cs.season))]
  const out: Array<{ cs: ClubSeason; p: number }> = []
  for (const season of seasons) {
    const inSeason = pool.filter((cs) => cs.season === season)
    const total = inSeason.reduce((a, cs) => a + h2hWeight(cs), 0)
    for (const cs of inSeason) out.push({ cs, p: h2hWeight(cs) / total / seasons.length })
  }
  return out
}

/** Spin for both managers: prefer club-seasons useful to everyone still drafting. */
export function h2hSpin(u: LoadedUniverse, h: H2HDraft, rng: Rng): ClubSeason {
  const active = activeManagers(h)
  if (!active.length) throw new Error('Draft complete')
  const firstIdx = active.includes(h.first) ? h.first : active[0]
  const pool = h2hPool(u, h, active, firstIdx)
  const seasons = [...new Set(pool.map((cs) => cs.season))]
  const season = rng.pick(seasons)
  const inSeason = pool.filter((cs) => cs.season === season)
  const chosen = rng.pickWeighted(inSeason, h2hWeight)
  h.current = { clubId: chosen.clubId, season: chosen.season }
  for (const d of h.drafts) {
    d.current = { ...h.current }
    d.spins++
  }
  h.spins++
  h.picksThisSpin = 0
  h.picking = firstIdx
  h.log.push(`Spin ${h.spins}: ${u.clubById[chosen.clubId]?.name ?? chosen.clubId} ${chosen.season}-${String((chosen.season + 1) % 100).padStart(2, '0')}. ${firstIdx === 0 ? 'Manager 1' : 'Manager 2'} picks first.`)
  skipIfStuck(u, h)
  return chosen
}

/** Players the current picker could take from the current squad. */
export function h2hUsable(u: LoadedUniverse, h: H2HDraft): PlayerSeason[] {
  if (h.picking === null || !h.current) return []
  const cs = u.clubSeasonByKey[`${h.current.clubId}@${h.current.season}`]
  if (!cs) return []
  const d = h.drafts[h.picking]
  return cs.squad.filter((p) => canUse(d, p))
}

/** If the current picker has nothing usable, they miss the spin. */
function skipIfStuck(u: LoadedUniverse, h: H2HDraft): void {
  let guard = 0
  while (h.picking !== null && guard++ < 3) {
    const d = h.drafts[h.picking]
    if (isComplete(d) || h2hUsable(u, h).length === 0) {
      if (!isComplete(d)) h.log.push(`${h.picking === 0 ? 'Manager 1' : 'Manager 2'} has no eligible player here and misses out.`)
      advanceTurn(h)
    } else break
  }
}

function advanceTurn(h: H2HDraft): void {
  h.picksThisSpin++
  if (h.picksThisSpin >= 2) {
    // Spin over: snake order flips.
    h.picking = null
    h.current = null
    for (const d of h.drafts) d.current = null
    h.first = h.first === 0 ? 1 : 0
    return
  }
  const other: 0 | 1 = h.picking === 0 ? 1 : 0
  h.picking = isComplete(h.drafts[other]) ? null : other
  if (h.picking === null) {
    h.current = null
    for (const d of h.drafts) d.current = null
    h.first = h.first === 0 ? 1 : 0
  }
}

export function h2hPick(u: LoadedUniverse, h: H2HDraft, playerSeasonId: string, slotId: string | 'bench'): void {
  if (h.picking === null) throw new Error('Spin first')
  const me = h.picking
  const d = h.drafts[me]
  const p = u.index[playerSeasonId]
  if (!p) throw new Error('Unknown player')
  pick(u, d, playerSeasonId, slotId)
  // The other manager cannot take the same human.
  const other = h.drafts[me === 0 ? 1 : 0]
  if (!other.takenPlayers.includes(p.playerId)) other.takenPlayers.push(p.playerId)
  // `pick` cleared d.current; restore for the second picker's sake.
  d.current = h.current ? { ...h.current } : null
  h.log.push(`${me === 0 ? 'Manager 1' : 'Manager 2'} drafts ${p.name}.`)
  advanceTurn(h)
  if (h.picking !== null) skipIfStuck(u, h)
}

export function h2hEligibleSlots(h: H2HDraft, p: PlayerSeason) {
  if (h.picking === null) return []
  return eligibleSlots(h.drafts[h.picking], p)
}

/** Auto-pick for the current manager (used by "let the assistant pick"). */
export function h2hAutoPick(u: LoadedUniverse, h: H2HDraft): void {
  if (h.picking === null) return
  const usable = h2hUsable(u, h).sort((a, b) => b.overall - a.overall)
  const d = h.drafts[h.picking]
  for (const p of usable) {
    const slots = eligibleSlots(d, p)
    if (slots.length) {
      h2hPick(u, h, p.id, slots[0].id)
      return
    }
    if (!slots.length && isComplete(d) === false && Object.keys(d.lineup).length >= d.formation.slots.length) {
      h2hPick(u, h, p.id, 'bench')
      return
    }
  }
}
