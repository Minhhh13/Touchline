import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import type { LeaguesFile, MetaFile, PlayersFile } from '@engine/universe'
import { archivePath, packFiles, puzzleLeagues, universeFromPacks, type LeaguePack } from '../server/packs'

const DATA = path.resolve(__dirname, '..', '..', '..', 'public', 'data')
const read = <T>(file: string) => JSON.parse(readFileSync(path.join(DATA, file), 'utf8')) as T
const index = read<LeaguesFile>('leagues.json')
const pack = (id: string): LeaguePack => ({ players: read<PlayersFile>(`${id}/players.json`), meta: read<MetaFile>(`${id}/meta.json`) })

describe('universeFromPacks', () => {
  it('builds England exactly as the tests (and the browser) do', () => {
    const expected = loadTestUniverse()
    const u = universeFromPacks(index, { england: pack('england') }, ['england'])
    expect(u.generatedAt).toBe(expected.generatedAt)
    expect(u.clubSeasons.length).toBe(expected.clubSeasons.length)
    expect(Object.keys(u.index).length).toBe(Object.keys(expected.index).length)
    expect(u.clubSeasons.map((cs) => `${cs.clubId}@${cs.season}`)).toEqual(expected.clubSeasons.map((cs) => `${cs.clubId}@${cs.season}`))
    expect(u.seed).toBe(expected.seed)
  }, 60000)

  it('builds two leagues in the index order, whatever order they are given in', () => {
    const second = index.leagues[1].id
    const expected = loadTestUniverse(['england', second])
    const u = universeFromPacks(index, { england: pack('england'), [second]: pack(second) }, [second, 'england'])
    expect(u.generatedAt).toBe(expected.generatedAt)
    expect(u.clubSeasons.length).toBe(expected.clubSeasons.length)
    expect(Object.keys(u.index).length).toBe(Object.keys(expected.index).length)
    expect(u.clubSeasons[0].leagueId).toBe('england')
    expect(u.leagues.map((l) => l.id)).toEqual(['england', second])
  }, 60000)

  it('refuses a missing league, a missing pack and a players file under another stamp', () => {
    expect(() => universeFromPacks(index, {}, [])).toThrow(/No league/)
    expect(() => universeFromPacks(index, { england: pack('england') }, ['atlantis'])).toThrow(/not in the/)
    expect(() => universeFromPacks(index, {}, ['england'])).toThrow(/No pack/)
    const p = pack('england')
    expect(() => universeFromPacks(index, { england: { ...p, players: { ...p.players, generatedAt: '1999-01-01' } } }, ['england'])).toThrow(/stamped 1999-01-01/)
    expect(() => universeFromPacks(index, { england: { ...p, meta: pack(index.leagues[1].id).meta } }, ['england'])).toThrow(/another league/)
  }, 60000)
})

describe('pack paths', () => {
  it('lists the index and two files per league, archived under the version', () => {
    expect(packFiles(['england', 'spain'])).toEqual(['leagues.json', 'england/players.json', 'england/meta.json', 'spain/players.json', 'spain/meta.json'])
    expect(archivePath('2026-10-25', 'england/meta.json')).toBe('v/2026-10-25/england/meta.json')
  })

  it('orders a puzzle\'s leagues by the index', () => {
    expect(puzzleLeagues({ leagueId: 'england', wheelLeagues: ['england'] })).toEqual(['england'])
    const second = index.leagues[1].id
    expect(puzzleLeagues({ leagueId: second, wheelLeagues: [second, 'england'] }, index)).toEqual(['england', second])
  })
})
