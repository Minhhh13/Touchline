/**
 * QA round 13 (r15, docs/QA.md): the hot-seat draft's two open items from round 11, through the store and a server
 * render of the screen. R14-O2: once a spin has landed, "Let the assistant pick" is the first control after the club's
 * name (where the landing puts the focus), before the squad's rows. R14-O3: a spin this tab saw land comes back landed
 * after a reload (the saved draft read back, sessionStorage kept), and a spin it did not see never does.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const store = () => {
    const mem = new Map<string, string>()
    return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear() }
  }
  Object.defineProperty(globalThis, 'localStorage', { value: store(), configurable: true })
  Object.defineProperty(globalThis, 'sessionStorage', { value: store(), configurable: true })
})
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { h2hComplete } from '@engine/h2h'
import { Rng } from '@engine/rng'
import { useStore, type H2HGame } from '@game/store'
import { H2HScreen } from '../screens/H2H'
import { landedBefore, landedKey, rememberLanded, REEL_LANDED_KEY } from '../reelLanded'
import { markupProblems, show } from './qaSsr'

const u = loadTestUniverse(['england'])
const FORMATIONS = ['4-3-3', '4-4-2', '3-5-2', '4-2-3-1', '5-3-2']

function start(seed: string): void {
  const r = new Rng(seed)
  show({ universe: u, loadedLeagues: ['england'], game: null, h2h: null, screen: 'h2h' })
  useStore.getState().startH2H([{ name: 'Ann Lee', shortName: 'ANN', formationId: r.pick(FORMATIONS), hostClubId: 'everton' }, { name: 'Bo', shortName: 'BOB', formationId: r.pick(FORMATIONS), hostClubId: 'fulham' }], 'england', ['england'], 2024, 'calibrated', r.next() < 0.3, seed)
}
const key = (h: H2HGame) => landedKey('h2h', h.seed, h.draft.spins, h.draft.current)
/** A reload: the saved head-to-head read back from its JSON. */
const reload = () => show({ h2h: JSON.parse(JSON.stringify(useStore.getState().h2h)) as H2HGame })
/** The server render reads the store's initial state: `show({})` copies what the actions wrote into it first. */
const render = () => {
  show({})
  return renderToString(createElement(H2HScreen))
}

describe('QA r15: the hot-seat draft after a landing and a reload', { timeout: 60_000 }, () => {
  it('shows a spin this tab saw land at once after a reload, with the assistant first after the club name', () => {
    let landedRenders = 0
    let freshRenders = 0
    const keys = new Set<string>()
    for (let s = 0; s < 8; s++) {
      const seed = `qa-r15-h2h-${s}`
      start(seed)
      sessionStorage.clear()
      for (let i = 0; i < 200 && !h2hComplete(useStore.getState().h2h!.draft); i++) {
        const h = useStore.getState().h2h!
        if (h.draft.picking === null) {
          useStore.getState().h2hSpin()
          const k = key(useStore.getState().h2h!)
          expect(k).not.toBeNull()
          // Every spin of every game has its own key: a fresh spin is never taken for one already seen
          expect(keys.has(k!)).toBe(false)
          keys.add(k!)
          // Not seen yet: the reel turns, nothing to pick from, no assistant button
          if (i % 3 === 0) {
            const html = render()
            expect(html).not.toContain('data-testid="h2h-auto"')
            expect(html).not.toContain('data-testid="h2h-draft-btn"')
            freshRenders++
          }
          rememberLanded(k)
          continue
        }
        // Reloaded mid-spin (before or between the two managers' picks): the same key, so the reel stays landed
        if (i % 2 === 0) reload()
        const after = useStore.getState().h2h!
        expect(landedBefore(key(after))).toBe(true)
        {
          const html = render()
          const head = html.search(/<h2 tabindex="-1"/)
          const auto = html.indexOf('data-testid="h2h-auto"')
          const firstRow = html.indexOf('data-testid="h2h-draft-btn"')
          expect(head).toBeGreaterThan(-1)
          expect(auto).toBeGreaterThan(head)
          expect(firstRow).toBeGreaterThan(auto)
          // Between the club's name and the assistant: no other control
          expect(html.slice(head, html.lastIndexOf('<button', auto))).not.toMatch(/<(button|a|input|select)\b|tabindex="0"/)
          expect(markupProblems(html)).toEqual([])
          landedRenders++
        }
        useStore.getState().h2hAuto()
      }
      expect(h2hComplete(useStore.getState().h2h!.draft)).toBe(true)
    }
    expect(landedRenders).toBeGreaterThan(150)
    expect(freshRenders).toBeGreaterThan(30)
  })

  it('forgets a landing for another game, another spin and blocked storage', () => {
    const k = landedKey('h2h', 'seed-a', 3, { clubId: 'everton', season: 2019 })
    rememberLanded(k)
    expect(landedBefore(k)).toBe(true)
    expect(landedBefore(landedKey('h2h', 'seed-b', 3, { clubId: 'everton', season: 2019 }))).toBe(false)
    expect(landedBefore(landedKey('h2h', 'seed-a', 4, { clubId: 'everton', season: 2019 }))).toBe(false)
    expect(landedBefore(landedKey('h2h', 'seed-a', 3, { clubId: 'everton', season: 2020 }))).toBe(false)
    expect(landedBefore(landedKey('h2h', 'seed-a', 3, null))).toBe(false)
    expect(sessionStorage.getItem(REEL_LANDED_KEY)).toBe(k)
    const real = globalThis.sessionStorage
    Object.defineProperty(globalThis, 'sessionStorage', { get: () => { throw new Error('blocked') }, configurable: true })
    try {
      expect(landedBefore(k)).toBe(false)
      expect(() => rememberLanded(k)).not.toThrow()
    } finally {
      Object.defineProperty(globalThis, 'sessionStorage', { value: real, configurable: true })
    }
  })
})
