import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, isComplete, QUICK_RULES } from '@engine/draft'
import { decodeChallenge, encodeChallenge } from '@engine/challenge'
import { getFormation } from '@engine/formations'
import { ratingAt } from '@engine/positions'
import { closeJanuary, kickOff, QUICK_EUROPE_PLACES, quickUserInput, quickXI, runQuickSeason, toKickoff } from '../logic/quick'
import { JANUARY_BUDGET_FLOOR, JANUARY_LISTINGS, januaryBudget, weakestSlots } from '../logic/january'
import { foldResults, januaryLine, europeLine, nextReveal, playbackDelay, playbackFrame, PLAYBACK_STEP_MS } from '../logic/gameByGame'
import { challengeFromGame, replayChallenge } from '../logic/challenge'
import { createGame, dailyGameSettings, DAILY_SEASON, summariseSetup } from '../logic/setup'
import { playerLookup } from '../logic/players'
import { normaliseGame } from '../logic/save'
import type { Game, GameSettings, QuickGameResult } from '../types'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { useStore } from '../store'

const u = loadTestUniverse(['england'])

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return { mode: 'quick', seed: 'jan-1', formationId: '4-3-3', teamName: 'Window XI', shortName: 'WIN', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: true, ...partial }
}

/** A quick game drafted by the assistant and standing at the tactics step. */
function drafted(partial: Partial<GameSettings> = {}, universe = u): Game {
  const g = createGame(settings(partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(universe, g.draft!, rng)
  g.rngState = rng.getState()
  expect(isComplete(g.draft!)).toBe(true)
  toKickoff(g, universe)
  return g
}

const clone = (g: Game): Game => JSON.parse(JSON.stringify(g)) as Game
const SEEDS = ['jan-1', 'jan-2', 'jan-3']

// Whole seasons, several per test: seconds alone, slower beside the other files
describe('the January window of a quick season', { timeout: 90_000 }, () => {
  it('passing on the window reproduces the season a run without a window plays, figure for figure', () => {
    for (const seed of SEEDS) {
      const instant = drafted({ seed, january: false })
      kickOff(instant, u)
      expect(instant.phase).toBe('summary')
      const paused = drafted({ seed })
      const before = paused.rngState
      kickOff(paused, u)
      expect(paused.phase).toBe('january')
      // The pause writes nothing to the season's stream
      expect(paused.rngState).toEqual(before)
      closeJanuary(paused, u, null)
      expect(paused.phase).toBe('summary')
      expect(paused.quickResult).toEqual(instant.quickResult)
      expect(paused.rngState).toEqual(instant.rngState)
      expect(paused.lineup).toEqual(instant.lineup)
      expect(paused.quickJanuary!.move).toBeNull()
      expect(paused.quickResult!.january).toBeUndefined()
    }
  })

  it('the old single run (runQuickSeason straight after the draft) is still the same season', () => {
    const plain = createGame(settings({ seed: 'jan-2', january: undefined }))
    const rng = Rng.fromState(plain.rngState)
    autoDraft(u, plain.draft!, rng)
    plain.rngState = rng.getState()
    runQuickSeason(plain, u)
    const passed = drafted({ seed: 'jan-2' })
    kickOff(passed, u)
    closeJanuary(passed, u, null)
    expect(passed.quickResult).toEqual(plain.quickResult)
    expect(passed.rngState).toEqual(plain.rngState)
  })

  it('opens after the halfway matchweek with the first half shown, a budget and three to five listings for the weakest slots', () => {
    for (const seed of SEEDS) {
      const g = drafted({ seed })
      kickOff(g, u)
      const j = g.quickJanuary!
      expect(j.afterMatchweek).toBe(19)
      expect(j.firstHalf.map((r) => r.matchweek)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1))
      expect(j.firstHalf.at(-1)!.position).toBe(j.position)
      const get = playerLookup(g, u)
      const xiValue = Object.values(g.lineup).reduce((s, id) => s + (get(id)?.value ?? 0), 0)
      expect(j.budget).toBe(januaryBudget(j.position, 20, xiValue))
      expect(j.budget).toBeGreaterThanOrEqual(JANUARY_BUDGET_FLOOR)
      expect(j.listings.length).toBeGreaterThanOrEqual(JANUARY_LISTINGS.min)
      expect(j.listings.length).toBeLessThanOrEqual(JANUARY_LISTINGS.max)
      const weak = weakestSlots(g, g.lineup, get).slice(0, 3).map((s) => s.slotId)
      const formation = getFormation(g.tactics.formationId)
      for (const [i, l] of j.listings.entries()) {
        expect(g.lineup[l.slotId]).toBe(l.outId)
        expect(l.kind).toBe(i === j.listings.length - 1 ? 'swap' : 'sign')
        if (l.kind === 'sign') expect(l.fee).toBeLessThanOrEqual(j.budget)
        else expect(l.fee).toBe(0)
        const slot = formation.slots.find((s) => s.id === l.slotId)!
        expect(get(l.playerSeasonId)!.positions).toContain(slot.position)
        expect(ratingAt(get(l.playerSeasonId)!, slot.position)).toBeGreaterThanOrEqual(ratingAt(get(l.outId)!, slot.position))
        expect(Object.values(g.lineup)).not.toContain(l.playerSeasonId)
      }
      // With candidates at every slot the listings shop for the three weakest
      expect(j.listings.every((l) => weak.includes(l.slotId))).toBe(true)
      // The same seed always offers the same window
      const again = drafted({ seed })
      kickOff(again, u)
      expect(again.quickJanuary).toEqual(j)
    }
  })

  it('never offers a man already in the squad, bench included', () => {
    for (const seed of ['jan-bench-1', 'jan-bench-2', 'jan-bench-3', 'jan-bench-4']) {
      const g = drafted({ seed, rules: { ...QUICK_RULES, leagues: ['england'], squadSize: 15 } })
      expect(g.bench.length).toBeGreaterThan(0)
      kickOff(g, u)
      const get = playerLookup(g, u)
      const squad = new Set([...Object.values(g.lineup), ...g.bench].map((id) => get(id)!.playerId))
      expect(g.quickJanuary!.listings.length).toBeGreaterThan(0)
      for (const l of g.quickJanuary!.listings) expect(squad.has(get(l.playerSeasonId)!.playerId)).toBe(false)
    }
  })

  it('a signing changes the second half only, and the summary records it', () => {
    for (const seed of SEEDS) {
      const base = drafted({ seed })
      kickOff(base, u)
      const signed = clone(base)
      const twin = clone(base)
      closeJanuary(base, u, null)
      const deal = signed.quickJanuary!.listings[0]
      closeJanuary(signed, u, 0)
      const a = base.quickResult!.results!
      const b = signed.quickResult!.results!
      expect(b.slice(0, 19)).toEqual(a.slice(0, 19))
      expect(b.slice(0, 19)).toEqual(signed.quickJanuary!.firstHalf)
      expect(b.slice(19)).not.toEqual(a.slice(19))
      expect(signed.lineup[deal.slotId]).toBe(deal.playerSeasonId)
      expect(Object.values(signed.lineup)).not.toContain(deal.outId)
      const get = playerLookup(signed, u)
      expect(signed.quickResult!.january).toEqual({ kind: 'sign', inId: deal.playerSeasonId, inName: get(deal.playerSeasonId)!.name, outId: deal.outId, outName: get(deal.outId)!.name, fee: deal.fee, slotId: deal.slotId })
      expect(signed.quickJanuary!.move).toEqual(deal)
      // The totals still add up over both halves
      const t = foldResults(b)
      expect([t.won, t.drawn, t.lost, t.points]).toEqual([signed.quickResult!.won, signed.quickResult!.drawn, signed.quickResult!.lost, signed.quickResult!.points])
      // The same deal from the same pause, the same season
      closeJanuary(twin, u, 0)
      expect(twin.quickResult).toEqual(signed.quickResult)
      expect(twin.rngState).toEqual(signed.rngState)
    }
  })

  it('a deal that was not on offer is refused', () => {
    const g = drafted({ seed: 'jan-1' })
    kickOff(g, u)
    const forged = clone(g)
    forged.quickJanuary!.listings[0] = { ...forged.quickJanuary!.listings[0], fee: 0.5 }
    expect(() => closeJanuary(forged, u, 0)).toThrow('not on offer')
    expect(() => closeJanuary(clone(g), u, 9)).toThrow('No such January listing')
  })

  it('the player who leaves gives up the armband and the penalties', () => {
    const g = drafted({ seed: 'jan-3' })
    kickOff(g, u)
    const out = g.quickJanuary!.listings[0].outId
    g.captainId = out
    g.tactics.setPieces = { penalties: out }
    closeJanuary(g, u, 0)
    expect(g.captainId).toBeUndefined()
    expect(g.tactics.setPieces?.penalties).toBeUndefined()
  })

  it('works out a budget that grows from the leaders to the bottom side, never under the floor', () => {
    expect(januaryBudget(1, 20, 300)).toBe(24)
    expect(januaryBudget(20, 20, 300)).toBe(60)
    expect(januaryBudget(10, 20, 300)).toBeGreaterThan(24)
    expect(januaryBudget(1, 20, 10)).toBe(JANUARY_BUDGET_FLOOR)
  })
})

describe('the tactics step', { timeout: 90_000 }, () => {
  it('passes the tactics, the captain and the penalty taker to the quick season’s user side', () => {
    const g = drafted({ seed: 'jan-1' })
    const get = playerLookup(g, u)
    const { lineup, bench } = quickXI(g, u)
    const cap = Object.values(lineup)[3]
    g.tactics = { ...g.tactics, mentality: 'attacking', pressing: 'high', tempo: 'fast', defensiveLine: 'high', width: 'wide', setPieces: { penalties: cap } }
    g.captainId = cap
    const input = quickUserInput(g, lineup, bench, g.tactics, g.captainId, get)
    expect(input.tactics).toBe(g.tactics)
    expect(input.captainId).toBe(cap)
    expect(input.tactics.setPieces?.penalties).toBe(cap)
    expect(input.lineup).toEqual(g.lineup)
  })

  it('changes the season it plays, and Skip puts the defaults back', () => {
    const plain = drafted({ seed: 'jan-2', january: false })
    kickOff(plain, u)
    const bold = drafted({ seed: 'jan-2', january: false })
    bold.tactics = { ...bold.tactics, mentality: 'attacking', pressing: 'high', tempo: 'fast' }
    kickOff(bold, u)
    expect(bold.quickResult!.results).not.toEqual(plain.quickResult!.results)
    const skipped = drafted({ seed: 'jan-2', january: false })
    skipped.tactics = { ...skipped.tactics, mentality: 'defensive' }
    skipped.captainId = Object.values(skipped.lineup)[0]
    kickOff(skipped, u, true)
    expect(skipped.captainId).toBeUndefined()
    expect(skipped.quickResult).toEqual(plain.quickResult)
  })

  it('plays the second half with the tactics set at the January pause', () => {
    const a = drafted({ seed: 'jan-1' })
    kickOff(a, u)
    const b = clone(a)
    closeJanuary(a, u, null)
    b.tactics = { ...b.tactics, mentality: 'defensive', pressing: 'low' }
    closeJanuary(b, u, null)
    expect(b.quickResult!.results!.slice(0, 19)).toEqual(a.quickResult!.results!.slice(0, 19))
    expect(b.quickResult!.results!.slice(19)).not.toEqual(a.quickResult!.results!.slice(19))
  })

  it('is deterministic per seed: the same draft, tactics and deal give the same season on any device', () => {
    const run = () => {
      const g = drafted({ seed: 'jan-det' })
      g.tactics = { ...g.tactics, mentality: 'attacking', width: 'narrow' }
      kickOff(g, u)
      closeJanuary(g, u, g.quickJanuary!.listings.length - 1)
      return g
    }
    const x = run()
    const y = run()
    expect(y.quickResult).toEqual(x.quickResult)
    expect(y.rngState).toEqual(x.rngState)
    expect(x.quickResult!.january!.kind).toBe('swap')
  })
})

describe('the store flow', { timeout: 90_000 }, () => {
  it('goes draft, tactics step, first half, window, second half, summary, with the playback marked from the pause', () => {
    const g = createGame(settings({ seed: 'jan-store' }))
    useStore.setState({ universe: u, game: g, loadedLeagues: ['england'], playback: null })
    const s = useStore.getState()
    s.autoDraftRest()
    s.finishDraft()
    expect(useStore.getState().game!.phase).toBe('kickoff')
    s.setTactics({ mentality: 'attacking' })
    s.kickOff()
    expect(useStore.getState().game!.phase).toBe('january')
    expect(useStore.getState().playback).toEqual({ from: 0 })
    // Nothing is recorded while the season is paused
    const played = useStore.getState().profile.seasonsSimulated
    s.setTactics({ mentality: 'balanced' })
    s.closeJanuary(null)
    const done = useStore.getState().game!
    expect(done.phase).toBe('summary')
    expect(useStore.getState().playback).toEqual({ from: 19 })
    expect(useStore.getState().profile.seasonsSimulated).toBe(played + 1)
    expect(done.quickJanuary!.firstHalfTactics.mentality).toBe('attacking')
    expect(done.tactics.mentality).toBe('balanced')
    s.endPlayback()
    expect(useStore.getState().playback).toBeNull()
    useStore.setState({ game: null, universe: null, loadedLeagues: [] })
  })

  it('sends a save paused for a January window it does not hold back to the tactics step, which replays the season', () => {
    const g = drafted({ seed: 'jan-2' })
    const at = clone(g)
    kickOff(g, u)
    const broken = clone(g) as unknown as Record<string, unknown>
    delete broken.quickJanuary
    const n = normaliseGame(broken as unknown as Game)!
    expect(n.phase).toBe('kickoff')
    kickOff(n, u)
    kickOff(at, u)
    expect(n.quickJanuary).toEqual(at.quickJanuary)
    // An intact pause is left where it is
    expect(normaliseGame(clone(g))!.phase).toBe('january')
  })

  it('opens a save written before the window with nothing to fill in', () => {
    const g = drafted({ seed: 'jan-1' })
    kickOff(g, u)
    closeJanuary(g, u, null)
    const old = clone(g) as unknown as Record<string, unknown>
    delete old.quickJanuary
    const settingsOld = { ...(old.settings as Record<string, unknown>) }
    delete settingsOld.january
    old.settings = settingsOld
    const n = normaliseGame(old as unknown as Game)!
    expect(n.quickJanuary).toBeUndefined()
    expect(n.settings.january).toBeUndefined()
    expect(n.quickResult).toEqual(g.quickResult)
  })
})

describe('challenge links carry the season’s choices', { timeout: 90_000 }, () => {
  it('a tactics change and a January deal travel in the link and replay to the same claim', () => {
    const g = drafted({ seed: 'jan-link' })
    g.tactics = { ...g.tactics, mentality: 'attacking', setPieces: { penalties: Object.values(g.lineup)[9] } }
    const cap = Object.values(g.lineup)[5]
    g.captainId = cap
    kickOff(g, u)
    g.tactics = { ...g.tactics, pressing: 'high' }
    closeJanuary(g, u, 0)
    const c = challengeFromGame(g, u, 'Minh')!
    expect(c.x?.t).toMatchObject({ mentality: 'attacking', captain: cap })
    expect(c.x?.t2).toMatchObject({ mentality: 'attacking', pressing: 'high' })
    expect(c.x?.j).toEqual([g.quickJanuary!.move!.playerSeasonId, g.quickJanuary!.move!.slotId])
    const decoded = decodeChallenge(encodeChallenge(c))
    expect(decoded.x).toEqual(c.x)
    expect(replayChallenge(u, decoded).verified).toBe('yes')
    // A deal that was not offered, or other tactics, do not replay to the claim
    expect(replayChallenge(u, { ...decoded, x: { ...decoded.x, j: ['s1@2025@burnley', decoded.x!.j![1]] } }).verified).toBe('no')
    expect(replayChallenge(u, { ...decoded, x: undefined }).verified).toBe('no')
  })

  it('a default season writes no season block, so older links and untouched seasons look the same', () => {
    const g = drafted({ seed: 'jan-1' })
    kickOff(g, u)
    closeJanuary(g, u, null)
    const c = challengeFromGame(g, u, 'Minh')!
    expect(c.x).toBeUndefined()
    expect(replayChallenge(u, c).verified).toBe('yes')
  })

  it('refuses a season block holding unknown keys or values', () => {
    const g = drafted({ seed: 'jan-1', january: false })
    kickOff(g, u)
    const c = challengeFromGame(g, u, 'Minh')!
    const bad = (x: unknown) => () => decodeChallenge(encodeChallenge({ ...c, x } as never))
    expect(bad({ t: { mentality: 'reckless' } })).toThrow('Not a Touchline challenge link')
    expect(bad({ t: { formation: '4-4-2' } })).toThrow('Not a Touchline challenge link')
    expect(bad({ j: ['only-one'] })).toThrow('Not a Touchline challenge link')
    expect(bad({ y: 1 })).toThrow('Not a Touchline challenge link')
    expect(decodeChallenge(encodeChallenge({ ...c, x: { t: { tempo: 'fast' } } })).x).toEqual({ t: { tempo: 'fast' } })
  })
})

describe('the Daily pins its season options', () => {
  it('keeps the January window on and the Continental Cup run off for everyone', () => {
    for (const seed of ['daily-2026-10-25', 'daily-2027-01-01']) {
      const s = dailyGameSettings(u, seed, 'Anyone')
      expect(s.january).toBe(true)
      expect(s.continental).toBe(false)
    }
    expect(DAILY_SEASON).toEqual({ january: true, continental: false })
  })

  it('names a quick draft without the window, or with the run, in the setup line', () => {
    expect(summariseSetup(u, settings({ seed: 'S', january: false }))).toContain('no January window')
    expect(summariseSetup(u, settings({ seed: 'S', continental: true }))).toContain('Continental Cup run')
    expect(summariseSetup(u, settings({ seed: 'S' }))).not.toMatch(/January|Continental/)
  })
})

describe('the playback helpers', () => {
  const results: QuickGameResult[] = [
    { matchweek: 1, opponentId: 'a', home: true, gf: 2, ga: 0, scorers: [], position: 1 },
    { matchweek: 2, opponentId: 'b', home: false, gf: 1, ga: 1, scorers: [], position: 3 },
    { matchweek: 3, opponentId: 'c', home: true, gf: 0, ga: 3, scorers: [], position: 7 },
    { matchweek: 4, opponentId: 'd', home: false, gf: 4, ga: 2, scorers: [], position: 4 },
  ]

  it('reveals the games in order with the running totals of every game so far', () => {
    let revealed = 0
    const seen: number[] = []
    while (!playbackFrame(results, revealed).done) {
      revealed = nextReveal(revealed, results.length)
      const f = playbackFrame(results, revealed)
      seen.push(f.latest!.matchweek)
      expect(f.totals).toEqual(foldResults(results, revealed))
    }
    expect(seen).toEqual([1, 2, 3, 4])
    const end = playbackFrame(results, 4)
    expect(end.totals).toMatchObject({ played: 4, won: 2, drawn: 1, lost: 1, goalsFor: 7, goalsAgainst: 6, points: 7, position: 4 })
    expect(playbackFrame(results, 0)).toMatchObject({ latest: null, done: false, totals: { played: 0, position: 0 } })
    expect(playbackFrame(results, 2).totals).toMatchObject({ played: 2, points: 4, position: 3 })
  })

  it('stops at the January pause and at the last game, at 700, 350 or 175 ms a game', () => {
    expect(nextReveal(1, 4, 2)).toBe(2)
    expect(nextReveal(2, 4, 2)).toBe(2)
    expect(nextReveal(4, 4)).toBe(4)
    expect(playbackFrame(results, 2, 2).done).toBe(true)
    expect(PLAYBACK_STEP_MS).toBe(700)
    expect([playbackDelay(1), playbackDelay(2), playbackDelay(4)]).toEqual([700, 350, 175])
  })

  it('words January business and the European run for the share text', () => {
    expect(januaryLine({ kind: 'sign', inName: 'D. Rice', outName: 'B. Fernandes', fee: 45 })).toBe('January: signed Rice (£45M), Fernandes out')
    expect(januaryLine({ kind: 'swap', inName: 'D. Rice', outName: 'B. Fernandes', fee: 0 })).toBe('January: swapped Fernandes for Rice')
    expect(januaryLine(undefined)).toBeNull()
    expect(europeLine({ reached: 'W' })).toBe('🌍 Continental Cup winners')
    expect(europeLine({ reached: 'SF' })).toBe('🌍 Continental Cup: semi-finals')
    expect(europeLine(undefined)).toBeNull()
  })
})

describe('the Continental Cup run', { timeout: 90_000 }, () => {
  const big = loadTestUniverse(['england', 'spain', 'italy', 'germany'])

  it('follows a top-four finish when the option is on, without touching the league season', () => {
    let found = 0
    for (const seed of ['euro-1', 'euro-2', 'euro-3', 'euro-4', 'euro-5', 'euro-6']) {
      const on = drafted({ seed, continental: true, january: false }, big)
      kickOff(on, big)
      const off = drafted({ seed, january: false }, big)
      kickOff(off, big)
      const { europe, ...league } = on.quickResult!
      expect(league).toEqual(off.quickResult)
      expect(on.rngState).toEqual(off.rngState)
      if (on.quickResult!.position > QUICK_EUROPE_PLACES) {
        expect(europe).toBeUndefined()
        continue
      }
      found++
      expect(europe).toBeDefined()
      const rounds = europe!.ties.map((t) => t.round)
      expect(['R16', 'QF', 'SF', 'F'].slice(0, rounds.length)).toEqual(rounds)
      // Through every tie but possibly the last; out in the last unless the final was won
      expect(europe!.ties.slice(0, -1).every((t) => t.won)).toBe(true)
      const last = europe!.ties.at(-1)!
      expect(europe!.reached).toBe(last.won && last.round === 'F' ? 'W' : last.round)
      if (!last.won) expect(rounds.length).toBe(rounds.indexOf(last.round) + 1)
      for (const t of europe!.ties) {
        expect(big.clubById[t.opponentId]?.leagueId).not.toBe('england')
        if (t.gf === t.ga) expect(t.pens).toBeDefined()
        else expect(t.won).toBe(t.gf > t.ga)
      }
      // The same seed, the same run
      const again = drafted({ seed, continental: true, january: false }, big)
      kickOff(again, big)
      expect(again.quickResult!.europe).toEqual(europe)
    }
    expect(found).toBeGreaterThan(0)
  })
})
