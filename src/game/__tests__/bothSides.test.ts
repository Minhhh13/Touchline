import { describe, expect, it, vi } from 'vitest'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
// Every match any mode kicks off goes through this wrapper, which notes the real player ids of both sides' matchday
// squads before handing the match to the engine unchanged
vi.mock('@engine/match', async (importOriginal) => {
  const m = await importOriginal<typeof import('@engine/match')>()
  const seen = (globalThis as { __bothSides?: string[] }).__bothSides ?? ((globalThis as { __bothSides?: string[] }).__bothSides = [])
  const check = (o: import('@engine/match').MatchOptions) => {
    const men = (t: import('@engine/match').MatchTeamInput) => new Set([...Object.values(t.lineup), ...t.bench].map((id) => t.getPlayer(id)?.playerId).filter(Boolean))
    const home = men(o.home)
    for (const id of men(o.away)) if (home.has(id)) seen.push(`${o.home.teamName} v ${o.away.teamName}: ${id}`)
    const n = (globalThis as { __bothSidesMatches?: number }).__bothSidesMatches ?? 0
    ;(globalThis as { __bothSidesMatches?: number }).__bothSidesMatches = n + 1
  }
  return {
    ...m,
    simulateMatch: (o: import('@engine/match').MatchOptions) => (check(o), m.simulateMatch(o)),
    beginMatch: (o: import('@engine/match').MatchOptions) => (check(o), m.beginMatch(o)),
  }
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { runInCatalogue, suggestRunIns } from '@engine/scenario'
import { cupGameSettings, finalGameSettings, gauntletGameSettings, type ArenaChoices } from '../logic/arena'
import { closeJanuary, kickOff, toKickoff } from '../logic/quick'
import { playQuickCup, quickCupStatus } from '../logic/quickCups'
import { runInGameSettings } from '../logic/runin'
import { createGame } from '../logic/setup'
import { playMatchweek } from '../logic/week'
import { useStore } from '../store'
import type { GameSettings } from '../types'
import { breathe, Chooser, driveDraft, loadStore } from './qaHarness'
import { driveArena, driveSeason } from './qaSeasonHarness'
import { playHotSeat } from './roomHelpers'
import { seasonGame } from './seasonGame'

/**
 * Engine 6, E6-2: no human plays for both sides of a match. A drafted man used to stay in his real club's squad, so he
 * could score for both sides (Eze for Arsenal and QA XI), take a kick for each in an arena shoot-out (Fàbregas), or
 * meet another season of himself. Checked over every mode that plays matches: quick seasons (a real league and the
 * Super League, the January window, the cups after), a managed Season, a Run-in, head-to-head and the arena's Final,
 * Cup and Gauntlet, including the arena's AI-against-AI ties.
 */
const u = loadTestUniverse(['england'])
const st = () => useStore.getState()
const seen = () => ((globalThis as { __bothSides?: string[] }).__bothSides ??= [])
const matches = () => (globalThis as { __bothSidesMatches?: number }).__bothSidesMatches ?? 0
const T = 1_800_000

function quickSettings(seed: string, extra: Partial<GameSettings['rules']> = {}): GameSettings {
  return { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Both XI', shortName: 'BTH', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'], managers: false, ...extra }, jobSecurity: false, difficulty: 'calibrated', january: true }
}

function arenaChoices(seed: string, ch: Chooser): ArenaChoices {
  return { teamName: 'Both Arena', formationId: ch.pick(['4-3-3', '4-4-2', '3-5-2', '4-2-3-1']), field: ch.pick(['giants', 'wheel', 'decade', 'champions'] as const), wheelLeagues: ['england'], difficulty: ch.pick(['calibrated', 'realistic'] as const), seed, hardMode: false, twists: ch.chance(0.5), decade: ch.pick([2010, 2020]) }
}

describe('no human on both sides of a match (E6-2)', () => {
  it('quick seasons in the Premier League and the Super League, with the January window and both cups', () => {
    // Four leagues: the Continental Cup has a field, and the Super League's clubs share careers across leagues
    const all = loadTestUniverse(['england', 'spain', 'italy', 'germany'])
    const before = matches()
    for (let i = 0; i < 24; i++) {
      const g = createGame(quickSettings(`both-quick-${i}`, i % 3 === 2 ? { superLeague: true, leagues: ['england', 'spain', 'italy', 'germany'] } : {}))
      if (g.settings.rules.superLeague) g.settings = { ...g.settings, wheelLeagues: ['england', 'spain', 'italy', 'germany'] }
      const rng = Rng.fromState(g.rngState)
      autoDraft(all, g.draft!, rng)
      g.rngState = rng.getState()
      toKickoff(g, all)
      kickOff(g, all, true)
      // Take the first January deal on offer, so a signing from a league club plays the second half
      if (g.phase === 'january') closeJanuary(g, all, g.quickJanuary?.listings.length ? 0 : null)
      for (const comp of ['cup', 'continental'] as const) if (quickCupStatus(g, all, comp).state === 'open') playQuickCup(g, all, comp)
    }
    expect(matches() - before).toBeGreaterThan(24 * 36)
    expect(seen()).toEqual([])
  }, T)

  it('a managed Season, cups included, and head-to-head', () => {
    const before = matches()
    for (const seed of ['both-season-0', 'both-season-1']) {
      const g = seasonGame(u, seed)
      for (let i = 0; i < 60 && g.phase !== 'summary'; i++) {
        playMatchweek(g, u, true)
        if (g.phase === 'match') g.phase = 'week'
      }
    }
    for (let i = 0; i < 4; i++) playHotSeat(u, `both-h2h-${i}`, { leagueId: 'england', wheelLeagues: ['england'], leagueSeason: 2024, difficulty: 'calibrated', hardMode: false }, [{ name: 'Ann', shortName: 'ANN', formationId: '4-3-3', hostClubId: 'everton' }, { name: 'Bob', shortName: 'BOB', formationId: '4-4-2', hostClubId: 'fulham' }])
    expect(matches() - before).toBeGreaterThan(2 * 380)
    expect(seen()).toEqual([])
  }, T)

  it('the arena (Final, Cup and Gauntlet) and Run-ins through the store', async () => {
    const before = matches()
    for (const format of ['final', 'cup', 'gauntlet'] as const) {
      for (let i = 0; i < 12; i++) {
        await breathe()
        const seed = `both-arena-${format}-${i}`
        const ch = new Chooser(seed)
        loadStore(u, ['england'])
        const c = arenaChoices(seed, ch)
        st().startGame(format === 'final' ? finalGameSettings(u, c, 'BOA') : format === 'cup' ? cupGameSettings(u, { ...c, size: ch.pick([8, 16, 32] as const) }, 'BOA') : gauntletGameSettings(u, c, 'BOA'))
        expect(driveDraft(u, ch, { autoAt: ch.int(0, 6) }).problems).toEqual([])
        expect(driveArena(u, ch)).toEqual([])
      }
    }
    for (let i = 0; i < 4; i++) {
      await breathe()
      const seed = `both-runin-${i}`
      const ch = new Chooser(seed)
      loadStore(u, ['england'])
      const jobs = runInCatalogue(u, 'survival').filter((j) => j.leagueId === 'england')
      st().startGame(runInGameSettings(u, suggestRunIns(jobs, seed)[0], { seed, formationId: '4-3-3' }))
      expect(driveDraft(u, ch, {}).problems).toEqual([])
      expect(driveSeason(u, ch, { draft: () => ['a second draft in a run-in'], simBias: 3 }).problems).toEqual([])
    }
    expect(matches() - before).toBeGreaterThan(100)
    expect(seen()).toEqual([])
  }, T)
})
