/**
 * Prime ratings: every player at his career best.
 *
 * A player's prime is his highest-rated player-season (`overall`, the data's
 * rating) among the club-seasons of a set of leagues, ties going to the earlier
 * season and then to the smaller player-season id, so it never depends on load
 * order. The draft passes its wheel leagues (`rules.leagues`), not whatever
 * happens to be loaded: leagues load lazily (a device that once opened La Liga
 * holds it, another does not), and a prime that followed the loaded packs would
 * rate the same draft differently on two devices and break challenge replays.
 * With no leagues given, every league in the universe counts.
 *
 * Under `rules.ratings === 'prime'` a drafted player-season keeps its identity
 * (id, club, season, age, positions, traits, contract figures) and takes the
 * prime season's `overall` and `attributes`, which is what the draft list, team
 * strength and the match engine read. Positions stay those of the season he was
 * drafted from, because slot eligibility was decided on them.
 *
 * Built once per universe and league set (one pass over those club-seasons) and
 * cached in a WeakMap keyed by the universe. Pure: no RNG.
 */
import type { PlayerSeason } from './types'
import type { LoadedUniverse } from './universe'

interface PrimeCache {
  best: Map<string, PlayerSeason>
  primed: Map<string, PlayerSeason>
}

const caches = new WeakMap<LoadedUniverse, Map<string, PrimeCache>>()

function better(a: PlayerSeason, b: PlayerSeason): boolean {
  if (a.overall !== b.overall) return a.overall > b.overall
  if (a.season !== b.season) return a.season < b.season
  return a.id < b.id
}

/** The cache for one league set: the key is the sorted league ids, or `*` for every league. */
function cacheFor(u: LoadedUniverse, leagues?: readonly string[]): PrimeCache {
  const key = leagues ? [...new Set(leagues)].sort().join(',') : '*'
  let byKey = caches.get(u)
  if (!byKey) {
    byKey = new Map()
    caches.set(u, byKey)
  }
  let cache = byKey.get(key)
  if (!cache) {
    const best = new Map<string, PlayerSeason>()
    for (const cs of u.clubSeasons) {
      if (leagues && !leagues.includes(cs.leagueId)) continue
      for (const p of cs.squad) {
        const cur = best.get(p.playerId)
        if (!cur || better(p, cur)) best.set(p.playerId, p)
      }
    }
    cache = { best, primed: new Map() }
    byKey.set(key, cache)
  }
  return cache
}

/**
 * The player-season in which a player (by `playerId`) was rated highest in the given leagues
 * (every league when omitted), or undefined when he has no season there.
 */
export function primeOf(u: LoadedUniverse, playerId: string, leagues?: readonly string[]): PlayerSeason | undefined {
  return cacheFor(u, leagues).best.get(playerId)
}

/**
 * A player-season as Prime rates it over the given leagues: the same player-season with the overall
 * and attributes of his best season there. Returns the same object for the same id on every call
 * (cached), and the season itself when it already is his best.
 */
export function primed(u: LoadedUniverse, p: PlayerSeason, leagues?: readonly string[]): PlayerSeason {
  const cache = cacheFor(u, leagues)
  const hit = cache.primed.get(p.id)
  if (hit) return hit
  const best = cache.best.get(p.playerId)
  const out = !best || best.id === p.id || best.overall <= p.overall ? p : { ...p, overall: best.overall, attributes: { ...best.attributes } }
  cache.primed.set(p.id, out)
  return out
}

/** Prime lookup of a player-season id in the universe, over the given leagues. */
export function primeLookup(u: LoadedUniverse, id: string, leagues?: readonly string[]): PlayerSeason | undefined {
  const p = u.index[id]
  return p ? primed(u, p, leagues) : undefined
}
