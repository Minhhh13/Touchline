import { describe, expect, it } from 'vitest'
import type { AlltimeRow, BoardRow, CasualRow, ChaseRow } from '../../online/boards'
import { BOARD_SIZE, fillAlltimeBoard, fillCasualBoard, fillChaseBoard, fillRankedBoard, isExhibitionRow } from '../online/exhibitionRows'

const REAL_ALLTIME: AlltimeRow = {
  position: 1,
  name: 'RopZ',
  country: 'AU',
  totalPoints: 77,
  played: 1,
  average: 77,
  bestStreak: 1,
  currentStreak: 0,
  lastDate: '2026-10-31',
  isMe: true,
}

const REAL_RANKED: BoardRow = {
  position: 1,
  name: 'RopZ',
  country: 'AU',
  team: 'Touchline FC',
  points: 77,
  won: 24,
  drawn: 5,
  lost: 9,
  goalsFor: 70,
  goalsAgainst: 42,
  goalDiff: 28,
  leaguePosition: 2,
  tier: 'TITLE_RACE',
  createdAt: '2026-10-31T12:00:00.000Z',
  isMe: true,
  revealed: false,
  payload: null,
}

describe('full World leaderboard display rows', () => {
  it('fills every kind of board to two hundred numbered places', () => {
    const boards = [
      fillRankedBoard([], 'daily', null),
      fillRankedBoard([], 'weekly', null),
      fillAlltimeBoard([], 'points', null),
      fillAlltimeBoard([], 'streak', null),
      fillChaseBoard([], null),
      fillCasualBoard([], 'arena', null),
      fillCasualBoard([], 'themed', null),
      fillCasualBoard([], 'runin', null),
    ]
    for (const rows of boards) {
      expect(rows).toHaveLength(BOARD_SIZE)
      expect(rows.map((row) => row.position)).toEqual(Array.from({ length: BOARD_SIZE }, (_, index) => index + 1))
      expect(new Set(rows.map((row) => row.name)).size).toBe(BOARD_SIZE)
      expect(rows.every(isExhibitionRow)).toBe(true)
      expect(rows.every((row) => !/\b(?:ai|bot|simulated)\b/i.test(row.name))).toBe(true)
    }
  })

  it('varies names and board order without repeating an obvious surname block', () => {
    const daily = fillRankedBoard([], 'daily', null)
    const weekly = fillRankedBoard([], 'weekly', null)
    const alltime = fillAlltimeBoard([], 'points', null)
    expect(new Set(daily.slice(0, 12).map((row) => row.name.split(' ').at(-1))).size).toBeGreaterThan(8)
    expect(daily.slice(0, 20).map((row) => row.name)).not.toEqual(weekly.slice(0, 20).map((row) => row.name))
    expect(daily.slice(0, 20).map((row) => row.name)).not.toEqual(alltime.slice(0, 20).map((row) => row.name))
  })

  it('never duplicates a verified manager name in a generated place', () => {
    const firstDisplayName = fillRankedBoard([], 'daily', null)[0].name
    const real = { ...REAL_RANKED, name: firstDisplayName.toUpperCase() }
    const rows = fillRankedBoard([real], 'daily', null)
    expect(rows).toHaveLength(BOARD_SIZE)
    expect(rows[0]).toBe(real)
    expect(new Set(rows.map((row) => row.name.toLocaleLowerCase())).size).toBe(BOARD_SIZE)
  })

  it('keeps verified rows and official positions first, then fills only the empty places', () => {
    const rankedInput = [REAL_RANKED]
    const ranked = fillRankedBoard(rankedInput, 'daily', null)
    expect(ranked).toHaveLength(BOARD_SIZE)
    expect(ranked[0]).toBe(REAL_RANKED)
    expect(ranked[1].position).toBe(2)
    expect(ranked[1].points).toBeLessThan(REAL_RANKED.points)
    expect(rankedInput).toEqual([REAL_RANKED])

    const alltimeInput = [REAL_ALLTIME]
    const alltime = fillAlltimeBoard(alltimeInput, 'points', null)
    expect(alltime[0]).toBe(REAL_ALLTIME)
    expect(alltime[1].position).toBe(2)
    expect(alltime[1].totalPoints).toBeLessThan(REAL_ALLTIME.totalPoints)
    expect(alltimeInput).toEqual([REAL_ALLTIME])
  })

  it('uses the selected country on all generated display rows', () => {
    expect(fillRankedBoard([], 'daily', 'AU').every((row) => row.country === 'AU')).toBe(true)
    expect(fillAlltimeBoard([], 'points', 'AU').every((row) => row.country === 'AU')).toBe(true)
    expect(fillChaseBoard([], 'AU').every((row) => row.country === 'AU')).toBe(true)
    expect(fillCasualBoard([], 'arena', 'AU').every((row) => row.country === 'AU')).toBe(true)
  })

  it('gives each board coherent result data and no replay link', () => {
    const chase = fillChaseBoard([], null) as ChaseRow[]
    expect(chase[0]).toMatchObject({ position: 1, games: 38, points: 114, won: 38, drawn: 0, lost: 0, perfect: true, payload: null })

    const arena = fillCasualBoard([], 'arena', null) as CasualRow[]
    const themed = fillCasualBoard([], 'themed', null) as CasualRow[]
    const runin = fillCasualBoard([], 'runin', null) as CasualRow[]
    expect(arena[0].leaguePosition).toBeNull()
    expect(themed[0].leaguePosition).toBe(1)
    expect(runin[0].leaguePosition).toBe(1)
    expect([...arena, ...themed, ...runin].every((row) => row.payload === null && row.revealed === false)).toBe(true)
  })

  it('adds nothing once a board already has two hundred verified rows', () => {
    const full = Array.from({ length: BOARD_SIZE }, (_, index) => ({ ...REAL_RANKED, position: index + 1, name: `Manager ${index + 1}` }))
    expect(fillRankedBoard(full, 'daily', null)).toEqual(full)
    expect(fillRankedBoard(full, 'daily', null).some(isExhibitionRow)).toBe(false)
  })
})
