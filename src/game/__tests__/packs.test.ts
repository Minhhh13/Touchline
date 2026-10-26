import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildLeague, mergeUniverses, type LeaguesFile, type MetaFile, type PlayersFile } from '@engine/universe'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { hasClassicPack, withClassic } from '../packs'
import { classicFromIndex, needsClassic } from '../logic/era'

const root = path.resolve(__dirname, '..', '..', '..')
const read = <T>(p: string): T => JSON.parse(readFileSync(path.join(root, 'public', 'data', p), 'utf8')) as T
const index = read<LeaguesFile>('leagues.json')
const players = read<PlayersFile>('england/players.json')
const meta = read<MetaFile>('england/meta.json')
const classic = read<PlayersFile>('england/players-classic.json')
const info = index.leagues.find((l) => l.id === 'england')
const header = { version: players.version, generatedAt: players.generatedAt, columns: players.columns }

describe('the classic pack on demand (packs.ts)', { timeout: 120_000 }, () => {
  it('adds the classic seasons to a standard league exactly as one build with them gives', () => {
    const standard = buildLeague(players, meta, info)
    const added = withClassic(standard, header, meta, info, classic)
    const once = buildLeague(players, meta, info, classic)
    expect(added.clubSeasons.length).toBe(once.clubSeasons.length)
    expect(added.clubSeasons.map((cs) => `${cs.clubId}@${cs.season}`)).toEqual(once.clubSeasons.map((cs) => `${cs.clubId}@${cs.season}`))
    expect(Object.keys(added.index)).toEqual(Object.keys(once.index))
    expect(Object.keys(added.clubSeasonByKey)).toEqual(Object.keys(once.clubSeasonByKey))
    expect(added).toEqual(once)
  })

  it('keeps the standard player-seasons and club-seasons already in use, and leaves the standard league untouched', () => {
    const standard = buildLeague(players, meta, info)
    const before = { seasons: standard.clubSeasons.length, ids: Object.keys(standard.index).length, classicFrom: standard.classicFirstSeason }
    const added = withClassic(standard, header, meta, info, classic)
    for (const cs of standard.clubSeasons) expect(added.clubSeasonByKey[`${cs.clubId}@${cs.season}`]).toBe(cs)
    for (const id of Object.keys(standard.index).slice(0, 2000)) expect(added.index[id]).toBe(standard.index[id])
    expect({ seasons: standard.clubSeasons.length, ids: Object.keys(standard.index).length, classicFrom: standard.classicFirstSeason }).toEqual(before)
    expect(standard.clubSeasons.some((cs) => cs.classic)).toBe(false)
    expect(added.clubSeasons.filter((cs) => cs.classic).length).toBeGreaterThan(300)
  })

  it('merges into the universe the tests and the server load (every pack with its classic seasons)', () => {
    const merged = mergeUniverses([withClassic(buildLeague(players, meta, info), header, meta, info, classic)], index.leagues, index.generatedAt)
    const reference = loadTestUniverse()
    // The test helper builds without the index's league info; everything the game reads matches
    expect(merged.clubSeasons.map((cs) => `${cs.clubId}@${cs.season}`)).toEqual(reference.clubSeasons.map((cs) => `${cs.clubId}@${cs.season}`))
    expect(merged.index).toEqual(reference.index)
    expect(merged.tables).toEqual(reference.tables)
    expect(merged.classicFirstSeason).toBe(reference.classicFirstSeason)
    expect(merged.seed).toBe(reference.seed)
  })

  it('knows which leagues have a classic pack and which games need one', () => {
    expect(hasClassicPack(info)).toBe(true)
    expect(hasClassicPack(index.leagues.find((l) => l.id === 'spain'))).toBe(false)
    expect(classicFromIndex(index.leagues, ['england'])).toBe(info?.classicFrom)
    expect(classicFromIndex(index.leagues, ['spain', 'italy'])).toBeUndefined()
    expect(classicFromIndex(index.leagues, ['england'])).toBe(loadTestUniverse().classicFirstSeason)
    expect(needsClassic({ settings: { rules: { classic: true } } })).toBe(true)
    expect(needsClassic({ settings: { rules: {} } })).toBe(false)
  })
})
