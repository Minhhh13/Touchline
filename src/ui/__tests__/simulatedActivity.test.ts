import { describe, expect, it } from 'vitest'
import type { AlltimeRow } from '../../online/boards'
import { fillAlltimeBoard, isSimulatedAlltimeRow, SIMULATION_BASE, SIMULATION_EPOCH, simulatedGamesAt } from '../online/simulatedActivity'

const REAL: AlltimeRow = {
  position: 1,
  name: 'RopZ',
  country: 'AU',
  totalPoints: 77,
  played: 1,
  average: 77,
  bestStreak: 1,
  currentStreak: 0,
  lastDate: '2026-10-31',
  isMe: true,
}

describe('the World board AI exhibition', () => {
  it('keeps the activity figure deterministic and moving forward', () => {
    expect(simulatedGamesAt(SIMULATION_EPOCH)).toBe(SIMULATION_BASE)
    expect(simulatedGamesAt(SIMULATION_EPOCH - 60_000)).toBe(SIMULATION_BASE)
    expect(simulatedGamesAt(SIMULATION_EPOCH + 24_000)).toBe(SIMULATION_BASE + 10)
  })

  it('keeps every real row and official rank first, then fills twelve display places with labelled AI rows', () => {
    const input = [REAL]
    const shown = fillAlltimeBoard(input, 'points', null)
    expect(shown).toHaveLength(12)
    expect(shown[0]).toBe(REAL)
    expect(shown[0].position).toBe(1)
    expect(shown.slice(1).every(isSimulatedAlltimeRow)).toBe(true)
    expect(new Set(shown.map((r) => r.name)).size).toBe(shown.length)
    expect(input).toEqual([REAL])
  })

  it('orders the exhibition for the selected view and respects the country filter', () => {
    const byPoints = fillAlltimeBoard([], 'points', null)
    const byStreak = fillAlltimeBoard([], 'streak', null)
    expect(byPoints[0].totalPoints).toBeGreaterThanOrEqual(byPoints[1].totalPoints)
    expect(byStreak[0].bestStreak).toBeGreaterThanOrEqual(byStreak[1].bestStreak)
    const australia = fillAlltimeBoard([], 'points', 'AU')
    expect(australia).toHaveLength(1)
    expect(australia[0]).toMatchObject({ country: 'AU', name: 'Touchline Bot' })
  })

  it('adds nothing once twelve real managers are present', () => {
    const full = Array.from({ length: 12 }, (_, i) => ({ ...REAL, position: i + 1, name: `Real ${i}` }))
    expect(fillAlltimeBoard(full, 'points', null)).toEqual(full)
    expect(fillAlltimeBoard(full, 'points', null).some(isSimulatedAlltimeRow)).toBe(false)
  })
})
