/**
 * Data packs on the server: which files a data version is made of, where the Edge Function archives them, and how a
 * universe is built from their parsed JSON exactly as the browser builds it (`fetchLeague` + `loadUniverse` in
 * `src/engine/universe.ts`: `buildLeague` with the index's league info and, for a league the index gives a
 * `classicFrom`, its `players-classic.json`, then `mergeUniverses` with the index's order and stamp). Classic
 * club-seasons sit after every standard one and are never on a ranked wheel, but the universe the server replays on
 * must be the one the browser played on. Pure and DOM-free; bundled into the verifier.
 */
import { buildLeague, mergeUniverses, type LeaguesFile, type LoadedUniverse, type MetaFile, type PlayersFile } from '@engine/universe'
import type { GameSettings } from '@game/types'

/** The classic pack of a league, which the browser loads only when the index gives the league a `classicFrom`. */
export function classicFile(id: string): string {
  return `${id}/players-classic.json`
}

/** Whether the index gives a league classic seasons (and so a `players-classic.json`). */
export function hasClassic(index: LeaguesFile | undefined, id: string): boolean {
  return index?.leagues.find((l) => l.id === id)?.classicFrom !== undefined
}

/**
 * The pack files of a data version, relative to `data/` on the site and to `v/<version>/` in the archive: the index,
 * then each league's players and meta, plus its classic pack when `index` gives it one.
 */
export function packFiles(leagueIds: readonly string[], index?: LeaguesFile): string[] {
  return ['leagues.json', ...leagueIds.flatMap((id) => [`${id}/players.json`, `${id}/meta.json`, ...(hasClassic(index, id) ? [classicFile(id)] : [])])]
}

/** Where a pack file lives in the private `packs` bucket. */
export function archivePath(version: string, file: string): string {
  return `v/${version}/${file}`
}

/** The leagues a puzzle needs, in the index's order (the order `mergeUniverses` uses whatever it is given). */
export function puzzleLeagues(settings: Pick<GameSettings, 'leagueId' | 'wheelLeagues'>, index?: LeaguesFile): string[] {
  const ids = [...new Set([settings.leagueId, ...(settings.wheelLeagues ?? [])])]
  if (!index) return ids.sort()
  const rank = (id: string) => {
    const i = index.leagues.findIndex((l) => l.id === id)
    return i < 0 ? index.leagues.length : i
  }
  return ids.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1))
}

export interface LeaguePack {
  players: PlayersFile
  meta: MetaFile
  /** `players-classic.json`, for a league the index gives a `classicFrom`. */
  classic?: PlayersFile
}

/**
 * The universe of `leagueIds` from parsed packs. Throws when a league is missing from the index or the packs, or when
 * a players file carries another stamp than the index (one data version is one set of bytes).
 */
export function universeFromPacks(index: LeaguesFile, packs: Record<string, LeaguePack>, leagueIds: readonly string[]): LoadedUniverse {
  if (!leagueIds.length) throw new Error('No league to build')
  const parts = leagueIds.map((id) => {
    const info = index.leagues.find((l) => l.id === id)
    if (!info) throw new Error(`League ${id} is not in the ${index.generatedAt} index`)
    const pack = packs[id]
    if (!pack) throw new Error(`No pack for league ${id}`)
    if (pack.players.generatedAt !== index.generatedAt) throw new Error(`${id}/players.json is stamped ${pack.players.generatedAt}, not ${index.generatedAt}`)
    if (pack.meta.league?.id !== id) throw new Error(`${id}/meta.json describes another league`)
    if (pack.classic && pack.classic.generatedAt !== index.generatedAt) throw new Error(`${classicFile(id)} is stamped ${pack.classic.generatedAt}, not ${index.generatedAt}`)
    return buildLeague(pack.players, pack.meta, info, pack.classic)
  })
  return mergeUniverses(parts, index.leagues, index.generatedAt)
}
