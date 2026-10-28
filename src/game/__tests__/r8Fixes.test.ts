/**
 * QA round 3 (r8) fixes in game logic, each pinned on its own (the sweeps in `qaR8*.test.ts` found them).
 */
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
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { playerLookup } from '../logic/players'
import { arenaPool } from '@engine/knockout'
import { buildLadder } from '@engine/gauntlet'
import { gauntletGameSettings } from '../logic/arena'
import { lifelineChanges, LIFELINE_SAME_NOTE } from '../logic/lifeline'
import { useStore } from '../store'
import { arena as arenaText } from '../../ui/i18n/en/arena'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function dynasty(seed: string): GameSettings {
  return { mode: 'dynasty', seed, formationId: '4-3-3', teamName: 'R8 Fix', shortName: 'R8F', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2018, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', continental: false }
}

describe('R8-2: the January window never lists a man who retired from a Dynasty squad', () => {
  it('bars every retired player id, as the summer window and the market do', () => {
    for (const seed of ['r8-jan-1', 'r8-jan-2', 'r8-jan-3']) {
      const g = createGame(dynasty(seed))
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      beginSeason(g, u)
      startSeasonProper(g, u)
      // A Dynasty some summers in: half the league's players retired (by real player id, every season of them)
      const ids = [...new Set(u.clubSeasons.filter((cs) => cs.leagueId === 'england').flatMap((cs) => cs.squad.map((p) => p.playerId)))]
      g.retiredPlayers = ids.filter((_, i) => i % 2 === 0)
      const retired = new Set(g.retiredPlayers)
      while (g.window?.kind !== 'january' && g.phase !== 'summary') playMatchweek(g, u, true)
      expect(g.window?.kind).toBe('january')
      const get = playerLookup(g, u)
      const listed = g.window!.listings.map((l) => get(l.playerSeasonId)!)
      expect(listed.length).toBeGreaterThan(5)
      expect(listed.filter((p) => retired.has(p.playerId)).map((p) => p.name)).toEqual([])
    }
  }, 120_000)
})

describe('R8-3: the Gauntlet lifeline is never spent on the same side', () => {
  it('a one-season wheel runs out of alternates: some rungs would bring their own main back', () => {
    const pool = arenaPool(u, { leagues: ['england'], fromSeason: 2019, toSeason: 2019 })
    let same = 0
    for (let s = 0; s < 60; s++) {
      const ladder = buildLadder(u, new Rng(`r8-ladder-${s}`), pool)
      for (let step = 0; step < 15; step++) if (!lifelineChanges({ ladder, step })) same++
    }
    // The engine's draw is unchanged (an engine fix is R8-O1); the guard has cases to catch
    expect(same).toBeGreaterThan(0)
    expect(lifelineChanges({ ladder: undefined, step: 0 })).toBe(false)
  })

  it('the store refuses such a lifeline with a note and keeps it; a real change still goes through', () => {
    const st = () => useStore.getState()
    useStore.setState({ universe: u, loadedLeagues: ['england'], game: null, toast: null })
    const c = { teamName: 'R8 Arena', formationId: '4-3-3', wheelLeagues: ['england'], difficulty: 'calibrated' as const, seed: 'r8-lifeline', hardMode: false, twists: false, fromSeason: 2019, toSeason: 2019 }
    st().startGame(gauntletGameSettings(u, c, 'R8A'))
    st().autoDraftRest()
    st().finishDraft()
    const g = st().game!
    expect([g.phase, g.arena?.format, !!g.arena?.ladder, st().toast]).toEqual(["week", "gauntlet", true, null])
    // The same side as rung 1's alternate
    const copy = JSON.parse(JSON.stringify(g)) as Game
    copy.arena!.ladder!.alternates[0] = copy.arena!.ladder!.mains[0]
    useStore.setState({ game: copy, toast: null })
    st().changeTheDraw()
    expect(st().toast).toBe(LIFELINE_SAME_NOTE)
    expect(st().game!.arena!.lifelineUsed).toBeUndefined()
    expect(st().game!.arena!.next).toBe(copy.arena!.next)
    // The screen's words are the store's
    expect(arenaText.messages.lifelineSame).toBe(LIFELINE_SAME_NOTE)
    // A rung whose alternate differs still changes
    useStore.setState({ game: g, toast: null })
    st().changeTheDraw()
    expect(st().game!.arena!.lifelineUsed).toBe(1)
    expect(st().game!.arena!.next).not.toBe(g.arena!.next)
  })
})

describe('R8-7: Sim to the next big match names the semi-final\'s first leg, where it stops', () => {
  it('a two-legged semi-final is foreseen at its first leg', async () => {
    const all = loadTestUniverse(['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal'])
    const { foreseeStop, nextStop } = await import('../logic/seasonHighlights')
    const { USER_TEAM } = await import('@engine/season')
    const { continentalPlan } = await import('@engine/continental')
    const g = createGame({ ...dynasty('r8-foresee'), mode: 'season', continental: true })
    const rng = Rng.fromState(g.rngState)
    autoDraft(all, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, all)
    startSeasonProper(g, all)
    const s = g.season!
    const plan = continentalPlan(s.matchweeks)
    const sf = plan.rounds[1]
    // The user drawn in a semi-final, the season played to the week before its first leg
    const opp = Object.keys(s.continental!.clubs)[0]
    s.continental!.ties.push({ round: 'SF', afterMatchweek: sf.afterMatchweek, homeTeamId: USER_TEAM, awayTeamId: opp, firstLeg: { afterMatchweek: sf.firstLeg! } })
    s.matchweek = sf.firstLeg! - 1
    s.cupEliminated = true
    g.window = { kind: 'january' } as unknown as Game['window']
    expect(nextStop(g, all)).toMatchObject({ kind: 'semi-final', matchweek: sf.firstLeg })
    expect(foreseeStop(g, all)?.matchweek).toBe(sf.firstLeg)
    // Between the legs, the second
    s.continental!.ties.at(-1)!.firstLeg!.result = { homeTeamId: USER_TEAM, awayTeamId: opp, homeGoals: 1, awayGoals: 0, events: [], homeStats: [], awayStats: [], xg: { home: 1, away: 0 } } as never
    s.matchweek = sf.afterMatchweek - 1
    expect(foreseeStop(g, all)?.matchweek).toBe(sf.afterMatchweek)
  })
})
