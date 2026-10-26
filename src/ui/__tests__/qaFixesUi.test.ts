/**
 * Regression tests for the screen bugs the QA hunt of 2026-10-26 fixed (docs/QA.md), rendered on the server.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { H2HSetup } from '../screens/H2H'
import { renderProblems, show } from './qaSsr'

describe('QA screen fixes', () => {
  it('QA-2: the head-to-head setup renders while the chosen league is still loading (it was a white page)', () => {
    // England is the setup's first league; a universe without its pack is the moment after a new league is picked
    show({ universe: loadTestUniverse(['spain']), loadedLeagues: ['spain'], h2h: null, screen: 'h2h' })
    expect(renderProblems(H2HSetup)).toEqual([])
    show({ universe: loadTestUniverse(['england']), loadedLeagues: ['england'] })
    expect(renderProblems(H2HSetup)).toEqual([])
  })
})
