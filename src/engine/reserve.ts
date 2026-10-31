/**
 * The reserve keeper (engine 6, E6-5): an AI side whose squad has no fit goalkeeper left fields a generated one instead
 * of an outfielder in goal. 190 club-seasons in the packs list a single keeper (two none at all), and when he was injured
 * the best remaining man went in goal with a goalkeeping rating near 20 and the side conceded six or seven a week.
 *
 * He is one fixed player-season per club-season, rated at the squad's fifth percentile, and never in the universe's
 * index: no draft, market, pool or search sees him. Ids follow the player-season shape, `reserve-gk-<club>@<season>@<club>`,
 * so his `playerId` is his club's own and he can never be the same human as anyone else. Pure, no RNG, cached per
 * universe.
 */
import type { PlayerSeason } from './types'
import type { LoadedUniverse } from './universe'

const PREFIX = 'reserve-gk-'
const cache = new WeakMap<LoadedUniverse, Map<string, PlayerSeason | null>>()

export function reserveKeeperId(clubId: string, season: number): string {
  return `${PREFIX}${clubId}@${season}@${clubId}`
}

export function isReserveKeeperId(id: string): boolean {
  return id.startsWith(PREFIX)
}

/** The reserve keeper of a club-season, or undefined when the club-season is not in the universe. */
export function reserveKeeper(u: LoadedUniverse, clubId: string, season: number): PlayerSeason | undefined {
  const id = reserveKeeperId(clubId, season)
  let byId = cache.get(u)
  if (!byId) cache.set(u, (byId = new Map()))
  const hit = byId.get(id)
  if (hit !== undefined) return hit ?? undefined
  const cs = u.clubSeasonByKey[`${clubId}@${season}`]
  const built = cs && cs.squad.length ? build(id, clubId, season, cs.squad) : null
  byId.set(id, built)
  return built ?? undefined
}

/** A reserve keeper by his id (what a match's stats and events carry), or undefined for any other id. */
export function reserveKeeperById(u: LoadedUniverse, id: string): PlayerSeason | undefined {
  if (!isReserveKeeperId(id)) return undefined
  const [head, season, clubId] = id.split('@')
  if (head !== `${PREFIX}${clubId}`) return undefined
  return reserveKeeper(u, clubId, Number(season))
}

/** An AI side's player lookup: the universe's index, then its reserve keeper. What every AI `MatchTeamInput` resolves with. */
export function aiLookup(u: LoadedUniverse): (id: string) => PlayerSeason | undefined {
  return (id) => u.index[id] ?? reserveKeeperById(u, id)
}

function build(id: string, clubId: string, season: number, squad: PlayerSeason[]): PlayerSeason {
  const overalls = squad.map((p) => p.overall).sort((a, b) => a - b)
  const rating = Math.max(40, overalls[Math.floor(0.05 * (overalls.length - 1))])
  const low = Math.max(20, rating - 35)
  return {
    id,
    playerId: `${PREFIX}${clubId}`,
    name: 'Reserve keeper',
    nationality: '',
    age: 30,
    clubId,
    season,
    positions: ['GK'],
    attributes: { pace: low, shooting: Math.max(10, low - 10), passing: low + 5, dribbling: low, defending: Math.max(10, low - 5), physical: Math.min(99, rating - 5), mentality: Math.min(99, rating - 5), goalkeeping: rating, stamina: 60, strength: 65, aggression: 40, jumping: Math.min(99, rating), workRate: 50 },
    traits: { consistency: 0.5, injuryProneness: 0.5, bigMatch: 0.5, professionalism: 0.5 },
    overall: rating,
    value: 0.2,
    wage: 2,
    foot: 'R',
    height: 188,
    accolades: [],
  }
}
