import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { Lineup, PlayerSeason, Tactics } from '@engine/types'
import { canCloseBench, canSpin, isComplete, picksMade } from '@engine/draft'
import { MANAGER_STYLE_LABEL, managerBoost, managerOptions, type Manager } from '@engine/managers'

/** Whether this game picks a manager: a Quick Draft (challenge links included) whose rules have managers on. Never the Daily. */
export function managersOn(game: Pick<Game, 'settings'>): boolean {
  return game.settings.mode === 'quick' && game.settings.rules.managers === true
}

/** The club-seasons the draft took its players from, one row per pick in draft order (bench picks included). */
export function draftedClubSeasons(game: Game): Array<{ clubId: string; season: number }> {
  return (game.draft?.history ?? []).filter((h) => h.pickedId).map((h) => ({ clubId: h.clubId, season: h.season }))
}

/** The managers this game's finished draft may pick from (`managerOptions`); empty when the game has no managers. Pure. */
export function quickManagerOptions(game: Game): Manager[] {
  return managersOn(game) ? managerOptions(draftedClubSeasons(game)) : []
}

/** Whether the manager may be picked now: the draft is done (or may close), and the season has not kicked off. */
export function canPickManager(game: Game, u: LoadedUniverse): boolean {
  if (!managersOn(game) || !game.draft) return false
  if (game.phase === 'kickoff') return true
  if (game.phase !== 'draft') return false
  const d = game.draft
  // The same test the store's finishDraft makes: a full squad, an XI with bench places to spare, or a dry wheel after eleven
  return isComplete(d) || canCloseBench(d) || (picksMade(d) >= 11 && !canSpin(u, d))
}

/** Pick the manager by id (null for none). Throws for a manager the draft does not offer; does nothing once the season is under way. */
export function pickManager(game: Game, u: LoadedUniverse, id: string | null): void {
  if (!canPickManager(game, u)) return
  setManager(game, id)
}

/** Put a manager the draft offers on the game, by id, without the phase check (the challenge replay); null clears it. */
export function setManager(game: Game, id: string | null): void {
  if (id === null) {
    delete game.manager
    return
  }
  const m = quickManagerOptions(game).find((x) => x.id === id)
  if (!m) throw new Error('That manager was not on offer')
  game.manager = { ...m }
}

/**
 * At the step from the draft to the season: a game with managers keeps the manager picked if the finished draft still
 * offers him, else takes the first offered (the manager of the club-season the draft took most players from). A game
 * without managers never has one.
 */
export function settleManager(game: Game): void {
  const options = quickManagerOptions(game)
  if (!options.length) {
    delete game.manager
    return
  }
  if (!game.manager || !options.some((m) => m.id === game.manager!.id)) game.manager = { ...options[0] }
}

/** The manager's edge on the user's side for an XI and its instructions, or undefined without a manager. Pure. */
export function quickManagerBoost(game: Game, lineup: Lineup, tactics: Tactics, get: (id: string) => PlayerSeason | undefined): { attack: number; defence: number } | undefined {
  if (!game.manager || !managersOn(game)) return undefined
  const xi = Object.values(lineup)
    .map((id) => get(id))
    .filter((p): p is PlayerSeason => !!p)
  return managerBoost(game.manager.style, tactics, xi)
}

/** The manager in the share text: "👔 Arsène Wenger · Youth", an archetype marked as invented. Null without one. */
export function managerLine(m: Manager | undefined): string | null {
  if (!m) return null
  return `👔 ${m.name}${m.archetype ? ' (invented)' : ''} · ${MANAGER_STYLE_LABEL[m.style]}`
}
