/**
 * Regression tests for the screen audit (r8, `claude/r8-audit-screens`): the helpers the fixes moved out of the
 * screens, and the screens themselves rendered on the server.
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
import { useStore, type H2HGame } from '@game/store'
import { seasonFilterIn } from '@game/logic/exploreFilter'
import { slotTapMove } from '../slotTap'
import { makeFlash } from '../useFlash'
import { pickKeys } from '../useStorePick'
import { unlockedNames } from '../i18n/trophyText'
import { translator } from '../i18n'
import { h2h as h2hText } from '../i18n/en/h2h'
import { fitText } from '../slotRatingText'
import { H2HScreen, setRematch } from '../screens/H2H'
import { show } from './qaSsr'

const u = loadTestUniverse(['england', 'spain'])
const st = () => useStore.getState()

describe('the arena hub: two taps on the pitch move one man', () => {
  const lineup = { gk: 'a', cb1: 'b', st: 'c' }
  it('the man in the first slot goes to the second (assignPlayer swaps the other back)', () => {
    expect(slotTapMove(lineup, 'cb1', 'st')).toEqual({ id: 'b', slot: 'st' })
    expect(slotTapMove(lineup, 'cb1', 'lb')).toEqual({ id: 'b', slot: 'lb' })
  })
  it('from an empty slot, the man tapped second moves into it (it used to move nobody)', () => {
    expect(slotTapMove(lineup, 'lb', 'st')).toEqual({ id: 'c', slot: 'lb' })
  })
  it('nothing for the same slot twice, or two empty slots', () => {
    expect(slotTapMove(lineup, 'st', 'st')).toBe(null)
    expect(slotTapMove(lineup, 'lb', 'rb')).toBe(null)
  })
})

describe('a "Copied" flash', () => {
  function clock() {
    let now = 0
    const timers = new Map<number, { at: number; fn: () => void }>()
    let next = 1
    return {
      set: (fn: () => void, ms: number) => {
        timers.set(next, { at: now + ms, fn })
        return next++ as unknown as ReturnType<typeof setTimeout>
      },
      clear: (id: ReturnType<typeof setTimeout>) => void timers.delete(id as unknown as number),
      tick(ms: number) {
        now += ms
        for (const [id, t] of [...timers]) if (t.at <= now) {
          timers.delete(id)
          t.fn()
        }
      },
      pending: () => timers.size,
    }
  }
  it('a second copy restarts the wait: the first timer never turns the label off early', () => {
    const c = clock()
    const seen: boolean[] = []
    const f = makeFlash((on) => seen.push(on), 1500, c)
    f.flash()
    c.tick(1000)
    f.flash()
    c.tick(1000)
    expect(seen).toEqual([true, true])
    c.tick(600)
    expect(seen).toEqual([true, true, false])
  })
  it('dispose drops the pending timer (no state set after the screen goes)', () => {
    const c = clock()
    const seen: boolean[] = []
    const f = makeFlash((on) => seen.push(on), 1500, c)
    f.flash()
    f.dispose()
    expect(c.pending()).toBe(0)
    c.tick(5000)
    expect(seen).toEqual([true])
  })
})

describe('the store slice a screen subscribes to', () => {
  it('picks exactly the named keys, the same values', () => {
    const s = st()
    const picked = pickKeys(s, ['universe', 'game', 'go'])
    expect(Object.keys(picked).sort()).toEqual(['game', 'go', 'universe'])
    expect(picked.go).toBe(s.go)
  })
})

describe('Explore: the Top view keeps a season only where the league has it', () => {
  it('a classic English season falls back to every season in Spain, a modern one is kept', () => {
    expect(seasonFilterIn(u, 'spain', 'all')).toBe('all')
    expect(seasonFilterIn(u, 'spain', 2015)).toBe(2015)
    expect(seasonFilterIn(u, 'spain', 1995)).toBe('all')
    expect(seasonFilterIn(u, 'spain', u.lastSeason + 1)).toBe('all')
  })
})

describe('the Dugout Club tab names the game\'s achievements', () => {
  it('reads names, never ids, and leaves out the internal survivor-pending', () => {
    const names = unlockedNames(['dealmaker', 'survivor-pending', 'champions'])
    expect(names.map((n) => n.id)).toEqual(['dealmaker', 'champions'])
    expect(names[0].title).toBe('Dealmaker')
    expect(names.every((n) => n.title && n.text && n.title !== n.id)).toBe(true)
  })
})

describe('words that used to skip t()', () => {
  it('a head-to-head season choice, in progress and estimated', () => {
    const t = translator(h2hText)
    expect(t('seasonChoice', { season: '2026-27', current: 'yes', est: 'no' })).toBe('2026-27 (in progress)')
    expect(t('seasonChoice', { season: '1995-96', current: 'no', est: 'yes' })).toBe('1995-96 (est.)')
    expect(t('seasonChoice', { season: '2019-20', current: 'no', est: 'no' })).toBe('2019-20')
  })
  it('a draft slot chip\'s fit', () => {
    expect(fitText('fits')).toBe('fits')
    expect(fitText('can cover')).toBe('can cover')
  })
})

describe('Head-to-head: a Rematch from an older save', () => {
  it('opens the setup though the save has no wheelLeagues (it threw in the setup\'s first render)', () => {
    show({ universe: u, loadedLeagues: ['england', 'spain'], game: null, parked: {}, toast: null, h2h: null, screen: 'h2h' })
    st().startH2H([{ name: 'Ann', shortName: 'ANN', formationId: '4-3-3', hostClubId: 'everton' }, { name: 'Bob', shortName: 'BOB', formationId: '4-4-2', hostClubId: 'fulham' }], 'england', ['england'], 2024, 'calibrated', false, 'r8-old')
    // A save from before `wheelLeagues` (the store's merge does not fill it in)
    const { wheelLeagues: _drop, ...rest } = st().h2h!
    void _drop
    const old = rest as H2HGame
    st().abandonH2H()
    show({ h2h: null, screen: 'h2h' })
    setRematch(old)
    const html = renderToString(createElement(H2HScreen))
    expect(html).toContain('Ann')
    expect(html).toContain('Bob')
    setRematch(null)
  })
})
