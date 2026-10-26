import { buildLeague, fetchLeaguesIndex, mergeUniverses, type LoadedUniverse, type MetaFile, type PlayersFile } from '@engine/universe'
import type { LeagueInfo } from '@engine/types'

/**
 * The store's pack loader: the engine's `fetchLeague` + `loadUniverse`, except that a league's classic pack
 * (`players-classic.json`, England 1992-93 to 2007-08: 1.16 MB, a third of the first download on a phone) loads only
 * when something asks for classic seasons. Classic club-seasons are opt-in and sit after every standard one
 * (CLAUDE.md invariant 20), so a universe without them plays every standard game identically
 * (`classicRelease.test.ts`); `withClassic` then adds them to the standard league already built, keeping its
 * player-season and club-season objects, and gives exactly what `buildLeague(players, meta, info, classic)` gives
 * (`packs.test.ts`). The engine's loader stays as it is for the tests and the server.
 */

/** What a league's standard build keeps for adding its classic seasons later: its meta and the players file's header. */
interface StandardLeague {
  u: LoadedUniverse
  meta: MetaFile
  header: Omit<PlayersFile, 'rows'>
  info: LeagueInfo | undefined
}

const standardCache = new Map<string, Promise<StandardLeague>>()
const fullCache = new Map<string, Promise<LoadedUniverse>>()

function base(): string {
  const b = import.meta.env?.BASE_URL ?? '/'
  return b.endsWith('/') ? b : `${b}/`
}

function getJson<T>(path: string): Promise<T> {
  return fetch(`${base()}data/${path}`).then((r) => {
    if (!r.ok) throw new Error(`${path} ${r.status}`)
    return r.json() as Promise<T>
  })
}

/** Keep a promise in `cache` under `key` unless it fails, so the next call retries the network. */
function cached<T>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  let p = cache.get(key)
  if (!p) {
    p = make()
    cache.set(key, p)
    p.catch(() => cache.delete(key))
  }
  return p
}

/** Whether a league has a classic pack (the data index says where its classic seasons start). */
export function hasClassicPack(info: LeagueInfo | undefined): boolean {
  return info?.classicFrom !== undefined
}

/**
 * A standard league with its classic seasons added: the classic rows are built on their own (a players file with no
 * standard rows) and appended, so the standard objects are the ones already in use. Pure.
 */
export function withClassic(standard: LoadedUniverse, header: Omit<PlayersFile, 'rows'>, meta: MetaFile, info: LeagueInfo | undefined, classic: PlayersFile): LoadedUniverse {
  const extra = buildLeague({ ...header, rows: [] }, meta, info, classic)
  const added = extra.clubSeasons.filter((cs) => cs.classic)
  if (!added.length) return standard
  const clubSeasonByKey = { ...standard.clubSeasonByKey }
  for (const cs of added) clubSeasonByKey[`${cs.clubId}@${cs.season}`] = cs
  const out: LoadedUniverse = {
    ...standard,
    clubSeasons: [...standard.clubSeasons, ...added],
    // The extra build holds classic rows only: standard ids first, then the classic ones, as one build orders them
    index: { ...standard.index, ...extra.index },
    clubSeasonByKey,
    tables: extra.tables,
    voidTitles: extra.voidTitles,
  }
  if (extra.classicFirstSeason !== undefined) out.classicFirstSeason = extra.classicFirstSeason
  return out
}

function loadStandard(id: string): Promise<StandardLeague> {
  return cached(standardCache, id, async () => {
    const [players, meta, index] = await Promise.all([getJson<PlayersFile>(`${id}/players.json`), getJson<MetaFile>(`${id}/meta.json`), fetchLeaguesIndex()])
    const info = index.leagues.find((l) => l.id === id)
    const header = { version: players.version, generatedAt: players.generatedAt, columns: players.columns }
    return { u: buildLeague(players, meta, info), meta, header, info }
  })
}

function loadFull(id: string): Promise<LoadedUniverse> {
  return cached(fullCache, id, async () => {
    const s = await loadStandard(id)
    if (!hasClassicPack(s.info)) return s.u
    // As the engine's loader: a failed classic fetch loads the standard seasons only, and is tried again next time
    const classic = await getJson<PlayersFile>(`${id}/players-classic.json`).catch(() => undefined)
    if (!classic) {
      fullCache.delete(id)
      return s.u
    }
    return withClassic(s.u, s.header, s.meta, s.info, classic)
  })
}

/** One league as the universe holds it: with its classic seasons when `classic` (and it has any), else standard only. */
export function loadLeague(id: string, classic: boolean): Promise<LoadedUniverse> {
  return classic ? loadFull(id) : loadStandard(id).then((s) => s.u)
}

/** Load and merge `ids` in the data index's order (as `loadUniverse`), classic seasons included when `classic`. */
export async function loadPacks(ids: string[], classic: boolean): Promise<LoadedUniverse> {
  const unique = [...new Set(ids)]
  const [index, ...parts] = await Promise.all([fetchLeaguesIndex(), ...unique.map((id) => loadLeague(id, classic))])
  return mergeUniverses(parts, index.leagues, index.generatedAt)
}

/**
 * Fetch the classic packs of `ids` without parsing them, so the service worker holds them for an offline visit. Best
 * effort; the response body is read and dropped.
 */
export function warmClassicPacks(ids: string[], available: LeagueInfo[]): void {
  for (const id of ids) {
    if (!hasClassicPack(available.find((l) => l.id === id))) continue
    fetch(`${base()}data/${id}/players-classic.json`)
      .then((r) => r.arrayBuffer())
      .catch(() => undefined)
  }
}
