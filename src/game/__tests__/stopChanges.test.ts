import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { benchAt, onPitchAtMinute } from '@engine/match'
import { playMatchweek } from '../logic/week'
import { availableStopChanges } from '../logic/stopChanges'
import { useStore } from '../store'
import { clone, seasonGame } from './seasonGame'
import type { Game } from '../types'

describe('a stop never brings on an injured or suspended man', { timeout: 30_000 }, () => {
  const u = loadTestUniverse()

  /** A live league match at half time, with a starter to take off and two bench men to bring on. */
  function atHalfTime(seed: string): { g: Game; off: string; on: [string, string] } {
    const g = seasonGame(u, seed, 1)
    playMatchweek(g, u)
    expect(g.live?.mp.clock).toBe(45)
    const side = g.live!.userIsHome ? 'home' : 'away'
    const off = onPitchAtMinute(g.live!.mp, side, 45).find((p) => p.position !== 'GK' && p.offAt >= 90 && !p.red)!.psId
    const bench = benchAt(g.live!.mp, side, 45, (id) => g.squad[id])
    expect(bench.length).toBeGreaterThanOrEqual(2)
    return { g, off, on: [bench[0], bench[1]] }
  }

  const subsOf = (g: Game) => (g.live!.userIsHome ? g.live!.mp.hSubs : g.live!.mp.aSubs)

  it('drops only the unavailable men and leaves a fit change untouched', () => {
    const { g, off, on } = atHalfTime('stop-subs-pure')
    const changes = { talk: 'calm' as const, substitutions: [{ off, on: on[0] }] }
    expect(availableStopChanges(g, changes)).toBe(changes)
    expect(availableStopChanges(g, undefined)).toBeUndefined()
    g.squad[on[0]].injury = { description: 'Knock', weeksOut: 2 }
    expect(availableStopChanges(g, changes)).toEqual({ talk: 'calm', substitutions: [] })
    g.squad[on[0]].injury = null
    g.squad[on[0]].suspension = 1
    expect(availableStopChanges(g, changes).substitutions).toEqual([])
  })

  for (const seed of ['stop-subs-1', 'stop-subs-2', 'stop-subs-3']) {
    it(`the store's half-time change refuses an injured substitute and makes a fit one (${seed})`, () => {
      const { g, off, on } = atHalfTime(seed)
      const fitPath = clone(g)
      // The injured man asked for: nothing changes on the pitch, the match plays on to 70
      g.squad[on[0]].injury = { description: 'Hamstring strain', weeksOut: 3 }
      useStore.setState({ universe: u, loadedLeagues: ['england'], game: g, toast: null })
      useStore.getState().advanceLive({ substitutions: [{ off, on: on[0] }] })
      const after = useStore.getState().game!
      expect(after.live?.mp.clock).toBe(70)
      expect(subsOf(after).some((s) => s.on === on[0])).toBe(false)
      expect(Object.values(after.lineup)).not.toContain(on[0])
      // A fit man asked for comes on at the break, as before
      useStore.setState({ game: fitPath, toast: null })
      useStore.getState().advanceLive({ substitutions: [{ off, on: on[1] }] })
      expect(subsOf(useStore.getState().game!).some((s) => s.on === on[1] && s.minute === 45)).toBe(true)
    })
  }
})
