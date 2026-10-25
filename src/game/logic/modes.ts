/**
 * Every place the game names its mode, in one file. Each table is a
 * `Record<Mode, ...>` or an exhaustive `switch`, so adding a `Mode` fails to
 * compile here, once, instead of falling through a hand-written chain on some
 * screen. Pure: no React, no store.
 */
import type { ArenaSettings, Game, Mode } from '../types'
import { capFooter } from './cap'

/** The mode's title: Setup's heading, the Record page's mode column. */
export const MODE_TITLE: Record<Mode, string> = { quick: 'Quick Draft', daily: 'Daily Challenge', season: 'Season', dynasty: 'Dynasty', arena: 'Arena' }

/**
 * How a label is worded:
 * - `short`: Home's active and parked rows (`Dynasty · Year 2`);
 * - `heading`: the line above the Summary's verdict (`Dynasty year 2`);
 * - `share`: the mode in the share text (`Daily 2026-10-25`, `Dynasty Y2`).
 */
export type ModeLabelStyle = 'short' | 'heading' | 'share'

/** The parts of a game a label reads. */
export type LabelledGame = Pick<Game, 'year'> & Partial<Pick<Game, 'arena'>> & { settings: Pick<Game['settings'], 'mode' | 'seed'> & Partial<Pick<Game['settings'], 'arena' | 'rules'>> }

/** An arena format's name: `Cup Final`, `The Gauntlet`, `The Cup · 16 clubs`. */
export function arenaFormatLabel(a: (Pick<ArenaSettings, 'format'> & { size?: number }) | undefined): string {
  if (a?.format === 'gauntlet') return 'The Gauntlet'
  const size = a?.size ?? 2
  return size === 2 ? 'Cup Final' : `The Cup · ${size} clubs`
}

/** The day of a daily seed as written in labels: `daily-2026-10-25` reads `2026-10-25`. */
function dailyDay(seed: string): string {
  return seed.replace('daily-', '')
}

/** The game's mode in words, in the given style. */
export function modeLabel(game: LabelledGame, style: ModeLabelStyle): string {
  const mode = game.settings.mode
  switch (mode) {
    case 'quick':
      return style === 'share' ? 'Quick Draft' : 'Quick draft'
    case 'daily':
      return style === 'share' ? `Daily ${dailyDay(game.settings.seed)}` : 'Daily challenge'
    case 'season':
      return 'Season'
    case 'dynasty':
      return style === 'share' ? `Dynasty Y${game.year}` : style === 'heading' ? `Dynasty year ${game.year}` : `Dynasty · Year ${game.year}`
    case 'arena':
      return arenaFormatLabel(game.settings.arena)
    default: {
      const never: never = mode
      return never
    }
  }
}

/** The footer of the share card: the daily's day, or the seed a friend can replay (`Seed K7Q2-MX9A · £180M cap` under a salary cap). */
export function shareCardFooter(game: LabelledGame): string {
  return game.settings.mode === 'daily' ? `Daily challenge ${dailyDay(game.settings.seed)}` : `Seed ${game.settings.seed}${capFooter(game)}`
}

/** `Year 2` in a dynasty, nothing in a mode that plays one season. */
export function yearLabel(game: LabelledGame): string | null {
  return game.settings.mode === 'dynasty' ? `Year ${game.year}` : null
}

/** Modes whose draft ends in one click into the quick season (`runQuickSeason`) rather than a managed one. */
export function isQuickLike(mode: Mode): boolean {
  switch (mode) {
    case 'quick':
    case 'daily':
      return true
    case 'season':
    case 'dynasty':
    case 'arena':
      return false
    default: {
      const never: never = mode
      return never
    }
  }
}

/**
 * The Draft screen's finish button: into the quick season, into a dynasty's
 * new season after its summer draft, or to pre-season. `made` is set when the
 * wheel has run dry and the squad goes on short (`Go to pre-season with 15`).
 */
export function finishDraftLabel(game: LabelledGame, made?: number): string {
  if (isQuickLike(game.settings.mode)) return 'Simulate the season'
  if (game.settings.mode === 'arena') return game.arena && game.arena.step > 0 ? 'Back to the ladder' : arenaFormatLabel(game.settings.arena) === 'Cup Final' ? 'On to the final' : game.settings.arena?.format === 'gauntlet' ? 'Onto the ladder' : 'On to the draw'
  if (game.settings.mode === 'dynasty' && game.year > 1) return 'Into the new season'
  return made === undefined ? 'Go to pre-season' : `Go to pre-season with ${made}`
}
