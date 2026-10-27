import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { canCover } from '@engine/positions'
import { getFormation } from '@engine/formations'
import { realChampion } from '@engine/records'
import { bestXIEver, careerLine, clubHistory, clubSummary, compareRows, COMPARE_MAX, leagueChampions, leagueClubs, leagueRecordBook, oneIn, shareLabel, titleCounts, toggleCompare, topRatedBySeason, wheelChanceOf, wheelChances, xiAverage } from '../logic/exploreDb'
import { careerSeasons } from '../logic/playerCard'

const u = loadTestUniverse(['england', 'germany', 'france'])

describe("Explore's club pages", () => {
  it('lists every club of a league once, the most titles first', () => {
    const clubs = leagueClubs(u, 'england')
    expect(new Set(clubs.map((c) => c.clubId)).size).toBe(clubs.length)
    expect(clubs.every((c) => u.clubById[c.clubId]?.leagueId === 'england')).toBe(true)
    for (let i = 1; i < clubs.length; i++) expect(clubs[i - 1].titles).toBeGreaterThanOrEqual(clubs[i].titles)
    const total = clubs.reduce((s, c) => s + c.titles, 0)
    expect(total).toBe(u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.champions).length)
    expect(clubs[0].titles).toBeGreaterThan(0)
  })

  it("gives a club's history newest first with its real finishes", () => {
    const lines = clubHistory(u, 'manchester-city')
    expect(lines.length).toBeGreaterThan(10)
    for (let i = 1; i < lines.length; i++) expect(lines[i - 1].cs.season).toBeGreaterThan(lines[i].cs.season)
    for (const l of lines) {
      expect(l.table).toBe(!!u.tables.england?.[l.cs.season]?.length)
      expect(l.xiAvg).toBeCloseTo(xiAverage(l.cs), 10)
      expect(l.top?.overall).toBe(Math.max(...l.cs.squad.map((p) => p.overall)))
    }
    const sum = clubSummary(lines)
    expect(sum.titles).toBe(lines.filter((l) => l.cs.champions).length)
    expect(sum.titles).toBeGreaterThan(3)
    expect(sum.avgFinish).not.toBeNull()
    expect(sum.topFour).toBeGreaterThanOrEqual(sum.titles)
  })

  it('picks a best XI ever with each real player once, all from the club, natural or cover in their slots', () => {
    for (const clubId of ['arsenal', 'liverpool', 'bayern-munich']) {
      if (!u.clubById[clubId]) continue
      const xi = bestXIEver(u, clubId)
      expect(xi).toHaveLength(11)
      expect(new Set(xi.map((x) => x.p.playerId)).size).toBe(11)
      expect(xi.map((x) => x.slotId)).toEqual(getFormation('4-3-3').slots.map((s) => s.id))
      for (const x of xi) {
        expect(x.p.clubId).toBe(clubId)
        expect(canCover(x.p, x.position)).toBe(true)
      }
      // The same XI on a second call: nothing depends on order or state
      expect(bestXIEver(u, clubId)).toEqual(xi)
    }
  })
})

describe("Explore's league pages", () => {
  it('names the real champion of every complete season with a table, and none without one', () => {
    const lines = leagueChampions(u, 'england')
    for (let i = 1; i < lines.length; i++) expect(lines[i - 1].season).toBeGreaterThan(lines[i].season)
    for (const l of lines) {
      const real = realChampion(u, 'england', l.season)
      if (real && l.complete) expect(l.first?.clubId).toBe(real)
      if (l.first && l.second) expect(l.gap).toBe(l.first.points - l.second.points)
    }
    // France has no tables: nobody is placed
    for (const l of leagueChampions(u, 'france')) {
      expect(l.table).toBe(false)
      expect(l.first).toBeUndefined()
    }
    const counts = titleCounts(u, 'england')
    expect(counts.reduce((s, c) => s + c.titles, 0)).toBe(lines.filter((l) => l.first?.champions).length)
  })

  it('gives the top-rated players of each season, best first', () => {
    const rows = topRatedBySeason(u, 'germany', 3)
    expect(rows.length).toBeGreaterThan(10)
    for (const r of rows) {
      expect(r.players).toHaveLength(3)
      const all = u.clubSeasons.filter((cs) => cs.leagueId === 'germany' && cs.season === r.season).flatMap((cs) => cs.squad)
      expect(r.players[0].overall).toBe(Math.max(...all.map((p) => p.overall)))
      expect(r.players[0].overall).toBeGreaterThanOrEqual(r.players[2].overall)
    }
  })

  it('keeps one season length in the record book and names every holder', () => {
    const book = leagueRecordBook(u, 'germany')!
    expect(book.played).toBe(34)
    const eng = leagueRecordBook(u, 'england')!
    expect(eng.played).toBe(38)
    const most = eng.records.find((r) => r.key === 'mostPoints')!
    // Manchester City's 100 points in 2017-18
    expect(most.value).toBe(100)
    expect(most.holders).toContainEqual({ clubId: 'manchester-city', season: 2017 })
    for (const r of eng.records) {
      expect(r.holders.length).toBeGreaterThan(0)
      for (const h of r.holders) expect(u.tables.england[h.season].some((row) => row.clubId === h.clubId)).toBe(true)
    }
    expect(leagueRecordBook(u, 'france')).toBeNull()
  })
})

describe('on this wheel', () => {
  it("reads the engine's exact first-spin odds: they add up to one and each season gets an equal share", () => {
    const map = wheelChances(u, 'england')
    const total = [...map.values()].reduce((s, w) => s + w.p, 0)
    expect(total).toBeCloseTo(1, 9)
    const bySeason = new Map<number, number>()
    for (const [key, w] of map) {
      const season = Number(key.split('@')[1])
      bySeason.set(season, (bySeason.get(season) ?? 0) + w.seasonShare)
    }
    for (const share of bySeason.values()) expect(share).toBeCloseTo(1, 9)
    // A champion weighs more than a relegated side of the same season
    const season = 2015
    const champ = u.clubSeasons.find((cs) => cs.leagueId === 'england' && cs.season === season && cs.champions)!
    const last = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === season).sort((a, b) => b.position - a.position)[0]
    expect(wheelChanceOf(u, champ)!.p).toBeGreaterThan(wheelChanceOf(u, last)!.p)
    // Cached: the same map on a second call
    expect(wheelChances(u, 'england')).toBe(map)
  })

  it('words a chance', () => {
    expect(oneIn(1 / 412)).toBe('1 in 412')
    expect(oneIn(0)).toBe('never')
    expect(shareLabel(0.0634)).toBe('6.3%')
    expect(shareLabel(0.0001)).toBe('<0.1%')
  })
})

describe('compare', () => {
  it('lines up the same rows for every player and marks the leaders', () => {
    const a = careerSeasons(u, u.clubSeasonByKey['manchester-city@2022'].squad[0].playerId)
    const b = careerSeasons(u, u.clubSeasonByKey['liverpool@2019'].squad[0].playerId)
    const players = [a[a.length - 1], b[b.length - 1]]
    const rows = compareRows(players)
    expect(rows[0].key).toBe('overall')
    for (const r of rows) {
      expect(r.values).toHaveLength(2)
      if (r.leaders.length) for (const i of r.leaders) expect(r.values[i]).toBe(Math.max(...r.values))
    }
    expect(rows.find((r) => r.key === 'age')!.leaders).toEqual([])
    expect(rows.some((r) => r.key === 'goalkeeping')).toBe(true)
    expect(compareRows([])).toEqual([])
    const line = careerLine(a)!
    expect(line.peak).toBe(Math.max(...a.map((s) => s.overall)))
    expect(careerLine([])).toBeNull()
  })

  it('holds at most three players, the oldest dropped', () => {
    let list: string[] = []
    for (const id of ['a', 'b', 'c', 'd']) list = toggleCompare(list, id)
    expect(list).toEqual(['b', 'c', 'd'])
    expect(list.length).toBe(COMPARE_MAX)
    expect(toggleCompare(list, 'c')).toEqual(['b', 'd'])
  })
})
