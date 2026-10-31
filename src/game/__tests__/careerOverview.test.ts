import { describe, expect, it } from 'vitest'
import { careerOverview, orderAchievements } from '../logic/careerOverview'
import type { LeaderboardEntry } from '../types'

function entry(id: string, over: Partial<LeaderboardEntry>): LeaderboardEntry {
  return { id, date: '2026-10-01', mode: 'quick', teamName: 'XI', points: 80, won: 25, drawn: 5, lost: 8, position: 2, tier: 'EUROPEAN', seed: id, leagueSeason: 2025, hostClubId: 'arsenal', xi: [], ...over }
}

describe('the Profile career overview', () => {
  it('is empty and null-safe for a new manager', () => {
    const c = careerOverview({ leaderboard: [] }, { byMode: {}, league: 0 })
    expect(c).toEqual({ results: 0, byMode: [], kept: 0, record: { won: 0, drawn: 0, lost: 0, games: 0 }, winRate: null, pointsPerGame: null, firstPlaces: 0, titleRate: null, regulars: [] })
  })

  it('counts modes from the cabinet and the record from the league seasons kept', () => {
    const leaderboard = [
      entry('a', { won: 30, drawn: 5, lost: 3, points: 95, position: 1, hostClubId: 'arsenal', date: '2026-10-02' }),
      entry('b', { won: 20, drawn: 8, lost: 10, points: 68, position: 5, hostClubId: 'chelsea', date: '2026-10-05' }),
      entry('c', { won: 26, drawn: 6, lost: 6, points: 84, position: 1, hostClubId: 'chelsea', mode: 'daily', date: '2026-10-03' }),
      entry('d', { won: 22, drawn: 6, lost: 10, points: 72, position: 3, hostClubId: 'arsenal', mode: 'season', date: '2026-10-01' }),
      entry('e', { won: 22, drawn: 6, lost: 10, points: 72, position: 3, hostClubId: 'everton', superLeague: true }),
    ]
    const c = careerOverview({ leaderboard }, { byMode: { quick: 10, daily: 3, arena: 4, season: 1, runin: 0 }, league: 4 })
    expect(c.results).toBe(18)
    expect(c.byMode.map((m) => [m.mode, m.count])).toEqual([['quick', 10], ['arena', 4], ['daily', 3], ['season', 1]])
    expect(c.kept).toBe(5)
    expect(c.record).toEqual({ won: 120, drawn: 31, lost: 39, games: 190 })
    expect(c.winRate).toBe(63)
    expect(c.pointsPerGame).toBe(2.1)
    expect(c.firstPlaces).toBe(2)
    // Four titles in fourteen league seasons (the arena is not a league season)
    expect(c.titleRate).toBe(29)
    // Arsenal and Chelsea twice each, Chelsea the later; the Super League's host is no real club place
    expect(c.regulars).toEqual([{ clubId: 'chelsea', seasons: 2 }, { clubId: 'arsenal', seasons: 2 }])
  })
})

describe('the Profile achievements list', () => {
  const all = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  it('puts the unlocked first, newest first, and keeps the catalogue order otherwise', () => {
    const unlocked = { c: '2026-10-01', d: '2026-10-05', b: '2026-10-01' }
    expect(orderAchievements(all, unlocked).map((x) => x.id)).toEqual(['d', 'b', 'c', 'a'])
    expect(orderAchievements(all, unlocked, 'unlocked').map((x) => x.id)).toEqual(['d', 'b', 'c'])
    expect(orderAchievements(all, unlocked, 'locked').map((x) => x.id)).toEqual(['a'])
    expect(orderAchievements(all, {}).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('the career record against the cabinet', () => {
  it('counts a first place as the cabinet counts a title: a sacked season filed relegated is not one', () => {
    const o = careerOverview({ leaderboard: [entry('top', { position: 1, tier: 'CHAMPIONS', mode: 'season' }), entry('sacked', { position: 1, tier: 'RELEGATED', mode: 'season' })] }, { byMode: { season: 2 }, league: 1 })
    expect(o.firstPlaces).toBe(1)
    expect(o.kept).toBe(2)
  })

  it('keeps the league modes the cabinet keeps, and nothing else', () => {
    const o = careerOverview({ leaderboard: [entry('q', { mode: 'quick' }), entry('w', { mode: 'weekly' }), entry('r', { mode: 'runin' }), entry('a', { mode: 'arena' })] }, { byMode: { quick: 1, weekly: 1, runin: 1, arena: 1 }, league: 0 })
    expect(o.kept).toBe(2)
    expect(o.results).toBe(4)
  })
})
