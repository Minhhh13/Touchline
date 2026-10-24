import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { simulateMatch, teamInputFromPool } from '../match'
import { tacticsForStyle } from '../tactics'
import type { PlayerSeason } from '../types'

/** Best distinct players per position within an overall band, so every slot has a natural fit. */
function bestXIpool(all: PlayerSeason[], minOverall: number, maxOverall: number): PlayerSeason[] {
  const seen = new Set<string>()
  const pool: PlayerSeason[] = []
  const perPos: Record<string, number> = { GK: 2, CB: 4, LB: 2, RB: 2, DM: 2, CM: 3, AM: 2, LW: 2, RW: 2, ST: 3 }
  const sorted = all.filter((p) => p.overall >= minOverall && p.overall <= maxOverall).sort((a, b) => b.overall - a.overall)
  for (const pos of Object.keys(perPos)) {
    let n = 0
    for (const p of sorted) {
      if (n >= perPos[pos]) break
      if (seen.has(p.playerId) || p.positions[0] !== pos) continue
      seen.add(p.playerId)
      pool.push(p)
      n++
    }
  }
  return pool
}

describe('match engine', () => {
  const u = loadTestUniverse()
  const all = Object.values(u.index)
  const elite = bestXIpool(all, 86, 99)
  const mid = bestXIpool(all, 72, 76)
  const weak = bestXIpool(all, 62, 66)

  it('elite side beats a mid-table side most of the time, and never produces NaN', () => {
    const rng = new Rng('match-1')
    let wins = 0
    let draws = 0
    const n = 400
    for (let i = 0; i < n; i++) {
      const home = teamInputFromPool('A', 'Elite', 'ELI', tacticsForStyle('balanced', '4-3-3'), elite)
      const away = teamInputFromPool('B', 'Mid', 'MID', tacticsForStyle('balanced', '4-2-3-1'), mid)
      const r = simulateMatch({ rng, home, away, detail: 'summary' })
      expect(Number.isFinite(r.homeGoals)).toBe(true)
      expect(Number.isFinite(r.xg.home)).toBe(true)
      if (r.homeGoals > r.awayGoals) wins++
      else if (r.homeGoals === r.awayGoals) draws++
    }
    const winRate = wins / n
    console.log(`elite(home) v mid: win ${(winRate * 100).toFixed(1)}% draw ${((draws / n) * 100).toFixed(1)}%`)
    expect(winRate).toBeGreaterThan(0.72)
    expect(winRate).toBeLessThan(0.97)
  })

  it('elite side away at a weak side wins very often', () => {
    const rng = new Rng('match-2')
    let wins = 0
    const n = 400
    for (let i = 0; i < n; i++) {
      const home = teamInputFromPool('W', 'Weak', 'WEA', tacticsForStyle('defensive', '5-3-2'), weak)
      const away = teamInputFromPool('E', 'Elite', 'ELI', tacticsForStyle('press', '4-3-3'), elite)
      const r = simulateMatch({ rng, home, away, detail: 'summary' })
      if (r.awayGoals > r.homeGoals) wins++
    }
    console.log(`elite(away) v weak: win ${((wins / n) * 100).toFixed(1)}%`)
    expect(wins / n).toBeGreaterThan(0.8)
  })

  it('equal sides are roughly symmetric with a home edge', () => {
    const rng = new Rng('match-3')
    let hw = 0
    let aw = 0
    const n = 600
    for (let i = 0; i < n; i++) {
      const home = teamInputFromPool('A', 'A', 'A', tacticsForStyle('balanced', '4-3-3'), mid)
      const away = teamInputFromPool('B', 'B', 'B', tacticsForStyle('balanced', '4-3-3'), mid)
      const r = simulateMatch({ rng, home, away, detail: 'summary' })
      if (r.homeGoals > r.awayGoals) hw++
      else if (r.awayGoals > r.homeGoals) aw++
    }
    console.log(`equal: home ${((hw / n) * 100).toFixed(1)}% away ${((aw / n) * 100).toFixed(1)}% draw ${(((n - hw - aw) / n) * 100).toFixed(1)}%`)
    expect(hw).toBeGreaterThan(aw)
    expect(hw / n).toBeLessThan(0.6)
  })

  it('produces a coherent event timeline', () => {
    const rng = new Rng('match-4')
    const home = teamInputFromPool('A', 'Elite', 'ELI', tacticsForStyle('balanced', '4-3-3'), elite)
    const away = teamInputFromPool('B', 'Mid', 'MID', tacticsForStyle('counter', '4-2-3-1'), mid)
    const r = simulateMatch({ rng, home, away, detail: 'full' })
    const goals = r.events.filter((e) => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal')
    expect(goals.filter((e) => e.side === 'home').length).toBe(r.homeGoals)
    expect(goals.filter((e) => e.side === 'away').length).toBe(r.awayGoals)
    for (let i = 1; i < r.events.length; i++) expect(r.events[i].minute).toBeGreaterThanOrEqual(r.events[i - 1].minute)
    expect(r.events.at(-1)?.type).toBe('full_time')
    expect(r.homeStats.length).toBeGreaterThanOrEqual(11)
    for (const s of [...r.homeStats, ...r.awayStats]) {
      expect(s.rating).toBeGreaterThanOrEqual(4.5)
      expect(s.rating).toBeLessThanOrEqual(10)
    }
  })
})
