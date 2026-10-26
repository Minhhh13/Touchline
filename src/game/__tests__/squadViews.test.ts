import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { canCover } from '@engine/positions'
import { computeAwards } from '@engine/awards'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { squadPlayers } from '../logic/players'
import { contractsOverview, PLANNER_POSITIONS, squadPlanner } from '../logic/planner'
import { leagueAwards } from '../logic/leagueAwards'
import { inboxActions, INBOX_ACTIONS_CAP } from '../logic/inboxActions'
import { weeklyBriefing } from '../logic/briefing'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function settings(seed: string): GameSettings {
  return { mode: 'season', seed, formationId: '4-3-3', teamName: 'Plan XI', shortName: 'PLN', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'wolves', leagueSeason: 2020, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' }
}

function seeded(seed: string): Game {
  const g = createGame(settings(seed))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  return g
}

describe('the squad planner', () => {
  it('lists depth at every position, who is next in, and the needs of the formation', () => {
    for (const seed of ['plan-1', 'plan-2', 'plan-3', 'plan-4', 'plan-5']) {
      const g = seeded(seed)
      playMatchweek(g, u, true)
      const rows = squadPlanner(g, u)
      expect(rows.map((r) => r.position)).toEqual(PLANNER_POSITIONS)
      const formation = getFormation(g.tactics.formationId)
      const xi = new Set(Object.values(g.lineup))
      for (const r of rows) {
        expect(r.used).toBe(formation.slots.some((s) => s.position === r.position))
        for (const d of r.depth) expect(canCover(u.index[d.id] ?? g.customPlayers[d.id], r.position, 'accomplished')).toBe(true)
        expect(r.depth.map((d) => d.rating)).toEqual([...r.depth.map((d) => d.rating)].sort((a, b) => b - a))
        if (r.next) {
          expect(xi.has(r.next.id)).toBe(false)
          expect(r.next.available).toBe(true)
        }
        expect(r.naturals).toBe(r.depth.filter((d) => d.natural).length)
        if (!r.used) expect(r.need).toBeNull()
        if (r.used && r.naturals === 0) expect(r.need).toBe('No natural')
      }
    }
  })

  it('flags a position with too few natural players', () => {
    const g = seeded('plan-need')
    const st = Object.keys(g.squad).filter((id) => u.index[id]?.positions.includes('ST'))
    for (const id of st.slice(1)) {
      delete g.squad[id]
      delete g.contracts[id]
    }
    const row = squadPlanner(g, u).find((r) => r.position === 'ST')!
    expect(row.naturals).toBeLessThanOrEqual(1)
    expect(row.need).not.toBeNull()
  })

  it('sorts contracts soonest out first and totals the wages', () => {
    const g = seeded('plan-contracts')
    const [a] = Object.keys(g.squad)
    g.contracts[a] = { ...g.contracts[a], years: 1, renewed: false }
    const c = contractsOverview(g, u)
    expect(c.rows.length).toBe(Object.keys(g.squad).length)
    expect(c.rows[0].expiring).toBe(true)
    const firstNot = c.rows.findIndex((r) => !r.expiring)
    if (firstNot >= 0) expect(c.rows.slice(firstNot).every((r) => !r.expiring)).toBe(true)
    expect(c.expiring).toBe(c.rows.filter((r) => r.expiring).length)
    expect(c.wagesLeaving + c.wagesCommitted).toBe(squadPlayers(g, u).reduce((t, x) => t + x.p.wage, 0))
  })
})

describe('league awards', () => {
  it('judges the whole league from the squad and the rivals, and leaves the squad awards alone', () => {
    const g = seeded('awards-league')
    let guard = 0
    while (g.phase !== 'summary' && guard++ < 60) playMatchweek(g, u, true)
    const own = computeAwards(squadPlayers(g, u), g.season!.matchweeks)
    expect(g.awards).toEqual(own)
    const a = leagueAwards(g, u)!
    expect(a.teamOfTheSeason.length).toBe(11)
    expect(new Set(a.teamOfTheSeason.map((t) => t.playerSeasonId)).size).toBe(11)
    for (const w of [a.playerOfTheSeason, a.goldenBoot, a.playmaker, a.goldenGlove]) {
      expect(w).toBeDefined()
      expect(w!.teamName.length).toBeGreaterThan(0)
      expect(w!.mine).toBe(!!g.squad[w!.playerSeasonId])
    }
    // The league's top scorer has at least as many as the squad's
    const goals = (v: string) => Number(v.split(' ')[0])
    expect(goals(a.goldenBoot!.value)).toBeGreaterThanOrEqual(goals(own.goldenBoot?.value ?? '0 goals'))
    expect(a.mineInTeam).toBe(a.teamOfTheSeason.filter((t) => !!g.squad[t.playerSeasonId]).length)
  }, 120_000)
})

describe('inbox actions', () => {
  it('offers a way to act on items about a player, at most two, each to a real destination', () => {
    const g = seeded('inbox-actions')
    let guard = 0
    while (g.season!.matchweek < 12 && guard++ < 30) playMatchweek(g, u, true)
    const news = g.season!.news
    expect(news.some((n) => n.playerId)).toBe(true)
    let withActions = 0
    for (const n of news) {
      const acts = inboxActions(n, g)
      expect(acts.length).toBeLessThanOrEqual(INBOX_ACTIONS_CAP)
      for (const a of acts) {
        expect(a.tab || a.op).toBeTruthy()
        if (a.op === 'player') expect(g.squad[a.playerId!]).toBeDefined()
      }
      if (acts.length) withActions++
    }
    expect(withActions).toBeGreaterThan(0)
    // An item about a tired starter offers a rest; one about a player who has left offers nothing on him
    const id = Object.values(g.lineup)[3]
    g.squad[id].condition = 50
    g.squad[id].injury = null
    expect(inboxActions({ matchweek: 12, kind: 'event', title: 'x', body: 'y', playerId: id }, g)[0]).toEqual({ label: 'Rest him', op: 'player', playerId: id })
    expect(inboxActions({ matchweek: 12, kind: 'event', title: 'x', body: 'y', playerId: 'gone@2000@nobody' }, g).every((a) => a.playerId === undefined)).toBe(true)
    // A pending renewal for him is offered first
    g.pendingEvent = { id: 'contract', title: 'Contract', body: '', playerSeasonId: id, choices: [] } as unknown as Game['pendingEvent']
    expect(inboxActions({ matchweek: 12, kind: 'injury', title: 'x', body: 'y', playerId: id }, g)[0]).toEqual({ label: 'Offer a new contract', op: 'event' })
  }, 60_000)

  it('the briefing names a high-risk tired starter and sends him to the medical view', () => {
    const g = seeded('inbox-risk')
    playMatchweek(g, u, true)
    const id = Object.values(g.lineup).find((x) => u.index[x]?.positions[0] !== 'GK')!
    g.squad[id].condition = 62
    g.customPlayers[id] = { ...u.index[id], traits: { ...u.index[id].traits, injuryProneness: 0.8 } }
    g.pendingEvent = null
    const item = weeklyBriefing(g, u).find((i) => i.id === `risk-${id}`)
    expect(item?.action).toEqual({ label: 'Medical', tab: 'planner' })
  })
})
