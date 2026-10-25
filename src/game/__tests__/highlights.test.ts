import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { computeTable, positionOf, USER_TEAM } from '@engine/season'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { BOARD_ALARM, foreseeStop, nextStop, RUN_IN_WEEKS, simToLabel, simToNextStop, stopAfterWeek, stopLine, weekMark } from '../logic/highlights'
import type { Game, GameSettings } from '../types'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { useStore } from '../store'

const u = loadTestUniverse()

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'season',
    seed: 'highlights-1',
    formationId: '4-3-3',
    teamName: 'Highlights XI',
    shortName: 'HLX',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'everton',
    leagueSeason: 2025,
    rules: { ...SEASON_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

/** A drafted season in pre-season. */
function seasonGame(partial: Partial<GameSettings> = {}): Game {
  const g = createGame(settings(partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  return g
}

/** Sim 5's step, repeated until `matchweek` has been played. */
function simTo(g: Game, matchweek: number): void {
  if (g.phase === 'preseason') startSeasonProper(g)
  while (g.season!.matchweek < matchweek && g.phase !== 'summary') {
    playMatchweek(g, u, true)
    if (g.phase === 'match') g.phase = 'week'
  }
}

function nextOpponentId(g: Game): string {
  const mw = g.season!.matchweek + 1
  const f = g.season!.fixtures.find((x) => x.matchweek === mw && (x.homeTeamId === USER_TEAM || x.awayTeamId === USER_TEAM))!
  return f.homeTeamId === USER_TEAM ? f.awayTeamId : f.homeTeamId
}

/** Rewrite every played result's score; only the goals feed the table. */
function rescore(g: Game, score: (home: string, away: string) => [number, number]): void {
  for (const f of g.season!.fixtures) {
    if (!f.result) continue
    const [h, a] = score(f.homeTeamId, f.awayTeamId)
    f.result.homeGoals = h
    f.result.awayGoals = a
  }
}

/** A matchweek at or after `from` whose opponent is no rival of the host, played up to the week before it. */
function quietWeekFrom(g: Game, from: number): string {
  simTo(g, from - 1)
  const rivals = u.clubById[g.season!.hostClubId].rivals
  while (rivals.includes(nextOpponentId(g))) simTo(g, g.season!.matchweek + 1)
  return nextOpponentId(g)
}

/** A store holding this game, as the Dugout sees it. */
function storeWith(g: Game) {
  useStore.setState({ universe: u, game: g, screen: 'game', simStop: null })
  return useStore.getState()
}

describe('nextStop', () => {
  it('stops for Derby day the week before Everton play Liverpool', () => {
    expect(u.clubById.everton.rivals).toContain('liverpool')
    const g = seasonGame()
    const derby = g.season!.fixtures.filter((f) => (f.homeTeamId === USER_TEAM && f.awayTeamId === 'liverpool') || (f.awayTeamId === USER_TEAM && f.homeTeamId === 'liverpool')).map((f) => f.matchweek)
    expect(derby).toHaveLength(2)
    for (const mw of derby) {
      simTo(g, mw - 1)
      const stop = nextStop(g, u)
      // A cup semi-final or final the same midweek outranks the derby; neither falls on these weeks for this seed
      expect(stop).toMatchObject({ kind: 'derby', matchweek: mw, label: 'Derby day', opponentClubId: 'liverpool' })
      expect(stopLine(stop!, u)).toBe(`Stopped for Derby day ${stop!.home ? 'v' : 'at'} Liverpool, MW ${mw}`)
    }
  })

  it('names a title decider from a constructed table', () => {
    const g = seasonGame({ hostClubId: 'burnley', seed: 'highlights-title' })
    const opp = quietWeekFrom(g, 30)
    // The user and the next opponent win every game except the one between them, which the user won
    rescore(g, (h, a) => (h === USER_TEAM || (h === opp && a !== USER_TEAM) ? [2, 0] : a === USER_TEAM || (a === opp && h !== USER_TEAM) ? [0, 2] : [1, 1]))
    const table = computeTable(g.season!.fixtures, [USER_TEAM, ...Object.keys(g.season!.ai)])
    expect(positionOf(table, USER_TEAM)).toBe(1)
    expect(positionOf(table, opp)).toBe(2)
    expect(nextStop(g, u)).toMatchObject({ kind: 'title-decider', label: 'Title decider', opponentClubId: opp, matchweek: g.season!.matchweek + 1 })
  })

  it('stops before a pending cup semi-final and final, in either competition', () => {
    const g = seasonGame({ hostClubId: 'burnley', seed: 'highlights-cup' })
    quietWeekFrom(g, 12)
    const mw = g.season!.matchweek + 1
    expect(nextStop(g, u)).toBeNull()
    g.season!.cupEliminated = false
    g.season!.cupWon = false
    g.season!.cup.push({ round: 'SF', afterMatchweek: mw, homeTeamId: 'arsenal', awayTeamId: USER_TEAM })
    const sf = nextStop(g, u)
    expect(sf).toMatchObject({ kind: 'semi-final', label: 'Cup semi-final', comp: 'cup', opponentClubId: 'arsenal', home: false, matchweek: mw })
    expect(stopLine(sf!, u)).toBe(`Stopped for the Cup semi-final at Arsenal, midweek after MW ${mw}`)
    g.season!.cup[g.season!.cup.length - 1].round = 'F'
    expect(nextStop(g, u)).toMatchObject({ kind: 'final', label: 'Cup final' })
    // Out of the cup: the tie no longer stops anything
    g.season!.cupEliminated = true
    expect(nextStop(g, u)?.kind).not.toBe('final')
  })

  it('stops for an open title race in the run-in, and not before it', () => {
    const g = seasonGame({ hostClubId: 'burnley', seed: 'highlights-race' })
    const opp = quietWeekFrom(g, 38 - RUN_IN_WEEKS + 1)
    const rival = Object.keys(g.season!.ai).find((id) => id !== opp && !u.clubById.burnley.rivals.includes(id))!
    // The user and one rival win everything but their meeting (a draw); the next opponent scores nothing and loses to both
    rescore(g, (h, a) => {
      const pair = [h, a]
      if (pair.includes(USER_TEAM) && pair.includes(rival)) return [1, 1]
      if (h === USER_TEAM || h === rival) return [2, 0]
      if (a === USER_TEAM || a === rival) return [0, 2]
      return h === opp || a === opp ? [0, 0] : [1, 1]
    })
    const stop = nextStop(g, u)
    expect(stop).toMatchObject({ kind: 'title-run-in', label: 'Title run-in' })
    expect(Math.abs(stop!.gap!)).toBeLessThanOrEqual(3)
    // The same race five weeks earlier is not the run-in yet
    const early = seasonGame({ hostClubId: 'burnley', seed: 'highlights-race' })
    quietWeekFrom(early, 28)
    rescore(early, (h, a) => (h === USER_TEAM ? [2, 0] : a === USER_TEAM ? [0, 2] : [1, 1]))
    expect(early.season!.matchweek + 1).toBeLessThanOrEqual(38 - RUN_IN_WEEKS)
    expect(nextStop(early, u)?.kind).not.toBe('title-run-in')
  })

  it('stops for an open relegation fight, but not once the drop is certain', () => {
    const g = seasonGame({ hostClubId: 'burnley', seed: 'highlights-drop' })
    const opp = quietWeekFrom(g, 38 - RUN_IN_WEEKS + 1)
    const leader = Object.keys(g.season!.ai).find((id) => id !== opp)!
    // One club wins everything; the rest draw 1-1, the user 0-0, so the user sits last on goals scored, level on points with safety
    rescore(g, (h, a) => (h === leader ? [1, 0] : a === leader ? [0, 1] : h === USER_TEAM || a === USER_TEAM ? [0, 0] : [1, 1]))
    const stop = nextStop(g, u)
    expect(stop).toMatchObject({ kind: 'survival-run-in', inDrop: true })
    expect(stopLine(stop!, u)).toMatch(/^Stopped for the survival run-in, MW \d+: in the bottom three/)
    // Lose everything and safety is out of reach: nothing left to manage
    rescore(g, (h, a) => (h === USER_TEAM ? [0, 3] : a === USER_TEAM ? [3, 0] : [1, 1]))
    expect(nextStop(g, u)).toBeNull()
  })
})

describe('stops after a simmed week', () => {
  it('stops the week the January window opens, and only that week', () => {
    const g = seasonGame({ hostClubId: 'burnley', seed: 'highlights-window' })
    const half = Math.floor(g.season!.matchweeks / 2)
    simTo(g, half - 1)
    let m = weekMark(g)
    simTo(g, half)
    expect(stopAfterWeek(g, m)).toMatchObject({ kind: 'window', matchweek: half })
    expect(g.window).toMatchObject({ kind: 'january', day: 0 })
    expect(stopLine(stopAfterWeek(g, m)!, u)).toBe(`Stopped: the January window opened after MW ${half}`)
    m = weekMark(g)
    simTo(g, half + 1)
    expect(stopAfterWeek(g, m)).toBeNull()
  })

  it('stops for the board only when confidence crosses below 25 with job security on', () => {
    const g = seasonGame({ hostClubId: 'burnley', seed: 'highlights-board', jobSecurity: true })
    simTo(g, 12)
    const season = g.season!
    season.confidence = BOARD_ALARM - 3
    expect(stopAfterWeek(g, { confidence: BOARD_ALARM + 1, januaryOpen: false })).toMatchObject({ kind: 'board', confidence: BOARD_ALARM - 3, matchweek: 12 })
    expect(stopAfterWeek(g, { confidence: BOARD_ALARM, januaryOpen: false })?.kind).toBe('board')
    // Already below before the week, or still above after it: no stop
    expect(stopAfterWeek(g, { confidence: BOARD_ALARM - 1, januaryOpen: false })).toBeNull()
    season.confidence = BOARD_ALARM
    expect(stopAfterWeek(g, { confidence: BOARD_ALARM + 10, januaryOpen: false })).toBeNull()
    // Without job security the board cannot sack you, so it never stops the sim
    season.confidence = BOARD_ALARM - 3
    g.settings.jobSecurity = false
    expect(stopAfterWeek(g, { confidence: BOARD_ALARM + 1, januaryOpen: false })).toBeNull()
  })
})

describe('simToNextStop and the store action', () => {
  it('from pre-season stops before the first stop week, and the next Play plays it live', () => {
    const g = seasonGame()
    expect(simToLabel(g, u)).toMatch(/^Sim to (Derby day|the January window|Cup (semi-)?final|Continental (semi-)?final) \(MW \d+\)$/)
    const seen = foreseeStop(g, u)!
    const store = storeWith(g)
    store.simToNextBigMatch()
    const after = useStore.getState().game!
    const stop = useStore.getState().simStop!.stop
    expect(after.phase).toBe('week')
    expect(after.live).toBeNull()
    // The sim never runs past what it could see coming
    const reached = stop.kind === 'window' || stop.kind === 'board' ? stop.matchweek : stop.matchweek - 1
    expect(reached).toBeLessThanOrEqual(seen.matchweek)
    expect(useStore.getState().simStop).toMatchObject({ gameId: after.id, year: after.year, matchweek: after.season!.matchweek })
    if (stop.kind !== 'window' && stop.kind !== 'board') {
      // A match stop leaves that week unplayed for the manager
      expect(stop.matchweek).toBe(after.season!.matchweek + 1)
      expect(nextStop(after, u)).toEqual(stop)
      useStore.getState().playWeek()
      expect(useStore.getState().game!.live?.kind).toBe('league')
    }
  })

  it('plays exactly the weeks Sim 5 would play before the stop', () => {
    for (const [host, seed] of [['everton', 'hl-eq-1'], ['burnley', 'hl-eq-2'], ['fulham', 'hl-eq-3'], ['brentford', 'hl-eq-4']]) {
      const a = seasonGame({ hostClubId: host, seed })
      const b = structuredClone(a)
      storeWith(a).simToNextBigMatch()
      const ran = useStore.getState().game!
      const k = ran.season!.matchweek
      storeWith(b).simWeeks(k)
      const sim = useStore.getState().game!
      expect(sim.rngState).toEqual(ran.rngState)
      expect(JSON.stringify(sim)).toBe(JSON.stringify(ran))
    }
  }, 120000) // whole runs through the persisted store: 12 to 15 s alone on a loaded machine, so 30 s timed out under the full suite

  it('the store plays a season to the summary through its stops', () => {
    for (const [host, seed, jobSecurity] of [['everton', 'hl-store-1', false], ['crystal-palace', 'hl-store-2', true]] as const) {
      storeWith(seasonGame({ hostClubId: host, seed, jobSecurity }))
      for (let guard = 0; guard < 60 && useStore.getState().game!.phase !== 'summary'; guard++) {
        useStore.getState().simToNextBigMatch()
        const s = useStore.getState()
        // The run that ends the season leaves no stop behind and files the result
        if (s.game!.phase === 'summary') expect(s.simStop).toBeNull()
        // The manager takes the big match (here the assistant plays it, as Sim 5 would)
        else if (s.simStop!.stop.kind !== 'window' && s.simStop!.stop.kind !== 'board') s.simWeeks(1)
      }
      expect(useStore.getState().game!.phase).toBe('summary')
      expect(useStore.getState().profile.leaderboard.some((e) => e.seed === seed)).toBe(true)
    }
  }, 120000) // whole runs through the persisted store: 12 to 15 s alone on a loaded machine, so 30 s timed out under the full suite

  it('stops a few times a season, every season (balance guard)', () => {
    const counts: number[] = []
    const hosts = ['burnley', 'everton', 'brentford', 'fulham', 'nottingham-forest', 'crystal-palace']
    for (let i = 0; i < 12; i++) {
      const g = seasonGame({ hostClubId: hosts[i % hosts.length], seed: `hl-run-${i}`, jobSecurity: i % 2 === 1 })
      let stops = 0
      for (let stop = simToNextStop(g, u); stop; stop = simToNextStop(g, u)) {
        stops++
        if (stop.kind === 'window') expect(g.window).toMatchObject({ kind: 'january', day: 0 })
        if (stop.kind !== 'window' && stop.kind !== 'board') {
          expect(stop.matchweek).toBe(g.season!.matchweek + 1)
          playMatchweek(g, u, true)
          if (g.phase === 'match') g.phase = 'week'
        }
      }
      expect(g.phase).toBe('summary')
      counts.push(stops)
    }
    const mean = counts.reduce((x, y) => x + y, 0) / counts.length
    // Measured 5.0 stops a season over 108 auto-managed seasons (p10/p50/p90 1/5/9, the window included); all stops or none is a regression
    expect(mean).toBeGreaterThan(2.5)
    expect(mean).toBeLessThan(8)
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(1)
    expect(Math.max(...counts)).toBeLessThan(15)
  }, 120000) // twelve seasons: 17 s alone on a loaded machine

  it('reads nothing once the season is over', () => {
    const g = seasonGame({ hostClubId: 'burnley', seed: 'highlights-end' })
    simTo(g, 38)
    expect(g.phase).toBe('summary')
    expect(nextStop(g, u)).toBeNull()
    expect(foreseeStop(g, u)).toBeNull()
    expect(simToNextStop(g, u)).toBeNull()
  })
})
