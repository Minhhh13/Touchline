/**
 * Men who left a Dynasty squad (sold, released, out of contract, a loan gone
 * back). Each is kept by his real player id with the age he left at, so no pool
 * (the summer wheel, the market, the academy, a scout, the assistant's cover)
 * offers a season of him in which he is younger than he would really be now.
 * Only a Dynasty records anything: every other mode reads nothing here and
 * plays exactly as before. Pure, no draws.
 */
import type { Game } from '../types'
import type { PlayerSeason } from '@engine/types'

/** File a departure (Dynasty only). A man who leaves twice keeps the later age. */
export function recordDeparture(game: Game, p: Pick<PlayerSeason, 'playerId' | 'age'>): void {
  if (game.settings.mode !== 'dynasty') return
  ;(game.departedPlayers ??= {})[p.playerId] = { age: p.age, year: game.year }
}

/** Real player id -> the youngest age he may come back at this game year; undefined when nobody has left. */
export function ageFloors(game: Game): Record<string, number> | undefined {
  const book = game.departedPlayers
  if (!book) return undefined
  const out: Record<string, number> = {}
  for (const [id, d] of Object.entries(book)) out[id] = d.age + Math.max(0, game.year - d.year)
  return Object.keys(out).length ? out : undefined
}

/** A season of a man who left, younger than he would be now. */
export function barredByAge(floors: Record<string, number> | undefined, p: Pick<PlayerSeason, 'playerId' | 'age'>): boolean {
  const floor = floors?.[p.playerId]
  return floor !== undefined && p.age < floor
}
