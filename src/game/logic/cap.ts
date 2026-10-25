/**
 * The Moneyball wheel: a salary cap on the draft. The engine prices players
 * and enforces the cap (`capPrice`, `affordable` in `src/engine/draft.ts`);
 * this file holds the presets the setup screens offer, what a finished game
 * says about its spend, and when a cap applies at all. Pure: no React, no store.
 *
 * The cap binds a draft only. A Season or a Dynasty's first year is drafted
 * under it, then the market takes over; a Dynasty's summer draft has none.
 */
import { capForSquad, xiCapOf, type DraftRules } from '@engine/draft'
import type { Mode } from '../types'

/** The parts of a game the cap's lines read: a whole `Game`, or the lighter shape the mode labels take. */
export interface CapGame {
  year: number
  settings: { mode: Mode; rules?: Pick<DraftRules, 'budget'> & Partial<Pick<DraftRules, 'squadSize'>> }
  draft?: { spent?: number; rules?: Pick<DraftRules, 'budget'> } | null
  capSpent?: number
}

/** The cap choices the setup screens offer. */
export type CapPreset = 'off' | 'shoestring' | 'moneyball' | 'big-spender' | 'custom'

/** Every preset with its cap for an XI (£M). Moneyball is the default once the cap is on. */
export const CAP_PRESETS: ReadonlyArray<{ value: CapPreset; label: string; xi?: number; hint: string }> = [
  { value: 'off', label: 'Off', hint: 'No cap: draft anyone the wheel lands on' },
  { value: 'shoestring', label: 'Shoestring', xi: 120, hint: '£120M for an XI: one star and a lot of graft' },
  { value: 'moneyball', label: 'Moneyball', xi: 180, hint: '£180M for an XI: stars and scrubs, or spread it' },
  { value: 'big-spender', label: 'Big Spender', xi: 250, hint: '£250M for an XI: a few big names' },
  { value: 'custom', label: 'Custom', hint: 'Your own cap, £50M to £600M for an XI' },
]

/** The custom cap's range and step for an XI, £M. */
export const CAP_CUSTOM_RANGE: readonly [number, number] = [50, 600]
export const CAP_CUSTOM_STEP = 10

/** What the setup screens hold: the preset, and the custom XI cap kept while another preset is shown. */
export interface CapChoice {
  preset: CapPreset
  custom: number
}

export const DEFAULT_CAP_CHOICE: CapChoice = { preset: 'off', custom: 180 }

/** The XI cap of a choice, or undefined when the cap is off. */
export function capXI(choice: CapChoice): number | undefined {
  if (choice.preset === 'off') return undefined
  if (choice.preset === 'custom') return Math.min(CAP_CUSTOM_RANGE[1], Math.max(CAP_CUSTOM_RANGE[0], Math.round(choice.custom / CAP_CUSTOM_STEP) * CAP_CUSTOM_STEP))
  return CAP_PRESETS.find((p) => p.value === choice.preset)?.xi
}

/** The budget a draft of `squadSize` picks gets from a choice (`DraftRules.budget`), or undefined when the cap is off. */
export function capBudget(choice: CapChoice, squadSize: number): number | undefined {
  const xi = capXI(choice)
  return xi === undefined ? undefined : capForSquad(xi, squadSize)
}

/** The XI cap a squad's budget was scaled from, back on the £10M grid every preset and custom cap sits on. */
export function xiCapOfBudget(budget: number, squadSize: number): number {
  return Math.round(xiCapOf(budget, squadSize) / CAP_CUSTOM_STEP) * CAP_CUSTOM_STEP
}

/** A squad's budget when it grows to `newSize` picks (a Gauntlet bonus spin): the same XI cap, scaled to the bigger squad. */
export function grownBudget(budget: number, squadSize: number, newSize: number): number {
  return capForSquad(xiCapOfBudget(budget, squadSize), newSize)
}

/** A total in whole millions from £100M (and for a whole number), one decimal below: `£178M`, `£50M`, `£52.5M`. */
export function capTotal(m: number): string {
  return m >= 100 || Number.isInteger(m) ? `£${Math.round(m)}M` : `£${m.toFixed(1)}M`
}

/** The cap a finished or running game was drafted under, with its spend; null when there was none or it no longer binds (a Dynasty after year one). */
export function capOfGame(game: CapGame): { budget: number; spent: number } | null {
  // The draft's own cap first: a Gauntlet bonus spin grows it beyond the settings' one
  const budget = game.draft?.rules?.budget ?? game.settings.rules?.budget
  if (budget === undefined) return null
  if (game.settings.mode === 'dynasty' && game.year > 1) return null
  return { budget, spent: game.draft?.spent ?? game.capSpent ?? 0 }
}

/** The summary's money line: `💰 £178M of a £180M cap · 0.52 pts per £M`; an arena run has no points, so no rate. */
export function capLine(game: CapGame, points?: number): string | null {
  const cap = capOfGame(game)
  if (!cap) return null
  const base = `💰 ${capTotal(cap.spent)} of a ${capTotal(cap.budget)} cap`
  return points === undefined || cap.spent <= 0 ? base : `${base} · ${(points / cap.spent).toFixed(2)} pts per £M`
}

/** The share card footer's cap: ` · £180M cap`, or nothing. */
export function capFooter(game: CapGame): string {
  const cap = capOfGame(game)
  return cap ? ` · ${capTotal(cap.budget)} cap` : ''
}

/** The Bargain Hunters achievement's cap: a league won on £150M for an XI or less (a bigger squad's cap is read back to its XI). */
export const MONEYBALL_ACHIEVEMENT_CAP = 150

/** Whether a title in this game earns Bargain Hunters: drafted under a cap worth £150M or less for an XI, in the cap's own season. */
export function earnsMoneyball(game: CapGame): boolean {
  const budget = game.settings.rules?.budget
  if (budget === undefined || (game.settings.mode === 'dynasty' && game.year > 1)) return false
  return xiCapOfBudget(budget, game.settings.rules?.squadSize ?? 11) <= MONEYBALL_ACHIEVEMENT_CAP
}
