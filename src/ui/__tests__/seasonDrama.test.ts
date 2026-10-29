import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame } from '@game/logic/setup'
import { runQuickSeason } from '@game/logic/quick'
import { tableAfterGame, weeklyTables, type LiveRow } from '@game/logic/liveTable'
import { playbackDelay, PLAYBACK_SPEEDS } from '@game/logic/gameByGame'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { USER_TEAM } from '@engine/season'
import type { GameSettings, QuickGameResult } from '@game/types'
import { digestWinRun, flareAt, goalFlashes, RACE_EXTRA_MAX_MS, RACE_GAMES, raceAt, raceDelay } from '../seasonDrama'

const u = loadTestUniverse(['england'])

/** A table of `n` clubs on these points, the user's row named `me` (already in table order). */
function table(points: number[], me: number): LiveRow[] {
  return points.map((p, i) => ({ teamId: i === me ? USER_TEAM : `c${i}`, played: 30, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: p }))
}

function shaped(shape: string): QuickGameResult[] {
  return [...shape].map((o, i) => ({ matchweek: i + 1, opponentId: 'x', home: i % 2 === 0, position: 1, scorers: [], ...(o === 'W' ? { gf: 2, ga: 1 } : o === 'R' ? { gf: 5, ga: 0 } : o === 'D' ? { gf: 1, ga: 1 } : o === 'N' ? { gf: 0, ga: 0 } : { gf: 0, ga: 1 }) }) as QuickGameResult)
}

function quickSeason(seed: string) {
  const settings: GameSettings = { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Drama XI', shortName: 'DRA', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'], managers: false }, jobSecurity: false, difficulty: 'calibrated' }
  const g = createGame(settings)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  const before = g.rngState
  runQuickSeason(g, u)
  const q = g.quickResult!
  return { results: q.results!, tables: q.rounds ? weeklyTables(q.rounds) : [], rngState: g.rngState, before }
}

describe('the title race in the last weeks', () => {
  const twenty = (top: number, second: number, me: number) => {
    const pts = Array.from({ length: 20 }, (_, i) => 60 - i * 2)
    pts[0] = top
    pts[1] = second
    return table(pts, me)
  }
  it('is on for a leader the games left could still catch, and for a chaser within reach', () => {
    expect(raceAt(twenty(80, 77, 0), USER_TEAM, 36, 38)).toEqual({ kind: 'title', left: 2 })
    expect(raceAt(twenty(80, 77, 1), USER_TEAM, 37, 38)).toEqual({ kind: 'title', left: 1 })
    // Sealed (a lead the games left cannot close) or a long shot (more than RACE_GAP.title behind)
    expect(raceAt(twenty(80, 73, 0), USER_TEAM, 36, 38)).toBeNull()
    expect(raceAt(twenty(80, 72, 1), USER_TEAM, 33, 38)).toBeNull()
  })
  it('waits for the last RACE_GAMES and ends with the season', () => {
    expect(raceAt(twenty(80, 79, 0), USER_TEAM, 38 - RACE_GAMES - 1, 38)).toBeNull()
    expect(raceAt(twenty(80, 79, 0), USER_TEAM, 38 - RACE_GAMES, 38)?.left).toBe(RACE_GAMES)
    expect(raceAt(twenty(80, 79, 0), USER_TEAM, 38, 38)).toBeNull()
  })
  it('turns to a drop fight in or just above the bottom three, and the title wins over it', () => {
    const pts = [80, 70, 60, 55, 50, 48, 46, 45, 44, 43, 42, 41, 40, 39, 38, 36, 35, 34, 33, 30]
    expect(raceAt(table(pts, 17), USER_TEAM, 35, 38)).toEqual({ kind: 'drop', left: 3 })
    expect(raceAt(table(pts, 16), USER_TEAM, 35, 38)).toEqual({ kind: 'drop', left: 3 })
    expect(raceAt(table(pts, 10), USER_TEAM, 35, 38)).toBeNull()
    // Too far below the line with one game left: 36 - 30 = 6 > 3
    expect(raceAt(table(pts, 19), USER_TEAM, 37, 38)).toBeNull()
  })
  it('stretches the wait more as the games run out, never by more than RACE_EXTRA_MAX_MS', () => {
    expect(raceDelay(1500, null)).toBe(1500)
    const waits = [6, 5, 4, 3, 2, 1].map((left) => raceDelay(1500, { kind: 'title', left }))
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThan(waits[i - 1])
    expect(waits.at(-1)).toBe(3150)
    expect(raceDelay(3000, { kind: 'title', left: 1 })).toBe(3000 + RACE_EXTRA_MAX_MS)
  })
  it('slows a real season only in its last games and by a bounded amount, and never touches its generator', () => {
    let races = 0
    for (const seed of ['drama-a', 'drama-b', 'drama-c', 'drama-d', 'drama-e', 'drama-f']) {
      const s = quickSeason(seed)
      const total = s.results.length
      for (const speed of PLAYBACK_SPEEDS) {
        const base = playbackDelay(speed)
        let extra = 0
        for (let k = 0; k < total; k++) {
          const race = raceAt(tableAfterGame(s.tables, s.results, k), USER_TEAM, k, total)
          if (race) {
            races++
            expect(total - k).toBeLessThanOrEqual(RACE_GAMES)
          }
          extra += raceDelay(base, race) - base
        }
        expect(extra).toBeLessThanOrEqual(RACE_GAMES * RACE_EXTRA_MAX_MS)
      }
      // Reading the drama replays nothing: the season's own stream is where the season left it
      const again = quickSeason(seed)
      expect(again.rngState).toEqual(s.rngState)
    }
    expect(races).toBeGreaterThan(0)
  })
})

describe('streaks and milestones', () => {
  it('flares a run of wins at 3, 5 and 7, but not while the whole season is still perfect', () => {
    expect(flareAt(shaped('WWW'), 3)).toBeNull()
    expect(flareAt(shaped('DWWW'), 4)).toEqual({ kind: 'wins', n: 3, box: 'w' })
    expect(flareAt(shaped('DWWWW'), 5)).toBeNull()
    expect(flareAt(shaped('DWWWWW'), 6)?.n).toBe(5)
  })
  it('flares an unbeaten run from ten, clean sheets from three and a rout', () => {
    expect(flareAt(shaped('LDDDDDDDDDD'), 11)).toEqual({ kind: 'unbeaten', n: 10, box: 'w' })
    expect(flareAt(shaped('LNNN'), 4)).toEqual({ kind: 'clean', n: 3, box: null })
    expect(flareAt(shaped('LR'), 2)).toEqual({ kind: 'rout', n: 5, box: null })
  })
  it('gives a milestone crossed the first say', () => {
    // 16 wins and a draw is 49 points; the next win crosses 50 (and also extends the run); wins here are 2-1, no clean sheets
    const r = shaped('L' + 'W'.repeat(16) + 'D' + 'W')
    expect(flareAt(r, r.length)).toEqual({ kind: 'points', n: 50, box: 'pts' })
    const goals = shaped('L' + 'R'.repeat(10))
    expect(flareAt(goals, goals.length)).toEqual({ kind: 'goals', n: 50, box: null })
  })
  it('flashes a score once a goal, at most five times, and finds the digest’s run of wins', () => {
    expect([0, 1, 3, 5, 9].map(goalFlashes)).toEqual([0, 1, 3, 5, 5])
    expect(digestWinRun(['W', 'W', 'D', 'W', 'W', 'W', 'L'])).toBe(3)
    expect(digestWinRun(['W', 'W', 'D'])).toBe(0)
  })
  it('stays out of range and rare enough over real seasons', () => {
    let flares = 0
    let games = 0
    for (const seed of ['drama-a', 'drama-b', 'drama-c', 'drama-d']) {
      const s = quickSeason(seed)
      expect(flareAt(s.results, 0)).toBeNull()
      expect(flareAt(s.results, s.results.length + 1)).toBeNull()
      for (let k = 1; k <= s.results.length; k++) {
        games++
        if (flareAt(s.results, k)) flares++
      }
    }
    // A flare is an event, not the weather
    expect(flares).toBeGreaterThan(0)
    expect(flares / games).toBeLessThan(0.35)
  })
})
