/**
 * The Daily Arena: one arena puzzle a day for everyone (UTC), the Gauntlet and
 * the Cup in turn, with its own streak. Pure and pinned like the Daily's
 * mapping: `dailyArenaSettings` must never change once shipped, or everyone's
 * puzzle changes with the deploy. The ladder, the field and the draws come
 * from the arena's seed streams, so everyone on the day meets the same sides.
 */
import type { LoadedUniverse } from '@engine/universe'
import type { ArenaState, GameSettings } from '../types'
import { DAILY_FORMATIONS, shortNameFor } from './setup'
import { arenaBanner, cupGameSettings, gauntletGameSettings, stepWon, type ArenaChoices } from './arena'

/** Everything the Daily Arena fixes: the format (the Cup at 16 clubs against the wheel), the wheel, the shape, the difficulty. */
export interface DailyArenaSettings {
  seed: string
  format: 'cup' | 'gauntlet'
  /** The Cup's size and field; absent on a Gauntlet day. */
  size?: 16
  field?: 'wheel'
  leagueId: 'england'
  wheelLeagues: ['england']
  formationId: string
  difficulty: 'calibrated'
  twists: true
}

/** `arena-2026-10-25` reads `2026-10-25`. */
export function arenaDay(seed: string): string {
  return seed.replace('arena-', '')
}

/**
 * The Daily Arena's fixed settings for an `arena-YYYY-MM-DD` seed. With `n` the date's digits: an even `n` is the
 * Gauntlet, an odd one the Cup of 16 against the wheel; an England wheel, `DAILY_FORMATIONS[(n × 7) % 5]`,
 * calibrated, twists on, no era, club or nation filter. Frozen once shipped.
 */
export function dailyArenaSettings(seed: string): DailyArenaSettings {
  const n = Number(arenaDay(seed).split('-').join('')) || 0
  const format = n % 2 === 0 ? 'gauntlet' : 'cup'
  return { seed, format, ...(format === 'cup' ? { size: 16 as const, field: 'wheel' as const } : {}), leagueId: 'england', wheelLeagues: ['england'], formationId: DAILY_FORMATIONS[(n * 7) % DAILY_FORMATIONS.length], difficulty: 'calibrated', twists: true }
}

/** The complete settings of a day's arena, ready for `startGame`; only the team name is the player's. */
export function dailyArenaGameSettings(u: LoadedUniverse, seed: string, teamName = 'Touchline XI'): GameSettings {
  const d = dailyArenaSettings(seed)
  const name = teamName.trim() || 'Touchline XI'
  const c: ArenaChoices = { teamName: name, formationId: d.formationId, field: 'wheel', wheelLeagues: d.wheelLeagues, difficulty: d.difficulty, seed: d.seed, hardMode: false, twists: d.twists }
  const s = d.format === 'gauntlet' ? gauntletGameSettings(u, c, shortNameFor(name)) : cupGameSettings(u, { ...c, size: 16 }, shortNameFor(name))
  return { ...s, arena: { format: d.format, ...(s.arena ?? {}), daily: true } }
}

/** A day's arena in a few words for Home: `The Gauntlet on the Premier League wheel`. */
export function dailyArenaLine(u: Pick<LoadedUniverse, 'available'>, d: DailyArenaSettings): string {
  const wheel = u.available.find((l) => l.id === d.leagueId)?.name ?? d.leagueId
  return `${d.format === 'gauntlet' ? 'The Gauntlet' : `The Cup of ${d.size}`} on the ${wheel} wheel`
}

/** What a finished day's run files in `profile.arenaDaily`: the format, rounds won and the banner in words (`6 rungs`, `Cup winners`). */
export function dailyArenaResult(a: Pick<ArenaState, 'format' | 'size' | 'won' | 'log'>): { format: 'cup' | 'gauntlet'; score: number; label: string } {
  const banner = arenaBanner(a).toLowerCase()
  return { format: a.format, score: a.log.filter(stepWon).length, label: /^\d/.test(banner) ? banner : banner.charAt(0).toUpperCase() + banner.slice(1) }
}

/** The settings to play an arena game again on a new seed: a day's puzzle replayed is an ordinary run, off the streak. */
export function arenaAgainSettings(s: GameSettings, seed: string): GameSettings {
  return { ...s, seed, ...(s.arena ? { arena: { ...s.arena, daily: undefined } } : {}) }
}
