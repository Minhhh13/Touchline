/**
 * O-14 (docs/QA.md): with the storage full the toast showed on the first refused write and then every twentieth, and the
 * rest of the time nothing said that nothing was being saved. The store now holds a flag the banner reads for as long
 * as writes fail.
 */
import { describe, expect, it, vi } from 'vitest'
const disk = vi.hoisted(() => {
  const mem = new Map<string, string>()
  const state = { full: false, mem }
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (state.full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        mem.set(k, v)
      },
      removeItem: (k: string) => void mem.delete(k),
    },
    configurable: true,
  })
  return state
})
vi.setConfig({ testTimeout: 120_000 })
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { createGame, beginSeason } from '../logic/setup'
import { startSeasonProper } from '../logic/week'
import { persistedState, SAVE_FAILING_LINE, SAVE_FULL_TOAST, saveStorage, useStore } from '../store'
import { show } from '../../ui/__tests__/qaSsr'
import { SaveBanner } from '../../ui/components/SaveBanner'

const u = loadTestUniverse()

describe('O-14: a full storage', () => {
  it('keeps the banner up for every refused write, takes it down on the next write that goes through, and never saves the flag', () => {
    const g = createGame({ mode: 'season', seed: 'qa-save-full', formationId: '4-3-3', teamName: 'Full XI', shortName: 'FUL', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    startSeasonProper(g)
    useStore.setState({ universe: u, loadedLeagues: ['england'], game: g, toast: null, saveFailing: false })
    saveStorage.flush()
    expect(useStore.getState().saveFailing).toBe(false)
    disk.full = true
    try {
      for (let week = 0; week < 3; week++) {
        useStore.getState().simWeeks(1)
        saveStorage.flush()
        expect(useStore.getState().saveFailing).toBe(true)
        // The toast came once and is not repeated; the banner is what stays
        if (week === 0) expect(useStore.getState().toast).toBe(SAVE_FULL_TOAST)
        useStore.setState({ toast: null })
      }
      show({})
      const html = renderToString(createElement(SaveBanner))
      expect(html).toContain(SAVE_FAILING_LINE)
      expect(html).toContain('role="alert"')
      expect(html).toContain('data-testid="save-banner-export"')
      // On Your record itself the export is right there: no button to it
      show({ screen: 'profile' })
      expect(renderToString(createElement(SaveBanner))).not.toContain('save-banner-export')
      expect('saveFailing' in persistedState(useStore.getState())).toBe(false)
    } finally {
      disk.full = false
    }
    useStore.getState().simWeeks(1)
    saveStorage.flush()
    expect(useStore.getState().saveFailing).toBe(false)
    show({ screen: 'game' })
    expect(renderToString(createElement(SaveBanner))).toBe('')
  })
})
