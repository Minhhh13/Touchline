/**
 * The Teammate Chain's index: which club-seasons each real player appeared in,
 * so the draft can ask whether two men ever shared a dressing room.
 *
 * The index covers the club-seasons of the draft's own wheel leagues
 * (`rules.leagues`), never every pack the browser has loaded. Player ids are
 * shared across packs (a player who moved from England to Spain is one id in
 * both), so an index over whatever happened to be loaded would give an
 * England-only seed a different wheel on a device that had opened Spain too.
 *
 * Pure and deterministic: no RNG. Memoised by universe and leagues.
 */
import type { LoadedUniverse } from './universe'

/** Real player id -> the club-season keys (`clubId@season`) he appeared in. */
export type TeammateIndex = Map<string, Set<string>>

const cache = new WeakMap<LoadedUniverse, Map<string, TeammateIndex>>()

/** The cache key of a set of wheel leagues; `*` when the wheel takes every loaded league. */
function leaguesKey(leagues: readonly string[] | undefined): string {
  return leagues ? [...leagues].sort().join(',') : '*'
}

/** Every player's club-seasons over the given leagues (every loaded league when omitted). */
export function teammateIndex(u: LoadedUniverse, leagues?: readonly string[]): TeammateIndex {
  let byLeagues = cache.get(u)
  if (!byLeagues) {
    byLeagues = new Map()
    cache.set(u, byLeagues)
  }
  const key = leaguesKey(leagues)
  const hit = byLeagues.get(key)
  if (hit) return hit
  const index: TeammateIndex = new Map()
  for (const cs of u.clubSeasons) {
    if (leagues && !leagues.includes(cs.leagueId)) continue
    // A classic club-season (estimated ratings) never links a chain: the wheel only lands on one with the opt-in
    if (cs.classic) continue
    const csKey = `${cs.clubId}@${cs.season}`
    for (const p of cs.squad) {
      let set = index.get(p.playerId)
      if (!set) index.set(p.playerId, (set = new Set()))
      set.add(csKey)
    }
  }
  byLeagues.set(key, index)
  return index
}

/** The real player ids who shared a club-season with this player in those leagues, sorted (himself excluded). */
export function formerTeammates(u: LoadedUniverse, leagues: readonly string[] | undefined, playerId: string): string[] {
  const mates = new Set<string>()
  for (const key of teammateIndex(u, leagues).get(playerId) ?? []) for (const p of u.clubSeasonByKey[key]?.squad ?? []) if (p.playerId !== playerId) mates.add(p.playerId)
  return [...mates].sort()
}

/** The club-seasons two players shared in those leagues, latest season first (then by club id). */
export function sharedClubSeasons(u: LoadedUniverse, leagues: readonly string[] | undefined, a: string, b: string): string[] {
  const index = teammateIndex(u, leagues)
  const theirs = index.get(b)
  if (!theirs) return []
  const shared = [...(index.get(a) ?? [])].filter((key) => theirs.has(key))
  const seasonOf = (key: string) => Number(key.slice(key.lastIndexOf('@') + 1))
  return shared.sort((x, y) => seasonOf(y) - seasonOf(x) || x.localeCompare(y))
}
