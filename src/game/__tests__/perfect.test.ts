import { describe, expect, it } from 'vitest'
import { chaseAt, chaseLine, emptyBests, recordLabel, runsLine, versusPerfectLine, withQuickBests } from '../logic/perfect'
import { normaliseProfile } from '../logic/save'
import type { Profile } from '../types'

const g = (gf: number, ga: number) => ({ gf, ga })

describe('the 38-0 chase', () => {
  it('counts the perfect run and the unbeaten run from the first game', () => {
    const r = [g(2, 0), g(1, 0), g(3, 1), g(1, 1), g(2, 0), g(0, 1), g(4, 0)]
    expect(chaseAt(r, 3)).toMatchObject({ perfect: true, unbeaten: true, perfectRun: 3, unbeatenRun: 3, won: 3 })
    expect(chaseAt(r, 4)).toMatchObject({ perfect: false, unbeaten: true, perfectRun: 3, unbeatenRun: 4, perfectEndedAt: 4 })
    expect(chaseAt(r)).toMatchObject({ perfect: false, unbeaten: false, perfectRun: 3, unbeatenRun: 5, perfectEndedAt: 4, unbeatenEndedAt: 6, won: 5, drawn: 1, lost: 1 })
    expect(chaseAt(r, 0)).toMatchObject({ played: 0, perfect: true, perfectRun: 0 })
  })

  it('says it the way the playback shows it, with the moment it breaks', () => {
    const r = [...Array.from({ length: 12 }, () => g(2, 0)), g(1, 1), g(2, 0), g(1, 0), g(0, 2)]
    expect(chaseLine(chaseAt(r, 0), 38).headline).toBe('Chasing 38-0')
    expect(chaseLine(chaseAt(r, 12), 38)).toMatchObject({ tone: 'perfect', headline: 'Still perfect: 12-0', justBroke: false })
    expect(chaseLine(chaseAt(r, 13), 38)).toMatchObject({ tone: 'unbeaten', headline: 'Perfect run over at 12-0', detail: 'Unbeaten: 13', justBroke: true })
    expect(chaseLine(chaseAt(r, 15), 38)).toMatchObject({ tone: 'unbeaten', detail: 'Unbeaten: 15', justBroke: false })
    expect(chaseLine(chaseAt(r, 16), 38)).toMatchObject({ tone: 'over', headline: 'Perfect run over at 12-0', detail: 'Unbeaten run ended at 15', justBroke: true })
    const all = Array.from({ length: 38 }, () => g(1, 0))
    expect(chaseLine(chaseAt(all), 38).headline).toBe('38-0. The perfect season')
    expect(chaseLine(chaseAt(all.slice(0, 36)), 36).headline).toBe('36-0. The perfect season')
  })

  it('leads the summary with the record against 38-0', () => {
    expect(recordLabel(31, 4, 3)).toBe('31-4-3')
    expect(versusPerfectLine(31, 3, 38)).toBe('7 wins short')
    expect(versusPerfectLine(37, 3, 38)).toBe('1 win short')
    expect(versusPerfectLine(30, 0, 38)).toBe('Unbeaten, 8 draws short')
    expect(versusPerfectLine(38, 0, 38)).toBe('The perfect season')
    expect(runsLine({ perfectRun: 12, unbeatenRun: 15 })).toBe('Perfect run 12-0 · unbeaten from the start 15')
    expect(runsLine({ perfectRun: 0, unbeatenRun: 0 })).toBe('Game 1 not won')
    expect(chaseLine(chaseAt([g(0, 1)]), 38).headline).toBe('Perfect run over in game 1')
  })

  it('keeps the Profile bests: best record, longest perfect run and perfect seasons', () => {
    const season = (won: number, drawn: number, lost: number, results: Array<{ gf: number; ga: number }>) => ({ won, drawn, lost, points: won * 3 + drawn, results })
    let b = withQuickBests(undefined, season(25, 8, 5, [g(1, 0), g(1, 0), g(0, 0)]), 38)
    expect(b).toEqual({ perfectSeasons: 0, longestPerfectRun: 2, bestRecord: { won: 25, drawn: 8, lost: 5, points: 83, games: 38 } })
    b = withQuickBests(b, season(25, 9, 4, [g(0, 1)]), 38)
    expect(b.bestRecord).toMatchObject({ won: 25, lost: 4 })
    expect(b.longestPerfectRun).toBe(2)
    b = withQuickBests(b, season(24, 14, 0, [g(1, 0), g(1, 0), g(1, 0), g(1, 1)]), 38)
    expect(b.bestRecord).toMatchObject({ won: 25, lost: 4 })
    expect(b.longestPerfectRun).toBe(3)
    b = withQuickBests(b, season(38, 0, 0, Array.from({ length: 38 }, () => g(2, 0))), 38)
    expect(b).toMatchObject({ perfectSeasons: 1, longestPerfectRun: 38, bestRecord: { won: 38, drawn: 0, lost: 0 } })
    expect(emptyBests()).toEqual({ perfectSeasons: 0, longestPerfectRun: 0 })
  })

  it('fills the bests in on a profile saved before them, and keeps them on one saved after', () => {
    const defaults: Profile = { achievements: {}, leaderboard: [], dailyStreak: 0, lastDailyDate: null, dailyResults: {}, gamesPlayed: 0, seasonsSimulated: 0, theme: 'auto', managerName: '' }
    const old = { ...defaults, gamesPlayed: 7, managerName: 'Gaffer' }
    const n = normaliseProfile(old, defaults)
    expect(n.quickBests).toEqual({ perfectSeasons: 0, longestPerfectRun: 0 })
    expect(n.gamesPlayed).toBe(7)
    expect(n.managerName).toBe('Gaffer')
    const kept = normaliseProfile({ ...old, quickBests: { perfectSeasons: 2, longestPerfectRun: 38, bestRecord: { won: 38, drawn: 0, lost: 0, points: 114, games: 38 } } }, defaults)
    expect(kept.quickBests).toEqual({ perfectSeasons: 2, longestPerfectRun: 38, bestRecord: { won: 38, drawn: 0, lost: 0, points: 114, games: 38 } })
    expect(normaliseProfile(undefined, defaults).quickBests).toEqual({ perfectSeasons: 0, longestPerfectRun: 0 })
    // A JSON round trip: still plain data
    expect(JSON.parse(JSON.stringify(kept))).toEqual(kept)
  })
})
