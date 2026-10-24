import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { buildAiClubs, aiTeamInput, computeTable, generateFixtures, USER_TEAM, seasonTier } from '../season'
import { simulateMatch, type MatchTeamInput } from '../match'
import { autoDraft, newDraft, SEASON_RULES } from '../draft'
import { getFormation } from '../formations'
import { defaultTactics } from '../tactics'
import { autoPickLineup } from '../ratings'

describe('season', () => {
  const u = loadTestUniverse()

  it('generates a balanced double round robin', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `t${i}`)
    const fixtures = generateFixtures(ids, new Rng('fx'))
    expect(fixtures.length).toBe(380)
    for (const id of ids) {
      expect(fixtures.filter((f) => f.homeTeamId === id).length).toBe(19)
      expect(fixtures.filter((f) => f.awayTeamId === id).length).toBe(19)
    }
    for (let mw = 1; mw <= 38; mw++) {
      const week = fixtures.filter((f) => f.matchweek === mw)
      expect(week.length).toBe(10)
      const teams = new Set(week.flatMap((f) => [f.homeTeamId, f.awayTeamId]))
      expect(teams.size).toBe(20)
    }
    const pairs = new Set(fixtures.map((f) => `${f.homeTeamId}>${f.awayTeamId}`))
    expect(pairs.size).toBe(380)
  })

  it('simulates a full season for an auto-drafted squad in the 2025-26 league', () => {
    const rng = new Rng('season-1')
    const leagueSeason = 2025
    const host = 'burnley'
    const ai = buildAiClubs(u, 'england', leagueSeason, host)
    const ids = [USER_TEAM, ...Object.keys(ai)]
    expect(ids.length).toBe(20)
    const fixtures = generateFixtures(ids, rng)

    const d = newDraft(getFormation('4-3-3'), SEASON_RULES)
    autoDraft(u, d, rng)
    const squadIds = [...Object.values(d.lineup), ...d.bench]
    const pool = squadIds.map((id) => u.index[id])
    const tactics = defaultTactics('4-3-3')
    const { lineup, bench } = autoPickLineup(getFormation('4-3-3'), pool, tactics)
    const user: MatchTeamInput = { teamId: USER_TEAM, teamName: 'Test XI', shortName: 'TST', tactics, lineup, bench, getPlayer: (id) => u.index[id], getState: () => undefined }

    for (const f of fixtures) {
      const home = f.homeTeamId === USER_TEAM ? user : aiTeamInput(u, ai[f.homeTeamId])
      const away = f.awayTeamId === USER_TEAM ? user : aiTeamInput(u, ai[f.awayTeamId])
      f.result = simulateMatch({ rng, home, away, detail: 'summary' })
    }
    const table = computeTable(fixtures, ids)
    const userRow = table.find((r) => r.teamId === USER_TEAM)!
    const avgOverall = pool.reduce((s, p) => s + p.overall, 0) / pool.length
    console.log(`auto-draft squad avg ${avgOverall.toFixed(1)} finished ${table.indexOf(userRow) + 1} with ${userRow.points} pts (${userRow.won}-${userRow.drawn}-${userRow.lost}), tier ${seasonTier(table, USER_TEAM, false)}`)
    console.log(table.slice(0, 5).map((r) => `${r.teamId} ${r.points}`).join(' | '))
    expect(userRow.played).toBe(38)
    expect(table.reduce((s, r) => s + r.points, 0)).toBeGreaterThan(900)
    for (const r of table) expect(r.played).toBe(38)
  })
})
