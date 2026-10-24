import { describe, expect, it } from 'vitest'
import { loadTestUniverse, } from './helpers'
import { POSITIONS } from '../positions'

describe('universe data', () => {
  const u = loadTestUniverse()
  it('covers every season from 2008-09 with 20 clubs each', () => {
    const seasons = [...new Set(u.clubSeasons.map((cs) => cs.season))].sort()
    expect(seasons[0]).toBe(2008)
    expect(seasons.length).toBeGreaterThanOrEqual(19)
    for (const s of seasons) expect(u.clubSeasons.filter((cs) => cs.season === s).length).toBe(20)
  })
  it('has thousands of valid player-seasons', () => {
    const all = Object.values(u.index)
    expect(all.length).toBeGreaterThan(10000)
    for (const p of all) {
      expect(p.overall).toBeGreaterThan(30)
      expect(p.overall).toBeLessThanOrEqual(99)
      expect(p.positions.length).toBeGreaterThan(0)
      for (const pos of p.positions) expect(POSITIONS).toContain(pos)
      expect(p.age).toBeGreaterThan(14)
      expect(p.age).toBeLessThan(45)
      expect(p.value).toBeGreaterThan(0)
      expect(u.clubById[p.clubId]).toBeTruthy()
    }
  })
  it('knows famous player-seasons with post-season ratings', () => {
    const vardy = Object.values(u.index).find((p) => p.name === 'J. Vardy' && p.season === 2015)
    expect(vardy?.clubId).toBe('leicester-city')
    expect(vardy?.overall).toBeGreaterThanOrEqual(80)
    expect(vardy?.accolades).toContain('Champion')
  })
  it('has complete tables with champions', () => {
    const t = u.tables.england[2015]
    expect(t[0].clubId).toBe('leicester-city')
    expect(t.length).toBe(20)
    expect(u.clubSeasonByKey['leicester-city@2015'].champions).toBe(true)
  })
  it('merges other leagues with their own clubs and seasons', () => {
    const e = loadTestUniverse(['england', 'spain', 'germany'])
    expect(e.leagues.map((l) => l.id)).toEqual(['england', 'spain', 'germany'])
    expect(e.clubSeasons.filter((cs) => cs.leagueId === 'germany' && cs.season === 2024).length).toBe(18)
    expect(e.clubSeasons.filter((cs) => cs.leagueId === 'spain' && cs.season === 2024).length).toBe(20)
    expect(e.tables.spain[2024][0].clubId).toBe('fc-barcelona')
    expect(e.tables.germany[2023][0].clubId).toBe('bayer-leverkusen')
    const messi = Object.values(e.index).find((p) => p.name === 'L. Messi' && p.season === 2014)
    expect(messi?.clubId).toBe('fc-barcelona')
    expect(messi?.overall).toBeGreaterThanOrEqual(90)
  })
})
