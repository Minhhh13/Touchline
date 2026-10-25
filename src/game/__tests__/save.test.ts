import { describe, expect, it, vi } from 'vitest'
// The store persists through localStorage: an in-memory stand-in that can be made to refuse writes like a full browser storage
const disk = vi.hoisted(() => {
  const mem = new Map<string, string>()
  const state = { full: false, mem }
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (state.full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        mem.set(k, v)
      },
      removeItem: (k: string) => void mem.delete(k),
    },
    configurable: true,
  })
  return state
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { computeTable, USER_TEAM } from '@engine/season'
import type { FullMatchResult } from '@engine/match'
import { createGame, beginSeason } from '../logic/setup'
import { eventContext, playMatchweek, startSeasonProper } from '../logic/week'
import { advanceToNextSeason } from '../logic/dynasty'
import { normaliseGame } from '../logic/save'
import { compactGame, compactResult } from '../logic/compact'
import { weeklyBriefing } from '../logic/briefing'
import { buildDigest, digestSnapshot } from '../logic/digest'
import { playerLookup } from '../logic/players'
import { createSaveStorage, decodeSave, encodeSave, isPlainSave, parseSave } from '../saveStorage'
import { exportSaveJson, persistedState, readSaveFile, SAVE_FULL_TOAST, SAVE_KEY, saveStorage, storeImportedSave, useStore } from '../store'
import type { Game, GameSettings } from '../types'
import { logLine, WINDOW_LOG_CAP } from '@engine/market'

const u = loadTestUniverse()
const LONG = 180_000

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'season',
    seed: 'save-test',
    formationId: '4-3-3',
    teamName: 'Save XI',
    shortName: 'SAV',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'everton',
    leagueSeason: 2024,
    rules: { ...SEASON_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

function started(partial: Partial<GameSettings> = {}): Game {
  const g = createGame(settings(partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  return g
}

function playTo(g: Game, matchweek: number): Game {
  while (g.phase !== 'summary' && g.season!.matchweek < matchweek) playMatchweek(g, u, true)
  return g
}

/** A dynasty's summer with the assistant: the draft auto-completed, the new season started. */
function nextSeason(g: Game): Game {
  advanceToNextSeason(g, u)
  if (g.phase === 'draft') {
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
  }
  startSeasonProper(g)
  return g
}

/** What the save holds after a reload: the game compacted, written as JSON and read back through normaliseGame. */
const reloaded = (g: Game): Game => normaliseGame(JSON.parse(JSON.stringify(compactGame(g))) as Game)!

/**
 * Everything a screen reads from a season: the table (Dugout, Summary, the
 * opposition report), the fixtures list and the season records (scores of the
 * user's fixtures), both knockouts, the league statistics (squad and AI club
 * states), the awards and history, the last match and cup tie on the match
 * screen, the objectives, the briefing, the event context and the
 * "while you were away" digest of the last five matchweeks.
 */
function screenData(g: Game) {
  const s = g.season!
  const ids = [USER_TEAM, ...Object.keys(s.ai)]
  const get = playerLookup(g, u)
  const stats = [...Object.entries(g.squad).map(([id, st]) => ({ id, team: USER_TEAM, st })), ...Object.values(s.ai).flatMap((c) => Object.entries(c.state).map(([id, st]) => ({ id, team: c.id, st })))]
  const top = (k: 'goals' | 'assists' | 'motm' | 'cleanSheets') =>
    stats
      .filter((x) => x.st.seasonStats[k] > 0 && get(x.id))
      .sort((a, b) => b.st.seasonStats[k] - a.st.seasonStats[k] || b.st.seasonStats.apps - a.st.seasonStats.apps || a.id.localeCompare(b.id))
      .slice(0, 25)
      .map((x) => [x.id, x.team, x.st.seasonStats[k]])
  const ties = (list: typeof s.cup) => list.map((t) => [t.round, t.homeTeamId, t.awayTeamId, t.result?.homeGoals, t.result?.awayGoals, t.result?.penalties, t.winnerId])
  const ctx = s.matchweek < s.matchweeks ? eventContext(g, u, new Rng('screen')) : null
  return {
    table: computeTable(s.fixtures, ids),
    fixtures: s.fixtures.filter((f) => f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM).map((f) => [f.matchweek, f.homeTeamId, f.awayTeamId, f.result?.homeGoals, f.result?.awayGoals]),
    cup: ties(s.cup),
    continental: ties(s.continental?.ties ?? []),
    scorers: top('goals'),
    assists: top('assists'),
    motm: top('motm'),
    cleanSheets: top('cleanSheets'),
    awards: g.awards,
    history: g.history,
    tier: g.tier,
    lastMatch: g.lastMatch,
    lastMatchContext: g.lastMatchContext,
    lastCupMatch: g.lastCupMatch,
    lastCupContext: g.lastCupContext,
    objectives: s.objectives,
    news: s.news,
    briefing: weeklyBriefing(g, u),
    digest: buildDigest({ ...digestSnapshot(g)!, matchweek: Math.max(0, s.matchweek - 5) }, g),
    event: ctx && { lastResult: ctx.lastResult, beatRival: ctx.beatRival, recentForm: ctx.recentForm, position: ctx.position, wins: ctx.wins, losses: ctx.losses, unbeaten: ctx.unbeaten },
  }
}

/** The size of what the store writes for these games, compressed, and the plain JSON it replaces. */
function storedSize(game: Game, parked: Record<string, Game> = {}) {
  const base = { shortlist: [], h2h: null, profile: useStore.getState().profile, screen: 'game' as const }
  const before = JSON.stringify({ state: { game, parked, ...base }, version: 1 }).length
  const json = JSON.stringify({ state: persistedState({ game, parked, ...base }), version: 1 })
  return { before, compactJson: json.length, stored: encodeSave(json).length }
}

/** An old build's save: every fixture carries full match detail (positions, momentum, appearances, tactics). */
function withFullDetailEverywhere(g: Game): Game {
  const full = JSON.parse(JSON.stringify(g)) as Game
  const template = full.lastMatch!
  for (const f of full.season!.fixtures) {
    if (!f.result) continue
    const r = f.result as FullMatchResult
    r.momentum = [...template.momentum!]
    r.homeReport.appearances = template.homeReport.appearances
    r.homeReport.tactics = template.homeReport.tactics
    r.awayReport.appearances = template.awayReport.appearances
    r.awayReport.tactics = template.awayReport.tactics
    for (const e of r.events) e.position ??= { x: 80, y: 50 }
  }
  return full
}

describe('save compaction', () => {
  it('keeps the user\'s matches of the current and previous matchweek and the last cup tie whole, and only the score of the rest', () => {
    const g = playTo(started({ seed: 'compact-keep' }), 16)
    const c = compactGame(g)
    const mw = c.season!.matchweek
    expect(mw).toBe(16)
    const mine = (f: { homeTeamId: string; awayTeamId: string }) => f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM
    for (const f of c.season!.fixtures.filter((x) => x.result)) {
      const whole = mine(f) && f.matchweek >= mw - 1
      const original = g.season!.fixtures.find((x) => x.matchweek === f.matchweek && x.homeTeamId === f.homeTeamId)!.result!
      if (whole) expect(f.result).toBe(original)
      else {
        expect(f.result).toEqual({ homeTeamId: original.homeTeamId, awayTeamId: original.awayTeamId, homeGoals: original.homeGoals, awayGoals: original.awayGoals, events: [], homeStats: [], awayStats: [], xg: original.xg })
      }
    }
    // Two cup rounds are played by matchweek 16 (after 6 and 14): the user's later tie stays whole, AI ties keep score and penalties
    const played = c.season!.cup.filter((t) => t.result)
    expect(played.length).toBeGreaterThan(8)
    const myTies = played.filter(mine)
    const last = myTies.reduce((a, b) => (b.afterMatchweek >= a.afterMatchweek ? b : a))
    expect(last.result!.events.length).toBeGreaterThan(0)
    for (const t of played.filter((x) => !mine(x))) {
      expect(t.result!.events).toEqual([])
      expect(t.result!.homeStats).toEqual([])
      const original = g.season!.cup.find((x) => x.round === t.round && x.homeTeamId === t.homeTeamId)!.result!
      expect(t.result!.penalties).toEqual(original.penalties)
    }
    // Never mutates the game it was given, and a second pass changes nothing
    expect(g.season!.fixtures.filter((f) => f.result && f.matchweek < mw - 1).every((f) => f.result!.events.length > 0)).toBe(true)
    expect(compactGame(c).season).toBe(c.season)
    const old = c.season!.fixtures.find((f) => f.result && f.matchweek < mw - 1)!
    expect(compactResult(old.result!)).toBe(old.result)
  }, LONG)

  it('leaves every displayed value unchanged, mid-season and at full time', () => {
    const g = playTo(started({ seed: 'compact-screens' }), 20)
    expect(screenData(reloaded(g))).toEqual(screenData(g))
    playTo(g, 99)
    expect(g.phase).toBe('summary')
    expect(g.awards).toBeTruthy()
    expect(screenData(reloaded(g))).toEqual(screenData(g))
  }, LONG)

  it('changes no result: a season played on from a compacted save ends exactly as the one played on in memory', () => {
    const a = playTo(started({ seed: 'compact-replay', mode: 'dynasty' }), 13)
    const b = reloaded(a)
    playTo(a, 99)
    playTo(b, 99)
    expect(screenData(b)).toEqual(screenData(a))
    expect(b.rngState).toEqual(a.rngState)
    expect(b.squad).toEqual(a.squad)
    expect(b.finances).toEqual(a.finances)
    // And on into the next season, where the summer draws from the same generator
    nextSeason(a)
    nextSeason(b)
    playTo(a, 10)
    playTo(b, 10)
    expect(screenData(b)).toEqual(screenData(a))
    expect(b.rngState).toEqual(a.rngState)
  }, LONG)

  it('caps a window log at the newest lines', () => {
    const w = { log: [] as string[] }
    for (let i = 0; i < WINDOW_LOG_CAP + 25; i++) logLine(w, `line ${i}`)
    expect(w.log.length).toBe(WINDOW_LOG_CAP)
    expect(w.log[0]).toBe(`line ${WINDOW_LOG_CAP + 24}`)
  })

  it('meets the targets: a season at full time under 1 MB stored, a two-season dynasty with a parked season under 1.5 MB', () => {
    const season = playTo(started({ seed: 'size-season' }), 99)
    const one = storedSize(season)
    const dynasty = playTo(nextSeason(playTo(started({ seed: 'size-dynasty', mode: 'dynasty' }), 99)), 99)
    expect(dynasty.history.length).toBe(2)
    const parked = playTo(started({ seed: 'size-parked' }), 31)
    const two = storedSize(dynasty, { season: parked })
    console.log(`season at full time: ${one.before} chars plain before, ${one.compactJson} compacted, ${one.stored} stored`)
    console.log(`two-season dynasty + parked season at MW 31: ${two.before} chars plain before, ${two.compactJson} compacted, ${two.stored} stored`)
    expect(one.stored).toBeLessThan(1_000_000)
    expect(two.stored).toBeLessThan(1_500_000)
    // Far under, in fact: compaction and compression together take each out of the quota's way
    expect(one.stored).toBeLessThan(one.before / 20)
    expect(two.stored).toBeLessThan(two.before / 20)
  }, LONG)
})

describe('save storage', () => {
  it('writes compressed and reads back exactly what it was given', () => {
    const mem = new Map<string, string>()
    const backing = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } as unknown as Storage
    const store = createSaveStorage<{ game: Game | null }>({ storage: () => backing, delayMs: 0 })
    const game = playTo(started({ seed: 'storage-roundtrip' }), 5)
    const value = { state: { game }, version: 1 }
    store.setItem('k', value)
    const raw = mem.get('k')!
    expect(isPlainSave(raw)).toBe(false)
    expect(raw.length).toBeLessThan(JSON.stringify(value).length / 4)
    expect(store.getItem('k')).toEqual(JSON.parse(JSON.stringify(value)))
    // A compressed save never reads as plain JSON, and decodes to the exact text
    const json = JSON.stringify(value)
    expect(decodeSave(encodeSave(json))).toBe(json)
    expect(encodeSave('{"state":{}}').startsWith('{')).toBe(false)
    // Plain JSON (every earlier build) reads as it is
    mem.set('old', json)
    expect(store.getItem('old')).toEqual(JSON.parse(json))
    // Something that is neither reads as no save
    mem.set('bad', 'not a save at all')
    expect(store.getItem('bad')).toBeNull()
  }, LONG)

  it('coalesces a burst of writes into one, with the latest state, and flushes on demand', () => {
    const writes: string[] = []
    const backing = { getItem: () => null, setItem: (_k: string, v: string) => void writes.push(v), removeItem: () => undefined } as unknown as Storage
    const store = createSaveStorage<{ n: number }>({ storage: () => backing, delayMs: 10_000 })
    for (let n = 1; n <= 5; n++) store.setItem('k', { state: { n }, version: 1 })
    expect(writes.length).toBe(0)
    expect(store.pending()).toBe(true)
    // A read before the write lands sees the pending state
    expect(store.getItem('k')).toEqual({ state: { n: 5 }, version: 1 })
    store.flush()
    expect(writes.length).toBe(1)
    expect(parseSave(writes[0])).toEqual({ state: { n: 5 }, version: 1 })
    store.freeze()
    store.setItem('k', { state: { n: 6 }, version: 1 })
    store.flush()
    expect(writes.length).toBe(1)
  })

  it('loads an old plain save with full detail on every fixture, plays on, and writes it back compressed and compacted', async () => {
    const active = withFullDetailEverywhere(playTo(started({ seed: 'old-active', mode: 'dynasty' }), 24))
    const parked = withFullDetailEverywhere(playTo(started({ seed: 'old-parked' }), 31))
    const old = JSON.stringify({ state: { game: active, parked: { season: parked }, shortlist: [], h2h: null, profile: useStore.getState().profile, screen: 'game' }, version: 1 })
    expect(old.length).toBeGreaterThan(5_000_000)
    disk.mem.set(SAVE_KEY, old)
    await useStore.persist.rehydrate()
    const st = useStore.getState()
    expect(st.game).toEqual(normaliseGame(active))
    expect(st.parked.season).toEqual(normaliseGame(parked))
    expect(screenData(st.game!)).toEqual(screenData(active))
    // Plays on through the store, and the next write is compressed and far smaller
    useStore.setState({ universe: u, loadedLeagues: ['england'] })
    useStore.getState().simWeeks(2)
    expect(useStore.getState().game!.season!.matchweek).toBe(26)
    saveStorage.flush()
    const raw = disk.mem.get(SAVE_KEY)!
    expect(isPlainSave(raw)).toBe(false)
    expect(raw.length).toBeLessThan(old.length / 20)
    const before = screenData(useStore.getState().game!)
    await useStore.persist.rehydrate()
    expect(screenData(useStore.getState().game!)).toEqual(before)
    expect(screenData(useStore.getState().parked.season!)).toEqual(screenData(parked))
  }, LONG)

  it('a full storage shows the toast, keeps the stored save and the game in memory, and saves again once there is room', () => {
    useStore.setState({ universe: u, loadedLeagues: ['england'], game: playTo(started({ seed: 'quota' }), 3), toast: null })
    saveStorage.flush()
    const stored = disk.mem.get(SAVE_KEY)
    disk.full = true
    try {
      useStore.getState().simWeeks(1)
      saveStorage.flush()
      expect(useStore.getState().toast).toBe(SAVE_FULL_TOAST)
      expect(disk.mem.get(SAVE_KEY)).toBe(stored)
      // The game carries on: weeks still play, nothing in memory is lost
      useStore.getState().simWeeks(2)
      saveStorage.flush()
      expect(useStore.getState().game!.season!.matchweek).toBe(6)
      expect(disk.mem.get(SAVE_KEY)).toBe(stored)
      // The toast is not repeated on every refused write
      useStore.setState({ toast: null })
      saveStorage.flush()
      expect(useStore.getState().toast).toBeNull()
    } finally {
      disk.full = false
    }
    useStore.getState().simWeeks(1)
    saveStorage.flush()
    expect(parseSave<{ game: Game }>(disk.mem.get(SAVE_KEY)!).state.game.season!.matchweek).toBe(7)
  }, LONG)
})

// Last: storing an imported save freezes the store's writes until the page reloads
describe('export and import', () => {
  it('exports plain JSON that imports back to the same game, and accepts the compressed form and an old build\'s export', async () => {
    const game = playTo(started({ seed: 'export-import' }), 12)
    const parked = playTo(started({ seed: 'export-parked', mode: 'dynasty' }), 4)
    useStore.setState({ universe: u, game, parked: { dynasty: parked }, screen: 'game' })
    saveStorage.flush()
    const exported = exportSaveJson()
    expect(isPlainSave(exported)).toBe(true)
    const parsed = JSON.parse(exported) as { state: { game: Game }; version: number }
    expect(parsed.version).toBe(1)
    expect(screenData(parsed.state.game)).toEqual(screenData(game))

    // Garbage is refused before anything is touched
    expect(() => readSaveFile('{"nope":1}')).toThrow('not a Touchline save')
    expect(() => readSaveFile('definitely not a save')).toThrow('not a Touchline save')

    const roundTrip = async (text: string) => {
      storeImportedSave(readSaveFile(text))
      expect(isPlainSave(disk.mem.get(SAVE_KEY)!)).toBe(false)
      useStore.setState({ game: null, parked: {} })
      await useStore.persist.rehydrate()
      return useStore.getState()
    }
    // The plain export
    let st = await roundTrip(exported)
    expect(screenData(st.game!)).toEqual(screenData(game))
    expect(screenData(st.parked.dynasty!)).toEqual(screenData(parked))
    // The compressed form (a copy of the stored save)
    st = await roundTrip(encodeSave(exported))
    expect(screenData(st.game!)).toEqual(screenData(game))
    // An older build's export: plain, uncompacted, full detail everywhere, with a byte-order mark
    const oldExport = '﻿' + JSON.stringify({ state: { game: withFullDetailEverywhere(game), parked: {}, shortlist: ['x'], h2h: null, profile: useStore.getState().profile, screen: 'game' }, version: 1 })
    st = await roundTrip(oldExport)
    expect(screenData(st.game!)).toEqual(screenData(game))
    expect(st.shortlist).toEqual(['x'])
    expect(disk.mem.get(SAVE_KEY)!.length).toBeLessThan(oldExport.length / 20)
  }, LONG)

  it('an import that does not fit leaves the current save alone', () => {
    const before = disk.mem.get(SAVE_KEY)
    const text = readSaveFile(exportSaveJson())
    disk.full = true
    try {
      expect(() => storeImportedSave(text)).toThrow("does not fit in this browser's storage")
    } finally {
      disk.full = false
    }
    expect(disk.mem.get(SAVE_KEY)).toBe(before)
  })
})
