import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { USER_TEAM } from '@engine/season'
import { OFFICE_URGENT_WEEKS, weeklyBriefing } from '../logic/briefing'
import { officeItems } from '../logic/office'
import { AHEAD_CAP, digestAhead } from '../logic/digestAhead'
import type { Game, GameSettings } from '../types'

function settings(seed: string, partial: Partial<GameSettings> = {}): GameSettings {
  return { mode: 'season', seed, formationId: '4-3-3', teamName: 'Test XI', shortName: 'TST', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2023, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', ...partial }
}

function inSeason(u: ReturnType<typeof loadTestUniverse>, seed: string, weeks = 3): Game {
  const g = createGame(settings(seed))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g, u)
  for (let i = 0; i < weeks; i++) playMatchweek(g, u, true)
  return g
}

/** Two of the squad's men, by id and name. */
function two(g: Game, u: ReturnType<typeof loadTestUniverse>) {
  return Object.keys(g.squad).slice(0, 2).map((id) => ({ id, playerId: id.split('@')[0], name: u.index[id]?.name ?? id }))
}

describe("the briefing's Office line (r10)", () => {
  const u = loadTestUniverse()

  it('is absent while nothing waits in the Office, as the tab has no badge', () => {
    for (const seed of ['r10-office-a', 'r10-office-b', 'r10-office-c']) {
      const g = inSeason(u, seed)
      if (officeItems(g, u).length) continue
      expect(weeklyBriefing(g, u).some((i) => i.id === 'office')).toBe(false)
    }
  })

  it('names one request to leave, with the matchweeks left, and opens the Office', () => {
    const g = inSeason(u, 'r10-office-request')
    const [a] = two(g, u)
    g.office = { requests: { [a.playerId]: { playerId: a.playerId, name: a.name, reason: 'minutes', year: g.year, at: g.season!.matchweek, stage: 'open', waits: 0 } } }
    const line = weeklyBriefing(g, u).find((i) => i.id === 'office')!
    expect(line.text).toBe(`${a.name} has asked to leave: answer him in the Office (3 matchweeks left)`)
    expect(line.level).toBe('info')
    expect(line.action).toEqual({ label: 'Office', tab: 'office' })
    // His patience nearly spent: a warning, and it stays in a briefing that has warnings
    g.office.requests![a.playerId].waits = 3 - OFFICE_URGENT_WEEKS
    const urgent = weeklyBriefing(g, u).find((i) => i.id === 'office')!
    expect(urgent.level).toBe('warn')
    expect(urgent.text).toContain('(1 matchweek left)')
  })

  it('counts several items in one line, and a promise falling due is a warning', () => {
    const g = inSeason(u, 'r10-office-many')
    const [a, b] = two(g, u)
    const week = g.season!.matchweek
    g.office = {
      requests: { [a.playerId]: { playerId: a.playerId, name: a.name, reason: 'morale', year: g.year, at: week, stage: 'open', waits: 0 } },
      promises: [{ kind: 'minutes', playerId: b.playerId, name: b.name, year: g.year, madeAt: week - 1, due: week, state: 'open' } as NonNullable<NonNullable<Game['office']>['promises']>[number]],
    }
    const items = weeklyBriefing(g, u)
    const line = items.find((i) => i.id === 'office')!
    expect(line.text).toBe(`2 things wait in the Office: ${a.name} and ${b.name}`)
    expect(line.level).toBe('warn')
    // Right after the decision and the board, before the lineup
    const order = items.map((i) => i.id)
    expect(order.slice(0, order.indexOf('office')).every((id) => id === 'event' || id === 'board')).toBe(true)
  })
})

describe("the digest's next match (r10)", () => {
  const u = loadTestUniverse()

  it('names the next league opponent and every man who misses it, longest out first', () => {
    for (const seed of ['r10-ahead-1', 'r10-ahead-2', 'r10-ahead-3', 'r10-ahead-4']) {
      const g = inSeason(u, seed, 6)
      const a = digestAhead(g, u)!
      expect(a.matchweek).toBe(g.season!.matchweek + 1)
      const f = g.season!.fixtures.find((x) => x.matchweek === a.matchweek && (x.homeTeamId === USER_TEAM || x.awayTeamId === USER_TEAM))
      expect(a.opponentId).toBe(f ? (f.homeTeamId === USER_TEAM ? f.awayTeamId : f.homeTeamId) : undefined)
      const unavailable = Object.entries(g.squad).filter(([, s]) => (s.injury && s.injury.weeksOut > 0) || s.suspension > 0).map(([id]) => id)
      expect(a.out.map((m) => m.id).sort()).toEqual(unavailable.sort())
      for (let i = 1; i < a.out.length; i++) expect(a.out[i - 1].weeks).toBeGreaterThanOrEqual(a.out[i].weeks)
    }
  })

  it('reads an injury before a ban, and is null once the season is over', () => {
    const g = inSeason(u, 'r10-ahead-made', 2)
    const [a, b] = two(g, u)
    g.squad[a.id].injury = { description: 'Hamstring', weeksOut: 4 }
    g.squad[a.id].suspension = 1
    g.squad[b.id].injury = null
    g.squad[b.id].suspension = 2
    const out = digestAhead(g, u)!.out
    expect(out.find((m) => m.id === a.id)).toEqual({ id: a.id, name: a.name, why: 'injury', weeks: 4 })
    expect(out.find((m) => m.id === b.id)).toEqual({ id: b.id, name: b.name, why: 'suspension', weeks: 2 })
    expect(AHEAD_CAP).toBeGreaterThan(0)
    g.season!.matchweek = g.season!.matchweeks
    expect(digestAhead(g, u)).toBeNull()
  })

  it('never changes the game it reads', () => {
    const g = inSeason(u, 'r10-ahead-pure', 4)
    const before = JSON.stringify(g)
    digestAhead(g, u)
    weeklyBriefing(g, u)
    expect(JSON.stringify(g)).toBe(before)
  })
})
