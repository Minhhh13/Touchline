import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { computeTable, seasonTable, USER_TEAM } from '@engine/season'
import { beginSeason, createGame } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'

const u = loadTestUniverse()

/** Every .ts and .tsx file under `dir`, tests left out. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__') out.push(...sources(path))
    } else if (/\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

describe('seasonTable', () => {
  it('equals computeTable over the fixtures when the season carries nothing in', () => {
    const g = createGame({ mode: 'season', seed: 'season-table-1', formationId: '4-3-3', teamName: 'Table XI', shortName: 'TXI', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    startSeasonProper(g)
    const ids = [USER_TEAM, ...Object.keys(g.season!.ai)]
    expect(seasonTable(g.season!)).toEqual(computeTable(g.season!.fixtures, ids))
    for (let i = 0; i < 12; i++) {
      playMatchweek(g, u, true)
      if (g.phase === 'match') g.phase = 'week'
      if (i % 4 === 3) expect(seasonTable(g.season!)).toEqual(computeTable(g.season!.fixtures, ids))
    }
    expect(seasonTable(g.season!).find((r) => r.teamId === USER_TEAM)!.played).toBe(12)
  }, 30000)

  it('starts each row from the row carried in, with points of three a win and one a draw', () => {
    const fixtures = [{ matchweek: 3, homeTeamId: 'a', awayTeamId: 'b', result: { homeGoals: 0, awayGoals: 2 } }] as Parameters<typeof computeTable>[0]
    const t = computeTable(fixtures, ['a', 'b', 'c'], { a: { won: 2, drawn: 0, lost: 0, goalsFor: 5, goalsAgainst: 1 }, c: { won: 1, drawn: 1, lost: 0, goalsFor: 2, goalsAgainst: 1 } })
    const row = (id: string) => t.find((r) => r.teamId === id)!
    expect(row('a')).toMatchObject({ played: 3, won: 2, lost: 1, points: 6, goalsFor: 5, goalsAgainst: 3, form: ['L'] })
    expect(row('b')).toMatchObject({ played: 1, won: 1, points: 3, form: ['W'] })
    expect(row('c')).toMatchObject({ played: 2, won: 1, drawn: 1, points: 4, form: [] })
    expect(t.map((r) => r.teamId)).toEqual(['a', 'c', 'b'])
  })

  it('is the only way a season table is read: no computeTable over a season\'s fixtures outside season.ts', () => {
    const offenders = sources(join(__dirname, '..', '..')).filter((f) => !f.endsWith(join('engine', 'season.ts')) && /computeTable\(\s*(game\.)?season!?\.fixtures/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
