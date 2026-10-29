import { afterEach, describe, expect, it, vi } from 'vitest'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { wheelSeasons } from '@engine/era'
import { defaultHostClub, setupRules, shortNameFor } from '../logic/setup'
import { compactGame } from '../logic/compact'
import { normaliseGame } from '../logic/save'
import { encodeSave, parseSave } from '../saveStorage'
import { canonicalJson } from '../../online/core/canonical'
import { compareProgress, gameSlot as slotOf, progressKey } from '../../online/core/slots'
import { encodeSlot } from '../../online/sync'
import { persistedState, useStore } from '../store'
import type { Game, GameSettings, Mode } from '../types'
import { breathe, Chooser, crashToast, driveDraft, loadStore, seeds, stepHook } from './qaHarness'
import { driveSeason } from './qaSeasonHarness'
import { continentalProblems } from './qaEuropeChecks'

/**
 * QA round 4 (r9): engine 7's Continental Cup in Season and Dynasty, every league loaded, across page reloads and
 * cloud-save round trips. A cloud trip uploads the game as the sync does (`slotPayload`: the compacted game as JSON)
 * and restores it as `importCloudGame` does (`normaliseGame`, then the active game replaced); each trip must restore
 * the game it uploaded, field for field. Each run is played three times, plain, with reloads and with cloud trips
 * mixed in, and must end on the same game. Along every run the sync's progress key never goes backwards.
 */
const ALL = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
const u = loadTestUniverse(ALL)
const st = () => useStore.getState()
type Store = ReturnType<typeof useStore.getState>

function reloadNow(): void {
  const s = st()
  const raw = encodeSave(JSON.stringify({ state: persistedState(s), version: 1 }))
  const value = parseSave<Record<string, unknown>>(raw)
  const merge = useStore.persist.getOptions().merge!
  const fresh: Store = { ...useStore.getInitialState(), universe: s.universe, loadedLeagues: s.loadedLeagues }
  useStore.setState(merge(value.state, fresh) as Store, true)
}

/** Upload and restore as the sync would, on this device. Returns the uploaded text, or a problem. */
function cloudTrip(): { text?: string; problem?: string } {
  const g = st().game
  if (!g || (g.phase === 'match' && g.live)) return {}
  // The sync's payload for a game slot is the compacted game (`slotPayload`), sent as JSON and gzipped
  const text = JSON.stringify(compactGame(g))
  const restored = normaliseGame(JSON.parse(text))
  if (!restored) return { problem: 'normaliseGame refused the cloud copy' }
  if (slotOf(restored) !== slotOf(g)) return { problem: `slot ${slotOf(restored)} for ${slotOf(g)}` }
  if (canonicalJson(restored) !== canonicalJson(JSON.parse(text))) {
    const a = JSON.parse(text) as Record<string, unknown>
    const b = restored as unknown as Record<string, unknown>
    return { problem: `the restored game differs in ${Object.keys({ ...a, ...b }).filter((k) => canonicalJson(a[k]) !== canonicalJson(b[k])).join(', ')}` }
  }
  useStore.setState({ game: restored, digest: null, offseason: null })
  return { text }
}

function comparable(g: Game | null): string {
  if (!g) return 'null'
  return canonicalJson(compactGame(g)).split(g.id).join('ID').replace(/"\d{4}-\d\d-\d\dT[\d:.]+Z"/g, '"T"')
}

function settings(mode: Mode, seed: string, ch: Chooser, leagueId: string): GameSettings {
  const stops = wheelSeasons(u, [leagueId], false)
  const rules = setupRules({ ...SEASON_RULES, squadSize: 18 }, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: stops[0], eraTo: stops[stops.length - 1], first: stops[0], last: stops[stops.length - 1], twists: false, leagues: [leagueId], benchPicks: 0, modes: [], powerUps: false, classic: false })
  const seasons = [...new Set(u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.complete && !cs.classic).map((cs) => cs.season))].sort()
  const leagueSeason = mode === 'dynasty' ? seasons[Math.max(0, seasons.length - 3)] : ch.pick(seasons)
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === leagueSeason).map((cs) => cs.clubId)
  return { mode, seed, formationId: '4-4-2', teamName: 'R9 Europa', shortName: shortNameFor('R9 Europa'), leagueId, wheelLeagues: [leagueId], hostClubId: defaultHostClub(u, leagueId, leagueSeason, clubs), leagueSeason, rules, jobSecurity: false, difficulty: 'calibrated', continental: true }
}

interface Played {
  problems: string[]
  game: string
  trips: number
  texts: string[]
  groups: boolean
}

function play(mode: Mode, seed: string, leagueId: string, how: 'plain' | 'reload' | 'cloud', bias: number): Played {
  const ch = new Chooser(seed)
  const trips = new Rng(`trip:${seed}:${how}`)
  let n = 0
  let groups = false
  let last: { id: string; key: number[]; label: string } | null = null
  const texts: string[] = []
  const problems: string[] = []
  stepHook.run = () => {
    const g = st().game
    if (!g) return
    if (g.season?.continental?.groups) groups = true
    const label = `y${g.year} mw ${g.season?.matchweek} ${g.phase}`
    if (problems.length < 6) problems.push(...continentalProblems(g).map((x) => `${label}: ${x}`))
    // The sync orders two copies of one game by this key: a later step must never read as behind an earlier one
    const key = progressKey({ slot: slotOf(g)!, kind: 'game', game: g, active: true } as never)
    // A live match is never uploaded or compared (`sync.ts`): the slot waits for the whistle
    if (g.phase === 'match' && g.live) key.length = 0
    else if (last && last.id === g.id && compareProgress(key, last.key) < 0 && problems.length < 6) problems.push(`progress went back from ${last.label} [${last.key}] to ${label} [${key}]`)
    if (key.length) last = { id: g.id, key, label }
    if (how === 'reload' && trips.chance(0.1) && !st().digest) {
      reloadNow()
      n++
    } else if (how === 'cloud' && trips.chance(0.12) && !st().digest) {
      const out = cloudTrip()
      if (out.problem) problems.push(`${label} cloud: ${out.problem}`)
      if (out.text) {
        n++
        if (texts.length < 4 && trips.chance(0.3)) texts.push(out.text)
      }
    }
  }
  loadStore(u, ALL)
  const draft = (label: string) => driveDraft(u, ch, { autoAt: 0 }).problems.map((x) => `${label}: ${x}`)
  st().startGame(settings(mode, seed, ch, leagueId))
  problems.push(...draft('draft'))
  if (!problems.length) problems.push(...driveSeason(u, ch, { years: mode === 'dynasty' ? 1 : 0, draft, simBias: bias }).problems)
  const crash = crashToast()
  if (crash) problems.push(crash)
  stepHook.run = undefined
  return { problems, game: comparable(st().game), trips: n, texts, groups }
}

afterEach(() => {
  stepHook.run = undefined
})

const diffKeys = (a: string, b: string) => {
  const ga = JSON.parse(a) as Record<string, unknown>
  const gb = JSON.parse(b) as Record<string, unknown>
  return Object.keys({ ...ga, ...gb }).filter((k) => JSON.stringify(ga[k]) !== JSON.stringify(gb[k]))
}

describe('QA r9: the Continental Cup across reloads and cloud-save round trips', () => {
  const runs: Array<[Mode, string, number]> = [['season', 'spain', 2], ['dynasty', 'germany', 3], ['season', 'italy', 5], ['dynasty', 'portugal', 4], ['season', 'netherlands', 2], ['dynasty', 'france', 6]]
  const collected: string[] = []
  for (const [i, [mode, leagueId, bias]] of runs.entries()) {
    if (i >= seeds(runs.length)) continue
    it(`${mode} in ${leagueId}`, async () => {
      const seed = `r9-europe-${mode}-${leagueId}`
      await breathe()
      const a = play(mode, seed, leagueId, 'plain', bias)
      await breathe()
      const b = play(mode, seed, leagueId, 'reload', bias)
      await breathe()
      const c = play(mode, seed, leagueId, 'cloud', bias)
      collected.push(...c.texts)
      expect(a.groups, 'the cup had groups').toBe(true)
      expect([...a.problems, ...b.problems.map((x) => `reloaded: ${x}`), ...c.problems.map((x) => `cloud: ${x}`)]).toEqual([])
      if (a.game !== b.game) expect(diffKeys(a.game, b.game), `${b.trips} reloads`).toEqual([])
      if (a.game !== c.game) expect(diffKeys(a.game, c.game), `${c.trips} cloud trips`).toEqual([])
      expect(b.trips).toBeGreaterThan(0)
      expect(c.trips).toBeGreaterThan(0)
    }, 600_000)
  }

  it("the sync's own encoder and the store's own import agree with the trips", async () => {
    expect(collected.length).toBeGreaterThan(0)
    for (const text of collected.slice(0, 6)) {
      const game = JSON.parse(text) as Game
      const enc = await encodeSlot({ slot: slotOf(game)!, kind: 'game', game, active: true } as never)
      expect(enc.text).toBe(JSON.stringify(compactGame(game)))
      loadStore(u, ALL)
      useStore.setState({ game: { ...normaliseGame(JSON.parse(text))!, phase: game.phase } })
      const ok = await st().importCloudGame(slotOf(game)!, JSON.parse(enc.text) as Game, 'replace')
      expect(ok).toBe(true)
      expect(canonicalJson(st().game)).toBe(canonicalJson(normaliseGame(JSON.parse(text))))
    }
  }, 120_000)
})
