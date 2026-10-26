/**
 * The end-of-draft case of a casual Quick Draft (`DraftRules.endCase`, the drops in `src/engine/endCase.ts`) and the
 * locker its power-ups go to (`Profile.inventory`), unpacked into a later Quick Draft without the tray.
 *
 * The case is rolled once, at the step from the draft to the season, from a fork of a copy of the game's stream
 * (`END_CASE_FORK`): the game's stream, the season and everything after it are exactly what they would be without it.
 * The Daily never has one, and neither does a game opened from a challenge link (so the head-to-head compares two
 * drafts, not two cases); a challenge replay opens the challenger's case again, which lands the same, to bring his
 * Icon back in (`ChallengeSeason.ic`).
 */
import type { Game, Profile } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { END_CASE_FORK, iconSlots, rollCase, type CaseRarity } from '@engine/endCase'
import { POWER_UPS, POWER_UP_INFO, canUnpack, unpackPowerUp, type PowerUp } from '@engine/powerups'
import type { DisplayTier } from './rarity'
import { reelLeagues } from './reel'
import { describeFit, ratingAt } from '@engine/positions'
import { playerLookup } from './players'
import { slotLabel } from './slotSheet'

/** The case's rarities in the reel's tier colours: common blue, rare purple, epic pink, the Icon in the Icons colour. */
export const CASE_TIER: Record<CaseRarity, DisplayTier> = { common: 'blue', rare: 'purple', epic: 'pink', icon: 'icons' }
export const CASE_RARITY_LABEL: Record<CaseRarity, string> = { common: 'Common', rare: 'Rare', epic: 'Epic', icon: 'Icon' }

/** Whether the rules give this game an end-of-draft case: a Quick Draft with `endCase` on (never the Daily). */
export function endCaseRule(game: Pick<Game, 'settings'>): boolean {
  return game.settings.mode === 'quick' && game.settings.rules.endCase === true
}

/** Whether this game opens the case: the rule, and not a game played from a challenge link. */
export function endCaseOn(game: Pick<Game, 'settings'>): boolean {
  return endCaseRule(game) && !game.settings.challenge
}

/**
 * Roll the case, once, when the draft is done: from a fork of a copy of the game's stream, so nothing else moves.
 * `replay` rolls it for a challenge replay, whose settings carry the link (a live game from a link has no case).
 */
export function rollEndCase(game: Game, u: LoadedUniverse, replay = false): void {
  if (!(replay ? endCaseRule(game) : endCaseOn(game)) || game.endCase || !game.draft) return
  const rng = Rng.fromState(game.rngState).fork(END_CASE_FORK)
  game.endCase = { drop: rollCase(u, game.draft, reelLeagues(u, game.settings.rules), rng) }
}

/** The power-up the case drops for the locker, or null (an Icon, no case, or already opened). */
export function lockerDrop(game: Game): PowerUp | null {
  const c = game.endCase
  return c && c.drop.kind === 'powerup' ? c.drop.powerUp : null
}

/**
 * Open the case. Returns the power-up the locker gains, once: null when it holds an Icon or was opened already. A case
 * with nothing to decide (a power-up) is done once opened; an Icon waits for `subCaseIcon`.
 */
export function openEndCase(game: Game): PowerUp | null {
  const c = game.endCase
  if (!c || c.opened || game.phase !== 'kickoff') return null
  c.opened = true
  return c.drop.kind === 'powerup' ? c.drop.powerUp : null
}

/** The slots the case's Icon may take: drafted starters' slots he can cover at the draft's minimum fit. Empty without an Icon. */
export function caseIconSlots(game: Game, u: LoadedUniverse): string[] {
  const c = game.endCase
  const d = game.draft
  if (!c || c.drop.kind !== 'icon' || !d) return []
  const p = u.index[c.drop.id]
  if (!p) return []
  // A drafted starter's slot (the one the Icon is in already counts: he may move)
  return iconSlots(d, p).filter((s) => !!d.lineup[s])
}

/** One slot the case's Icon could take, in words: where, his rating there and whether it is his position, and who makes way. */
export interface CaseIconChoice {
  slotId: string
  label: string
  rating: number
  fit: 'fits' | 'can cover'
  outId: string
  outName: string
  outRating: number
}

/** The Icon's slot choices, best for the XI first (the biggest gain over the man making way), ties in formation order. */
export function caseIconChoices(game: Game, u: LoadedUniverse): CaseIconChoice[] {
  const c = game.endCase
  const d = game.draft
  if (!c || c.drop.kind !== 'icon' || !d) return []
  const get = playerLookup(game, u)
  const icon = get(c.drop.id)
  if (!icon) return []
  const order = d.formation.slots.map((s) => s.id)
  return caseIconSlots(game, u)
    .map((slotId) => {
      const slot = d.formation.slots.find((s) => s.id === slotId)!
      const outId = c.sub?.slotId === slotId ? c.sub.outId : d.lineup[slotId]
      const out = get(outId)
      return { slotId, label: slotLabel(d.formation, slot), rating: Math.round(ratingAt(icon, slot.position)), fit: describeFit(icon, slot.position) === 'natural' ? 'fits' : 'can cover', outId, outName: out?.name ?? outId, outRating: out ? Math.round(ratingAt(out, slot.position)) : 0 } satisfies CaseIconChoice
    })
    .sort((a, b) => b.rating - b.outRating - (a.rating - a.outRating) || order.indexOf(a.slotId) - order.indexOf(b.slotId))
}

/** Put the case's Icon in a drafted starter's slot (taking back any earlier choice), or keep the XI with null. No phase check (the challenge replay). */
export function placeCaseIcon(game: Game, u: LoadedUniverse, slotId: string | null): void {
  const c = game.endCase
  const d = game.draft
  if (!c || c.drop.kind !== 'icon' || !d) throw new Error('The case holds no Icon')
  // Undo an earlier choice first, so the Icon is only ever in one slot
  if (c.sub) {
    d.lineup[c.sub.slotId] = c.sub.outId
    if (game.lineup[c.sub.slotId] === c.drop.id) game.lineup[c.sub.slotId] = c.sub.outId
    delete c.sub
  }
  if (slotId !== null) {
    if (!caseIconSlots(game, u).includes(slotId)) throw new Error(`${u.index[c.drop.id]?.name ?? 'The Icon'} cannot play there`)
    const outId = d.lineup[slotId]
    d.lineup[slotId] = c.drop.id
    game.lineup[slotId] = c.drop.id
    // The man making way gives up any duty he had
    if (game.captainId === outId) delete game.captainId
    const sp = game.tactics.setPieces
    if (sp) for (const k of ['penalties', 'freeKicks', 'corners'] as const) if (sp[k] === outId) delete sp[k]
    c.sub = { slotId, outId }
  }
}

/** The user's call on an opened case's Icon: bring him in at `slotId`, or keep the XI (null). Then the case is done. */
export function subCaseIcon(game: Game, u: LoadedUniverse, slotId: string | null): void {
  const c = game.endCase
  if (!c || !c.opened || game.phase !== 'kickoff') return
  placeCaseIcon(game, u, slotId)
  c.done = true
}

/** Done with an opened case (a power-up for the locker): on to the tactics step. */
export function finishEndCase(game: Game): void {
  const c = game.endCase
  if (!c || !c.opened || game.phase !== 'kickoff') return
  c.done = true
}

/** Whether the XI has the case's Icon in it: a non-standard season, kept out of the records and marked on the board. */
export function caseIconIn(game: Pick<Game, 'endCase'>): boolean {
  return !!game.endCase?.sub
}

/** What the kick-off step shows first: the manager spin, then the case, then the tactics. */
export type KickoffStep = 'managers' | 'case' | 'tactics'
export function kickoffStep(game: Game): KickoffStep {
  if (game.phase !== 'kickoff') return 'tactics'
  if (game.managerSpin && !game.managerSpin.picked && game.managerSpin.options.length) return 'managers'
  if (game.endCase && !game.endCase.done && endCaseOn(game)) return 'case'
  return 'tactics'
}

// ------------------------------------------------------------------ The locker

/** How many of a power-up the locker holds. */
export function lockerCount(p: Pick<Profile, 'inventory'>, kind: PowerUp): number {
  const n = p.inventory?.[kind] ?? 0
  return Number.isInteger(n) && n > 0 ? n : 0
}

/** The locker with one more of a power-up. Pure. */
export function addToLocker(p: Profile, kind: PowerUp): Profile {
  return { ...p, inventory: { ...p.inventory, [kind]: lockerCount(p, kind) + 1 } }
}

/** The locker with one fewer of a power-up (never below none). Pure. */
export function takeFromLocker(p: Profile, kind: PowerUp): Profile {
  const n = lockerCount(p, kind)
  const inventory = { ...p.inventory }
  if (n <= 1) delete inventory[kind]
  else inventory[kind] = n - 1
  return { ...p, inventory }
}

/** A saved locker made safe: known power-ups with whole positive counts only. */
export function cleanLocker(inv: unknown): Partial<Record<PowerUp, number>> {
  const out: Partial<Record<PowerUp, number>> = {}
  if (!inv || typeof inv !== 'object' || Array.isArray(inv)) return out
  for (const k of POWER_UPS) {
    const n = (inv as Record<string, unknown>)[k]
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) out[k] = Math.min(n, 999)
  }
  return out
}

/** Whether the locker may be used in this game: a casual Quick Draft (not the Daily, not a challenge link) without the tray, still drafting. */
export function lockerOn(game: Game): boolean {
  return game.settings.mode === 'quick' && !game.settings.challenge && game.phase === 'draft' && !!game.draft && !game.draft.rules.powerUps
}

/** Whether this power-up can come out of the locker now: the locker holds one and the draft can take it. */
export function canUnpackFromLocker(game: Game, p: Pick<Profile, 'inventory'>, kind: PowerUp): boolean {
  return lockerOn(game) && lockerCount(p, kind) > 0 && canUnpack(game.draft!, kind)
}

/** Unpack a power-up from the locker into the draft (the store takes it off the profile). */
export function unpackFromLocker(game: Game, kind: PowerUp): void {
  if (!lockerOn(game)) throw new Error('The locker is closed in this game')
  unpackPowerUp(game.draft!, kind, game.settings.seed)
}

/** The case in the share text: "🎁 Case: ★ Icon Lionel Messi in at RW (non-standard)", "🎁 Case: 🔀 Swap to the locker". Null without an opened case. */
export function caseLine(game: Pick<Game, 'endCase' | 'draft'>, nameOf: (playerSeasonId: string) => string): string | null {
  const c = game.endCase
  if (!c?.opened) return null
  if (c.drop.kind === 'powerup') return `🎁 Case: ${POWER_UP_INFO[c.drop.powerUp].icon} ${POWER_UP_INFO[c.drop.powerUp].title} to the locker`
  return c.sub ? `🎁 Case: ★ Icon ${nameOf(c.drop.id)} in at ${game.draft?.formation.slots.find((s) => s.id === c.sub!.slotId)?.position ?? c.sub.slotId} (non-standard)` : `🎁 Case: ★ Icon ${nameOf(c.drop.id)}, passed up`
}
