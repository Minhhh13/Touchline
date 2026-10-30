/**
 * QA round 14 (docs/QA.md, r16), over round 15's P8: the hot-seat's Auto-complete must draw exactly what Spin and "Let
 * the assistant pick" pressed in turn draw, on many seeds, leagues, formations and Hard mode, from the start and from a
 * draft part made by hand (picks by hand included), and its squads must hold 22 assistant-or-hand picks: 11 a side.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { breathe, loadTestUniverse } from '../../engine/__tests__/helpers'
import { h2hComplete, h2hEligibleSlots, h2hUsable } from '@engine/h2h'
import { Rng } from '@engine/rng'
import { useStore } from '../store'

const FULL = process.env.QA_FULL === '1'
const FORMATIONS = ['4-3-3', '3-5-2', '4-4-2', '4-2-3-1', '5-3-2', '4-4-2-diamond']
const st = () => useStore.getState()

function start(leagues: string[], seed: string, f0: string, f1: string, hardMode: boolean): void {
  useStore.setState({ universe: loadTestUniverse(leagues), loadedLeagues: leagues, h2h: null, toast: null })
  st().startH2H([{ name: 'Ann', shortName: 'ANN', formationId: f0, hostClubId: 'everton' }, { name: 'Bob', shortName: 'BOB', formationId: f1, hostClubId: 'fulham' }], leagues[0], leagues, 2024, 'calibrated', hardMode, seed)
}

/** Spin and the assistant's pick in turn, as the two buttons; returns the picks pressed. */
function pressButtons(limit = 400): number {
  let picks = 0
  for (let i = 0; i < limit && !h2hComplete(st().h2h!.draft); i++) {
    if (st().h2h!.draft.picking === null) st().h2hSpin()
    else {
      const before = st().h2h!.draft.log.length
      st().h2hAuto()
      if (st().h2h!.draft.log.length === before) break
      picks++
    }
  }
  return picks
}

/** A part made by hand: `steps` presses, a pick by hand (any eligible man, chosen by a test stream) every third pick. */
function byHand(steps: number, chooser: Rng): void {
  for (let i = 0; i < steps && !h2hComplete(st().h2h!.draft); i++) {
    const h = st().h2h!
    if (h.draft.picking === null) {
      st().h2hSpin()
      continue
    }
    const options = h2hUsable(st().universe!, h.draft).filter((p) => h2hEligibleSlots(h.draft, p).length > 0)
    const choice = i % 3 === 2 && options.length ? options[chooser.int(0, options.length - 1)] : null
    if (choice) st().h2hPick(choice.id, h2hEligibleSlots(h.draft, choice)[0].id)
    else st().h2hAuto()
  }
}

const picksIn = (log: string[]) => log.filter((l) => / drafts /.test(l)).length

describe('QA r16: head-to-head Auto-complete equals the buttons (P8)', () => {
  const cases: [string[], number][] = [[['england'], FULL ? 30 : 10], [['spain'], FULL ? 12 : 4], [['england', 'germany'], FULL ? 12 : 4]]
  for (const [leagues, n] of cases) {
    it(`from the start, ${leagues.join('+')}, ${n} seeds`, async () => {
      for (let i = 0; i < n; i++) {
        const seed = `qa-r16-auto-${leagues.join('-')}-${i}`
        const f0 = FORMATIONS[i % FORMATIONS.length]
        const f1 = FORMATIONS[(i * 5 + 1) % FORMATIONS.length]
        const hard = i % 4 === 3
        start(leagues, seed, f0, f1, hard)
        const pressed = pressButtons()
        const buttons = JSON.stringify(st().h2h)
        const squads = st().h2h!.draft.drafts.map((d) => Object.keys(d.lineup).length + d.bench.length)
        start(leagues, seed, f0, f1, hard)
        st().h2hAutoDraft()
        expect(h2hComplete(st().h2h!.draft), seed).toBe(true)
        expect(JSON.stringify(st().h2h), seed).toBe(buttons)
        expect(squads, seed).toEqual([11, 11])
        expect(pressed, seed).toBe(22)
        expect(picksIn(st().h2h!.draft.log), seed).toBe(22)
        if (i % 3 === 2) await breathe()
      }
    }, 60_000)
  }

  it('from a part made by hand (hand picks included), and the season played after it', async () => {
    const n = FULL ? 24 : 8
    for (let i = 0; i < n; i++) {
      const seed = `qa-r16-auto-half-${i}`
      start(['england'], seed, FORMATIONS[i % 6], FORMATIONS[(i + 2) % 6], i % 5 === 4)
      byHand(3 + ((i * 7) % 25), new Rng(`${seed}#chooser`))
      const half = st().h2h!
      pressButtons()
      if (i % 2 === 0) st().h2hFinish()
      const buttons = JSON.stringify(st().h2h)
      useStore.setState({ h2h: half })
      st().h2hAutoDraft()
      if (i % 2 === 0) st().h2hFinish()
      expect(JSON.stringify(st().h2h), seed).toBe(buttons)
      expect(picksIn(st().h2h!.draft.log), seed).toBe(22)
      if (i % 3 === 2) await breathe()
    }
  }, 60_000)

  it('a second Auto-complete, or one after the season, changes nothing', () => {
    start(['england'], 'qa-r16-auto-twice', '4-3-3', '4-4-2', false)
    st().h2hAutoDraft()
    const done = st().h2h
    st().h2hAutoDraft()
    expect(st().h2h).toBe(done)
    st().h2hFinish()
    const played = st().h2h
    st().h2hAutoDraft()
    expect(st().h2h).toBe(played)
  })
})
