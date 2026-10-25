import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { briefTarget, projectedCarryIn, RUN_IN_TEMPLATES, runInCatalogue, runInJob, scaleRow, suggestRunIns, takeoverWeek } from '../scenario'
import { computeTable, positionOf, USER_TEAM } from '../season'

const u = loadTestUniverse()

describe('the run-in projection', () => {
  it('takes over after matchweek 28 of 38 and 25 of 34', () => {
    expect(takeoverWeek(38)).toBe(28)
    expect(takeoverWeek(34)).toBe(25)
  })

  it('scales a row to exactly N matches, the missing ones to the largest remainders', () => {
    // 10-9-19 of 38 scaled to 28: 7.37, 6.63, 14.00 floor to 7-6-14 (27), and the draw has the largest remainder
    expect(scaleRow({ won: 10, drawn: 9, lost: 19, goalsFor: 46, goalsAgainst: 65 }, 38, 28)).toEqual({ won: 7, drawn: 7, lost: 14, goalsFor: 34, goalsAgainst: 48 })
    // Equal remainders go to won before drawn before lost: 1-1-1 of 3 to 2 is 0.67 each
    expect(scaleRow({ won: 1, drawn: 1, lost: 1, goalsFor: 3, goalsAgainst: 3 }, 3, 2)).toMatchObject({ won: 1, drawn: 1, lost: 0 })
    // Every real row of every complete English table adds up to N at both takeover lengths
    for (const rows of Object.values(u.tables.england)) {
      const played = rows[0].won + rows[0].drawn + rows[0].lost
      if (!rows.every((r) => r.won + r.drawn + r.lost === played)) continue
      for (const n of [28, 25, 10]) for (const r of rows) {
        const s = scaleRow(r, played, n)
        expect(s.won + s.drawn + s.lost).toBe(n)
        expect(Math.abs(s.won - (r.won * n) / played)).toBeLessThan(1)
      }
    }
  })

  it('puts West Ham 2025-26 18th on 28 at MW28, a point behind Spurs in 17th (they finished 18th on 39, Spurs 17th on 41)', () => {
    const job = runInJob(u, 'survival', 'england', 2025, 'west-ham-united')!
    expect(job).toMatchObject({ takeover: 28, matchweeks: 38, target: 17, real: { position: 18, points: 39 }, projected: { position: 18, points: 28 }, gap: -1 })
    const carry = projectedCarryIn(u, 'england', 2025, 'west-ham-united')!
    expect(carry[USER_TEAM]).toEqual({ won: 7, drawn: 7, lost: 14, goalsFor: 34, goalsAgainst: 48 })
    expect(carry['west-ham-united']).toBeUndefined()
    const spurs = carry['tottenham-hotspur']
    expect(3 * spurs.won + spurs.drawn).toBe(29)
    const table = computeTable([], Object.keys(carry), carry)
    expect(table).toHaveLength(20)
    expect(positionOf(table, 'tottenham-hotspur')).toBe(17)
    expect(table.every((r) => r.played === 28)).toBe(true)
  })

  it('asks for 1st, 4th or the last safe place', () => {
    expect(RUN_IN_TEMPLATES.map((t) => briefTarget(t, 20))).toEqual([1, 4, 17])
    expect(briefTarget('survival', 18)).toBe(15)
  })
})

describe('the run-in catalogue', () => {
  const all = loadTestUniverse(['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal'])
  const count = (template: (typeof RUN_IN_TEMPLATES)[number]) => {
    const by: Record<string, number> = {}
    for (const j of runInCatalogue(all, template)) by[j.leagueId] = (by[j.leagueId] ?? 0) + 1
    return by
  }

  it('offers jobs in the four leagues with real tables and none in the three without', () => {
    for (const t of RUN_IN_TEMPLATES) {
      const by = count(t)
      for (const l of ['england', 'spain', 'italy', 'germany']) expect(by[l] ?? 0, `${t} ${l}`).toBeGreaterThan(0)
      for (const l of ['france', 'netherlands', 'portugal']) expect(by[l] ?? 0, `${t} ${l}`).toBe(0)
    }
  })

  it('pins the counts to the data stamp (title 28, Europe 72, survival 104 on the 2026-10-25 packs)', () => {
    // A data rebuild moves these: re-baseline them with the stamp
    expect(all.generatedAt).toBe('2026-10-25')
    expect(count('title')).toEqual({ england: 9, spain: 9, italy: 7, germany: 3 })
    expect(count('europe')).toEqual({ england: 23, spain: 9, italy: 16, germany: 24 })
    expect(count('survival')).toEqual({ england: 28, spain: 24, italy: 19, germany: 33 })
  }, 30000)

  it('fits every job to its template, newest season first, the takeover nine or ten from the end', () => {
    for (const t of RUN_IN_TEMPLATES) {
      const jobs = runInCatalogue(all, t)
      for (let i = 1; i < jobs.length; i++) expect(jobs[i].season).toBeLessThanOrEqual(jobs[i - 1].season)
      for (const j of jobs) {
        expect(j.matchweeks - j.takeover, `${j.clubId} ${j.season}`).toBe(j.matchweeks === 38 ? 10 : 9)
        if (t === 'title') expect([2, 3]).toContain(j.real.position)
        if (t === 'europe') expect(j.real.position).toBeGreaterThanOrEqual(5)
        if (t === 'survival') expect(j.real.position).toBeGreaterThan(j.clubs - 3)
        expect(runInJob(all, t, j.leagueId, j.season, j.clubId)).toEqual(j)
      }
    }
  }, 30000)

  it('suggests the same distinct jobs for a seed, and others for another', () => {
    const jobs = runInCatalogue(u, 'survival')
    const a = suggestRunIns(jobs, 'K7Q2-MX9A')
    expect(a).toHaveLength(3)
    expect(new Set(a.map((j) => `${j.clubId}@${j.season}`)).size).toBe(3)
    expect(suggestRunIns(jobs, 'K7Q2-MX9A')).toEqual(a)
    const others = ['a', 'b', 'c', 'd', 'e'].map((s) => suggestRunIns(jobs, s).map((j) => `${j.clubId}@${j.season}`).join())
    expect(new Set(others).size).toBeGreaterThan(1)
    expect(suggestRunIns(jobs.slice(0, 2), 'x')).toHaveLength(2)
  })
})
