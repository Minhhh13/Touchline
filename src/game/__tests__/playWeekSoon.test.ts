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
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { createGame, beginSeason } from '../logic/setup'
import type { MatchPlayMode } from '../logic/assistant'
import type { Game, GameSettings } from '../types'
import { useStore } from '../store'

const u = loadTestUniverse()
const LONG = 300_000
const MODES: MatchPlayMode[] = ['sim', 'watch', 'auto', 'sim', 'sim']

function preseason(seed: string, mode: GameSettings['mode']): Game {
  const g = createGame({ mode, seed, formationId: '4-3-3', teamName: 'Split XI', shortName: 'SPL', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2023, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: mode === 'dynasty', difficulty: 'calibrated' })
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  return g
}

/** A season through the store, Watch, Auto-play and Sim result in turn, every event answered: the game after each week. */
async function playThrough(start: Game, split: boolean, weeks: number, sliceMs?: number): Promise<string[]> {
  useStore.setState({ universe: u, loadedLeagues: ['england'], game: start, screen: 'game', playingWeek: false, liveAuto: false })
  const out: string[] = []
  for (let w = 0; w < weeks && useStore.getState().game!.phase !== 'summary'; w++) {
    const s = useStore.getState()
    const ev = s.game!.pendingEvent
    if (ev) s.resolveEvent(ev.choices[w % ev.choices.length].id)
    useStore.getState().setMatchPlay(MODES[w % MODES.length])
    if (split) await useStore.getState().playWeekSoon(undefined, sliceMs === undefined ? undefined : { sliceMs })
    else useStore.getState().playWeek()
    if (useStore.getState().game!.live) useStore.getState().finishLiveNow()
    if (useStore.getState().game!.phase === 'match') useStore.getState().closeMatch()
    out.push(JSON.stringify(useStore.getState().game))
    // Yield between weeks so a long plain run never starves the Vitest worker's RPC
    await new Promise((r) => setTimeout(r, 0))
  }
  expect(useStore.getState().playingWeek).toBe(false)
  return out
}

describe('Play matchweek in parts (playWeekSoon)', () => {
  it('plays a seeded Season and a Dynasty season exactly as playWeek does, event for event', async () => {
    for (const [seed, mode, weeks] of [['split-season-1', 'season', 40], ['split-dynasty-1', 'dynasty', 40], ['split-season-2', 'season', 12]] as const) {
      const start = preseason(seed, mode)
      const whole = await playThrough(start, false, weeks)
      const parts = await playThrough(start, true, weeks)
      expect(parts.length).toBe(whole.length)
      expect(parts.length).toBeGreaterThanOrEqual(12)
      for (let i = 0; i < whole.length; i++) expect(parts[i], `${seed} week ${i + 1}`).toBe(whole[i])
      // Every match kept its events in memory: the comparison is event by event
      const last = JSON.parse(whole[whole.length - 1]) as Game
      expect(last.season!.fixtures.filter((f) => f.result && f.result.events.length).length).toBeGreaterThan(50)
    }
  }, LONG)

  it('ignores a second tap while one runs, and a game that moved meanwhile is played as it is now', async () => {
    const start = preseason('split-taps', 'season')
    useStore.setState({ universe: u, loadedLeagues: ['england'], game: start, screen: 'game', playingWeek: false })
    useStore.getState().setMatchPlay('sim')
    const a = useStore.getState().playWeekSoon()
    expect(useStore.getState().playingWeek).toBe(true)
    await useStore.getState().playWeekSoon()
    await a
    expect(useStore.getState().game!.season!.matchweek).toBe(1)
    // Reference: the same taps with playWeek
    const ref = preseason('split-taps', 'season')
    useStore.setState({ game: ref })
    useStore.getState().setMatchPlay('sim')
    useStore.getState().playWeek()
    const once = JSON.stringify(useStore.getState().game)
    // A change to the game while the week waits for the paint: the week is played on the changed game
    useStore.setState({ game: ref })
    useStore.getState().setMatchPlay('sim')
    const b = useStore.getState().playWeekSoon()
    useStore.getState().setMatchPlay('watch')
    useStore.getState().setMatchPlay('sim')
    await b
    expect(JSON.stringify(useStore.getState().game)).toBe(once)
  }, LONG)

  it('plays the week a step a task (every fixture, every stop) and still gives playWeek\'s game, over many seeds', async () => {
    let weeksSeen = 0
    for (let i = 0; i < 12; i++) {
      const start = preseason(`split-steps-${i}`, i % 3 === 2 ? 'dynasty' : 'season')
      const whole = await playThrough(start, false, 10)
      const steps = await playThrough(start, true, 10, 0)
      expect(steps.length).toBe(whole.length)
      for (let w = 0; w < whole.length; w++) expect(steps[w], `split-steps-${i} week ${w + 1}`).toBe(whole[w])
      weeksSeen += whole.length
    }
    expect(weeksSeen).toBe(120)
  }, LONG)

  it('lets the draft go when the game moves between two steps, and plays the week on the game as it is now', async () => {
    const start = preseason('split-moved', 'season')
    useStore.setState({ universe: u, loadedLeagues: ['england'], game: start, screen: 'game', playingWeek: false })
    useStore.getState().setMatchPlay('sim')
    const before = useStore.getState().game
    const a = useStore.getState().playWeekSoon(undefined, { sliceMs: 0 })
    // Past the paint and a few steps of the week, then a change to the game
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0))
    expect(useStore.getState().game).toBe(before)
    useStore.getState().setMatchPlay('watch')
    await a
    const got = JSON.stringify(useStore.getState().game)
    // Reference: the same change, then playWeek
    useStore.setState({ game: start, playingWeek: false })
    useStore.getState().setMatchPlay('watch')
    useStore.getState().playWeek()
    expect(got).toBe(JSON.stringify(useStore.getState().game))
    expect(useStore.getState().game!.season!.matchweek + (useStore.getState().game!.live ? 1 : 0)).toBe(1)
  }, LONG)

  it('sims weeks and sims to the next big match in slices, giving the plain actions\' game, digest and stop', async () => {
    const run = async (start: Game, soon: boolean, what: 'five' | 'big' | 'end') => {
      useStore.setState({ universe: u, loadedLeagues: ['england'], game: start, screen: 'game', playingWeek: false, digest: null, simStop: null })
      const s = useStore.getState()
      if (what === 'big') await (soon ? s.simToNextBigMatchSoon({ sliceMs: 0 }) : s.simToNextBigMatch())
      else await (soon ? s.simWeeksSoon(what === 'five' ? 5 : 40, { sliceMs: 0 }) : s.simWeeks(what === 'five' ? 5 : 40))
      const after = useStore.getState()
      return JSON.stringify({ game: after.game, digest: after.digest, simStop: after.simStop, matchView: after.matchView })
    }
    let summaries = 0
    for (let i = 0; i < 8; i++) {
      const start = preseason(`sim-steps-${i}`, i % 2 ? 'dynasty' : 'season')
      // From pre-season: five weeks, the run to the next big match, and the whole season
      for (const what of ['five', 'big', 'end'] as const) {
        await new Promise((r) => setTimeout(r, 0))
        const plain = await run(start, false, what)
        const got = await run(start, true, what)
        expect(got, `sim-steps-${i} ${what}`).toBe(plain)
        if (what === 'end' && (JSON.parse(plain) as { game: Game }).game.phase === 'summary') summaries++
      }
    }
    expect(summaries).toBeGreaterThan(4)
  }, LONG)
})
