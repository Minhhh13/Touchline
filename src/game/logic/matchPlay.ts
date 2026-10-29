/**
 * How the next match is played (Watch, Auto-play, Sim result) as the saved preference reads it, pure. Kept apart from
 * `assistant.ts` (which re-exports it) so the store can read it when a save loads without the season loop
 * (`week.ts`), which the first download leaves to the rules chunk (`src/game/rules.ts`).
 */
import type { Game } from '../types'

/** How the main play button plays the next match. */
export type MatchPlayMode = 'watch' | 'auto' | 'sim'

/** The saved preference: Season and Dynasty only, Watch when unset (every save written before the setting existed). */
export function matchPlayOf(game: Game): MatchPlayMode {
  if (game.settings.mode !== 'season' && game.settings.mode !== 'dynasty') return 'watch'
  return game.settings.matchPlay ?? 'watch'
}

/**
 * Whether the assistant takes the stops of the live match now on the screen when it opens fresh:
 * after a reload, or as the cup tie that follows a league match. Only the saved preference counts
 * ("Finish the match" and "Auto from here" were for the match they were asked in).
 */
export function assistantTakesStops(game: Game | null | undefined): boolean {
  return !!game?.live && matchPlayOf(game) === 'auto'
}
