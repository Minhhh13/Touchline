import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadTestUniverse } from './helpers'
import { Rng, dailyDateOf, dailySeed, previousDailySeed } from '../rng'
import { beginMatch, simulateMatch, teamInputFromPool } from '../match'
import { tacticsForStyle } from '../tactics'
import { newDraft, wheelPool } from '../draft'
import { getFormation } from '../formations'
import { bestFit } from '../positions'
import { buildLeague, type MetaFile, type PlayersFile } from '../universe'
import type { PlayerSeason } from '../types'

function pool(all: PlayerSeason[], lo: number, hi: number): PlayerSeason[] {
  const seen = new Set<string>()
  const out: PlayerSeason[] = []
  const perPos: Record<string, number> = { GK: 2, CB: 4, LB: 2, RB: 2, DM: 2, CM: 3, AM: 2, LW: 2, RW: 2, ST: 3 }
  const sorted = all.filter((p) => p.overall >= lo && p.overall <= hi).sort((a, b) => b.overall - a.overall)
  for (const pos of Object.keys(perPos)) {
    let n = 0
    for (const p of sorted) {
      if (n >= perPos[pos]) break
      if (seen.has(p.playerId) || p.positions[0] !== pos) continue
      seen.add(p.playerId)
      out.push(p)
      n++
    }
  }
  return out
}

describe('match engine audit fixes', () => {
  const u = loadTestUniverse()
  const all = Object.values(u.index)
  const a = pool(all, 78, 84)
  const b = pool(all, 70, 77)

  it('the full-time whistle is the last event even after stoppage-time goals', () => {
    for (let i = 0; i < 300; i++) {
      const res = simulateMatch({ rng: new Rng(`ft-${i}`), home: teamInputFromPool('A', 'A', 'AAA', tacticsForStyle('press', '4-3-3'), a), away: teamInputFromPool('B', 'B', 'BBB', tacticsForStyle('balanced', '4-2-3-1'), b), detail: 'full' })
      const last = res.events[res.events.length - 1]
      expect(last.type).toBe('full_time')
      expect(last.minute).toBe(Math.max(...res.events.map((e) => e.minute)))
    }
  })

  it('a booking never comes after the same player is sent off or substituted', () => {
    let reds = 0
    let subsAfterCard = 0
    for (let i = 0; i < 400; i++) {
      const res = simulateMatch({ rng: new Rng(`cards-${i}`), home: teamInputFromPool('A', 'A', 'AAA', tacticsForStyle('press', '4-3-3'), a), away: teamInputFromPool('B', 'B', 'BBB', tacticsForStyle('counter', '4-4-2'), b), detail: 'full' })
      const yellowAt = new Map<string, number>()
      for (const e of res.events) if (e.type === 'yellow' && e.playerId) yellowAt.set(e.playerId, e.minute)
      for (const e of res.events) {
        if (!e.playerId || !yellowAt.has(e.playerId)) continue
        if (e.type === 'red') {
          reds++
          expect(e.minute).toBeGreaterThanOrEqual(yellowAt.get(e.playerId)!)
        }
        if (e.type === 'substitution') {
          subsAfterCard++
          expect(e.minute).toBeGreaterThanOrEqual(yellowAt.get(e.playerId)!)
        }
      }
    }
    expect(reds + subsAfterCard).toBeGreaterThan(0)
  })

  it('the paused second half draws from its own stream, not the one the rest of the week uses', () => {
    const rng = new Rng('fork')
    const mp = beginMatch({ rng, home: teamInputFromPool('A', 'A', 'AAA', tacticsForStyle('balanced', '4-3-3'), a), away: teamInputFromPool('B', 'B', 'BBB', tacticsForStyle('balanced', '4-3-3'), b), detail: 'full' })
    expect(mp.rngState).not.toEqual(rng.getState())
  })

  it('a one-club wheel that has used every club-season reopens instead of running dry', () => {
    const d = newDraft(getFormation('4-3-3'), { squadSize: 18, respins: 3, minFit: 'accomplished', hardMode: false, uniqueClubSeasons: true, onlyClub: 'burnley', fromSeason: 2024, toSeason: 2025, leagues: ['england'] })
    const fresh = wheelPool(u, d)
    expect(fresh.length).toBeGreaterThan(0)
    d.usedClubSeasons = fresh.map((cs) => `${cs.clubId}@${cs.season}`)
    expect(wheelPool(u, d).length).toBe(fresh.length)
  })

  it('daily seeds know their own date and the day before', () => {
    expect(dailyDateOf('daily-2026-03-01')?.toISOString().slice(0, 10)).toBe('2026-03-01')
    expect(previousDailySeed('daily-2026-03-01')).toBe('daily-2026-02-28')
    expect(previousDailySeed('daily-2024-01-01')).toBe('daily-2023-12-31')
    expect(dailyDateOf('ABC123')).toBeNull()
    expect(previousDailySeed('ABC123')).toBeNull()
    expect(previousDailySeed(dailySeed(new Date(Date.UTC(2026, 9, 24))))).toBe('daily-2026-10-23')
  })

  it('the best fit is by quality, not alphabetical order', () => {
    expect(bestFit(['accomplished', 'natural'])).toBe('natural')
    expect(bestFit(['unsuited', 'awkward'])).toBe('awkward')
    expect(bestFit([])).toBeUndefined()
  })

  it('a missing trait column reads as an average player, never NaN', () => {
    const root = path.resolve(__dirname, '..', '..', '..')
    const players = JSON.parse(readFileSync(path.join(root, 'public', 'data', 'england', 'players.json'), 'utf8')) as PlayersFile
    const meta = JSON.parse(readFileSync(path.join(root, 'public', 'data', 'england', 'meta.json'), 'utf8')) as MetaFile
    const cons = players.columns.indexOf('cons')
    const row = [...players.rows[0]]
    row[cons] = ''
    const league = buildLeague({ ...players, rows: [row] }, meta)
    const p = Object.values(league.index)[0]
    expect(p.traits.consistency).toBe(0.5)
    expect(Number.isFinite(p.traits.injuryProneness)).toBe(true)
  })
})
