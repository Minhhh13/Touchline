/**
 * Regression tests for the screen bugs the second QA hunt (r7, the engine 6 release candidate) fixed (docs/QA.md,
 * round 2), rendered on the server.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
vi.setConfig({ testTimeout: 60_000 })
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { reserveKeeper, reserveKeeperId } from '@engine/reserve'
import { finalGameSettings } from '@game/logic/arena'
import { useStore } from '@game/store'
import type { Game } from '@game/types'
import { ShootoutPanel } from '../components/ShootoutPanel'
import { ArenaSummary } from '../screens/ArenaSummary'
import { show } from './qaSsr'

const u = loadTestUniverse(['england', 'portugal'])
const st = () => useStore.getState()

/** An arena final drafted by the assistant, at the hub. */
function arenaAtHub(): Game {
  show({ universe: u, loadedLeagues: ['england', 'portugal'], game: null, parked: {}, toast: null, screen: 'game' })
  st().startGame(finalGameSettings(u, { teamName: 'R7 Arena', formationId: '4-3-3', field: 'wheel', wheelLeagues: ['england'], difficulty: 'calibrated', seed: 'r7-reserve', hardMode: false, twists: false }, 'R7A'))
  st().autoDraftRest()
  st().finishDraft()
  return st().game!
}

describe('R7-2: the reserve keeper is named in an arena shoot-out', () => {
  // Tondela 2025-26 lists no keeper at all, so it always fields its reserve keeper (engine 6, E6-5)
  const reserve = reserveKeeperId('tondela', 2025)
  it('is a real player-season the AI lookup finds, never in the index', () => {
    expect(reserveKeeper(u, 'tondela', 2025)?.name).toBe('Reserve keeper')
    expect(u.index[reserve]).toBeUndefined()
  })

  it('the penalty order and the kicks read his name, never his id', () => {
    const g = arenaAtHub()
    const ours = Object.values(g.lineup)
    show({ game: { ...g, arena: { ...g.arena!, pending: { shootout: { defaultOrder: ours, keepers: [g.lineup.gk], theirOrder: [reserve], theirKeeper: reserve } } } } })
    const pending = renderToString(createElement(ShootoutPanel)).replace(/<!-- -->/g, '')
    expect(pending).toContain('Their side: Reserve keeper')
    expect(pending).not.toContain('reserve-gk-')
    // The final played by the assistant, then its last row given a shoot-out the reserve keeper kicked in
    useStore.setState({ game: g })
    st().simArenaToEnd()
    const done = st().game!
    expect(done.phase).toBe('summary')
    const last = { ...done.arena!.log.at(-1)!, pens: { us: 4, them: 3, kicks: [{ us: false, takerId: reserve, scored: true }, { us: true, takerId: ours[1], scored: true }] } }
    show({ game: { ...done, arena: { ...done.arena!, log: [...done.arena!.log.slice(0, -1), last] } } })
    for (const C of [ShootoutPanel, ArenaSummary]) {
      const html = renderToString(createElement(C))
      expect(html).not.toContain('reserve-gk-')
    }
    // The summary lists the final's kicks by name
    expect(renderToString(createElement(ArenaSummary))).toContain('Reserve keeper')
  })
})
