/**
 * Gamble mode's rare special: the Icons collection.
 *
 * The collection is the `ICONS_SIZE` best players of all time on the draft's wheel leagues, each at his prime
 * season (his highest-rated player-season there, `primeSeasons`), so a player appears once whichever club he
 * peaked at. Ranked by that rating, ties by the earlier season and then the smaller player-season id, so the
 * collection depends only on the data and the league set, never on load order or the draft. Built once per
 * universe and league set and cached; it is a fresh object, never a part of the universe.
 *
 * An Icons spin lands on the collection as if it were a club-season (`ICONS_CLUB` at `ICONS_SEASON`); the pick
 * is any icon who fits an open slot. Pure: no RNG here (the roll lives in `spin`, on the draft's own stream).
 */
import type { ClubSeason, PlayerSeason } from './types'
import type { LoadedUniverse } from './universe'
import { primeSeasons } from './prime'

/** The club id and season an Icons spin lands on: no real club or season uses either. */
export const ICONS_CLUB = 'icons'
export const ICONS_SEASON = 0
/** Chance per spin of a Gamble draft that the reel lands on the Icons collection (at most once per draft). */
export const ICONS_CHANCE = 0.01
/** Players in the collection. */
export const ICONS_SIZE = 60

const memo = new WeakMap<LoadedUniverse, Map<string, ClubSeason>>()

function ranked(a: PlayerSeason, b: PlayerSeason): number {
  return b.overall - a.overall || a.season - b.season || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** The Icons collection over these leagues (every loaded league when omitted), as a club-season whose squad is the icons. */
export function iconsCollection(u: LoadedUniverse, leagues?: readonly string[]): ClubSeason {
  const key = leagues?.length ? [...new Set(leagues)].sort().join(',') : '*'
  let byKey = memo.get(u)
  if (!byKey) memo.set(u, (byKey = new Map()))
  const hit = byKey.get(key)
  if (hit) return hit
  const squad = primeSeasons(u, leagues?.length ? leagues : undefined).sort(ranked).slice(0, ICONS_SIZE)
  const cs: ClubSeason = { clubId: ICONS_CLUB, leagueId: ICONS_CLUB, season: ICONS_SEASON, position: 0, points: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, champions: false, complete: true, squad }
  byKey.set(key, cs)
  return cs
}

/** Whether a spin's club and season are the Icons collection's. */
export function isIcons(at: { clubId: string } | null | undefined): boolean {
  return !!at && at.clubId === ICONS_CLUB
}
