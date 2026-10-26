import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { shotXg, isAttempt } from '@engine/matchStats'
import { USER_TEAM } from '@engine/season'
import { playMatchweek } from '../logic/week'
import { budgetAsk, makeRequest, nextRequestAt, REQUEST_GAP, requestOptions, shiftWages, SHIFT_BUDGET, SHIFT_LIMIT, SHIFT_WAGE, STAFF_REQUEST_WAGES, wageRoom } from '../logic/board'
import { analystPicks, dataHubRows, dataHubTotals } from '../logic/dataHub'
import { buildYouthIntake, INTAKE_SIZE } from '../logic/youth'
import { Rng } from '@engine/rng'
import { clone, seasonGame } from './seasonGame'

const u = loadTestUniverse(['england'])

describe('board requests', () => {
  it('grants a request at confidence 60 with the condition met, with no dice', () => {
    const g = seasonGame(u, 'board-grant')
    g.season!.confidence = 70
    const opt = requestOptions(g, u).find((o) => o.kind === 'budget')!
    expect(opt.conditionMet).toBe(true)
    const budget = g.finances.budget
    const ask = budgetAsk(g)
    // The same request on a copy gives the same answer: nothing is drawn
    const twin = clone(g)
    const out = makeRequest(g, u, 'budget')
    expect(makeRequest(twin, u, 'budget')).toEqual(out)
    expect(out.accepted).toBe(true)
    expect(g.finances.budget).toBeCloseTo(budget + ask, 5)
    expect(g.rngState).toEqual(twin.rngState)
  })

  it('refuses below 60 confidence or with the condition unmet, for 2 confidence', () => {
    const g = seasonGame(u, 'board-refuse')
    g.season!.confidence = 59
    const out = makeRequest(g, u, 'staff')
    expect(out.accepted).toBe(false)
    expect(g.season!.confidence).toBe(57)
    const h = seasonGame(u, 'board-refuse')
    h.season!.confidence = 80
    h.finances.budget = 3
    expect(makeRequest(h, u, 'staff').accepted).toBe(false)
    expect(h.season!.confidence).toBe(78)
    expect(h.finances.wageCap).toBe(seasonGame(u, 'board-refuse').finances.wageCap)
  })

  it('takes one request per 8 matchweeks', () => {
    const g = seasonGame(u, 'board-gap')
    g.season!.confidence = 90
    const cap = g.finances.wageCap
    expect(makeRequest(g, u, 'staff').accepted).toBe(true)
    expect(g.finances.wageCap).toBe(cap + STAFF_REQUEST_WAGES)
    expect(nextRequestAt(g)).toBe(REQUEST_GAP)
    expect(makeRequest(g, u, 'budget').ok).toBe(false)
    for (let i = 0; i < REQUEST_GAP - 1; i++) playMatchweek(g, u, true)
    expect(makeRequest(g, u, 'budget').ok).toBe(false)
    playMatchweek(g, u, true)
    g.season!.confidence = 90
    expect(nextRequestAt(g)).toBeNull()
    expect(makeRequest(g, u, 'budget').ok).toBe(true)
    expect(g.season!.requests!.length).toBe(2)
  }, 60_000)

  it('adds an academy prospect a summer for each youth facilities grant (Dynasty)', () => {
    const g = seasonGame(u, 'board-youth')
    expect(requestOptions(g, u).some((o) => o.kind === 'youth')).toBe(false)
    g.settings.mode = 'dynasty'
    g.season!.confidence = 90
    g.finances.budget = 50
    expect(makeRequest(g, u, 'youth').accepted).toBe(true)
    expect(g.youthFacilities).toBe(1)
    expect(buildYouthIntake(g, u, new Rng('youth-size')).length).toBe(INTAKE_SIZE + 1)
    delete g.youthFacilities
    expect(buildYouthIntake(g, u, new Rng('youth-size')).length).toBe(INTAKE_SIZE)
  })
})

describe('the wage-to-transfer slider', () => {
  it('turns £10k a week of wage room into £2M of budget and back, within the room, the budget and 25 steps', () => {
    const g = seasonGame(u, 'slider')
    const cap = g.finances.wageCap
    const budget = g.finances.budget
    expect(shiftWages(g, u, 1).ok).toBe(true)
    expect(g.finances.wageCap).toBe(cap - SHIFT_WAGE)
    expect(g.finances.budget).toBeCloseTo(budget + SHIFT_BUDGET, 5)
    expect(shiftWages(g, u, -1).ok).toBe(true)
    expect(g.finances.wageCap).toBe(cap)
    expect(g.finances.wageShift).toBeUndefined()
    // Never past the room left under the cap
    g.finances.wageCap = Math.round(cap - wageRoom(g, u) + 5)
    expect(shiftWages(g, u, 1).ok).toBe(false)
    // Never without the budget to move
    g.finances.budget = 1
    expect(shiftWages(g, u, -1).ok).toBe(false)
    g.finances.budget = 500
    for (let i = 0; i < SHIFT_LIMIT; i++) expect(shiftWages(g, u, -1).ok).toBe(true)
    expect(shiftWages(g, u, -1).ok).toBe(false)
    expect(g.finances.wageShift).toBe(-SHIFT_LIMIT)
  })
})

describe('the data hub', () => {
  it('adds up every attempt and assisted goal of the user\'s full-detail matches', () => {
    const g = seasonGame(u, 'data-hub')
    for (let i = 0; i < 10; i++) playMatchweek(g, u, true)
    let xg = 0
    let xa = 0
    let shots = 0
    const results = [...g.season!.fixtures.filter((f) => f.result && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM)), ...g.season!.cup.filter((t) => t.result && (t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM))]
    for (const f of results) {
      const side = f.homeTeamId === USER_TEAM ? 'home' : 'away'
      for (const e of f.result!.events) {
        if (e.side !== side || !isAttempt(e)) continue
        if (e.playerId && g.squad[e.playerId]) {
          xg += shotXg(e)
          shots++
        }
        if ((e.type === 'goal' || e.type === 'penalty') && e.secondaryId && g.squad[e.secondaryId]) xa += shotXg(e)
      }
    }
    const rows = dataHubRows(g, u)
    const t = dataHubTotals(rows)
    expect(shots).toBeGreaterThan(50)
    expect(t.shots).toBe(shots)
    expect(t.xg).toBeCloseTo(xg, 1)
    expect(t.xa).toBeCloseTo(xa, 1)
    for (const r of rows) {
      expect(r.gaPer90).toBeCloseTo(((r.goals + r.assists) * 90) / r.minutes, 1)
      expect(r.finishing).toBeCloseTo(r.goals - (g.dataHub?.[r.id]?.xg ?? 0), 1)
    }
    // The analyst wrote in at matchweeks 5 and 10 when someone had enough attempts to judge
    const notes = g.season!.news.filter((n) => n.title === 'Analyst: finishing report')
    const picks = analystPicks(rows)
    if (picks.over || picks.under) expect(notes.length).toBeGreaterThan(0)
    expect(notes.every((n) => n.matchweek % 5 === 0)).toBe(true)
  }, 60_000)
})
