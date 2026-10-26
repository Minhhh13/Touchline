import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { Lineup, PlayerSeason, Tactics } from '@engine/types'
import { canCloseBench, canSpin, isComplete, picksMade } from '@engine/draft'
import { MANAGER_SPIN_FORK, MANAGER_STYLE_LABEL, managerBoost, managerOptions, managerWheel, spinManagers, type Manager } from '@engine/managers'
import { Rng } from '@engine/rng'
import { DISPLAY_TIERS, tierTable, type DisplayTier } from './rarity'
import { reelLeagues } from './reel'

/** Whether this game picks a manager: a Quick Draft (challenge links included) whose rules have managers on. Never the Daily. */
export function managersOn(game: Pick<Game, 'settings'>): boolean {
  return game.settings.mode === 'quick' && game.settings.rules.managers === true
}

/** The club-seasons the draft took its players from, one row per pick in draft order (bench picks included). */
export function draftedClubSeasons(game: Game): Array<{ clubId: string; season: number }> {
  return (game.draft?.history ?? []).filter((h) => h.pickedId).map((h) => ({ clubId: h.clubId, season: h.season }))
}

/** Whether this game spins its manager (`DraftRules.managerSpin`): three reels at the step to the season, then a pick of the three. */
export function managerSpinOn(game: Pick<Game, 'settings'>): boolean {
  return managersOn(game) && game.settings.rules.managerSpin === true
}

/**
 * The managers this game's finished draft may pick from: with the manager spin the three the reels landed on (none
 * before they are rolled), else the managers of the drafted club-seasons (`managerOptions`); empty without managers. Pure.
 */
export function quickManagerOptions(game: Game): Manager[] {
  if (!managersOn(game)) return []
  if (managerSpinOn(game)) return game.managerSpin?.options ?? []
  return managerOptions(draftedClubSeasons(game))
}

/** The manager spin's wheel for a game: every real manager of the club-seasons its rules admit (`managerWheel`). */
export function gameManagerWheel(game: Pick<Game, 'settings'>, u: LoadedUniverse): Manager[] {
  const r = game.settings.rules
  return managerWheel(u.clubSeasons, { leagues: reelLeagues(u, r), fromSeason: r.fromSeason, toSeason: r.toSeason, classic: r.classic, onlyClub: r.onlyClub })
}

/**
 * Roll the manager spin, once, at the step from the draft to the season: three managers from the wheel, drawn from a
 * fork of a copy of the game's stream (`MANAGER_SPIN_FORK`), so the game's stream (and the season after it) is exactly
 * as it was. The same draft on the same seed always lands the same three, which is what a challenge replay relies on.
 */
export function rollManagerSpin(game: Game, u: LoadedUniverse): void {
  if (!managerSpinOn(game) || game.managerSpin) return
  const rng = Rng.fromState(game.rngState).fork(MANAGER_SPIN_FORK)
  game.managerSpin = { options: spinManagers(gameManagerWheel(game, u), rng) }
}

/** A manager's rarity on the reel: the tier of the club-season he ran (`tierTable` over the wheel's leagues); an archetype is blue. */
export function managerTier(u: LoadedUniverse, leagues: readonly string[], m: Manager): DisplayTier {
  if (m.archetype || !m.clubId || m.season === undefined) return 'blue'
  return tierTable(u, leagues)[`${m.clubId}@${m.season}`] ?? 'blue'
}

/** The chance a reel of the manager spin lands in each tier (each entry of the wheel equally likely), rarest first, Icons left out. Pure. */
export function managerSpinOdds(u: LoadedUniverse, game: Pick<Game, 'settings'>): Array<{ tier: DisplayTier; p: number }> {
  const wheel = gameManagerWheel(game, u)
  const leagues = reelLeagues(u, game.settings.rules)
  const by: Record<DisplayTier, number> = { icons: 0, gold: 0, red: 0, pink: 0, purple: 0, blue: 0 }
  for (const m of wheel) by[managerTier(u, leagues, m)]++
  return DISPLAY_TIERS.filter((t) => t !== 'icons').map((tier) => ({ tier, p: wheel.length ? by[tier] / wheel.length : tier === 'blue' ? 1 : 0 }))
}

/** Whether the manager may be picked now: the draft is done (or may close), and the season has not kicked off. */
export function canPickManager(game: Game, u: LoadedUniverse): boolean {
  if (!managersOn(game) || !game.draft) return false
  // The manager spin is rolled at the step to the season; its pick comes after the reels, never during the draft
  if (managerSpinOn(game)) return game.phase === 'kickoff' && !!game.managerSpin
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
  if (game.managerSpin && id !== null) game.managerSpin.picked = true
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
