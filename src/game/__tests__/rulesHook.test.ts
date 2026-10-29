import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { kickOff, toKickoff } from '../logic/quick'
import { createGame } from '../logic/setup'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])

const settings = (seed: string): GameSettings => ({ mode: 'quick', seed, formationId: '4-3-3', teamName: 'Rules XI', shortName: 'RUL', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'], benchPicks: 3 }, jobSecurity: false, difficulty: 'calibrated', january: false })

/** A Quick Draft with a bench, kicked off: at the summary, its result still open (recorded when the playback ends). */
function openSeason(seed: string): Game {
  const g = createGame(settings(seed))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, u)
  kickOff(g, u)
  expect(g.phase).toBe('summary')
  expect(g.quickOpen).toBe(true)
  return g
}

const withoutId = <T extends { id: string }>(e: T | undefined) => (e ? { ...e, id: undefined } : e)

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('the rules chunk (round 9: the store reads the game rules from their own chunk)', { timeout: 120_000 }, () => {
  it('settles a finished quick season the same way whether the rules were in or had to load first', async () => {
    const seeds = ['rules-wait-1', 'rules-wait-2', 'rules-wait-3']
    // As the tests (and every game screen) run it: the rules loaded before the action
    const { useStore: ready } = await import('../store')
    const settled = seeds.map((seed) => {
      ready.setState({ universe: u, game: openSeason(seed), parked: {} })
      ready.getState().abandonGame()
      expect(ready.getState().game).toBeNull()
      // The entry's id carries the game's own id (made from the clock), so it is left out of the comparison
      return withoutId(ready.getState().profile.leaderboard.find((e) => e.seed === seed))
    })
    expect(settled.every(Boolean)).toBe(true)

    // A page whose rules chunk has not loaded yet: Home's Abandon waits for it, then settles the season as before
    vi.resetModules()
    const hook = await import('../rulesHook')
    expect(hook.rulesReady()).toBe(false)
    expect(() => hook.rules()).toThrow(/still loading/)
    const { useStore: fresh } = await import('../store')
    for (const [i, seed] of seeds.entries()) {
      fresh.setState({ universe: u, game: openSeason(seed), parked: {} })
      fresh.getState().abandonGame()
      if (i === 0) {
        // Nothing changed until the rules came: the season is still there, unrecorded
        expect(fresh.getState().game?.settings.seed).toBe(seed)
        expect(fresh.getState().profile.leaderboard).toHaveLength(0)
      }
      await hook.loadRules()
      await tick()
      expect(fresh.getState().game).toBeNull()
      expect(withoutId(fresh.getState().profile.leaderboard.find((e) => e.seed === seed))).toEqual(settled[i])
    }
    expect(hook.rulesReady()).toBe(true)
  })

  it('starts a game at once when there is nothing to settle, rules or not', async () => {
    vi.resetModules()
    const hook = await import('../rulesHook')
    const { useStore: fresh } = await import('../store')
    expect(hook.rulesReady()).toBe(false)
    fresh.setState({ universe: u, game: null, parked: {} })
    fresh.getState().startGame(settings('rules-start'))
    expect(hook.rulesReady()).toBe(false)
    expect(fresh.getState().game?.settings.seed).toBe('rules-start')
    expect(fresh.getState().game?.phase).toBe('draft')
  })
})
