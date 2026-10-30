/**
 * Round 14's open reload items (r16, docs/QA.md R16-O1 and R16-O2), through server renders: the manager spin, the
 * end-of-draft case and the January spin come back landed after a reload once this device saw them land (the device's
 * last landed reel, `reelLanded.ts`), and turn as before when it did not; the Draft's and the online room's case reels
 * carry a scope. Presentation only: rendering any of them moves nothing in the game.
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
import { readFileSync } from 'node:fs'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { createGame, setupRules } from '@game/logic/setup'
import { kickOff, rollJanuarySpin, toKickoff } from '@game/logic/quick'
import { pickManager } from '@game/logic/managers'
import { openEndCase } from '@game/logic/endCase'
import type { Game, GameSettings } from '@game/types'
import { ManagerSpin } from '../components/ManagerSpin'
import { EndCase } from '../components/EndCase'
import { JanuaryWindow } from '../components/JanuaryWindow'
import { itemReelMark, readLandedReel, REEL_LANDED_KEY, rememberLanded } from '../reelLanded'
import { markupProblems, show } from './qaSsr'

const u = loadTestUniverse(['england'])
const RULES = setupRules(QUICK_RULES, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: 0, eraTo: 9999, first: 0, last: 9999, twists: true, leagues: ['england'], benchPicks: 1, managers: true, managerSpin: true, endCase: true })

function settings(seed: string, january = false): GameSettings {
  return { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Reel XI', shortName: 'REL', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: RULES, jobSecurity: false, difficulty: 'calibrated', january }
}

/** A Quick Draft drafted by the assistant and standing at its kick-off step. */
function atKickoff(seed: string, january = false): Game {
  const g = createGame(settings(seed, january))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, u)
  return g
}

const copy = (g: Game): Game => JSON.parse(JSON.stringify(g)) as Game
const stageOf = (html: string, id: string) => new RegExp(`data-stage="([a-z]+)"[^>]*data-testid="${id}"`).exec(html)?.[1]

describe('QA r16: item reels after a landing and a reload', { timeout: 60_000 }, () => {
  show({ universe: u, loadedLeagues: ['england'] })

  it('brings the manager spin back landed only when this device saw these three land', () => {
    for (const seed of ['r16-mspin-1', 'r16-mspin-2', 'r16-mspin-3']) {
      const g = atKickoff(seed)
      const before = JSON.stringify(g)
      const opts = g.managerSpin!.options
      expect(opts.length).toBe(3)
      localStorage.clear()
      const fresh = renderToString(createElement(ManagerSpin, { u, game: g }))
      expect(fresh).toContain('data-testid="mspin-go"')
      expect(fresh).not.toContain('data-testid="mspin-pick-0"')
      // Seen land on this device: the three reels mount landed and the Pick buttons are there
      rememberLanded(itemReelMark(g.id, 'manager-spin', opts.map((m) => m.id).join(',')))
      const back = renderToString(createElement(ManagerSpin, { u, game: copy(g) }))
      expect(back).not.toContain('data-testid="mspin-go"')
      for (let i = 0; i < 3; i++) {
        expect(stageOf(back, `mspin-reel-${i}`)).toBe('landed')
        expect(back).toContain(`data-testid="mspin-pick-${i}"`)
      }
      expect(markupProblems(back)).toEqual([])
      // Another game's three, or the same game's mark for other managers, still spin
      rememberLanded(itemReelMark(`${g.id}-other`, 'manager-spin', opts.map((m) => m.id).join(',')))
      expect(renderToString(createElement(ManagerSpin, { u, game: g }))).toContain('data-testid="mspin-go"')
      rememberLanded(itemReelMark(g.id, 'manager-spin', opts.map((m) => m.id).reverse().join(',')))
      expect(renderToString(createElement(ManagerSpin, { u, game: g }))).toContain('data-testid="mspin-go"')
      expect(JSON.stringify(g)).toBe(before)
    }
  })

  it('brings an opened end case back with its reel landed, and an unopened one idle', () => {
    for (const seed of ['r16-case-1', 'r16-case-2', 'r16-case-3']) {
      const g = atKickoff(seed)
      pickManager(g, u, g.managerSpin!.options[0].id)
      expect(g.endCase).toBeTruthy()
      localStorage.clear()
      const closed = renderToString(createElement(EndCase, { u, game: g }))
      expect(closed).toContain('data-testid="case-open"')
      expect(closed).toContain('data-testid="case-idle"')
      openEndCase(g)
      const c = g.endCase!
      const mark = itemReelMark(g.id, 'end-case', c.drop.kind === 'icon' ? c.drop.id : c.drop.powerUp)
      // Opened but never seen land here (a reload mid-reel): the result at once, as before
      const unseen = renderToString(createElement(EndCase, { u, game: g }))
      expect(unseen).toContain('data-testid="case-idle"')
      expect(unseen).toContain('data-testid="case-result"')
      // Seen land: the reel itself, landed, with the result
      rememberLanded(mark)
      const before = JSON.stringify(g)
      const back = renderToString(createElement(EndCase, { u, game: copy(g) }))
      expect(stageOf(back, 'case-reel')).toBe('landed')
      expect(back).not.toContain('data-testid="case-idle"')
      expect(back).toContain('data-testid="case-result"')
      expect(back).not.toContain('data-testid="case-skip"')
      expect(markupProblems(back)).toEqual([])
      expect(JSON.stringify(g)).toBe(before)
      expect(readLandedReel()).toBe(mark)
    }
  })

  it('brings an opened January spin back with its reel landed once seen', () => {
    for (const seed of ['r16-jan-1', 'r16-jan-2']) {
      const g = atKickoff(seed, true)
      pickManager(g, u, g.managerSpin!.options[0].id)
      openEndCase(g)
      g.endCase!.done = true
      kickOff(g, u)
      expect(g.phase).toBe('january')
      rollJanuarySpin(g, u)
      const j = g.quickJanuary!
      expect(j.spin).toBeTruthy()
      localStorage.clear()
      const unseen = renderToString(createElement(JanuaryWindow, { u, game: g, j }))
      expect(unseen).toContain('data-testid="january-spin-landed"')
      expect(unseen).not.toContain('data-testid="january-spin-reel"')
      rememberLanded(itemReelMark(g.id, 'january-spin', j.spin!.playerSeasonId))
      const before = JSON.stringify(g)
      const back = renderToString(createElement(JanuaryWindow, { u, game: copy(g), j: copy(g).quickJanuary! }))
      expect(stageOf(back, 'january-spin-reel')).toBe('landed')
      expect(back).toContain('data-testid="january-spin-landed"')
      expect(back).not.toContain('data-testid="january-spin-skip"')
      expect(markupProblems(back)).toEqual([])
      expect(JSON.stringify(g)).toBe(before)
    }
  })

  it('keys every case reel that can be reloaded: the Draft (a Dynasty summer by its year) and the online room', () => {
    const draft = readFileSync(new URL('../screens/Draft.tsx', import.meta.url), 'utf8')
    expect(draft).toMatch(/<CaseReel [^\n]*scope=\{isDynastySummer \? `\$\{game\.id\}:\$\{game\.year\}` : game\.id\}/)
    const room = readFileSync(new URL('../online/Rooms.tsx', import.meta.url), 'utf8')
    expect(room).toMatch(/<CaseReel [^\n]*scope=\{`room:\$\{view\.code\}`\}/)
    expect(REEL_LANDED_KEY).toBe('touchline-reel-landed')
  })
})
