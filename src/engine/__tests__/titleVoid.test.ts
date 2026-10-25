import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLeague, mergeUniverses, type LeaguesFile, type MetaFile, type PlayersFile } from '../universe'
import { realChampion } from '../records'

const DATA = path.resolve(__dirname, '..', '..', '..', 'public', 'data')
const players = JSON.parse(readFileSync(path.join(DATA, 'england', 'players.json'), 'utf8')) as PlayersFile
const meta = JSON.parse(readFileSync(path.join(DATA, 'england', 'meta.json'), 'utf8')) as MetaFile
const index = JSON.parse(readFileSync(path.join(DATA, 'leagues.json'), 'utf8')) as LeaguesFile

/** The real England pack with 2015-16 (a season with players) and 2003-04 (a historic table) marked as void titles. */
function voidedUniverse() {
  const m: MetaFile = { ...meta, seasons: meta.seasons.map((s) => (s.season === 2015 ? { ...s, titleVoid: true } : s)), historicTitleVoid: [2003] }
  return mergeUniverses([buildLeague(players, m)], index.leagues, index.generatedAt)
}

describe('a stripped or unawarded title (titleVoid)', () => {
  it('makes nobody champion and gives no Champion accolade, while the table keeps its order', () => {
    const u = voidedUniverse()
    expect(u.voidTitles.england).toEqual([2003, 2015])
    expect(u.tables.england[2015][0].clubId).toBe('leicester-city')
    expect(u.clubSeasonByKey['leicester-city@2015'].champions).toBe(false)
    expect(u.clubSeasons.filter((cs) => cs.season === 2015 && cs.champions)).toEqual([])
    const accolades = Object.values(u.index).filter((p) => p.season === 2015 && p.accolades.includes('Champion'))
    expect(accolades).toEqual([])
    expect(realChampion(u, 'england', 2015)).toBeNull()
    expect(realChampion(u, 'england', 2003)).toBeNull()
    // the seasons either side are untouched
    expect(u.clubSeasonByKey['chelsea@2016'].champions).toBe(true)
    expect(realChampion(u, 'england', 2016)).toBe('chelsea')
    expect(realChampion(u, 'england', 2004)).toBe('chelsea')
  })

  it('is absent from the shipped packs, so every complete season keeps its champion', () => {
    const u = mergeUniverses([buildLeague(players, meta)], index.leagues, index.generatedAt)
    expect(u.voidTitles.england).toEqual([])
    expect(u.clubSeasonByKey['leicester-city@2015'].champions).toBe(true)
    const champs = u.clubSeasons.filter((cs) => cs.champions)
    const complete = new Set(u.clubSeasons.filter((cs) => cs.complete).map((cs) => cs.season))
    expect(champs.length).toBe(complete.size)
  })
})
