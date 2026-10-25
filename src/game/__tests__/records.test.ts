import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame } from '../logic/setup'
import { runQuickSeason } from '../logic/quick'
import { earnsPointsRecord } from '../logic/records'
import { autoDraft, isComplete, QUICK_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { ACHIEVEMENT_BY_ID } from '@engine/awards'
import { benchmarkSeason, isPointsRecord } from '@engine/records'
import type { GameSettings } from '../types'

const record = { won: 33, drawn: 2, lost: 3, points: 101, goalsFor: 95, goalsAgainst: 30 }

describe('the Record Books achievement', () => {
  const u = loadTestUniverse(['england'])

  it('exists and is gated to a full season on Realistic', () => {
    expect(ACHIEVEMENT_BY_ID['record-points']).toBeDefined()
    expect(earnsPointsRecord(u, 'england', 'realistic', record, 38, false)).toBe(true)
    // Calibrated handicaps the AI: a hundred-point season there is a benchmark, not a record
    expect(earnsPointsRecord(u, 'england', 'calibrated', record, 38, false)).toBe(false)
    expect(earnsPointsRecord(u, 'england', undefined, record, 38, false)).toBe(false)
    // Sacked, or a season that stopped short of the real programme, is not compared
    expect(earnsPointsRecord(u, 'england', 'realistic', record, 38, true)).toBe(false)
    expect(earnsPointsRecord(u, 'england', 'realistic', { ...record, lost: 2 }, 38, false)).toBe(false)
    // Tying the record (100 points) is not setting it
    expect(earnsPointsRecord(u, 'england', 'realistic', { ...record, points: 100 }, 38, false)).toBe(false)
  })

  it('a league without tables cannot award it', () => {
    const france = loadTestUniverse(['france'])
    expect(earnsPointsRecord(france, 'france', 'realistic', record, 38, false)).toBe(false)
  })

  it('the quick season applies the same gate it shows on the summary', () => {
    for (const difficulty of ['realistic', 'calibrated'] as const) {
      const settings: GameSettings = { mode: 'quick', seed: `records-${difficulty}`, formationId: '4-3-3', teamName: 'Records XI', shortName: 'REC', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty }
      const g = createGame(settings)
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      expect(isComplete(g.draft!)).toBe(true)
      runQuickSeason(g, u)
      const q = g.quickResult!
      const bench = benchmarkSeason(u, 'england', q)
      expect(bench.played).toBe(38)
      expect(g.unlocked.includes('record-points')).toBe(difficulty === 'realistic' && isPointsRecord(bench))
      expect(g.unlocked.includes('record-points')).toBe(earnsPointsRecord(u, 'england', difficulty, q, 38, false))
    }
  })
})
