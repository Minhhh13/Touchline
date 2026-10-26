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
  })
})
