import { describe, expect, it } from 'vitest'
import { QUICK_RULES } from '@engine/draft'
import type { Cabinet, Game, GameSettings, LeaderboardEntry, QuickCupRun, QuickResult } from '../types'
import { creditGame, emptyCabinet, normaliseCabinet, trophiesOf } from '../logic/cabinet'
import { creditCupRun, type QuickCupComp } from '../logic/quickCups'
import { createGame } from '../logic/setup'
import { creditTrophyShelf, earlierTrophies, normaliseLeagueShelves, withLeagueShelves } from '../logic/trophyShelves'

const recordGame = (cabinet: Cabinet, game: Game) => creditTrophyShelf(cabinet, creditGame(cabinet, game), game)
const recordCup = (cabinet: Cabinet, before: QuickResult, game: Game, comp: QuickCupComp) => creditTrophyShelf(cabinet, creditCupRun(cabinet, before, game, comp), game)

const settings: GameSettings = { mode: 'quick', seed: 'SHELVES', formationId: '4-3-3', teamName: 'Shelf XI', shortName: 'SHF', leagueId: 'spain', wheelLeagues: ['spain'], hostClubId: 'barcelona', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['spain'] }, jobSecurity: false, difficulty: 'calibrated' }
const row = (id: string, leagueId?: string): LeaderboardEntry => ({ id, date: '2026-11-05', mode: 'quick', teamName: 'Shelf XI', points: 90, won: 28, drawn: 6, lost: 4, position: 1, tier: 'CHAMPIONS', seed: 'S', leagueSeason: 2025, hostClubId: 'barcelona', xi: [], ...(leagueId ? { leagueId } : {}) })

describe('country/league trophy shelves', () => {
  it('backfills recorded wins once, deduplicates the two boards, and keeps unknown history in All honours', () => {
    const old = { ...emptyCabinet(), league: 5, cup: 3, continental: 2, doubles: 2, trebles: 1, honours: [{ id: 'spain-1', kind: 'treble' as const, cups: ['cup', 'continental'] as const, teamName: 'Shelf XI', mode: 'quick' as const, leagueId: 'spain', leagueSeason: 2025 }] }
    const cabinet = { ...old, honours: old.honours.map((h) => ({ ...h, cups: [...h.cups] })) }
    const board = [row('spain-1', 'spain'), row('italy-1', 'italy'), row('italy-1', 'italy'), row('unknown')]
    const grouped = withLeagueShelves(cabinet, board)
    expect(grouped.leagueShelves?.spain).toEqual({ league: 1, cup: 1, continental: 1, doubles: 1, trebles: 1 })
    expect(grouped.leagueShelves?.italy?.league).toBe(1)
    expect(earlierTrophies(grouped)).toEqual({ league: 3, cup: 2, continental: 1, doubles: 1, trebles: 0 })
    expect(trophiesOf(grouped)).toEqual(trophiesOf(cabinet))
    expect('leagueShelves' in cabinet).toBe(false)
    expect(withLeagueShelves(grouped, board)).toBe(grouped)
    expect(withLeagueShelves({ ...cabinet, league: 0 }, board).leagueShelves?.spain?.league).toBe(0)
  })

  it('credits the same managed-season honours to their country, with no draw or RNG-state change', () => {
    const game = createGame({ ...settings, mode: 'season' })
    game.history = [{ year: 1, leagueId: 'italy', leagueSeason: 2025, teamName: 'Shelf XI', hostClubId: 'inter', position: 1, points: 90, won: 28, drawn: 6, lost: 4, goalsFor: 80, goalsAgainst: 30, tier: 'CHAMPIONS', cupWon: true, continentalWon: true }]
    const state = structuredClone(game.rngState)
    const c = recordGame(emptyCabinet(), game)
    expect(c.leagueShelves?.italy).toEqual(trophiesOf(c))
    expect(c.leagueShelves?.italy).toEqual({ league: 1, cup: 1, continental: 1, doubles: 1, trebles: 1 })
    expect(game.rngState).toEqual(state)
  })

  it('files post-season cups on the same shelf, including a later Treble, and never credits a replay twice', () => {
    const game = createGame(settings)
    const result = { position: 1, points: 90, won: 28, drawn: 6, lost: 4, tier: 'CHAMPIONS' } as QuickResult
    game.quickResult = result
    const c = recordGame(emptyCabinet(), game)
    const won: QuickCupRun = { reached: 'W', ties: [] }
    game.quickResult = { ...result, cup: won }
    const cup = recordCup(c, result, game, 'cup')
    const before = game.quickResult
    game.quickResult = { ...before, continentalCup: won }
    const treble = recordCup(cup, before, game, 'continental')
    expect(treble.leagueShelves?.spain).toEqual({ league: 1, cup: 1, continental: 1, doubles: 1, trebles: 1 })
    expect(trophiesOf(treble)).toEqual(treble.leagueShelves?.spain)
    expect(trophiesOf(c)).toEqual({ league: 1, cup: 0, continental: 0, doubles: 0, trebles: 0 })
    expect(recordCup(treble, game.quickResult, game, 'continental').leagueShelves).toEqual(treble.leagueShelves)
  })

  it('keeps Super League separate and excludes projected Run-in and Arena wins from season trophies', () => {
    const game = createGame({ ...settings, rules: { ...settings.rules, superLeague: true } })
    game.quickResult = { position: 1, points: 90, won: 28, drawn: 6, lost: 4, tier: 'CHAMPIONS' } as QuickResult
    expect(recordGame(emptyCabinet(), game).leagueShelves?.super?.league).toBe(1)
    for (const mode of ['arena', 'runin'] as const) {
      const c = recordGame(emptyCabinet(), { ...game, settings: { ...game.settings, mode } })
      expect(c.league).toBe(0)
      expect(c.leagueShelves).toEqual({})
    }
  })

  it('accepts absent legacy shelves and sanitises damaged imported counts', () => {
    expect(normaliseLeagueShelves(undefined)).toBeUndefined()
    expect(normaliseLeagueShelves([])).toBeUndefined()
    expect(withLeagueShelves(normaliseCabinet({ leagueShelves: { spain: { league: 2, cup: -1, continental: NaN, doubles: 1.5 } as never } }), []).leagueShelves?.spain).toEqual({ league: 2, cup: 0, continental: 0, doubles: 0, trebles: 0 })
  })
})
