/**
 * Prime ratings: every player at his career best.
 *
 * A player's prime is his highest-rated player-season among the leagues loaded
 * into the universe (`overall`, the data's rating), ties going to the earlier
 * season and then to the smaller player-season id, so it never depends on load
 * order. Under `rules.ratings === 'prime'` a drafted player-season keeps its
 * identity (id, club, season, age, positions, traits, contract figures) and
 * takes the prime season's `overall` and `attributes`, which is what the draft
 * list, team strength and the match engine read. Positions stay those of the
 * season he was drafted from, because slot eligibility was decided on them.
 *
 * Built once per universe (one pass over `u.index`) and cached in a WeakMap,
 * so a merged universe computes its own primes across all its leagues. Pure:
 * no RNG.
 */
import type { PlayerSeason } from './types'
import type { LoadedUniverse } from './universe'

const bestByPlayer = new WeakMap<LoadedUniverse, Map<string, PlayerSeason>>()
const primedCache = new WeakMap<LoadedUniverse, Map<string, PlayerSeason>>()

function better(a: PlayerSeason, b: PlayerSeason): boolean {
  if (a.overall !== b.overall) return a.overall > b.overall
  if (a.season !== b.season) return a.season < b.season
  return a.id < b.id
}

function primeTable(u: LoadedUniverse): Map<string, PlayerSeason> {
  let table = bestByPlayer.get(u)
  if (!table) {
    table = new Map()
    for (const p of Object.values(u.index)) {
      const cur = table.get(p.playerId)
      if (!cur || better(p, cur)) table.set(p.playerId, p)
    }
    bestByPlayer.set(u, table)
  }
  return table
}

/** The player-season in which a player (by `playerId`) was rated highest, or undefined when he is not in the data. */
export function primeOf(u: LoadedUniverse, playerId: string): PlayerSeason | undefined {
  return primeTable(u).get(playerId)
}

/**
 * A player-season as Prime rates it: the same player-season with the overall and attributes of his
 * best season. Returns the same object for the same id on every call (cached), and the season itself
 * when it already is his best.
 */
export function primed(u: LoadedUniverse, p: PlayerSeason): PlayerSeason {
  let cache = primedCache.get(u)
  if (!cache) {
    cache = new Map()
    primedCache.set(u, cache)
  }
  const hit = cache.get(p.id)
  if (hit) return hit
  const best = primeOf(u, p.playerId)
  const out = !best || best.id === p.id || best.overall <= p.overall ? p : { ...p, overall: best.overall, attributes: { ...best.attributes } }
  cache.set(p.id, out)
  return out
}

/** Prime lookup of a player-season id in the universe. */
export function primeLookup(u: LoadedUniverse, id: string): PlayerSeason | undefined {
  const p = u.index[id]
  return p ? primed(u, p) : undefined
}
