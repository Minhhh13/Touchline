import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { POSITIONS } from '../positions'
import { Rng } from '../rng'
import { canUse, eligibleSlots, isComplete, newDraft, pick, QUICK_RULES, spin } from '../draft'
import { getFormation } from '../formations'
import { ENGINE_VERSION } from '../version'
import type { LoadedUniverse } from '../universe'

/** Spin and pick a quick 4-3-3 from `leagues`, returning the club-seasons the wheel landed on. */
function quickDraftSpins(u: LoadedUniverse, leagues: string[], seed: string): string[] {
  const rng = new Rng(seed)
  const d = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues })
  const landed: string[] = []
  while (!isComplete(d)) {
    const cs = spin(u, d, rng)
    landed.push(`${cs.clubId}@${cs.season}`)
    const p = cs.squad.filter((x) => canUse(d, x)).sort((a, b) => b.overall - a.overall)[0]
    pick(u, d, p.id, eligibleSlots(d, p)[0].id)
  }
  return landed
}

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
  it('merges in data-index order whatever order the packs were loaded', () => {
    const a = loadTestUniverse(['england', 'germany', 'spain'])
    const b = loadTestUniverse(['england', 'spain', 'germany'])
    const c = loadTestUniverse(['germany', 'spain', 'england'])
    // leagues.json lists England, Spain, Italy, Germany, ...
    expect(a.leagues.map((l) => l.id)).toEqual(['england', 'spain', 'germany'])
    expect(b.leagues.map((l) => l.id)).toEqual(['england', 'spain', 'germany'])
    expect(c.leagues.map((l) => l.id)).toEqual(['england', 'spain', 'germany'])
    expect(a.clubSeasons.map((cs) => `${cs.clubId}@${cs.season}`)).toEqual(b.clubSeasons.map((cs) => `${cs.clubId}@${cs.season}`))
    expect(a.seed).toBe('england+germany+spain')
    expect(a.clubSeasons.length).toBe(b.clubSeasons.length)
  })
  it('spins the same European wheel for one seed whichever order the leagues were loaded', () => {
    const a = loadTestUniverse(['england', 'germany', 'spain'])
    const b = loadTestUniverse(['england', 'spain', 'germany'])
    const leagues = ['england', 'germany', 'spain']
    for (const seed of ['K7Q2-MX9A', 'europe-1', 'europe-2']) {
      const sa = quickDraftSpins(a, leagues, seed)
      const sb = quickDraftSpins(b, leagues, seed)
      expect(sa.length).toBe(11)
      expect(sa).toEqual(sb)
      // and the wheel really spans the merged leagues
      const landedLeagues = new Set(sa.map((k) => a.clubSeasonByKey[k].leagueId))
      expect(landedLeagues.size).toBeGreaterThan(1)
    }
  })
  it('carries the data stamp from leagues.json and the engine version', () => {
    expect(u.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(u.generatedAt).toBe('2026-10-24')
    const e = loadTestUniverse(['england', 'spain'])
    expect(e.generatedAt).toBe(u.generatedAt)
    expect(ENGINE_VERSION).toMatch(/^\d+$/)
  })
})
