/**
 * Power-ups: a tray of six one-use power-ups on a Quick Draft (`DraftRules.powerUps`), each used at most once per draft.
 *
 *  - Upgrader ⬆️: the Player Upgrader (`./upgrader`), on its own stream.
 *  - Re-roll season 🔁: keep the club the spin showing landed on and draw another of its seasons on the wheel, each
 *    equally likely (the odds are shown first). One draw from the draft's own power-up stream (`powerRng`, seeded from
 *    the game seed and forked by the spin it re-rolls), so the game's stream, the spins after it and the season are
 *    never moved by the draw itself.
 *  - Peek 👁️: the season the next spin lands on, before spinning. Pure: the spin is run on a copy of the draft and of
 *    the game's stream. While it shows, the chosen slot and the XI are pinned (no slot change, no swap), so the spin
 *    then lands where the peek said.
 *  - Swap 🔀: move a starter to another slot he can cover (an open one, or one whose player can cover his), between spins.
 *  - Captain's armband ©️: +`ARMBAND_BOOST` to one drafted player for the season, applied by the game's player lookup.
 *  - Lock 🔒: one drafted player keeps his rating if the Upgrader loses on him; used before the Upgrader.
 *
 * Every use is recorded on the draft (`DraftState.powerUps`, the Upgrader's as `upgrade`), shown in the draft log and
 * the share text, and carried by challenge links so a replay makes the same moves. The universe is never touched.
 */
import { Rng, type RngState } from './rng'
import { canCover } from './positions'
import type { ClubSeason } from './types'
import type { LoadedUniverse } from './universe'
import { isIcons, ICONS_SEASON } from './icons'
import { isComplete, peekActive, spin, wheelPool, canSpin, positionFirst, targetSlot, upgraderAvailable, type DraftState, type LockerKind, type PowerUpUse } from './draft'
import { upgradeCandidates } from './upgrader'

export type PowerUp = LockerKind
/** The tray's order. */
export const POWER_UPS: readonly PowerUp[] = ['upgrader', 'reroll', 'peek', 'swap', 'armband', 'lock']
/** The tray's own icon, for the setup toggle, the draft header and the share text. */
export const POWER_UPS_ICON = '🧰'
/** What the Captain's armband adds to one player's rating for the season. */
export const ARMBAND_BOOST = 2

export const POWER_UP_INFO: Record<PowerUp, { icon: string; title: string; line: string }> = {
  upgrader: { icon: '⬆️', title: 'Upgrader', line: 'Gamble +2, +5 or +10 on a drafted player at the odds shown; a loss costs half.' },
  reroll: { icon: '🔁', title: 'Re-roll season', line: 'Keep the club on the reel and spin only the year, among its seasons on the wheel.' },
  peek: { icon: '👁️', title: 'Peek', line: 'See the season the next spin lands on before you spin.' },
  swap: { icon: '🔀', title: 'Swap', line: 'Move a starter to another slot he can cover, for free.' },
  armband: { icon: '©️', title: "Captain's armband", line: `+${ARMBAND_BOOST} to one drafted player for the season.` },
  lock: { icon: '🔒', title: 'Lock', line: 'Protect one player: an Upgrader loss on him costs nothing.' },
}

/** Whether a draft has the power-up tray. */
export function powerUpsOn(d: DraftState): boolean {
  return !!d.rules.powerUps
}

/** Whether a draft has this power-up: the whole tray, or this one unpacked from the locker. */
export function hasPowerUp(d: DraftState, kind: PowerUp): boolean {
  if (kind === 'upgrader') return upgraderAvailable(d)
  return !!d.rules.powerUps || !!d.locker?.includes(kind)
}

/** Whether a draft shows power-up buttons at all: the tray, or anything unpacked from the locker. */
export function trayKinds(d: DraftState): PowerUp[] {
  if (d.rules.powerUps) return [...POWER_UPS]
  return POWER_UPS.filter((k) => d.locker?.includes(k))
}

/**
 * Whether a power-up may be unpacked from the locker into this draft: a draft without the tray, that kind not already
 * in it (Gamble's Upgrader counts), the squad not yet complete. The locker's count is the caller's to check.
 */
export function canUnpack(d: DraftState, kind: PowerUp): boolean {
  return !d.rules.powerUps && !hasPowerUp(d, kind) && !isComplete(d)
}

/**
 * Unpack a power-up from the locker into this draft: from now on it works exactly as the tray's. Re-roll season and the
 * Upgrader get the very streams `newDraft` seeds a tray draft with (`${seed}:powerups`, `${seed}:upgrader`), derived from
 * the game seed alone, so when in the draft it is unpacked never matters and a challenge replay unpacks it up front.
 * Draws nothing.
 */
export function unpackPowerUp(d: DraftState, kind: PowerUp, seed: string): void {
  if (d.rules.powerUps) throw new Error('This draft has the whole tray already')
  if (hasPowerUp(d, kind)) throw new Error(`${POWER_UP_INFO[kind].title} is in this draft already`)
  ;(d.locker ??= []).push(kind)
  if (kind === 'reroll' && !d.powerRng) d.powerRng = new Rng(`${seed}:powerups`).getState()
  if (kind === 'upgrader' && !d.upgradeRng) d.upgradeRng = new Rng(`${seed}:upgrader`).getState()
}

function uses(d: DraftState): PowerUpUse[] {
  return d.powerUps ?? []
}

/** Whether a power-up has been used in this draft. */
export function powerUpUsed(d: DraftState, kind: PowerUp): boolean {
  if (kind === 'upgrader') return !!d.upgrade
  return uses(d).some((x) => x.kind === kind)
}

function record(d: DraftState, use: PowerUpUse): void {
  ;(d.powerUps ??= []).push(use)
}

function need(d: DraftState, kind: Exclude<PowerUp, 'upgrader'>): void {
  if (!hasPowerUp(d, kind)) throw new Error('This draft has no power-ups')
  if (powerUpUsed(d, kind)) throw new Error(`${POWER_UP_INFO[kind].title} has been used`)
}

/** The drafted player under the Lock, if any. */
export function lockedId(d: DraftState): string | null {
  const l = uses(d).find((x) => x.kind === 'lock')
  return l && l.kind === 'lock' ? l.id : null
}

/** The drafted player wearing the Captain's armband, if any. */
export function armbandId(d: DraftState): string | null {
  const a = uses(d).find((x) => x.kind === 'armband')
  return a && a.kind === 'armband' ? a.id : null
}

/** The rating change the draft's power-ups give one player for the season: the Upgrader's result plus the armband. */
export function draftBoost(d: DraftState, id: string): number {
  return (d.upgrade?.id === id ? d.upgrade.delta : 0) + (armbandId(d) === id ? ARMBAND_BOOST : 0)
}

// ------------------------------------------------------------------ Re-roll season

/** Re-roll: the other seasons of the showing club on this spin's wheel (twist and rules applied), oldest first; each is equally likely. */
export function rerollOptions(u: LoadedUniverse, d: DraftState): ClubSeason[] {
  const at = d.current
  if (!at || isIcons(at)) return []
  return wheelPool(u, d)
    .filter((cs) => cs.clubId === at.clubId && cs.season !== at.season)
    .sort((a, b) => a.season - b.season)
}

export function canReroll(u: LoadedUniverse, d: DraftState): boolean {
  return hasPowerUp(d, 'reroll') && !!d.powerRng && !powerUpUsed(d, 'reroll') && rerollOptions(u, d).length > 0
}

/** Re-roll the showing spin's season: one draw from the power-up stream, forked by the spin; the spin count is unchanged. */
export function rerollSeason(u: LoadedUniverse, d: DraftState): ClubSeason {
  need(d, 'reroll')
  if (!d.current) throw new Error('Spin first')
  if (isIcons(d.current)) throw new Error('The Icons collection has no seasons to re-roll')
  if (!d.powerRng) throw new Error('This draft has no power-ups')
  const options = rerollOptions(u, d)
  if (!options.length) throw new Error('No other season of this club is on the wheel')
  const rng = Rng.fromState(d.powerRng)
  const chosen = rng.fork(`reroll:${d.current.clubId}@${d.current.season}:${d.spins}`).pick(options)
  d.powerRng = rng.getState()
  record(d, { kind: 'reroll', at: d.history.length, clubId: chosen.clubId, from: d.current.season, to: chosen.season, options: options.length })
  d.current = { clubId: chosen.clubId, season: chosen.season }
  return chosen
}

// ------------------------------------------------------------------ Peek

/**
 * Where the next spin would land in this state with the game's stream at `main`: a copy of the draft spun with a copy of
 * the stream. Null when it cannot spin (a spin showing, a Position First slot not chosen, the wheel dry, complete). Pure.
 */
export function peekNext(u: LoadedUniverse, d: DraftState, main: RngState): { clubId: string; season: number } | null {
  if (d.current || isComplete(d) || (positionFirst(d) && !targetSlot(d)) || !canSpin(u, d)) return null
  const copy = JSON.parse(JSON.stringify(d)) as DraftState
  spin(u, copy, Rng.fromState(main))
  return copy.current
}

export function canPeek(u: LoadedUniverse, d: DraftState): boolean {
  return hasPowerUp(d, 'peek') && !powerUpUsed(d, 'peek') && !d.current && !isComplete(d) && !(positionFirst(d) && !targetSlot(d)) && canSpin(u, d)
}

/** Peek: record the season the next spin lands on (`ICONS_SEASON` for an Icons spin). No draw from any stream. */
export function usePeek(u: LoadedUniverse, d: DraftState, main: RngState): number {
  need(d, 'peek')
  if (positionFirst(d) && !d.current && !targetSlot(d)) throw new Error('Choose a slot first')
  const next = peekNext(u, d, main)
  if (!next) throw new Error(d.current ? 'Pick from this spin first' : 'There is no spin to peek at')
  const season = isIcons(next) ? ICONS_SEASON : next.season
  record(d, { kind: 'peek', at: d.history.length, season })
  return season
}

/** The season a peek is showing for the next spin, or null when none is. */
export function peekedSeason(d: DraftState): number | null {
  if (!peekActive(d)) return null
  const p = uses(d).find((x) => x.kind === 'peek')
  return p && p.kind === 'peek' ? p.season : null
}

// ------------------------------------------------------------------ Swap

/** Swap: the slots the starter in `from` may move to: an open slot he can cover, or a filled one whose player can cover his. */
export function swapTargets(u: LoadedUniverse, d: DraftState, from: string): string[] {
  const slot = d.formation.slots.find((s) => s.id === from)
  const p = slot && d.lineup[from] ? u.index[d.lineup[from]] : undefined
  if (!slot || !p) return []
  return d.formation.slots
    .filter((s) => {
      if (s.id === from || !canCover(p, s.position, d.rules.minFit)) return false
      const other = d.lineup[s.id] ? u.index[d.lineup[s.id]] : undefined
      return !d.lineup[s.id] || (!!other && canCover(other, slot.position, d.rules.minFit))
    })
    .map((s) => s.id)
}

/** Whether a swap could be made now: unused, between spins, no peek pinned, and some starter has somewhere to go. */
export function canSwap(u: LoadedUniverse, d: DraftState): boolean {
  if (!hasPowerUp(d, 'swap') || powerUpUsed(d, 'swap') || d.current || peekActive(d)) return false
  return Object.keys(d.lineup).some((s) => swapTargets(u, d, s).length > 0)
}

/** Swap: move the starter in `from` to `to` (exchanging with whoever is there). No RNG. */
export function swapSlots(u: LoadedUniverse, d: DraftState, from: string, to: string): void {
  need(d, 'swap')
  if (d.current) throw new Error('Pick from this spin first')
  if (peekActive(d)) throw new Error('You peeked at this spin: spin first')
  if (!d.lineup[from]) throw new Error('Choose one of your starters')
  if (!swapTargets(u, d, from).includes(to)) throw new Error(`${u.index[d.lineup[from]]?.name ?? 'He'} cannot play there`)
  const moving = d.lineup[from]
  const other = d.lineup[to]
  d.lineup[to] = moving
  if (other) d.lineup[from] = other
  else delete d.lineup[from]
  // Position First: a chosen slot the swap has filled is no longer the one to spin for
  if (d.target && d.lineup[d.target]) d.target = null
  record(d, { kind: 'swap', at: d.history.length, from, to })
}

// ------------------------------------------------------------------ Captain's armband and Lock

export function canArmband(d: DraftState): boolean {
  return hasPowerUp(d, 'armband') && !powerUpUsed(d, 'armband') && upgradeCandidates(d).length > 0
}

/** The Captain's armband: +`ARMBAND_BOOST` to one drafted player for the season. No RNG. */
export function giveArmband(d: DraftState, id: string): void {
  need(d, 'armband')
  if (!upgradeCandidates(d).includes(id)) throw new Error('Choose one of your drafted players')
  record(d, { kind: 'armband', at: d.history.length, id })
}

export function canLock(d: DraftState): boolean {
  return hasPowerUp(d, 'lock') && !powerUpUsed(d, 'lock') && !d.upgrade && upgradeCandidates(d).length > 0
}

/** Lock: an Upgrader loss on this drafted player costs nothing. Before the Upgrader is used. No RNG. */
export function lockPlayer(d: DraftState, id: string): void {
  need(d, 'lock')
  if (d.upgrade) throw new Error('The Upgrader has been used: Lock comes before it')
  if (!upgradeCandidates(d).includes(id)) throw new Error('Choose one of your drafted players')
  record(d, { kind: 'lock', at: d.history.length, id })
}
