import { describe, expect, it } from 'vitest'
import { byRating, exploreIndexed, exploreIndexSteps, exploreRatingSteps, foldName, freshPlayerIndex, playerEntry, playerIndex } from '../logic/exploreIndex'
import { searchPlayers } from '../logic/exploreSearch'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildLeague, mergeUniverses, type LeaguesFile, type MetaFile, type PlayersFile } from '@engine/universe'

// Explore's index across league loads (r9 perf): the store builds each league once (`packs.ts`) and merges the same
// player-season objects into a new universe at every load, as here
const root = path.resolve(__dirname, '..', '..', '..')
const read = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(root, 'public', 'data', rel), 'utf8')) as T
const index = read<LeaguesFile>('leagues.json')
const part = (id: string) => buildLeague(read<PlayersFile>(`${id}/players.json`), read<MetaFile>(`${id}/meta.json`), index.leagues.find((l) => l.id === id))
const parts = { england: part('england'), spain: part('spain'), italy: part('italy') }
const merged = (ids: Array<keyof typeof parts>) => mergeUniverses(ids.map((id) => parts[id]), index.leagues, index.generatedAt)
const england = merged(['england'])
const two = merged(['england', 'spain'])
const three = merged(['england', 'spain', 'italy'])

describe("Explore's player index, kept across universes", () => {
  it('equals the index built from nothing after each league load, and keeps the entries that did not change', () => {
    playerIndex(england)
    for (const u of [two, three, england]) {
      const kept = playerIndex(u)
      expect(JSON.stringify(kept)).toBe(JSON.stringify(freshPlayerIndex(u)))
    }
    // A player whose seasons did not change keeps his entry object; one with seasons in the new pack gets a new one
    const before = playerIndex(two)
    const after = playerIndex(three)
    const same = before.filter((e) => playerEntry(three, e.playerId) === e).length
    expect(same / before.length).toBeGreaterThan(0.6)
    for (const e of after) {
      const old = playerEntry(two, e.playerId)
      if (old && old.seasons.length !== e.seasons.length) expect(old).not.toBe(e)
    }
  }, 120_000)

  it('builds the same index a step at a time, with many pauses', () => {
    const u = merged(['spain', 'italy'])
    expect(exploreIndexed(u)).toBe(false)
    let pauses = 0
    for (const _ of exploreIndexSteps(u)) pauses++
    expect(pauses).toBeGreaterThan(10)
    expect(exploreIndexed(u)).toBe(true)
    expect(JSON.stringify(playerIndex(u))).toBe(JSON.stringify(freshPlayerIndex(u)))
    // Built already: nothing to step
    expect([...exploreIndexSteps(u)].length).toBe(0)
    // The rating list too: stepped, then the one sort's order
    expect([...exploreRatingSteps(u)].length).toBeGreaterThan(10)
    const rated = byRating(u)
    expect(rated.map((p) => p.id)).toEqual(Object.values(u.index).sort((a, b) => b.overall - a.overall || a.season - b.season || a.id.localeCompare(b.id)).map((p) => p.id))
    expect([...exploreRatingSteps(u)].length).toBe(0)
  }, 120_000)

  it('sorts exactly as localeCompare did', () => {
    const ids = playerIndex(three).map((e) => e.playerId)
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
    const rated = byRating(three)
    const again = [...rated].sort((a, b) => b.overall - a.overall || a.season - b.season || a.id.localeCompare(b.id))
    expect(rated.map((p) => p.id)).toEqual(again.map((p) => p.id))
    for (const e of playerIndex(three).slice(0, 2000)) {
      const s = [...e.seasons].sort((a, b) => a.season - b.season || a.clubId.localeCompare(b.clubId))
      expect(e.seasons).toEqual(s)
    }
  }, 120_000)

  it('folds names the same from its cache', () => {
    for (const n of ['Guéhi', 'Ødegaard', 'Müller', 'Łukasz', 'Straße', 'Guéhi']) expect(foldName(n)).toBe(foldName(n.normalize('NFC')))
    expect(foldName('Ødegaard')).toBe('odegaard')
    expect(foldName('Guéhi')).toBe('guehi')
    expect(searchPlayers(three, 'odegaard', { limit: 3 }).length).toBeGreaterThan(0)
  })
})
