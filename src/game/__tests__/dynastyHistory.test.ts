import { describe, expect, it, vi } from 'vitest'
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
import { beginSeason, createGame } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { advanceToNextSeason } from '../logic/dynasty'
import { bestXI, BEST_XI_MIN_APPS, honoursOf, legendsOf, noteSeasonEnd, summerSnapshot, summerStories, targetMet } from '../logic/dynastyHistory'
import { useStore } from '../store'
import type { Game, GameSettings, SeasonRecord } from '../types'
import { loadStore } from './qaHarness'

const u = loadTestUniverse()
const LEAGUES = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
const st = () => useStore.getState()

function settings(seed: string, hostClubId = 'everton', leagueSeason = 2016): GameSettings {
  return { mode: 'dynasty', seed, formationId: '4-3-3', teamName: 'History XI', shortName: 'HXI', leagueId: 'england', wheelLeagues: ['england'], hostClubId, leagueSeason, rules: { ...SEASON_RULES, leagues: ['england'], squadSize: 18 }, jobSecurity: false, difficulty: 'calibrated' }
}

/** A Dynasty played by the assistant for `years` seasons through the logic, with or without the history's parts between the steps. */
function play(seed: string, years: number, history: boolean): Game {
  const g = createGame(settings(seed))
  for (let y = 0; y < years; y++) {
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    startSeasonProper(g, u)
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    if (history) noteSeasonEnd(g, u)
    if (y === years - 1) break
    const snap = history ? summerSnapshot(g, u) : null
    const report = advanceToNextSeason(g, u)
    if (snap) summerStories(snap, report.retired, g, u)
  }
  return g
}

/** The game without the history's own fields, for a byte comparison. */
function stripped(g: Game): string {
  const c = JSON.parse(JSON.stringify(g)) as Game
  // A game's id and creation time come from the clock
  c.id = ''
  c.createdAt = ''
  for (const h of c.history) delete h.notes
  for (const r of Object.values(c.careerStats ?? {})) for (const k of ['pos', 'peak', 'firstYear', 'firstAge', 'firstOverall', 'lastAge', 'lastOverall', 'ratingSum', 'captainSeasons'] as const) delete r[k]
  return JSON.stringify(c)
}

describe('the club history (round 9)', () => {
  it('draws nothing: a Dynasty played with the history is the same game, byte for byte, but for its own fields', () => {
    for (const seed of ['history-same-1', 'history-same-2']) {
      const plain = play(seed, 4, false)
      const told = play(seed, 4, true)
      expect(told.rngState, seed).toEqual(plain.rngState)
      const [a, b] = [stripped(told), stripped(plain)]
      expect(a === b, `${seed}: ${a.length} against ${b.length} characters`).toBe(true)
      expect(told.history.every((h) => h.notes), seed).toBe(true)
      // An older save (no notes, no career details) reads as an empty best XI and no board targets, never a crash
      expect(bestXI(plain, u).every((s) => s.legend === null), seed).toBe(true)
      expect(honoursOf(plain.history).targetsSet, seed).toBe(0)
      expect(legendsOf(plain, u).length, seed).toBe(Object.keys(plain.careerStats ?? {}).length)
    }
  }, 120_000)

  it('six seasons through the store: every season noted once, legends with careers, a best XI and the summer stories', () => {
    // Every league loaded: a side that qualifies for Europe moves on without waiting for a load
    const all = loadTestUniverse(LEAGUES)
    loadStore(all, LEAGUES)
    st().startGame(settings('history-store', 'burnley', 2015))
    st().setMatchPlay('sim')
    let farewells = 0
    let breakthroughs = 0
    let milestones = 0
    for (let y = 1; y <= 6; y++) {
      st().autoDraftRest()
      st().finishDraft()
      st().startSeason()
      st().simToEnd()
      const g = st().game!
      expect(g.phase, `year ${y}`).toBe('summary')
      expect(g.history.length).toBe(y)
      const notes = g.history[y - 1].notes
      expect(notes, `year ${y}`).toBeDefined()
      expect(notes!.target).toBe(g.season!.boardTarget)
      expect(notes!.objectivesTotal).toBe(g.season!.objectives?.length ?? 0)
      // A second record (a reload, a second tap) never notes the season twice
      const ratings = Object.values(g.careerStats!).map((r) => r.ratingSum)
      st().recordResult()
      expect(Object.values(st().game!.careerStats!).map((r) => r.ratingSum)).toEqual(ratings)
      expect(noteSeasonEnd(structuredClone(st().game!), u)).toBe(false)
      if (y === 6) break
      st().nextSeason()
      const stories = st().offseason!.stories!
      farewells += stories.farewells.length
      breakthroughs += stories.breakthroughs.length
      milestones += stories.milestones.length
      for (const f of stories.farewells) expect(st().offseason!.retired).toContain(f.name)
      for (const b of stories.breakthroughs) expect(b.to - b.from).toBeGreaterThanOrEqual(2)
      st().dismissOffseason()
    }
    const g = st().game!
    const legends = legendsOf(g, all)
    expect(legends.length).toBeGreaterThan(18)
    for (const l of legends) {
      expect(l.pos, l.name).toBeDefined()
      expect(l.firstYear, l.name).toBeGreaterThanOrEqual(1)
      expect(l.peak!, l.name).toBeGreaterThanOrEqual(l.lastOverall!)
      expect(l.ratingSum!, l.name).toBeGreaterThan(0)
    }
    expect(legends.filter((l) => l.firstAge !== undefined).length).toBe(legends.length)
    const xi = bestXI(g, all)
    expect(xi.length).toBe(11)
    expect(xi.filter((s) => s.legend).length).toBe(11)
    expect(new Set(xi.map((s) => s.legend?.playerId)).size).toBe(11)
    for (const s of xi) expect(s.legend!.apps).toBeGreaterThanOrEqual(BEST_XI_MIN_APPS)
    // The keeper's slot holds a keeper
    expect(xi.find((s) => s.position === 'GK')!.legend!.pos).toBe('GK')
    const h = honoursOf(g.history)
    expect(h.seasons).toBe(6)
    expect(h.targetsSet).toBe(6)
    expect(h.targetsMet).toBe(g.history.filter((x) => targetMet(x)).length)
    expect(milestones).toBeGreaterThan(0)
    expect(farewells + breakthroughs).toBeGreaterThan(0)
  }, 300_000)

  it('honours count titles, doubles, trebles and the longest title run from the lines alone', () => {
    const line = (position: number, cupWon = false, continentalWon = false): SeasonRecord => ({ year: 1, leagueId: 'england', leagueSeason: 2020, teamName: 'X', hostClubId: 'everton', position, points: 80, won: 25, drawn: 5, lost: 8, goalsFor: 70, goalsAgainst: 30, tier: position === 1 ? 'CHAMPIONS' : 'EUROPEAN', cupWon, continentalWon })
    const h = honoursOf([line(1), line(1, true), line(3, true), line(1, true, true), line(1), line(1)])
    expect(h).toMatchObject({ seasons: 6, titles: 5, cups: 3, continental: 1, doubles: 2, trebles: 1, titleRun: 3, bestFinish: 1, targetsSet: 0 })
  })
})
