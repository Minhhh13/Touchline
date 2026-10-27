import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { seasonTable, USER_TEAM } from '@engine/season'
import { playerLookup } from '../logic/players'
import { compactGame } from '../logic/compact'
import { AVG_MIN_APPS, playerStatRows, sortPlayerStats, sortTeamStats, teamRank, teamStatRows, teamStatValue } from '../logic/statsTables'
import { clone, seasonGame } from './seasonGame'

const u = loadTestUniverse(['england'])

describe("the Stats tab's tables", () => {
  const g = seasonGame(u, 'stats-tables', 12)
  const rows = playerStatRows(g.squad, g.season!, playerLookup(g, u))

  it("lists the user's whole squad and every AI man with an appearance", () => {
    expect(rows.filter((r) => r.mine).length).toBe(Object.keys(g.squad).length)
    expect(rows.filter((r) => !r.mine).every((r) => r.apps > 0)).toBe(true)
    for (const r of rows) {
      expect(r.ga).toBe(r.goals + r.assists)
      if (r.position !== 'GK') expect(r.cleanSheets).toBeNull()
      if (r.minutes < 90) expect(r.per90).toBeNull()
    }
    const goals = rows.reduce((s, r) => s + r.goals, 0)
    expect(goals).toBeGreaterThan(0)
  })

  it('sorts numbers high first, text A to Z, missing figures last, and reverses', () => {
    const byGoals = sortPlayerStats(rows, 'goals')
    for (let i = 1; i < byGoals.length; i++) expect(byGoals[i - 1].goals).toBeGreaterThanOrEqual(byGoals[i].goals)
    const up = sortPlayerStats(rows, 'goals', true)
    for (let i = 1; i < up.length; i++) expect(up[i - 1].goals).toBeLessThanOrEqual(up[i].goals)
    const byName = sortPlayerStats(rows, 'name')
    for (let i = 1; i < byName.length; i++) expect(byName[i - 1].name.localeCompare(byName[i].name)).toBeLessThanOrEqual(0)
    const cs = sortPlayerStats(rows, 'cleanSheets')
    const firstNull = cs.findIndex((r) => r.cleanSheets === null)
    expect(firstNull).toBeGreaterThan(0)
    expect(cs.slice(firstNull).every((r) => r.cleanSheets === null)).toBe(true)
    expect(sortPlayerStats(rows, 'cleanSheets', true).slice(firstNull).every((r) => r.cleanSheets === null)).toBe(true)
    const byAvg = sortPlayerStats(rows, 'avg')
    const firstThin = byAvg.findIndex((r) => r.apps < AVG_MIN_APPS)
    if (firstThin >= 0) expect(byAvg.slice(firstThin).every((r) => r.apps < AVG_MIN_APPS)).toBe(true)
    // Sorting never changes the rows themselves
    expect(sortPlayerStats(rows, 'avg').length).toBe(rows.length)
  })

  it("agrees with the league table, and reads only scores, so a compacted save gives the same", () => {
    const teams = teamStatRows(g.season!)
    const table = seasonTable(g.season!)
    expect(teams.map((t) => t.teamId)).toEqual(table.map((t) => t.teamId))
    for (const t of teams) {
      const row = table.find((r) => r.teamId === t.teamId)!
      expect([t.played, t.won, t.drawn, t.lost, t.goalsFor, t.goalsAgainst, t.points]).toEqual([row.played, row.won, row.drawn, row.lost, row.goalsFor, row.goalsAgainst, row.points])
      expect(t.home.won + t.away.won).toBe(t.won)
      expect(t.home.goalsFor + t.away.goalsFor).toBe(t.goalsFor)
    }
    const compacted = compactGame(clone(g))
    expect(teamStatRows(compacted.season!)).toEqual(teams)
    const best = sortTeamStats(teams, 'goalsAgainst')
    for (let i = 1; i < best.length; i++) expect(best[i - 1].goalsAgainst).toBeLessThanOrEqual(best[i].goalsAgainst)
    expect(teamRank(teams, best[0].teamId, 'goalsAgainst')).toBe(1)
    const rank = teamRank(teams, USER_TEAM, 'points')
    expect(rank).toBe(1 + teams.filter((t) => t.points > teams.find((x) => x.teamId === USER_TEAM)!.points).length)
    expect(teamStatValue(teams[0], 'homePoints') + teamStatValue(teams[0], 'awayPoints')).toBe(teams[0].points)
  })
})
