/**
 * The playback's bench change through the store's worker path (r9 perf): `benchChangeSoon` played by a stand-in
 * Worker that runs the real job on its own universe gives the game `benchChange` gives; a stale season, an error or
 * no Worker falls back to the plain action.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
vi.setConfig({ testTimeout: 120_000 })
import { freshTestUniverse, loadTestUniverse } from '../../engine/__tests__/helpers'
import { QUICK_RULES } from '@engine/draft'
import { wheelSeasons } from '@engine/era'
import { useStore } from '../store'
import { setupRules, shortNameFor } from '../logic/setup'
import { kickoffStep } from '../logic/endCase'
import { playbackResults, quickChangeProblem, quickSquadAt } from '../logic/quick'
import { CHANGES_CLOSED_NOTE } from '../logic/quickSeam'
import { runQuickJob, universeMark, type QuickWorkerAsk } from '../quickJob'
import type { Game, GameSettings } from '../types'
import { loadStore } from './qaHarness'

const u = loadTestUniverse(['england'])
const other = freshTestUniverse(['england'])
const st = () => useStore.getState()
/** The game as JSON without what `createGame` stamps from the clock (its id and start time). */
const played = () => JSON.stringify({ ...st().game, id: '', createdAt: 0 })

/** A stand-in for the quick-season worker: the real job on a universe of its own, answered on a later task. */
let jobs = 0
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  postMessage(ask: QuickWorkerAsk) {
    if (ask.type !== 'job') return
    jobs++
    setTimeout(() => {
      try {
        if (universeMark(other) !== ask.mark) throw new Error('the league data differs from the page')
        this.onmessage?.({ data: { id: ask.id, game: structuredClone(runQuickJob(structuredClone(ask.job), other)) } })
      } catch (err) {
        this.onmessage?.({ data: { id: ask.id, error: String(err) } })
      }
    }, 0)
  }
  terminate() {}
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function quickGame(seed: string, january: boolean): void {
  loadStore(u, ['england'])
  const stops = wheelSeasons(u, ['england'], false)
  const rules = setupRules(QUICK_RULES, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: stops[0], eraTo: stops[stops.length - 1], first: stops[0], last: stops[stops.length - 1], twists: true, leagues: ['england'], benchPicks: 3, modes: [], powerUps: false, classic: false, managers: false })
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === 2024).map((cs) => cs.clubId)
  const settings: GameSettings = { mode: 'quick', seed, formationId: '4-3-3', teamName: 'R9 XI', shortName: shortNameFor('R9 XI'), leagueId: 'england', wheelLeagues: ['england'], hostClubId: clubs[1], leagueSeason: 2024, rules, jobSecurity: false, difficulty: 'calibrated', continental: false, january }
  st().startGame(settings)
  st().autoDraftRest()
  st().finishDraft()
  for (let i = 0; i < 10 && st().game!.phase === 'kickoff'; i++) {
    const g = st().game!
    if (kickoffStep(g) === 'case') {
      if (!g.endCase?.opened) st().openCase()
      else st().finishCase()
    } else st().kickOff(false)
  }
}

function aChange(g: Game, revealed: number): { slotId: string; inId: string } {
  const results = playbackResults(g)
  const view = quickSquadAt(g, u, results, revealed)
  for (const inId of view.bench) for (const slotId of Object.keys(view.lineup)) if (!quickChangeProblem(g, u, results, revealed, { slotId, inId })) return { slotId, inId }
  throw new Error('no change open')
}

describe('benchChangeSoon', () => {
  it('plays the same game in the worker as benchChange on the page, January or not, two changes running', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    for (const [i, january] of [false, true, false].entries()) {
      const seed = `r9-bench-soon-${i}`
      // The plain action twice
      quickGame(seed, january)
      const r1 = january ? 2 : 4
      const c1 = aChange(st().game!, r1)
      st().benchChange(r1, c1.slotId, c1.inId)
      const c2 = st().game!.phase === 'january' || st().game!.quickOpen ? aChange(st().game!, r1 + 1) : null
      if (c2) st().benchChange(r1 + 1, c2.slotId, c2.inId)
      const plain = played()
      // The same through the worker
      quickGame(seed, january)
      jobs = 0
      const before = st().game
      const soon = st().benchChangeSoon(r1, c1.slotId, c1.inId)
      expect(st().changingBench).toBe(true)
      await soon
      expect(st().changingBench).toBe(false)
      expect(st().game).not.toBe(before)
      if (c2) await st().benchChangeSoon(r1 + 1, c2.slotId, c2.inId)
      expect(jobs).toBe(c2 ? 2 : 1)
      expect(played(), seed).toBe(plain)
      expect(Object.isFrozen(st().game)).toBe(true)
    }
  })

  it('with no Worker, plays the change on the page', async () => {
    quickGame('r9-bench-soon-plain', false)
    const c = aChange(st().game!, 3)
    await st().benchChangeSoon(3, c.slotId, c.inId)
    expect(st().game!.quickChanges).toHaveLength(1)
  })

  it('a season an earlier engine played is refused by the worker and the page says so, the games kept', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    quickGame('r9-bench-soon-stale', false)
    useStore.setState((s) => {
      const g = JSON.parse(JSON.stringify(s.game))
      g.quickResult.results[0].gf += 1
      return { game: g }
    })
    const shown = JSON.stringify(st().game!.quickResult!.results)
    const c = aChange(st().game!, 5)
    jobs = 0
    await st().benchChangeSoon(5, c.slotId, c.inId)
    expect(jobs).toBe(1)
    expect(st().toast).toBe(CHANGES_CLOSED_NOTE)
    expect(JSON.stringify(st().game!.quickResult!.results)).toBe(shown)
    expect(st().game!.quickChanges ?? []).toEqual([])
  })

  it('a refused change is the plain toast, nothing sent to the worker', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    quickGame('r9-bench-soon-refused', false)
    jobs = 0
    await st().benchChangeSoon(3, 'no-such-slot', 'nobody')
    expect(jobs).toBe(0)
    expect(st().toast).toBeTruthy()
  })
})
