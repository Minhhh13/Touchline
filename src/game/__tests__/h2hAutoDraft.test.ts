/**
 * Playtest round 2, P8: the hot-seat's Auto-complete is the buttons pressed in turn. Spin when no spin is on the wheel,
 * then "Let the assistant pick" for whoever picks, until both squads are full: the same draws, the same squads, the same
 * stream, from the start or from a draft half made by hand.
 */
import { describe, expect, it, vi } from 'vitest'
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

function start(seed: string, hardMode = false): void {
  useStore.setState({ universe: u, loadedLeagues: ['england'], h2h: null, toast: null })
  st().startH2H([{ name: 'Ann', shortName: 'ANN', formationId: '4-3-3', hostClubId: 'everton' }, { name: 'Bob', shortName: 'BOB', formationId: '3-5-2', hostClubId: 'fulham' }], 'england', ['england'], 2024, 'calibrated', hardMode, seed)
}

/** The buttons, pressed in turn: the way a manager auto-completed a draft before P8. Returns the assistant's picks. */
function pressButtons(limit = 400): number {
  let picks = 0
  for (let i = 0; i < limit && !h2hComplete(st().h2h!.draft); i++) {
    if (st().h2h!.draft.picking === null) st().h2hSpin()
    else {
      st().h2hAuto()
      picks++
    }
  }
  return picks
}

describe('head-to-head Auto-complete (playtest P8)', () => {
  it('drafts exactly what Spin and Let the assistant pick would, from the start', () => {
    for (const [i, seed] of ['h2h-auto-0', 'h2h-auto-1', 'h2h-auto-2', 'h2h-auto-3'].entries()) {
      start(seed, i === 3)
      pressButtons()
      const byHand = JSON.stringify(st().h2h)
      start(seed, i === 3)
      st().h2hAutoDraft()
      const auto = st().h2h!
      expect(h2hComplete(auto.draft), seed).toBe(true)
      expect(JSON.stringify(auto), seed).toBe(byHand)
    }
  }, 60_000)

  it('finishes a draft half made by hand the same way, and plays the same season', () => {
    for (const seed of ['h2h-auto-half-0', 'h2h-auto-half-1']) {
      start(seed)
      pressButtons(9)
      const half = st().h2h!
      pressButtons()
      st().h2hFinish()
      const byHand = JSON.stringify(st().h2h)
      useStore.setState({ h2h: half })
      st().h2hAutoDraft()
      st().h2hFinish()
      expect(JSON.stringify(st().h2h), seed).toBe(byHand)
    }
  }, 60_000)

  it('does nothing on a complete draft', () => {
    start('h2h-auto-done')
    st().h2hAutoDraft()
    const done = st().h2h
    st().h2hAutoDraft()
    expect(st().h2h).toBe(done)
  }, 60_000)
})
