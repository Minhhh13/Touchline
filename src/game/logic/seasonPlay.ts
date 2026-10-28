/**
 * The managed season's play experience (Season and Dynasty, r8): what a manager needs in front of him before he
 * presses Play matchweek, worked out from the game as it stands. The board's stakes (how close the sack is), the tired
 * starters with the fresher man for each slot, the promised start, where the side stands in its Continental Cup group
 * or what a second leg needs, and the contracts that run out this summer.
 *
 * Pure and RNG-free: the readers draw nothing, and the two actions (`restTired`, `startPromised`) only move men
 * between the XI and the bench, as the manager's own taps would. Nothing here runs unless the manager asks for it, so
 * no seeded game moves (invariant 21). Kept out of `week.ts`, `squad.ts` and the other modules the edge verifier
 * bundles: this file is display and manager actions only.
 */
import type { LoadedUniverse } from '@engine/universe'
import type { Position } from '@engine/types'
import type { Game } from '../types'
import { getFormation } from '@engine/formations'
import { DEFAULT_ROLE, getRole } from '@engine/roles'
import { liveModifiers, roleRating } from '@engine/ratings'
import { positionOf, seasonTable, USER_TEAM } from '@engine/season'
import { groupTable, tieScore } from '@engine/continental'
import { isAvailable, playerLookup } from './players'
import { assignPlayer } from './squad'
import { upcomingCupTie } from './week'

/** The board sacks a manager under this confidence (`afterMatchweek` in `week.ts`, with job security on). */
export const SACK_CONFIDENCE = 12
/** ...but only from this matchweek. */
export const SACK_FROM_MATCHWEEK = 10
/** Under this confidence the briefing says the job is at risk. */
export const BOARD_DANGER = 25
/** Under this confidence the briefing says the board is watching. */
export const BOARD_WATCH = 40
/** A starter below this condition is tired (the briefing's `BRIEFING_CONDITION`). */
export const TIRED_CONDITION = 60
/** The contract reminder starts this many matchweeks before the end of a Dynasty season. */
export const CONTRACT_REMINDER_WEEKS = 10

export type BoardLevel = 'safe' | 'watch' | 'danger'

export interface BoardStakes {
  level: BoardLevel
  confidence: number
  /** The sack falls below this confidence... */
  sackBelow: number
  /** ...from this matchweek. */
  from: number
  /** The finish the board expects, and where the side is. */
  target: number
  position: number
}

/** How safe the manager's job is, or null when the board cannot sack him (job security off, no season, season over). */
export function boardStakes(game: Game): BoardStakes | null {
  const s = game.season
  if (!s || !game.settings.jobSecurity || s.sacked || s.matchweek >= s.matchweeks || game.phase === 'preseason') return null
  const confidence = Math.round(s.confidence)
  const level: BoardLevel = confidence < BOARD_DANGER ? 'danger' : confidence < BOARD_WATCH ? 'watch' : 'safe'
  return { level, confidence, sackBelow: SACK_CONFIDENCE, from: SACK_FROM_MATCHWEEK, target: s.boardTarget, position: s.matchweek ? positionOf(seasonTable(s), USER_TEAM) : 0 }
}

const ordinal = (n: number) => {
  const v = n % 100
  const suffix = v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suffix}`
}

/** The briefing's line for the board, or null while the job is safe. */
export function boardLine(b: BoardStakes | null): string | null {
  if (!b || b.level === 'safe') return null
  const where = b.position ? `: ${ordinal(b.position)}, the target is ${ordinal(b.target)}` : ''
  if (b.level === 'danger') return `Job at risk (board confidence ${b.confidence}, sacked below ${b.sackBelow})${where}`
  return `The board is watching (confidence ${b.confidence})${where}`
}

/** One change `restTired` makes: the fresher man into the tired man's slot, the tired man to the bench. */
export interface RestSwap {
  outId: string
  inId: string
  slotId: string
  /** The slot's effective rating gained (role rating × condition × sharpness), above zero. */
  gain: number
}

/** The rating the assistant's lineup compares in a slot: the role rating there times condition and sharpness. */
function slotScore(game: Game, u: LoadedUniverse, id: string, slotId: string, position: Position): number {
  const p = playerLookup(game, u)(id)
  if (!p) return 0
  const mods = liveModifiers(game.squad[id])
  return roleRating(p, getRole(game.tactics.roles[slotId] ?? DEFAULT_ROLE[position]), position) * mods.condition * mods.sharpness
}

/** The starters below `TIRED_CONDITION` who are fit to play, tiredest first. */
export function tiredStarters(game: Game, u: LoadedUniverse): string[] {
  const get = playerLookup(game, u)
  return getFormation(game.tactics.formationId)
    .slots.map((sl) => game.lineup[sl.id])
    .filter((id): id is string => !!id && !!get(id) && isAvailable(game.squad[id]) && game.squad[id].condition < TIRED_CONDITION)
    .sort((a, b) => game.squad[a].condition - game.squad[b].condition || a.localeCompare(b))
}

/**
 * For each tired starter (or only `ids`), the best rested man outside the XI who plays the slot's position and is
 * worth more there today than the tired man: the same comparison the assistant's lineup makes. A man is used once.
 * Empty when nobody fresher would do better (a lone keeper, a thin squad).
 */
export function restPlan(game: Game, u: LoadedUniverse, ids?: string[]): RestSwap[] {
  const get = playerLookup(game, u)
  const formation = getFormation(game.tactics.formationId)
  const inXI = new Set(Object.values(game.lineup))
  const used = new Set<string>()
  const out: RestSwap[] = []
  for (const id of tiredStarters(game, u)) {
    if (ids && !ids.includes(id)) continue
    const slot = formation.slots.find((sl) => game.lineup[sl.id] === id)
    if (!slot) continue
    const now = slotScore(game, u, id, slot.id, slot.position)
    let best: RestSwap | null = null
    for (const q of Object.keys(game.squad).sort()) {
      const p = get(q)
      if (!p || inXI.has(q) || used.has(q) || !isAvailable(game.squad[q]) || !p.positions.includes(slot.position)) continue
      if (game.squad[q].condition < TIRED_CONDITION) continue
      const gain = slotScore(game, u, q, slot.id, slot.position) - now
      if (gain > 1e-9 && (!best || gain > best.gain + 1e-9)) best = { outId: id, inId: q, slotId: slot.id, gain: Math.round(gain * 10) / 10 }
    }
    if (best) {
      used.add(best.inId)
      out.push(best)
    }
  }
  return out
}

/** Rest the tired starters the plan finds a fresher man for (or only `ids`); returns the swaps made. No draws. */
export function restTired(game: Game, u: LoadedUniverse, ids?: string[]): RestSwap[] {
  const plan = restPlan(game, u, ids)
  for (const swap of plan) assignPlayer(game, u, swap.inId, swap.slotId)
  return plan
}

/**
 * The slot to keep a promise of a start in: of the slots whose position he plays, the one where he costs the XI least
 * against the man there (an empty slot first). Null when he is already in the XI, unavailable or plays none of them.
 */
export function promiseSlot(game: Game, u: LoadedUniverse, id: string): string | null {
  const p = playerLookup(game, u)(id)
  if (!p || !game.squad[id] || !isAvailable(game.squad[id])) return null
  if (Object.values(game.lineup).includes(id)) return null
  let best: { slot: string; cost: number } | null = null
  for (const slot of getFormation(game.tactics.formationId).slots) {
    if (!p.positions.includes(slot.position)) continue
    const there = game.lineup[slot.id]
    const theirs = there && isAvailable(game.squad[there]) ? slotScore(game, u, there, slot.id, slot.position) : 0
    const cost = theirs - slotScore(game, u, id, slot.id, slot.position)
    if (!best || cost < best.cost - 1e-9) best = { slot: slot.id, cost }
  }
  return best?.slot ?? null
}

/** Put the man promised a start into his `promiseSlot`; returns the slot, or null when nothing changed. */
export function startPromised(game: Game, u: LoadedUniverse): string | null {
  const id = game.promisedStart
  if (!id) return null
  const slot = promiseSlot(game, u, id)
  if (slot) assignPlayer(game, u, id, slot)
  return slot
}

/** Where the side stands in its Continental Cup group before its next group match. */
export interface GroupStake {
  kind: 'group'
  group: string
  position: number
  points: number
  /** Group matches left for the user, this one included. */
  left: number
  /** Points over the third side (above zero) or behind the second (below zero, for third and fourth). */
  margin: number
  /** Through whatever happens, out whatever happens, a win takes the side through, or still open. */
  state: 'through' | 'out' | 'win-through' | 'open'
}

/** What a second leg needs, from the user's side: the first leg's score. */
export interface LegStake {
  kind: 'second-leg'
  ours: number
  theirs: number
}

export type EuropeStake = GroupStake | LegStake

/**
 * The stake of the user's next Continental Cup match (engine 7's groups and two-legged ties): the group standing with
 * what the matches left can still change, or the first leg's score before a second leg. Null for a first leg, the
 * final, an engine 6 cup or when no European match is due after the next matchweek.
 */
export function europeStake(game: Game): EuropeStake | null {
  const s = game.season
  const next = upcomingCupTie(game)
  if (!s?.continental?.groups || !next || next.comp !== 'continental') return null
  if (next.round === 'G' && next.group) {
    const g = s.continental.groups.find((x) => x.name === next.group)
    if (!g) return null
    const table = groupTable(g)
    const at = table.findIndex((r) => r.teamId === USER_TEAM)
    if (at < 0) return null
    const left = (team: string) => g.matches.filter((m) => !m.result && (m.homeTeamId === team || m.awayTeamId === team)).length
    const me = table[at]
    // Before the side's first group match every table is level: nothing to say yet
    if (!me.played) return null
    const others = table.filter((r) => r.teamId !== USER_TEAM)
    const maxOf = (r: (typeof table)[number]) => r.points + 3 * left(r.teamId)
    const myMax = me.points + 3 * left(USER_TEAM)
    // Ties at the end go to goal difference, so a side that can draw level is a threat
    const threats = (pts: number, cut?: string) => others.filter((r) => maxOf(r) - (r.teamId === cut ? 3 : 0) >= pts).length
    const opp = next.homeTeamId === USER_TEAM ? next.awayTeamId : next.homeTeamId
    const state: GroupStake['state'] = threats(me.points) <= 1 ? 'through' : others.filter((r) => r.points > myMax).length >= 2 ? 'out' : threats(me.points + 3, opp) <= 1 ? 'win-through' : 'open'
    const margin = at <= 1 ? me.points - table[2].points : me.points - table[1].points
    return { kind: 'group', group: g.name, position: at + 1, points: me.points, left: left(USER_TEAM), margin, state }
  }
  if (next.leg === 2 && next.tie) {
    const legs = tieScore(next.tie)?.legs
    const first = legs?.[0]
    if (!first) return null
    const userHome = next.tie.homeTeamId === USER_TEAM
    return { kind: 'second-leg', ours: userHome ? first.home : first.away, theirs: userHome ? first.away : first.home }
  }
  return null
}

const goals = (n: number) => `${n} goal${n === 1 ? '' : 's'}`
const pts = (n: number) => `${n} point${n === 1 ? '' : 's'}`

/** The briefing's words for a European stake. */
export function europeLine(stake: EuropeStake): string {
  if (stake.kind === 'second-leg') {
    const d = stake.ours - stake.theirs
    const score = `${stake.ours}-${stake.theirs}`
    if (d > 0) return d === 1 ? `You lead ${score} from the first leg: a draw takes you through` : `You lead ${score} from the first leg: you can lose by ${goals(d - 1)} and go through`
    if (d === 0) return `Level at ${score} from the first leg: win to go through, a draw means extra time`
    return `You trail ${score} from the first leg: win by ${goals(1 - d)} to go through, by ${goals(-d)} for extra time`
  }
  const head = `${ordinal(stake.position)} in Group ${stake.group} on ${pts(stake.points)}, ${stake.left} to play`
  if (stake.state === 'through') return `${head}: through already, rest who you like`
  if (stake.state === 'out') return `${head}: out whatever happens`
  if (stake.state === 'win-through') return `${head}: a win takes you through`
  return stake.margin > 0 ? `${head}, ${stake.margin} clear of third` : stake.margin === 0 ? `${head}, level on points with the side in the places` : `${head}, ${stake.margin * -1} behind second`
}

/**
 * Dynasty: the men whose contracts run out at the end of this season and are not settled (not renewed, not declined,
 * not on loan), from `CONTRACT_REMINDER_WEEKS` before the end. Sorted by overall, best first. Empty in a Season, which
 * ends before any contract does.
 */
export function contractsEnding(game: Game, u: LoadedUniverse): string[] {
  const s = game.season
  if (game.settings.mode !== 'dynasty' || !s || game.phase === 'preseason' || s.matchweek < s.matchweeks - CONTRACT_REMINDER_WEEKS) return []
  const get = playerLookup(game, u)
  return Object.keys(game.squad)
    .filter((id) => {
      const c = game.contracts[id]
      return !!c && c.years <= 1 && !c.renewed && !c.declined && !c.loan && !c.expired && !!get(id)
    })
    .sort((a, b) => get(b)!.overall - get(a)!.overall || a.localeCompare(b))
}
