import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { createGame } from '../logic/setup'
import { kickOff, toKickoff } from '../logic/quick'
import { quickCupStatus } from '../logic/quickCups'
import { leaguesBeforeSkip } from '../logic/cupSkip'
import { useStore } from '../store'
import type { Game, GameSettings } from '../types'

const england = loadTestUniverse(['england'])
const all = loadTestUniverse(england.available.map((l) => l.id))

function settings(seed: string): GameSettings {
  return { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Skip XI', shortName: 'SKP', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: false }
}

/** A quick season auto-drafted and played to the summary on the Premier League alone. */
function played(seed: string): Game {
  const g = createGame(settings(seed))
  const rng = Rng.fromState(g.rngState)
  autoDraft(england, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, england)
  kickOff(g, england)
  return g
}

/** Seeds whose season earns the Continental Cup (a high enough finish). */
const qualified = ['skip-1', 'skip-2', 'skip-3', 'skip-4', 'skip-5', 'skip-6', 'skip-7', 'skip-8'].map(played).filter((g) => quickCupStatus(g, all, 'continental').state === 'open')

describe('skipping a post-season cup', () => {
  it('has qualified seasons to check', () => {
    expect(qualified.length).toBeGreaterThan(2)
  })

  it('needs every league first when the Continental Cup is offered before they are loaded', () => {
    for (const g of qualified) {
      // The summary offers it (Play loads the leagues), so Skip must load them too
      expect(quickCupStatus(g, england, 'continental').state).toBe('open')
      expect(leaguesBeforeSkip(g, england, 'continental')).toEqual(england.available.map((l) => l.id))
      expect(leaguesBeforeSkip(g, all, 'continental')).toEqual([])
      expect(leaguesBeforeSkip(g, england, 'cup')).toEqual([])
    }
  })

  it('skips through the store once the leagues are in, with no toast and no other change', async () => {
    const g = qualified[0]
    useStore.setState({ universe: all, game: JSON.parse(JSON.stringify(g)) as Game, loadedLeagues: all.available.map((l) => l.id), toast: null, playback: null })
    await useStore.getState().skipCup('continental')
    const after = useStore.getState()
    expect(after.toast).toBeNull()
    expect(after.game!.quickResult!.continentalCup).toBeNull()
    expect({ ...after.game!.quickResult!, continentalCup: undefined }).toEqual({ ...g.quickResult!, continentalCup: undefined })
    expect(after.game!.rngState).toEqual(g.rngState)
  })
})
