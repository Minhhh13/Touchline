import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { POSITIONS } from '../positions'
import { Rng } from '../rng'
import { canUse, eligibleSlots, isComplete, newDraft, pick, QUICK_RULES, spin } from '../draft'
import { getFormation } from '../formations'
import { ENGINE_VERSION } from '../version'
import type { LeaguesFile, LoadedUniverse, PlayersFile } from '../universe'

const DATA = path.resolve(__dirname, '..', '..', '..', 'public', 'data')
const readPack = (league: string): PlayersFile => JSON.parse(readFileSync(path.join(DATA, league, 'players.json'), 'utf8')) as PlayersFile
const ALL_LEAGUES = (JSON.parse(readFileSync(path.join(DATA, 'leagues.json'), 'utf8')) as LeaguesFile).leagues.map((l) => l.id)

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
    expect(u.generatedAt).toBe('2026-10-25')
    const e = loadTestUniverse(['england', 'spain'])
    expect(e.generatedAt).toBe(u.generatedAt)
    expect(ENGINE_VERSION).toMatch(/^\d+$/)
  })
})

describe('pack rows', () => {
  it('every row of every pack has finite hidden traits from 0 to 100', () => {
    for (const league of ALL_LEAGUES) {
      const pack = readPack(league)
      const cols = ['cons', 'inj', 'big', 'prof'].map((c) => pack.columns.indexOf(c))
      for (const i of cols) expect(i).toBeGreaterThanOrEqual(0)
      let bad = 0
      for (const row of pack.rows) {
        for (const i of cols) {
          const v = row[i]
          if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100) bad++
        }
      }
      expect(bad, league).toBe(0)
    }
  })

  it('full backs stand on the side of their stronger foot in the European Soccer Database seasons too', () => {
    // 2008-09 to 2013-14 come from line-up coordinates; from 2014-15 EA positions. Both eras should agree.
    for (const league of ['england', 'spain']) {
      const u = loadTestUniverse([league])
      const share = (from: number, to: number, pos: string) => {
        const ps = Object.values(u.index).filter((p) => p.season >= from && p.season <= to && p.positions[0] === pos)
        return { left: ps.filter((p) => p.foot === 'L').length / ps.length, n: ps.length }
      }
      for (const [from, to] of [[2008, 2013], [2014, 2026]]) {
        const lb = share(from, to, 'LB')
        const rb = share(from, to, 'RB')
        expect(lb.n).toBeGreaterThan(100)
        expect(rb.n).toBeGreaterThan(100)
        expect(lb.left, `${league} LB ${from}`).toBeGreaterThan(0.7)
        expect(rb.left, `${league} RB ${from}`).toBeLessThan(0.1)
      }
    }
  })
})

describe('Premier League tables 1992-93 to 2007-08', () => {
  const u = loadTestUniverse()
  const classic = Array.from({ length: 16 }, (_, i) => 1992 + i)
  it('has all sixteen, complete: 22 clubs and 462 matches until 1994-95, 20 and 380 after', () => {
    for (const s of classic) {
      const t = u.tables.england[s]
      expect(t, String(s)).toBeTruthy()
      const clubs = s <= 1994 ? 22 : 20
      expect(t.length).toBe(clubs)
      for (const r of t) expect(r.won + r.drawn + r.lost).toBe(2 * (clubs - 1))
      // every match counted once for each side
      expect(t.reduce((a, r) => a + r.won + r.drawn + r.lost, 0) / 2).toBe(clubs * (clubs - 1))
      expect(t.reduce((a, r) => a + r.goalsFor, 0)).toBe(t.reduce((a, r) => a + r.goalsAgainst, 0))
      expect(t.map((r) => r.position)).toEqual(Array.from({ length: clubs }, (_, i) => i + 1))
      // no players for these seasons yet, so nothing on the wheel
      expect(u.clubSeasons.some((cs) => cs.season === s)).toBe(false)
    }
  })
  it('resolves every one of the 40 clubs and gets the champions right', () => {
    const ids = new Set(classic.flatMap((s) => u.tables.england[s].map((r) => r.clubId)))
    expect(ids.size).toBe(40)
    for (const id of ids) expect(u.clubById[id], id).toBeTruthy()
    for (const id of ['oldham-athletic', 'swindon-town', 'barnsley', 'sheffield-wednesday', 'wimbledon']) expect(ids).toContain(id)
    const champions = classic.map((s) => u.tables.england[s][0].clubId)
    expect(champions).toEqual(['manchester-united', 'manchester-united', 'blackburn-rovers', 'manchester-united', 'manchester-united', 'arsenal', 'manchester-united', 'manchester-united', 'manchester-united', 'arsenal', 'manchester-united', 'arsenal', 'chelsea', 'chelsea', 'manchester-united', 'manchester-united'])
  })
  it('matches the real 1992-93 Manchester United and the unbeaten 2003-04 Arsenal', () => {
    const united = u.tables.england[1992][0]
    expect([united.clubId, united.won, united.drawn, united.lost, united.goalsFor, united.goalsAgainst, united.points]).toEqual(['manchester-united', 24, 12, 6, 67, 31, 84])
    const arsenal = u.tables.england[2003][0]
    expect([arsenal.clubId, arsenal.won, arsenal.drawn, arsenal.lost, arsenal.goalsFor, arsenal.goalsAgainst, arsenal.points]).toEqual(['arsenal', 26, 12, 0, 73, 26, 90])
  })
  it('applies the 1996-97 deduction: Middlesbrough 19th on 39 points after losing 3', () => {
    const t = u.tables.england[1996]
    const boro = t.find((r) => r.clubId === 'middlesbrough')!
    expect(boro.deduction).toBe(3)
    expect(boro.points).toBe(39)
    expect(boro.points).toBe(3 * boro.won + boro.drawn - 3)
    expect(boro.position).toBe(19)
    // nobody else lost points that season; the other Premier League deductions in the packs are the modern ones below
    const deducted = Object.entries(u.tables.england).flatMap(([s, rows]) => rows.filter((r) => r.deduction).map((r) => `${r.clubId}@${s}`))
    expect(deducted).toEqual(['middlesbrough@1996', 'portsmouth@2009', 'everton@2023', 'nottingham-forest@2023'])
    for (const rows of Object.values(u.tables.england)) for (const r of rows) expect(r.points).toBe(3 * r.won + r.drawn - (r.deduction ?? 0))
  })
})

describe('points deductions in the seasons with players', () => {
  const u = loadTestUniverse(['england', 'spain', 'italy', 'germany'])
  it('ranks every deducted club where the league did (the official tables on Wikipedia)', () => {
    const row = (league: string, season: number, clubId: string) => {
      const r = u.tables[league][season].find((x) => x.clubId === clubId)!
      return [r.position, r.points, r.deduction]
    }
    expect(row('england', 2009, 'portsmouth')).toEqual([20, 19, 9])
    expect(row('england', 2023, 'everton')).toEqual([15, 40, 8])
    expect(row('england', 2023, 'nottingham-forest')).toEqual([17, 32, 4])
    expect(row('spain', 2014, 'almeria')).toEqual([19, 29, 3])
    expect(row('italy', 2014, 'parma')).toEqual([20, 19, 7])
    expect(row('italy', 2018, 'chievo')).toEqual([20, 17, 3])
    expect(row('italy', 2022, 'juventus')).toEqual([7, 62, 10])
    // the wheel's club-seasons carry the same official finish
    expect(u.clubSeasonByKey['everton@2023'].position).toBe(15)
    expect(u.clubSeasonByKey['juventus@2022'].points).toBe(62)
    for (const league of ['england', 'spain', 'italy', 'germany']) {
      for (const rows of Object.values(u.tables[league])) {
        for (const r of rows) expect(r.points).toBe(3 * r.won + r.drawn - (r.deduction ?? 0))
        expect(rows.map((r) => r.position)).toEqual(rows.map((_, i) => i + 1))
        for (let i = 1; i < rows.length; i++) expect(rows[i - 1].points, `${league} ${rows[i].clubId}`).toBeGreaterThanOrEqual(rows[i].points)
      }
    }
    const all = ['england', 'spain', 'italy', 'germany'].flatMap((l) => Object.entries(u.tables[l]).flatMap(([s, rows]) => rows.filter((r) => r.deduction && Number(s) >= 2008).map((r) => `${l}:${r.clubId}@${s}`)))
    expect(all.length).toBe(7)
  })
})
