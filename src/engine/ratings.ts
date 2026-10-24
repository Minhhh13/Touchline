/**
 * Team strength: turns a lineup of player-seasons (plus their live state) into
 * per-unit ratings the match engine consumes. This is where Football Manager's
 * roles, condition, morale and familiarity meet 38-0's "balance matters".
 */
import type { Formation, Lineup, PlayerSeason, Position, SquadPlayer, Tactics, TeamStrength } from './types'
import { positionFactor } from './positions'
import { DEFAULT_ROLE, getRole, type Role } from './roles'
import { getFormation } from './formations'

export interface PlayerLookup {
  (playerSeasonId: string): PlayerSeason | undefined
}
export interface StateLookup {
  (playerSeasonId: string): SquadPlayer | undefined
}

export interface SlotEvaluation {
  slotId: string
  position: Position
  player: PlayerSeason
  role: Role
  /** Rating in the role before live modifiers. */
  base: number
  /** Rating after condition, morale, sharpness, familiarity and form. */
  effective: number
  positionFactor: number
  modifiers: { condition: number; morale: number; sharpness: number; familiarity: number; form: number }
}

/** Rating of a player playing a specific role (role weights × position fit). */
export function roleRating(player: PlayerSeason, role: Role, position: Position): number {
  let total = 0
  let sum = 0
  for (const key in role.weights) {
    const k = key as keyof PlayerSeason['attributes']
    const w = role.weights[k] ?? 0
    total += w
    sum += w * player.attributes[k]
  }
  const raw = total > 0 ? sum / total : 0
  // Anchor to the player's overall so the ratings people know still mean
  // something, while the role weights decide who suits which job.
  const blended = 0.55 * player.overall + 0.45 * raw
  return blended * positionFactor(player, position)
}

export function liveModifiers(state: SquadPlayer | undefined): SlotEvaluation['modifiers'] {
  if (!state) return { condition: 1, morale: 1, sharpness: 1, familiarity: 1, form: 1 }
  const condition = state.condition >= 85 ? 1 : state.condition >= 70 ? 1 - (85 - state.condition) * 0.003 : 0.955 - (70 - state.condition) * 0.0045
  const morale = 1 + ((state.morale - 65) / 35) * 0.04
  const sharpness = state.sharpness >= 75 ? 1 : 1 - (75 - state.sharpness) * 0.0012
  const familiarity = 0.95 + (state.familiarity / 100) * 0.07
  const recent = state.recentRatings.slice(-5)
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 7
  const form = 1 + Math.max(-0.03, Math.min(0.03, (avg - 7) * 0.02))
  return { condition: round4(condition), morale: round4(morale), sharpness: round4(sharpness), familiarity: round4(familiarity), form: round4(form) }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

export function evaluateLineup(
  formation: Formation,
  lineup: Lineup,
  tactics: Tactics,
  getPlayer: PlayerLookup,
  getState: StateLookup,
): SlotEvaluation[] {
  const out: SlotEvaluation[] = []
  for (const slot of formation.slots) {
    const psId = lineup[slot.id]
    if (!psId) continue
    const player = getPlayer(psId)
    if (!player) continue
    const role = getRole(tactics.roles[slot.id] ?? DEFAULT_ROLE[slot.position])
    const base = roleRating(player, role, slot.position)
    const mods = liveModifiers(getState(psId))
    const effective = base * mods.condition * mods.morale * mods.sharpness * mods.familiarity * mods.form
    out.push({ slotId: slot.id, position: slot.position, player, role, base, effective, positionFactor: positionFactor(player, slot.position), modifiers: mods })
  }
  return out
}

/**
 * Chemistry links between the eleven. Players from the same club-season know
 * each other; same club in neighbouring seasons helps a little; shared
 * nationality a touch. Average familiarity with the system adds on top.
 */
export function chemistryOf(players: PlayerSeason[], states: Array<SquadPlayer | undefined>): { points: number; links: number; breakdown: string[] } {
  let score = 0
  let links = 0
  const breakdown: string[] = []
  const clubPairs = new Map<string, number>()
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i]
      const b = players[j]
      if (a.clubId === b.clubId) {
        const gap = Math.abs(a.season - b.season)
        if (gap === 0) {
          score += 1
          links++
          clubPairs.set(`${a.clubId}@${a.season}`, (clubPairs.get(`${a.clubId}@${a.season}`) ?? 0) + 1)
        } else if (gap <= 2) {
          score += 0.4
          links++
        }
      }
      if (a.nationality === b.nationality && a.nationality !== 'UNK') {
        score += 0.2
      }
    }
  }
  const fam = states.filter(Boolean).map((s) => s!.familiarity)
  const avgFam = fam.length ? fam.reduce((x, y) => x + y, 0) / fam.length : 50
  // 55 possible pairs. A full one-club-season XI scores 55 → cap at +2.
  const linkPoints = Math.min(1.5, (score / 55) * 5)
  const famPoints = ((avgFam - 50) / 50) * 1.2 // -1.2 .. +1.2
  const points = round2(linkPoints + famPoints)
  for (const [key, n] of [...clubPairs.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3)) breakdown.push(`${n} link${n > 1 ? 's' : ''} from ${key}`)
  return { points, links, breakdown }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Baseline share totals for a "normal" shape, used to reward or punish numbers in a unit. */
const UNIT_BASELINE = { defence: 4.0, midfield: 3.2, attack: 2.8 }

export function computeTeamStrength(
  tactics: Tactics,
  lineup: Lineup,
  getPlayer: PlayerLookup,
  getState: StateLookup,
): TeamStrength & { slots: SlotEvaluation[]; chemistryBreakdown: string[] } {
  const formation = getFormation(tactics.formationId)
  const slots = evaluateLineup(formation, lineup, tactics, getPlayer, getState)
  const players = slots.map((s) => s.player)
  const chem = chemistryOf(players, slots.map((s) => getState(s.player.id)))

  const unit = { gk: { w: 0, s: 0 }, defence: { w: 0, s: 0 }, midfield: { w: 0, s: 0 }, attack: { w: 0, s: 0 } }
  for (const s of slots) {
    const c = s.role.contribution
    const add = (k: keyof typeof unit, share: number | undefined) => {
      if (!share) return
      unit[k].w += share
      unit[k].s += share * s.effective
    }
    add('gk', c.gk)
    add('defence', c.defence)
    add('midfield', c.midfield)
    add('attack', c.attack)
  }
  const mean = (k: keyof typeof unit) => (unit[k].w > 0 ? unit[k].s / unit[k].w : 0)
  const numbers = (k: 'defence' | 'midfield' | 'attack') => {
    const ratio = unit[k].w / UNIT_BASELINE[k]
    return 0.88 + 0.12 * Math.max(0.5, Math.min(1.5, ratio))
  }
  // Missing players are catastrophic: scale by how many of the eleven are filled.
  const fill = slots.length / 11
  const gk = mean('gk') * (slots.some((s) => s.position === 'GK') ? 1 : 0.4)
  const defence = mean('defence') * numbers('defence') * fill
  const midfield = mean('midfield') * numbers('midfield') * fill
  const attack = mean('attack') * numbers('attack') * fill

  const chemistry = chem.points
  const units = [gk + chemistry, defence + chemistry, midfield + chemistry, attack + chemistry]
  const spread = Math.max(...units) - Math.min(...units)
  const balance = Math.max(0, Math.min(1, 1 - spread / 35))
  const overall = (units[0] * 0.18 + units[1] * 0.3 + units[2] * 0.26 + units[3] * 0.26) * (0.96 + 0.04 * balance)

  return {
    goalkeeping: round2(units[0]),
    defence: round2(units[1]),
    midfield: round2(units[2]),
    attack: round2(units[3]),
    balance: round2(balance),
    chemistry,
    overall: round2(overall),
    slots,
    chemistryBreakdown: chem.breakdown,
  }
}

/**
 * Pick the strongest eleven from a pool for a formation (greedy with position fit),
 * respecting availability. Used for AI clubs and the "auto-pick" button.
 */
export function autoPickLineup(
  formation: Formation,
  pool: PlayerSeason[],
  tactics: Tactics,
  isAvailable: (p: PlayerSeason) => boolean = () => true,
  getState: StateLookup = () => undefined,
): { lineup: Lineup; bench: string[] } {
  const available = pool.filter(isAvailable)
  const lineup: Lineup = {}
  const used = new Set<string>()
  // Fill the hardest-to-fill slots first: GK, then by scarcity of natural players.
  const slots = [...formation.slots].sort((a, b) => {
    const na = available.filter((p) => p.positions.includes(a.position)).length
    const nb = available.filter((p) => p.positions.includes(b.position)).length
    if (a.position === 'GK') return -1
    if (b.position === 'GK') return 1
    return na - nb
  })
  // Two passes: first natural/accomplished fits, then anything.
  for (const pass of [0.86, 0]) {
    for (const slot of slots) {
      if (lineup[slot.id]) continue
      const role = getRole(tactics.roles[slot.id] ?? DEFAULT_ROLE[slot.position])
      let best: PlayerSeason | undefined
      let bestScore = -1
      for (const p of available) {
        if (used.has(p.id)) continue
        const pf = positionFactor(p, slot.position)
        if (pf < pass) continue
        const mods = liveModifiers(getState(p.id))
        const score = roleRating(p, role, slot.position) * mods.condition * mods.sharpness
        if (score > bestScore) {
          bestScore = score
          best = p
        }
      }
      if (best) {
        lineup[slot.id] = best.id
        used.add(best.id)
      }
    }
  }
  const bench = available
    .filter((p) => !used.has(p.id))
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 9)
    .map((p) => p.id)
  return { lineup, bench }
}
