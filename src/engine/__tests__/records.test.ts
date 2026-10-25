import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { benchmarkSeason, hasRecordBook, historicRows, isPointsRecord, playedOf, realChampion, recordShareLine, RECORD_BOOK_MIN_SEASONS, type SeasonFigures } from '../records'

describe('the record books', () => {
  const england = loadTestUniverse(['england'])

  it('reads only complete seasons: the 2000-07 historic tables are in, the season in progress is out', () => {
    const rows = historicRows(england, 'england')
    const seasons = [...new Set(rows.map((r) => r.season))]
    expect(seasons).toEqual(Array.from({ length: 26 }, (_, i) => 2000 + i))
    expect(seasons).not.toContain(england.currentSeason)
    expect(rows).toHaveLength(26 * 20)
    for (const r of rows) {
      expect(r.played).toBe(38)
      expect(playedOf(r.row)).toBe(38)
    }
  })

  it('Manchester City 2017-18 is the best 38-game points total in Premier League history', () => {
    const city = england.tables.england[2017].find((r) => r.clubId === 'manchester-city')!
    expect(city.points).toBe(100)
    const b = benchmarkSeason(england, 'england', city)
    expect(b.played).toBe(38)
    expect(b.seasons).toBe(26)
    expect(b.points.rank).toBe(1)
    expect(b.points.of).toBe(520)
    expect(b.points.better).toEqual([])
    // It is compared against itself, so it ties the record rather than beating it
    expect(b.points.equal).toBe(1)
    expect(b.records.map((m) => m.key)).not.toContain('points')
    expect(hasRecordBook(b)).toBe(true)
    expect(recordShareLine(b, 'English League')).toBe('📜 Joint-best points total in English League history')
  })

  it('a 101-point season is an outright points record and says so in the share line', () => {
    const row: SeasonFigures = { won: 33, drawn: 2, lost: 3, points: 101, goalsFor: 95, goalsAgainst: 30 }
    const b = benchmarkSeason(england, 'england', row)
    expect(b.points.rank).toBe(1)
    expect(b.points.equal).toBe(0)
    expect(b.records.map((m) => m.key)).toContain('points')
    expect(b.records.map((m) => m.key)).toContain('wins')
    expect(isPointsRecord(b)).toBe(true)
    expect(recordShareLine(b, 'English League')).toBe('📜 New English League points record: 101')
  })

  it('ranks a near miss behind the real seasons, best first, and knows which way is up for defeats and goals conceded', () => {
    // Chelsea 2004-05 to the point: 29-8-1, 95 points, 15 conceded
    const row: SeasonFigures = { won: 29, drawn: 8, lost: 1, points: 95, goalsFor: 80, goalsAgainst: 15 }
    const b = benchmarkSeason(england, 'england', row)
    expect(b.points.better).toHaveLength(3)
    expect(b.points.better[0]).toEqual({ clubId: 'manchester-city', season: 2017, value: 100 })
    expect(b.points.better[1]).toEqual({ clubId: 'liverpool', season: 2019, value: 99 })
    expect(b.points.better[2]).toEqual({ clubId: 'manchester-city', season: 2018, value: 98 })
    const strictlyBetter = historicRows(england, 'england').filter((h) => h.row.points > 95).length
    expect(b.points.rank).toBe(strictlyBetter + 1)
    expect(b.points.rank).toBe(5)
    expect(b.points.equal).toBe(1)
    expect(recordShareLine(b, 'English League')).toBe('📜 5th-best points total in English League history')
    // Fewer is better for goals conceded: 15 ties Chelsea 2004-05, so it is rank 1 but not an outright record
    expect(b.goalsAgainst.higherIsBetter).toBe(false)
    expect(b.goalsAgainst.rank).toBe(1)
    expect(b.goalsAgainst.equal).toBe(1)
    expect(b.goalsAgainst.better).toEqual([])
    expect(b.records.map((m) => m.key)).not.toContain('goalsAgainst')
    // One defeat sits behind Arsenal 2003-04 alone and level with Chelsea 2004-05 and Liverpool 2018-19
    expect(b.defeats.higherIsBetter).toBe(false)
    expect(b.defeats.better).toEqual([{ clubId: 'arsenal', season: 2003, value: 0 }])
    expect(b.defeats.rank).toBe(2)
    expect(b.defeats.equal).toBe(2)
  })

  it('a mid-table season adds no share line', () => {
    const b = benchmarkSeason(england, 'england', { won: 14, drawn: 10, lost: 14, points: 52, goalsFor: 50, goalsAgainst: 50 })
    expect(b.points.rank).toBeGreaterThan(10)
    expect(recordShareLine(b, 'English League')).toBeNull()
    expect(b.records).toEqual([])
  })

  it('compares a 34-game Bundesliga season only with 34-game seasons', () => {
    const germany = loadTestUniverse(['germany'])
    const rows = historicRows(germany, 'germany')
    const seasons = [...new Set(rows.map((r) => r.season))]
    // 2008-09 and 2009-10 ship without a table, 2026-27 is in progress
    expect(seasons[0]).toBe(2010)
    expect(seasons.at(-1)).toBe(2025)
    expect(seasons).toHaveLength(16)
    for (const r of rows) expect(r.played).toBe(34)
    const b34 = benchmarkSeason(germany, 'germany', { won: 25, drawn: 5, lost: 4, points: 80, goalsFor: 90, goalsAgainst: 30 })
    expect(b34.played).toBe(34)
    expect(b34.points.of).toBe(16 * 18)
    expect(b34.seasons).toBe(16)
    expect(b34.points.better[0].clubId).toBe('bayern-munich')
    const b38 = benchmarkSeason(germany, 'germany', { won: 28, drawn: 6, lost: 4, points: 90, goalsFor: 90, goalsAgainst: 30 })
    expect(b38.points.of).toBe(0)
    expect(b38.seasons).toBe(0)
    expect(b38.records).toEqual([])
  })

  it('France has no tables: nothing to compare, no record book, no champion', () => {
    const france = loadTestUniverse(['france'])
    expect(historicRows(france, 'france')).toEqual([])
    const b = benchmarkSeason(france, 'france', { won: 33, drawn: 2, lost: 3, points: 101, goalsFor: 95, goalsAgainst: 30 })
    expect(b.points.of).toBe(0)
    expect(b.points.rank).toBe(1)
    expect(b.seasons).toBe(0)
    expect(b.records).toEqual([])
    expect(hasRecordBook(b)).toBe(false)
    expect(isPointsRecord(b)).toBe(false)
    expect(recordShareLine(b, 'French League')).toBeNull()
    expect(realChampion(france, 'france', 2019)).toBeNull()
    expect(RECORD_BOOK_MIN_SEASONS).toBe(10)
  })

  it('names the real champions of a complete season and nobody for one still being played', () => {
    expect(realChampion(england, 'england', 2017)).toBe('manchester-city')
    expect(realChampion(england, 'england', 2003)).toBe('arsenal')
    expect(realChampion(england, 'england', 2015)).toBe('leicester-city')
    expect(realChampion(england, 'england', 2026)).toBeNull()
    expect(realChampion(england, 'england', 1999)).toBeNull()
    expect(realChampion(england, 'spain', 2017)).toBeNull()
  })
})
