/**
 * The substitution board's model, pure: which changes are staged in the
 * substitutions sheet before "Make changes", how well a held man fits each
 * slot (the slot picker's own split: natural, `canCover` at accomplished, the
 * rest out of position), the role rating in a slot and the team rating before
 * and after the staged changes (`roleRating`, `computeTeamStrength`), and the
 * keyboard's moves between slots. Nothing here decides a change: the staged
 * list is sent as it is through the hand's `submit`, which goes to
 * `interveneLive` in play or to the stop's pending changes, and the engine
 * refuses what it refuses. No React, no DOM.
 */
import { canCover, describeFit } from '@engine/positions'
import { computeTeamStrength, roleRating, type PlayerLookup, type StateLookup } from '@engine/ratings'
import { DEFAULT_ROLE, getRole, type Role } from '@engine/roles'
import type { FormationSlot, Lineup, PlayerSeason, Position, Tactics } from '@engine/types'
import type { LandingKind, Sub } from './controls'
import { translator } from '../i18n'
import { match } from '../i18n/en/match'

const t = translator(match)

// ------------------------------------------------------------------ fit

/** The glow on a slot for the man held over it: green natural, amber can cover, red out of position. */
export type FitGlow = 'natural' | 'cover' | 'out'

/** The slot picker's split (`slotSheet`): natural, accomplished cover (`canCover`), everything else out of position. */
export function fitGlow(p: Pick<PlayerSeason, 'positions'>, position: Position): FitGlow {
  if (describeFit(p, position) === 'natural') return 'natural'
  return canCover(p, position, 'accomplished') ? 'cover' : 'out'
}

export const FIT_WORDS: Record<FitGlow, string> = {
  get natural() {
    return t('fit_natural')
  },
  get cover() {
    return t('fit_cover')
  },
  get out() {
    return t('fit_out')
  },
}

/** The role a slot plays in these tactics (the slot's own pick, else the position's default). */
export function slotRole(tactics: Pick<Tactics, 'roles'>, slot: Pick<FormationSlot, 'id' | 'position'>): Role {
  return getRole(tactics.roles[slot.id] ?? DEFAULT_ROLE[slot.position])
}

/** A man's rating in a slot's role: `roleRating`, the number the team rating is built from (before condition and morale). */
export function slotRoleRating(p: PlayerSeason, tactics: Pick<Tactics, 'roles'>, slot: Pick<FormationSlot, 'id' | 'position'>): number {
  return roleRating(p, slotRole(tactics, slot), slot.position)
}

// ------------------------------------------------------------------ staging

export type StageRefusal = 'no-room' | 'not-on-pitch' | 'not-on-bench' | 'already-on' | 'same'

export interface StageContext {
  /** The men on the pitch who can come off (the hand's `onPitch`). */
  onPitch: string[]
  /** The men who can still come on (the hand's `bench`: nobody who has played). */
  bench: string[]
  /** How many changes this sheet can take (`boardRoom`). */
  cap: number
}

/**
 * Stage `sub` (a bench man onto a starter). Dropping a bench man on a man
 * already staged to come on swaps the incoming man and keeps the count; a man
 * staged once cannot be staged again, a man who has played is not on the
 * bench, and the count never passes the cap.
 */
export function stageSub(subs: Sub[], sub: Sub, c: StageContext): { subs: Sub[]; refused?: StageRefusal } {
  if (sub.on === sub.off) return { subs, refused: 'same' }
  if (!c.bench.includes(sub.on)) return { subs, refused: 'not-on-bench' }
  if (subs.some((s) => s.on === sub.on)) return { subs, refused: 'already-on' }
  const replacing = subs.find((s) => s.on === sub.off)
  if (replacing) return { subs: subs.map((s) => (s === replacing ? { off: s.off, on: sub.on } : s)) }
  if (!c.onPitch.includes(sub.off) || subs.some((s) => s.off === sub.off)) return { subs, refused: 'not-on-pitch' }
  if (subs.length >= c.cap) return { subs, refused: 'no-room' }
  return { subs: [...subs, { off: sub.off, on: sub.on }] }
}

/** Take a staged change back out (by the man coming on). */
export function undoSub(subs: Sub[], on: string): Sub[] {
  return subs.filter((s) => s.on !== on)
}

/**
 * How many changes the sheet can stage: the hand's `subCap` (the subs left in
 * play, or the stop's room), and none in play once the three stoppages are
 * spent, unless a change was already made at this very minute (that window is
 * open and costs nothing more), as the engine counts them.
 */
export function boardRoom(o: { subCap: number; landing: LandingKind; windowsLeft: number; windowOpen: boolean }): number {
  if (o.landing === 'now' && o.windowsLeft <= 0 && !o.windowOpen) return 0
  return Math.max(0, o.subCap)
}

/** The counters after the staged changes: subs left of five, and stoppages left of three (a change in play opens one unless one is open). */
export function countersAfter(o: { subsLeft: number; windowsLeft: number; landing: LandingKind; windowOpen: boolean; staged: number }): { subsLeft: number; windowsLeft: number } {
  const spends = o.staged > 0 && o.landing === 'now' && !o.windowOpen ? 1 : 0
  return { subsLeft: Math.max(0, o.subsLeft - o.staged), windowsLeft: Math.max(0, o.windowsLeft - spends) }
}

/** Who stands in each slot once the staged changes are made: the incoming man takes the slot of the man he replaces, as the engine does. */
export function lineupAfter(men: Array<{ psId: string; slotId: string }>, subs: Sub[]): Lineup {
  const swap = new Map(subs.map((s) => [s.off, s.on]))
  const lineup: Lineup = {}
  for (const m of men) lineup[m.slotId] = swap.get(m.psId) ?? m.psId
  return lineup
}

/** The team rating (`computeTeamStrength(...).overall`, the Dugout's number) of a lineup. */
export function teamRating(tactics: Tactics, lineup: Lineup, get: PlayerLookup, state: StateLookup): number {
  return computeTeamStrength(tactics, lineup, get, state).overall
}

// ------------------------------------------------------------------ keyboard

export interface BoardPoint {
  id: string
  /** Per cent of the pitch box, attacking up. */
  left: number
  top: number
}

/**
 * The slot an arrow key moves to: the nearest slot in that direction
 * (distance along the arrow counts once, across it twice), or the same slot
 * when there is none that way. With no slot yet, any arrow starts at the first.
 */
export function moveOnBoard(points: BoardPoint[], current: string | null, key: string): string | null {
  if (!points.length) return null
  const from = points.find((p) => p.id === current)
  if (!from) return points[0].id
  const dir = key === 'ArrowUp' ? [0, -1] : key === 'ArrowDown' ? [0, 1] : key === 'ArrowLeft' ? [-1, 0] : key === 'ArrowRight' ? [1, 0] : null
  if (!dir) return current
  let best: { id: string; score: number } | null = null
  for (const p of points) {
    if (p.id === from.id) continue
    const dx = p.left - from.left
    const dy = p.top - from.top
    const along = dx * dir[0] + dy * dir[1]
    if (along <= 0.5) continue
    const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0])
    const score = along + 2 * across
    if (!best || score < best.score) best = { id: p.id, score }
  }
  return best ? best.id : from.id
}
