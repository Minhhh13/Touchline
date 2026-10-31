/**
 * The squad planner: depth at every position (natural players and
 * accomplished cover), who is next in behind the XI, the ages, the positions
 * that need a signing, and a contracts overview (years left, wage, squad
 * status, who runs out this season). Pure and RNG-free.
 */
import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { Position } from '@engine/types'
import { getFormation } from '@engine/formations'
import { canCover, ratingAt } from '@engine/positions'
import { STATUS_LABEL, type SquadStatus } from '@engine/status'
import { isAvailable, squadPlayers } from './players'
import { statusOf } from './week'

export const PLANNER_POSITIONS: Position[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST']
/** A position needs a signing with fewer natural players than this. */
export const MIN_NATURALS = 2
/** Every natural player at a position this age or older: it is ageing. */
export const AGEING = 30

export interface PlannerPlayer {
  id: string
  name: string
  age: number
  /** His rating at this position. */
  rating: number
  natural: boolean
  inXI: boolean
  available: boolean
}

export interface PlannerRow {
  position: Position
  /** The position is in the current formation. */
  used: boolean
  /** Starters at this position in the XI. */
  starters: PlannerPlayer[]
  /** Everyone who can play there (natural or accomplished), best first. */
  depth: PlannerPlayer[]
  /** The best available player outside the XI who can cover it: who is next in. */
  next: PlannerPlayer | null
  naturals: number
  /** Why the position needs a signing, when it does (formation positions only). */
  need: string | null
}

export function squadPlanner(game: Game, u: LoadedUniverse): PlannerRow[] {
  const formation = getFormation(game.tactics.formationId)
  const squad = squadPlayers(game, u)
  const contracts = game.contracts
  return PLANNER_POSITIONS.map((position) => {
    const slots = formation.slots.filter((sl) => sl.position === position)
    const starterIds = new Set(slots.map((sl) => game.lineup[sl.id]).filter((id): id is string => !!id))
    const depth: PlannerPlayer[] = squad
      .filter((x) => canCover(x.p, position, 'accomplished'))
      .map((x) => ({ id: x.p.id, name: x.p.name, age: x.p.age, rating: Math.round(ratingAt(x.p, position)), natural: x.p.positions.includes(position), inXI: starterIds.has(x.p.id), available: isAvailable(x.s) }))
      .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))
    const xi = new Set(Object.values(game.lineup))
    const next = depth.find((d) => !xi.has(d.id) && d.available) ?? null
    const naturalOnes = depth.filter((d) => d.natural)
    let need: string | null = null
    if (slots.length) {
      const wanted = Math.max(MIN_NATURALS, slots.length + 1)
      if (naturalOnes.length === 0) need = 'No natural'
      else if (naturalOnes.length < wanted) need = `${naturalOnes.length} natural for ${slots.length} place${slots.length === 1 ? '' : 's'}`
      else if (naturalOnes.every((d) => d.age >= AGEING)) need = `All ${AGEING} or older`
      else if (naturalOnes.every((d) => (contracts[d.id]?.years ?? 1) <= 1 && !contracts[d.id]?.renewed)) need = 'All out of contract'
    }
    return { position, used: slots.length > 0, starters: depth.filter((d) => d.inXI), depth, next, naturals: naturalOnes.length, need }
  })
}

export interface ContractRow {
  id: string
  name: string
  age: number
  position: Position
  /** Seasons left including this one. */
  years: number
  /** GBP thousands a week. */
  wage: number
  status: SquadStatus
  statusLabel: string
  loan: boolean
  renewed: boolean
  declined: boolean
  /** Dynasty pre-season: his contract ran out and talks are open until the opener. */
  outOfContract: boolean
  /** Leaves at the end of this season unless renewed. */
  expiring: boolean
}

export interface ContractsOverview {
  rows: ContractRow[]
  expiring: number
  /** Weekly wages that come off the bill in the summer (expiring and loans), GBP thousands. */
  wagesLeaving: number
  /** Weekly wages committed beyond this season, GBP thousands. */
  wagesCommitted: number
}

/** Contracts soonest to run out first, then the biggest wages. */
export function contractsOverview(game: Game, u: LoadedUniverse): ContractsOverview {
  const rows: ContractRow[] = squadPlayers(game, u).map(({ p }) => {
    const c = game.contracts[p.id]
    const years = c?.years ?? 1
    const loan = !!c?.loan
    const renewed = !!c?.renewed
    const declined = !!c?.declined
    const outOfContract = !!c?.expired
    const status = statusOf(game, p.id)
    return { id: p.id, name: p.name, age: p.age, position: p.positions[0], years, wage: p.wage, status, statusLabel: STATUS_LABEL[status], loan, renewed, declined, outOfContract, expiring: loan || declined || (years <= 1 && !renewed) }
  })
  rows.sort((a, b) => Number(b.expiring) - Number(a.expiring) || a.years - b.years || b.wage - a.wage || a.id.localeCompare(b.id))
  const leaving = rows.filter((r) => r.expiring)
  return {
    rows,
    expiring: leaving.length,
    wagesLeaving: leaving.reduce((a, r) => a + r.wage, 0),
    wagesCommitted: rows.filter((r) => !r.expiring).reduce((a, r) => a + r.wage, 0),
  }
}
