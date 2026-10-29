import { describe, expect, it, vi } from 'vitest'
// The store persists through localStorage: an in-memory stand-in the test can write to as another page would
const disk = vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear() },
    configurable: true,
  })
  return { mem }
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { createGame, beginSeason } from '../logic/setup'
import { startSeasonProper } from '../logic/week'
import { SAVE_KEY, saveChangedElsewhere, saveStorage, useStore } from '../store'
import type { Game } from '../types'

/** QA round 6 (r11, docs/QA.md): the fixes, each failing without its change. */
const u = loadTestUniverse()

function started(seed: string): Game {
  const g = createGame({ mode: 'season', seed, formationId: '4-3-3', teamName: 'R11 XI', shortName: 'R11', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  return g
}

describe('R11-1: a reloaded page is not told its own save was written in another tab', () => {
  it('an event for a save that still reads as this page’s own freezes nothing; a different one still does', () => {
    useStore.setState({ universe: u, game: started('r11-reload-event'), saveIssue: null })
    saveStorage.flush()
    // Chromium hands a reloaded page the events of the page it replaced: its last pagehide write (the save this page
    // then read, or wrote itself) and a clear made before the reload, with the save back in place since
    saveChangedElsewhere(SAVE_KEY)
    expect(useStore.getState().saveIssue).toBeNull()
    saveChangedElsewhere(null)
    expect(useStore.getState().saveIssue).toBeNull()
    // The page still saves
    const before = disk.mem.get(SAVE_KEY)
    useStore.getState().simWeeks(1)
    saveStorage.flush()
    expect(disk.mem.get(SAVE_KEY)).not.toBe(before)
    // Another tab's newer save, or a wipe, still stops this page
    disk.mem.set(SAVE_KEY, 'another tab’s save')
    saveChangedElsewhere(SAVE_KEY)
    expect(useStore.getState().saveIssue).toBe('elsewhere')
    useStore.setState({ saveIssue: null })
    disk.mem.delete(SAVE_KEY)
    saveChangedElsewhere(null)
    expect(useStore.getState().saveIssue).toBe('elsewhere')
  }, 60_000)
})
