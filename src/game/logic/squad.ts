import { staffWages } from '@engine/staff'
import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { getFormation } from '@engine/formations'
import { autoPickLineup, computeTeamStrength } from '@engine/ratings'
import { retargetRoles } from '@engine/tactics'
import { isAvailable, playerLookup, squadPlayers } from './players'
import { logMorale } from './happiness'
import type { Lineup } from '@engine/types'
import { STATUS_RANK, WAGE_MULT, type SquadStatus } from '@engine/status'

/** Fill the lineup with the best available players; keeps existing valid picks when `keep` is true. */
export function autoPick(game: Game, u: LoadedUniverse, keep = false): void {
  const get = playerLookup(game, u)
  const formation = getFormation(game.tactics.formationId)
  const pool = squadPlayers(game, u).map((x) => x.p)
  const getState = (id: string) => game.squad[id]
  if (!keep) {
    const { lineup, bench } = autoPickLineup(formation, pool, game.tactics, (p) => isAvailable(game.squad[p.id]), getState)
    game.lineup = lineup
    game.bench = bench
    return
  }
  // Keep valid existing picks, fill the gaps.
  const lineup: Lineup = {}
  const used = new Set<string>()
  for (const slot of formation.slots) {
    const id = game.lineup[slot.id]
    if (id && get(id) && isAvailable(game.squad[id]) && !used.has(id)) {
      lineup[slot.id] = id
      used.add(id)
    }
  }
  const remainingPool = pool.filter((p) => !used.has(p.id))
  const { lineup: fill } = autoPickLineup({ ...formation, slots: formation.slots.filter((s) => !lineup[s.id]) }, remainingPool, game.tactics, (p) => isAvailable(game.squad[p.id]), getState)
  Object.assign(lineup, fill)
  game.lineup = lineup
  const inXI = new Set(Object.values(lineup))
  game.bench = pool
    .filter((p) => !inXI.has(p.id) && isAvailable(game.squad[p.id]))
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 9)
    .map((p) => p.id)
}

/** Validate the lineup before a match; returns problems (empty when fine). */
export function lineupProblems(game: Game, u: LoadedUniverse): string[] {
  const get = playerLookup(game, u)
  const formation = getFormation(game.tactics.formationId)
  const problems: string[] = []
  const seen = new Set<string>()
  for (const slot of formation.slots) {
    const id = game.lineup[slot.id]
    if (!id || !get(id)) {
      problems.push(`${slot.position} slot is empty`)
      continue
    }
    if (seen.has(id)) problems.push(`${get(id)!.name} is picked twice`)
    seen.add(id)
    const s = game.squad[id]
    if (s?.injury) problems.push(`${get(id)!.name} is injured (${s.injury.weeksOut} wk)`)
    if (s && s.suspension > 0) problems.push(`${get(id)!.name} is suspended`)
  }
  return problems
}

export function setFormation(game: Game, u: LoadedUniverse, formationId: string): void {
  if (formationId === game.tactics.formationId) return
  game.tactics = retargetRoles(game.tactics, formationId)
  // Tactical familiarity dips when the shape changes mid-season.
  if (game.phase === 'week' && game.season && game.season.matchweek > 0) {
    for (const s of Object.values(game.squad)) s.familiarity = Math.max(0, s.familiarity - 12)
  }
  autoPick(game, u, true)
}

/** Put a player into a slot (swapping with whoever was there) or onto the bench. */
export function assignPlayer(game: Game, u: LoadedUniverse, playerSeasonId: string, slotId: string | 'bench'): void {
  const get = playerLookup(game, u)
  if (!get(playerSeasonId) || !game.squad[playerSeasonId]) return
  const currentSlot = Object.keys(game.lineup).find((k) => game.lineup[k] === playerSeasonId)
  if (slotId === 'bench') {
    if (currentSlot) delete game.lineup[currentSlot]
    if (!game.bench.includes(playerSeasonId)) game.bench.push(playerSeasonId)
    return
  }
  const displaced = game.lineup[slotId]
  if (currentSlot) {
    if (displaced) game.lineup[currentSlot] = displaced
    else delete game.lineup[currentSlot]
  } else if (displaced) {
    if (!game.bench.includes(displaced)) game.bench.push(displaced)
  }
  game.lineup[slotId] = playerSeasonId
  game.bench = game.bench.filter((id) => id !== playerSeasonId)
}

export function teamStrength(game: Game, u: LoadedUniverse) {
  const get = playerLookup(game, u)
  return computeTeamStrength(game.tactics, game.lineup, get, (id) => game.squad[id])
}

/** Weekly wage bill in GBP thousands: players plus backroom staff. */
export function squadWages(game: Game, u: LoadedUniverse): number {
  return squadPlayers(game, u).reduce((s, x) => s + x.p.wage, 0) + staffWages(game.staff)
}

/**
 * Change a player's squad status from the Club tab. A promotion lifts his
 * morale 6 and his wage by the ratio of the two status multipliers; a demotion
 * costs 6 morale and leaves the wage where it is (contracts do not go down).
 */
export function setSquadStatus(game: Game, u: LoadedUniverse, playerSeasonId: string, status: SquadStatus): void {
  const c = game.contracts[playerSeasonId]
  const s = game.squad[playerSeasonId]
  const p = playerLookup(game, u)(playerSeasonId)
  if (!c || !s || !p) return
  const from = c.status ?? 'rotation'
  if (from === status) return
  c.status = status
  const up = STATUS_RANK[status] > STATUS_RANK[from]
  const before = s.morale
  s.morale = Math.max(10, Math.min(100, s.morale + (up ? 6 : -6)))
  logMorale(s, game.season?.matchweek ?? 0, before, 'status', status)
  if (up && !c.loan) game.customPlayers[p.id] = { ...p, wage: Math.round(p.wage * (WAGE_MULT[status] / WAGE_MULT[from])) }
}
