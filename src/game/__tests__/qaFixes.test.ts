/**
 * Regression tests for the bugs the QA hunt of 2026-10-26 fixed (docs/QA.md). Each names the bug it pins.
 */
import { describe, expect, it, vi } from 'vitest'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { h2hComplete } from '@engine/h2h'
import { useStore } from '../store'

const u = loadTestUniverse(['england'])
const st = () => useStore.getState()

describe('QA fixes', () => {
  it('QA-1: a second Finish on a finished head-to-head keeps its result and its stream (a double-click replayed the season)', () => {
    useStore.setState({ universe: u, loadedLeagues: ['england'], h2h: null, toast: null })
    st().startH2H([{ name: 'Ann', shortName: 'ANN', formationId: '4-3-3', hostClubId: 'everton' }, { name: 'Bob', shortName: 'BOB', formationId: '4-4-2', hostClubId: 'fulham' }], 'england', ['england'], 2024, 'calibrated', false, 'qa-fix-h2h')
    for (let i = 0; i < 200 && !h2hComplete(st().h2h!.draft); i++) {
      if (st().h2h!.draft.picking === null) st().h2hSpin()
      else st().h2hAuto()
    }
    st().h2hFinish()
    const done = st().h2h!
    expect(done.result).not.toBeNull()
    const cabinet = st().profile.cabinet
    st().h2hFinish()
    expect(st().h2h).toBe(done)
    expect(st().profile.cabinet).toBe(cabinet)
  }, 60_000)
})

describe('QA-5: Draft again on the summary', () => {
  it('draws a Crazy formation from the new seed, keeps any other shape, and drops the challenge', async () => {
    const { draftAgainSettings } = await import('../logic/setup')
    const { crazyFormation } = await import('@engine/modes')
    const { QUICK_RULES } = await import('@engine/draft')
    const s = { mode: 'quick' as const, seed: 'qa-again-0', formationId: '4-3-3', teamName: 'QA', shortName: 'QAA', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024, rules: { ...QUICK_RULES, leagues: ['england'], modes: ['crazy' as const] }, jobSecurity: false, difficulty: 'calibrated' as const, challenge: { name: 'x', picks: [], claim: { pts: 1, w: 0, d: 1, l: 0, gf: 0, ga: 0, pos: 1 }, verified: 'yes' as const, data: 'd', engine: '4' } }
    // Over many seeds a fresh Crazy draw lands on other shapes; the old code kept 4-3-3 every time
    const shapes = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const again = draftAgainSettings(s as never, `qa-again-${i}`)
      expect(again.formationId).toBe(crazyFormation(`qa-again-${i}`))
      expect(again.challenge).toBeUndefined()
      expect(again.seed).toBe(`qa-again-${i}`)
      shapes.add(again.formationId)
    }
    expect(shapes.size).toBeGreaterThan(3)
    const plain = draftAgainSettings({ ...s, rules: { ...QUICK_RULES, leagues: ['england'] } } as never, 'qa-again-x')
    expect(plain.formationId).toBe('4-3-3')
    expect({ ...plain, seed: s.seed }).toEqual({ ...s, rules: { ...QUICK_RULES, leagues: ['england'] }, challenge: undefined, seed: s.seed })
  })
})
