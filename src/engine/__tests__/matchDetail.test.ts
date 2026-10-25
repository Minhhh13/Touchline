import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { advanceMatch, beginMatch, finishMatch, simulateMatch, teamInputFromPool, type MatchInProgress } from '../match'
import { binOf, momentumBins, MOMENTUM_BINS, PITCH, shotPosition } from '../matchDetail'
import { tacticsForStyle } from '../tactics'
import type { MatchEvent, PlayerSeason } from '../types'

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

const SHOTS = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal', 'chance', 'save'])

describe('match detail: shot positions and momentum', () => {
  const u = loadTestUniverse()
  const all = Object.values(u.index)
  const elite = bestXIpool(all, 86, 99)
  const mid = bestXIpool(all, 72, 76)
  const sides = (i: number) => ({
    home: teamInputFromPool('A', 'Elite', 'ELI', tacticsForStyle(i % 2 ? 'press' : 'balanced', '4-3-3'), i % 3 ? elite : mid),
    away: teamInputFromPool('B', 'Mid', 'MID', tacticsForStyle(i % 3 ? 'counter' : 'defensive', '4-2-3-1'), i % 3 ? mid : elite),
  })

  it('is deterministic: the same seed gives the same positions and the same momentum', () => {
    for (let i = 0; i < 20; i++) {
      const one = simulateMatch({ rng: new Rng(`detail-${i}`), ...sides(i) })
      const two = simulateMatch({ rng: new Rng(`detail-${i}`), ...sides(i) })
      expect(two.momentum).toEqual(one.momentum)
      expect(two.events.map((e) => e.position)).toEqual(one.events.map((e) => e.position))
    }
  })

  it('places every shot on the pitch, penalties on the spot, and most shots in the box', () => {
    const rng = new Rng('detail-bounds')
    let shots = 0
    let inBox = 0
    let outside = 0
    for (let i = 0; i < 150; i++) {
      const r = simulateMatch({ rng, ...sides(i) })
      for (const e of r.events) {
        if (!SHOTS.has(e.type)) {
          expect(e.position).toBeUndefined()
          continue
        }
        expect(e.position).toBeDefined()
        const { x, y } = e.position!
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(100)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(100)
        if (e.type === 'penalty') expect(e.position).toEqual({ x: PITCH.penaltySpot, y: 50 })
        shots++
        if (x >= PITCH.boxEdge && Math.abs(y - 50) <= PITCH.boxHalfWidth) inBox++
        else if (x < PITCH.boxEdge) outside++
      }
      expect(r.momentum).toHaveLength(MOMENTUM_BINS)
      for (const m of r.momentum!) {
        expect(m).toBeGreaterThanOrEqual(0.08)
        expect(m).toBeLessThanOrEqual(0.92)
      }
    }
    expect(shots).toBeGreaterThan(500)
    expect(inBox / shots).toBeGreaterThan(0.6)
    expect(outside / shots).toBeGreaterThan(0.1)
    expect(outside / shots).toBeLessThan(0.3)
  })

  it('a header or a tap-in is drawn nearer the six-yard box than a long-range effort', () => {
    const rng = new Rng('detail-kinds')
    const header = Array.from({ length: 200 }, () => shotPosition(rng, { type: 'goal', text: 'GOAL! X heads it home from a corner.' }).x)
    const long = Array.from({ length: 200 }, () => shotPosition(rng, { type: 'goal', text: 'GOAL! X curls one in from the edge of the box.' }).x)
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean(header)).toBeGreaterThan(93)
    expect(Math.max(...long)).toBeLessThan(PITCH.boxEdge)
    for (const x of header) expect(x).toBeGreaterThanOrEqual(90)
  })

  it('a paused match carries the detail of the segments played and finishes exactly as a straight simulation', () => {
    for (let i = 0; i < 12; i++) {
      const one = simulateMatch({ rng: new Rng(`detail-pause-${i}`), ...sides(i) })
      const split = sides(i)
      let mp: MatchInProgress = beginMatch({ rng: new Rng(`detail-pause-${i}`), ...split })
      expect(mp.momentum).toHaveLength(9)
      for (const e of mp.events) if (SHOTS.has(e.type)) expect(e.position).toBeDefined()
      mp = JSON.parse(JSON.stringify(mp)) as MatchInProgress
      advanceMatch(mp, split, undefined, 70)
      expect(mp.momentum).toHaveLength(14)
      mp = JSON.parse(JSON.stringify(mp)) as MatchInProgress
      const two = finishMatch(mp, split)
      expect(two.momentum).toEqual(one.momentum)
      expect(two.events).toEqual(one.events)
      expect(two.homeReport.appearances).toEqual(one.homeReport.appearances)
      expect(two.homeReport.appearances!.filter((a) => a.onAt === 0)).toHaveLength(11)
      expect(two.homeReport.tactics).toEqual(one.homeReport.tactics)
    }
  })

  it('does not move the draws that decide the match: the chance count and the caller stream are pinned', () => {
    // Pinned when the detail was added, on an engine whose results were checked identical before and after
    // (engine '3': 404 goals, 774 chances). Re-pinned for the depth attributes (engine '4'), whose
    // stamina, aerial and aggression terms move every match: the merged engine gives the same values
    // with the detail calls switched off, so the detail still takes nothing from the match stream.
    const rng = new Rng('detail-chances')
    let goals = 0
    let chances = 0
    for (let i = 0; i < 100; i++) {
      const r = simulateMatch({ rng, ...sides(i) })
      goals += r.homeGoals + r.awayGoals
      chances += r.events.filter((e) => e.type === 'chance' || e.type === 'save').length
    }
    expect({ goals, chances, state: rng.getState() }).toEqual(PINNED)
  })

  it('a summary match carries no pitch detail and plays exactly as it did with it', () => {
    // Every summary result is kept in the save's fixtures (342 a season besides the user's), and
    // nothing draws its pitch: positions, momentum, appearances and tactics took a full season
    // past the browser's storage quota. The detail never drew from the match stream, so skipping
    // it moves no summary result (the season and game-by-game pins hold).
    const rng = new Rng('detail-summary')
    for (let i = 0; i < 30; i++) {
      const r = simulateMatch({ rng, ...sides(i), detail: 'summary' })
      expect(r.momentum).toBeUndefined()
      for (const e of r.events) expect(e.position).toBeUndefined()
      expect(r.homeReport.appearances).toBeUndefined()
      expect(r.awayReport.tactics).toBeUndefined()
    }
    const full = simulateMatch({ rng: new Rng('detail-summary-full'), ...sides(1) })
    expect(full.homeReport.appearances!.length).toBeGreaterThanOrEqual(11)
    expect(full.momentum).toHaveLength(MOMENTUM_BINS)
  })

  it('a match paused before the detail existed still finishes with eighteen bins, the missing ones at the base share', () => {
    const split = sides(4)
    const mp: MatchInProgress = beginMatch({ rng: new Rng('detail-old-save'), ...split })
    // An older save: no momentum and no positions on the first half
    delete mp.momentum
    for (const e of mp.events) delete e.position
    const old = JSON.parse(JSON.stringify(mp)) as MatchInProgress
    const r = finishMatch(old, split)
    expect(r.momentum).toHaveLength(MOMENTUM_BINS)
    const firstHalf = r.momentum!.slice(0, 9)
    expect(new Set(firstHalf).size).toBe(1)
    for (const e of r.events) if (SHOTS.has(e.type) && e.minute <= 45) expect(e.position).toBeUndefined()
    for (const e of r.events) if (SHOTS.has(e.type) && e.minute > 45) expect(e.position).toBeDefined()
  })

  it('bins the clock into eighteen five-minute slices, stoppage time in the last', () => {
    expect(binOf(1)).toBe(0)
    expect(binOf(5)).toBe(0)
    expect(binOf(6)).toBe(1)
    expect(binOf(45)).toBe(8)
    expect(binOf(46)).toBe(9)
    expect(binOf(70)).toBe(13)
    expect(binOf(71)).toBe(14)
    expect(binOf(90)).toBe(17)
    expect(binOf(94)).toBe(17)
  })

  it('a side chasing the game pushes, and a goal swings the bin it falls in', () => {
    const t = tacticsForStyle('balanced', '4-3-3')
    const base = { lamH: 1.4, lamA: 1.4, homeTactics: t, awayTactics: t, from: 1, to: 90, previous: [] as number[] }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const level = momentumBins(new Rng('m-level'), { ...base, events: [] })
    expect(level).toHaveLength(MOMENTUM_BINS)
    expect(Math.abs(mean(level) - 0.5)).toBeLessThan(0.06)
    const behind: MatchEvent[] = [
      { minute: 3, type: 'goal', side: 'away', text: 'GOAL!' },
      { minute: 4, type: 'goal', side: 'away', text: 'GOAL!' },
    ]
    const chasing = momentumBins(new Rng('m-chase'), { ...base, events: behind })
    expect(mean(chasing.slice(2))).toBeGreaterThan(0.55)
    // The last twenty minutes carry the harder push
    expect(mean(chasing.slice(14))).toBeGreaterThan(mean(chasing.slice(2, 9)))
    // A goal at 52 lifts bin 10 (51-55) over bin 9 on average: the wobble can hide it in one match
    const lift = Array.from({ length: 30 }, (_, i) => {
      const swing = momentumBins(new Rng(`m-swing-${i}`), { ...base, events: [{ minute: 52, type: 'goal', side: 'home', text: 'GOAL!' }] })
      return swing[10] - swing[9]
    })
    expect(mean(lift)).toBeGreaterThan(0.04)
    const attacking = momentumBins(new Rng('m-level'), { ...base, homeTactics: { ...t, mentality: 'attacking', pressing: 'high' }, events: [] })
    expect(mean(attacking)).toBeGreaterThan(mean(level))
  })
})

// Re-pinned for the 2026-10-25 data rebuild (positions and hidden traits of 2008-14 rows): the RNG state is unchanged.
const PINNED = { goals: 448, chances: 768, state: { a: -1802413461, b: 1017949396, c: -1306234288, d: -1031035180 } }
