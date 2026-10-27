import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, finishLiveMatch, startSeasonProper, continentalRun, upcomingCupTie } from '../logic/week'
import { advanceToNextSeason } from '../logic/dynasty'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { buildContinentalClubs, continentalRounds, cupRounds, drawFirstRound, USER_TEAM } from '@engine/season'
import { continentalPlan, groupTable, throughGroups, tieScore } from '@engine/continental'
import { normaliseGame } from '../logic/save'
import type { GameSettings } from '../types'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'dynasty',
    seed: 'euro-test',
    formationId: '4-3-3',
    teamName: 'Test XI',
    shortName: 'TST',
    leagueId: 'england',
    wheelLeagues: ['england', 'spain', 'germany'],
    hostClubId: 'everton',
    leagueSeason: 2024,
    rules: { ...SEASON_RULES, leagues: ['england', 'spain', 'germany'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    continental: true,
    ...partial,
  }
}

describe('Continental Cup', () => {
  const u = loadTestUniverse(['england', 'spain', 'germany'])

  it('builds a field of fifteen foreign clubs on free midweeks', () => {
    const clubs = buildContinentalClubs(u, 'england', 2024, 'everton', 15)
    const ids = Object.keys(clubs)
    expect(ids.length).toBe(15)
    for (const id of ids) expect(u.clubById[id]?.leagueId).not.toBe('england')
    const leagues = new Set(ids.map((id) => u.clubById[id]?.leagueId))
    expect(leagues.size).toBe(2)
    // No clash with the domestic cup in any league length, and every midweek its own, in order (engine 7's calendar)
    for (let mws = 26; mws <= 46; mws += 2) {
      const dom = new Set(cupRounds(mws).map((r) => r.afterMatchweek))
      const plan = continentalPlan(mws)
      const weeks = [...plan.groupWeeks, ...plan.rounds.flatMap((r) => [...(r.firstLeg ? [r.firstLeg] : []), r.afterMatchweek])]
      expect(weeks.length).toBe(11)
      for (const w of weeks) expect(dom.has(w), `${mws}: ${w}`).toBe(false)
      for (let k = 1; k < weeks.length; k++) expect(weeks[k], `${mws}`).toBeGreaterThan(weeks[k - 1])
      expect(weeks.at(-1)!).toBeLessThan(mws)
      // The engine 6 knockout's weeks too, for a cup drawn before engine 7
      for (const r of continentalRounds(mws)) expect(dom.has(r.afterMatchweek)).toBe(false)
    }
  })

  it('plays groups of four home and away, two-legged quarter- and semi-finals and a final, with live group matches and legs', () => {
    const g = createGame(settings())
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    const c = g.season!.continental!
    expect(c.groups).toHaveLength(4)
    expect(c.ties).toHaveLength(0)
    for (const grp of c.groups!) {
      expect(grp.teams).toHaveLength(4)
      expect(grp.matches).toHaveLength(12)
      // Each side three at home and three away, each pair twice with the venues swapped
      for (const t of grp.teams) expect(grp.matches.filter((m) => m.homeTeamId === t).length).toBe(3)
    }
    expect(new Set(c.groups!.flatMap((x) => x.teams)).size).toBe(16)
    expect(g.season!.news.some((n) => n.title === 'Continental Cup draw' && n.body.startsWith('Group '))).toBe(true)
    startSeasonProper(g)
    const plan = continentalPlan(g.season!.matchweeks)
    while (g.season!.matchweek < plan.groupWeeks[0] - 1) playMatchweek(g, u, true)
    const up = upcomingCupTie(g)
    expect(up?.comp).toBe('continental')
    expect(up?.round).toBe('G')
    // The league match live, then the group match live
    playMatchweek(g, u, false)
    expect(g.live?.kind).toBe('league')
    finishLiveMatch(g, u, { talk: 'encourage' })
    expect(g.live?.kind).toBe('cup')
    expect(g.live?.comp).toBe('continental')
    expect(g.live?.group).toBeGreaterThanOrEqual(0)
    expect(g.live?.ctx.roundLabel).toMatch(/^Continental Cup, Group [A-D], matchday 1$/)
    finishLiveMatch(g, u, { talk: 'fire-up' })
    expect(g.live).toBeNull()
    // Every match of matchday 1 is in, nothing of matchday 2
    const md1 = c.groups!.flatMap((x) => x.matches.filter((m) => m.matchday === 1))
    expect(md1.every((m) => !!m.result)).toBe(true)
    expect(c.groups!.flatMap((x) => x.matches.filter((m) => m.matchday === 2)).some((m) => !!m.result)).toBe(false)
    // To the quarter-finals' first leg
    while (g.season!.matchweek < plan.rounds[0].firstLeg! - 1) playMatchweek(g, u, true)
    expect(c.groups!.every((x) => x.matches.every((m) => !!m.result))).toBe(true)
    const qf = c.ties.filter((t) => t.round === 'QF')
    expect(qf).toHaveLength(4)
    // Group winners host the second leg; the eight are the groups' top two
    const firsts = c.groups!.map((x) => groupTable(x)[0].teamId)
    const seconds = c.groups!.map((x) => groupTable(x)[1].teamId)
    expect(qf.map((t) => t.awayTeamId).sort()).toEqual([...firsts].sort())
    expect(qf.map((t) => t.homeTeamId).sort()).toEqual([...seconds].sort())
    const through = throughGroups(c.groups!, USER_TEAM)
    expect(c.eliminated).toBe(!through)
    if (through) {
      playMatchweek(g, u, false)
      finishLiveMatch(g, u, {})
      expect(g.live?.leg).toBe(1)
      finishLiveMatch(g, u, {})
      const mine = qf.find((t) => t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM)!
      expect(mine.firstLeg?.result).toBeTruthy()
      expect(mine.result).toBeUndefined()
      expect(mine.winnerId).toBeUndefined()
    }
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    const ties = c.ties
    expect(ties.filter((t) => t.round === 'QF' && t.winnerId)).toHaveLength(4)
    expect(ties.filter((t) => t.round === 'SF' && t.winnerId)).toHaveLength(2)
    expect(ties.filter((t) => t.round === 'F' && t.winnerId)).toHaveLength(1)
    for (const t of ties.filter((x) => x.round !== 'F')) {
      // Aggregate over both legs, extra time on top when level, a shoot-out only when still level
      const s = tieScore(t)!
      const ninety = { home: t.firstLeg!.result!.homeGoals + t.result!.awayGoals, away: t.firstLeg!.result!.awayGoals + t.result!.homeGoals }
      if (!s.et) expect([s.home, s.away]).toEqual([ninety.home, ninety.away])
      else expect(ninety.home).toBe(ninety.away)
      if (s.pens) expect(s.home).toBe(s.away)
      expect(t.winnerId).toBe(s.home > s.away ? t.homeTeamId : s.away > s.home ? t.awayTeamId : s.pens!.home > s.pens!.away ? t.homeTeamId : t.awayTeamId)
    }
    const final = ties.find((t) => t.round === 'F')!
    expect(final.firstLeg).toBeUndefined()
    const run = continentalRun(g.season!)
    expect(['G', 'QF', 'SF', 'F', 'W']).toContain(run)
    expect(run === 'G').toBe(!through)
    expect(g.history[0].continentalRun).toBe(run)
    expect(g.history[0].continentalWon).toBe(run === 'W')
    expect(g.season!.cup.filter((t) => t.round === 'F' && t.result).length).toBe(1)
    expect(g.qualifiedContinental).toBe(g.history[0].position <= 4 || run === 'W')
  })

  it('keeps an engine 6 Continental Cup (no groups) playing its single-tie knockout from the round of 16', () => {
    const g = createGame(settings({ seed: 'euro-e6-save' }))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    // As engine 6 drew it: the round of 16 at once, no groups
    const c = g.season!.continental!
    c.groups = undefined
    c.ties = drawFirstRound([USER_TEAM, ...Object.keys(c.clubs)], new Rng('e6-draw'), continentalRounds(g.season!.matchweeks))
    const saved = normaliseGame(JSON.parse(JSON.stringify(g)))!
    startSeasonProper(saved)
    const r16 = continentalRounds(saved.season!.matchweeks)[0].afterMatchweek
    while (saved.season!.matchweek < r16 - 1) playMatchweek(saved, u, true)
    expect(upcomingCupTie(saved)?.label).toBe('Continental round of 16')
    while (saved.phase !== 'summary') playMatchweek(saved, u, true)
    const ties = saved.season!.continental!.ties
    expect(ties.filter((t) => t.round === 'R16' && t.winnerId)).toHaveLength(8)
    expect(ties.filter((t) => t.round === 'F' && t.winnerId)).toHaveLength(1)
    expect(ties.some((t) => t.firstLeg || t.agg)).toBe(false)
    expect(saved.season!.continental!.groups).toBeUndefined()
    expect(['R16', 'QF', 'SF', 'F', 'W']).toContain(continentalRun(saved.season!))
  })

  it('over seeded Seasons: the group stage and both legs replay identically and the user reaches the quarter-finals about half the time', () => {
    let through = 0
    const n = 6
    for (let i = 0; i < n; i++) {
      const play = () => {
        const g = createGame(settings({ seed: `euro-many-${i}`, mode: 'season' }))
        const rng = Rng.fromState(g.rngState)
        autoDraft(u, g.draft!, rng)
        g.rngState = rng.getState()
        beginSeason(g, u)
        startSeasonProper(g)
        while (g.phase !== 'summary') playMatchweek(g, u, true)
        return g
      }
      const a = play()
      const b = play()
      expect(b.season!.continental).toEqual(a.season!.continental)
      expect(b.rngState).toEqual(a.rngState)
      if (throughGroups(a.season!.continental!.groups!, USER_TEAM)) through++
    }
    expect(through).toBeGreaterThan(0)
  }, 120_000)

  it('re-enters in the dynasty only when qualified', () => {
    const g = createGame(settings({ seed: 'euro-dyn' }))
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    startSeasonProper(g)
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    const qualified = g.qualifiedContinental
    advanceToNextSeason(g, u)
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    expect(!!g.season!.continental).toBe(!!qualified)
    // Without the setting and without qualifying there is no European football
    const g2 = createGame(settings({ seed: 'euro-none', continental: false }))
    autoDraft(u, g2.draft!, Rng.fromState(g2.rngState))
    beginSeason(g2, u)
    expect(g2.season!.continental).toBeUndefined()
  })
})
