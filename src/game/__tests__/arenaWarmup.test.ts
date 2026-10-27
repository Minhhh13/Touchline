import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft } from '@engine/draft'
import { clubSeasonKey } from '@engine/knockout'
import { Rng } from '@engine/rng'
import type { LoadedUniverse } from '@engine/universe'
import { createGame } from '../logic/setup'
import { beginArena, cupGameSettings, finalGameSettings, gauntletGameSettings, simArenaToEnd, type ArenaChoices } from '../logic/arena'
import { arenaNeedsWarmup, arenaSetupPool, arenaWarmPool, warmStrengths } from '../logic/arenaWarmup'
import type { Game, GameSettings } from '../types'

const LEAGUES = ['england', 'spain']

function choices(seed: string, partial: Partial<ArenaChoices> = {}): ArenaChoices {
  return { teamName: 'Warm XI', formationId: '4-3-3', field: 'wheel', wheelLeagues: ['england'], difficulty: 'calibrated', seed, hardMode: false, twists: true, ...partial }
}

/** A drafted arena run, its strengths warmed first or not, played to its end by the assistant. */
function run(u: LoadedUniverse, settings: GameSettings, warm: boolean): string {
  const g: Game = createGame(settings)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  if (warm) {
    const pool = arenaWarmPool(g, u)
    expect(pool.length).toBeGreaterThan(0)
    expect(warmStrengths(u, pool, 0, () => true)).toBe(pool.length)
  }
  beginArena(g, u)
  // Whatever the first pass ranked came from the warmed pool
  const keys = new Set(arenaWarmPool({ ...g, arena: { ...g.arena!, next: null, ladder: undefined, bracket: undefined } }, u).map(clubSeasonKey))
  for (const k of [g.arena!.next, ...(g.arena!.ladder?.mains ?? []), ...(g.arena!.ladder?.alternates ?? [])]) if (k) expect(keys.has(k)).toBe(true)
  expect(arenaNeedsWarmup(g)).toBe(false)
  expect(arenaWarmPool(g, u)).toEqual([])
  simArenaToEnd(g, u)
  const { id: _id, createdAt: _at, ...rest } = g
  void _id
  void _at
  return JSON.stringify(rest)
}

describe('the arena warm-up', { timeout: 240_000 }, () => {
  it('works through the pool a slice at a time, at least one each call, and stops at the end', () => {
    const u = loadTestUniverse(['england'])
    const g = createGame(gauntletGameSettings(u, choices('warm-slices'), 'WXI'))
    expect(g.phase).toBe('draft')
    expect(arenaNeedsWarmup(g)).toBe(true)
    const pool = arenaWarmPool(g, u)
    expect(pool.length).toBeGreaterThan(300)
    let at = 0
    let calls = 0
    while (at < pool.length) {
      const next = warmStrengths(u, pool, at, () => false)
      expect(next).toBe(at + 1)
      at = next
      calls++
    }
    expect(calls).toBe(pool.length)
    expect(warmStrengths(u, pool, pool.length, () => true)).toBe(pool.length)
    // Not an arena run, nothing to warm
    expect(arenaWarmPool({ ...g, settings: { ...g.settings, mode: 'quick' } }, u)).toEqual([])
  })

  it('moves no field, ladder, bracket, draw or result: each format plays the same run warmed or cold', () => {
    const cases: Array<[string, (u: LoadedUniverse) => GameSettings]> = [
      ['gauntlet', (u) => gauntletGameSettings(u, choices('warm-gauntlet'), 'WXI')],
      ['final-giants', (u) => finalGameSettings(u, choices('warm-final', { field: 'giants' }), 'WXI')],
      ['cup-wheel', (u) => cupGameSettings(u, choices('warm-cup', { size: 16 }), 'WXI')],
      ['cup-champions', (u) => cupGameSettings(u, choices('warm-cup-ch', { size: 8, field: 'champions' }), 'WXI')],
    ]
    for (const [, make] of cases) {
      // Two universes, so the strength memo (per universe) is cold on one and warmed on the other
      const cold = loadTestUniverse(LEAGUES)
      const warmed = loadTestUniverse(LEAGUES)
      expect(run(warmed, make(warmed), true)).toBe(run(cold, make(cold), false))
    }
  })

  it("the setup's pool holds every run's pool, so warming it on the setup moves nothing either", () => {
    const u = loadTestUniverse(LEAGUES)
    const setup = arenaSetupPool(u, LEAGUES)
    const keys = new Set(setup.map(clubSeasonKey))
    const eras: Array<Partial<ArenaChoices>> = [{}, { fromSeason: 2015, toSeason: 2019 }, { field: 'giants' }, { field: 'champions', size: 8 }, { field: 'decade', decade: 2010 }, { wheelLeagues: ['spain'] }]
    for (const [i, extra] of eras.entries()) {
      for (const g of [createGame(gauntletGameSettings(u, choices(`setup-${i}`, extra), 'WXI')), createGame(cupGameSettings(u, choices(`setup-c${i}`, { size: 16, ...extra }), 'WXI')), createGame(finalGameSettings(u, choices(`setup-f${i}`, { field: 'giants', ...extra }), 'WXI'))]) {
        const pool = arenaWarmPool(g, u)
        expect(pool.length).toBeGreaterThan(0)
        for (const cs of pool) expect(keys.has(clubSeasonKey(cs))).toBe(true)
      }
    }
    // Warmed from the setup's pool on one universe, cold on another: the same run
    const cold = loadTestUniverse(LEAGUES)
    const warmed = loadTestUniverse(LEAGUES)
    const pool = arenaSetupPool(warmed, LEAGUES)
    expect(warmStrengths(warmed, pool, 0, () => true)).toBe(pool.length)
    expect(run(warmed, finalGameSettings(warmed, choices('setup-run', { field: 'giants' }), 'WXI'), false)).toBe(run(cold, finalGameSettings(cold, choices('setup-run', { field: 'giants' }), 'WXI'), false))
  })
})
