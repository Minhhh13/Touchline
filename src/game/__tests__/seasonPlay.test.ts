/**
 * r8 Season play: the board's stakes, resting tired starters, the promised start, the Continental Cup's stakes, the
 * contract reminder and the quiet summer renewals. Every reader is pure; the two actions move men between the XI and
 * the bench only, so the game's stream never moves.
 */
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { getFormation } from '@engine/formations'
import { DEFAULT_ROLE, getRole } from '@engine/roles'
import { liveModifiers, roleRating } from '@engine/ratings'
import { USER_TEAM } from '@engine/season'
import { continentalPlan } from '@engine/continental'
import { beginSeason, createGame } from '../logic/setup'
import { playMatchweek, startSeasonProper, upcomingCupTie } from '../logic/week'
import { advanceToNextSeason, postRenewals, settleRenewals } from '../logic/dynasty'
import { playerLookup } from '../logic/players'
import { weeklyBriefing } from '../logic/briefing'
import { BOARD_DANGER, BOARD_WATCH, boardLine, boardStakes, CONTRACT_REMINDER_WEEKS, contractsEnding, europeLine, europeStake, promiseSlot, restPlan, restTired, SACK_CONFIDENCE, SACK_FROM_MATCHWEEK, startPromised, TIRED_CONDITION, tiredStarters } from '../logic/seasonPlay'
import { BRIEFING_CONDITION } from '../logic/briefing'
import type { Game, GameSettings } from '../types'
import type { Fixture } from '@engine/types'

const LEAGUES = ['england', 'spain', 'germany']
const u = loadTestUniverse(LEAGUES)

function settings(seed: string, partial: Partial<GameSettings> = {}): GameSettings {
  return { mode: 'season', seed, formationId: '4-3-3', teamName: 'Play XI', shortName: 'PLY', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2023, rules: { ...SEASON_RULES, leagues: ['england'], squadSize: 20 }, jobSecurity: true, difficulty: 'calibrated', ...partial }
}

function newGame(seed: string, partial: Partial<GameSettings> = {}): Game {
  const g = createGame(settings(seed, partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g, u)
  return g
}

function score(f: Fixture, homeGoals: number, awayGoals: number): void {
  f.result = { homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId, homeGoals, awayGoals, events: [], homeStats: [], awayStats: [], xg: { home: homeGoals, away: awayGoals } }
}

const slotScore = (g: Game, id: string, slotId: string) => {
  const slot = getFormation(g.tactics.formationId).slots.find((s) => s.id === slotId)!
  const p = playerLookup(g, u)(id)!
  const m = liveModifiers(g.squad[id])
  return roleRating(p, getRole(g.tactics.roles[slotId] ?? DEFAULT_ROLE[slot.position]), slot.position) * m.condition * m.sharpness
}

describe('the board stakes', () => {
  it('names the danger before the sack, and only when the board can sack', () => {
    const g = newGame('play-board')
    g.season!.matchweek = 12
    g.season!.confidence = 70
    expect(boardStakes(g)?.level).toBe('safe')
    expect(boardLine(boardStakes(g))).toBeNull()
    g.season!.confidence = BOARD_WATCH - 1
    expect(boardStakes(g)?.level).toBe('watch')
    expect(boardLine(boardStakes(g))).toMatch(/^The board is watching \(confidence 39\): \d+(st|nd|rd|th), the target is \d+(st|nd|rd|th)$/)
    g.season!.confidence = BOARD_DANGER - 1
    const line = boardLine(boardStakes(g))!
    expect(line).toMatch(new RegExp(`^Job at risk \\(board confidence 24, sacked below ${SACK_CONFIDENCE}\\)`))
    // The briefing puts it straight after a pending decision, as a warning
    const brief = weeklyBriefing(g, u)
    expect(brief[0]).toMatchObject({ id: 'board', level: 'warn', text: line, action: { tab: 'club' } })
    g.pendingEvent = { id: 'x', title: 'A row', body: '', choices: [{ id: 'a', label: 'A', hint: '' }] }
    expect(weeklyBriefing(g, u).map((i) => i.id).slice(0, 2)).toEqual(['event', 'board'])
    // No job security, no stakes
    g.settings.jobSecurity = false
    expect(boardStakes(g)).toBeNull()
    expect(weeklyBriefing(g, u).some((i) => i.id === 'board')).toBe(false)
  })

  it('mirrors the week loop: confidence 0 from matchweek 10 sacks, before it does not', () => {
    const early = newGame('play-sack-early')
    early.season!.matchweek = SACK_FROM_MATCHWEEK - 2
    early.season!.confidence = 0
    playMatchweek(early, u, true)
    expect(early.season!.sacked).toBe(false)
    const late = newGame('play-sack-late')
    late.season!.matchweek = SACK_FROM_MATCHWEEK - 1
    for (const f of late.season!.fixtures) if (f.matchweek < SACK_FROM_MATCHWEEK) score(f, 0, 0)
    late.season!.confidence = 0
    playMatchweek(late, u, true)
    expect(late.season!.sacked).toBe(true)
  })
})

describe('resting tired starters', () => {
  it('swaps a tired starter for the fresher man who rates higher in his slot, and draws nothing', () => {
    let swaps = 0
    for (let i = 0; i < 12; i++) {
      const g = newGame(`play-rest-${i}`)
      const xi = Object.values(g.lineup)
      const rng = new Rng(`tire-${i}`)
      const tired = rng.shuffle([...xi]).slice(0, 3)
      for (const id of tired) g.squad[id].condition = 20 + rng.int(0, 30)
      expect(new Set(tiredStarters(g, u))).toEqual(new Set(tired))
      const plan = restPlan(g, u)
      const before = Object.fromEntries(plan.map((s) => [s.slotId, slotScore(g, s.outId, s.slotId)]))
      const state = JSON.stringify(g.rngState)
      const made = restTired(g, u)
      expect(made).toEqual(plan)
      expect(JSON.stringify(g.rngState)).toBe(state)
      for (const s of made) {
        expect(g.lineup[s.slotId]).toBe(s.inId)
        expect(g.bench).toContain(s.outId)
        expect(slotScore(g, s.inId, s.slotId)).toBeGreaterThan(before[s.slotId])
        expect(g.squad[s.inId].condition).toBeGreaterThanOrEqual(TIRED_CONDITION)
      }
      expect(new Set(Object.values(g.lineup)).size).toBe(Object.values(g.lineup).length)
      swaps += made.length
      // Nobody fresher is left for what remains, or the plan would name him
      expect(restPlan(g, u)).toEqual([])
    }
    expect(swaps).toBeGreaterThan(12)
  })

  it('leaves a man with no fresher cover where he is, and the briefing offers the rest only when one exists', () => {
    const g = newGame('play-rest-lone')
    const keeperSlot = getFormation(g.tactics.formationId).slots.find((s) => s.position === 'GK')!.id
    const keeper = g.lineup[keeperSlot]
    const get = playerLookup(g, u)
    g.squad[keeper].condition = BRIEFING_CONDITION - 25
    const others = Object.keys(g.squad).filter((id) => id !== keeper && get(id)!.positions.includes('GK'))
    expect(others.length).toBeGreaterThan(0)
    const line = () => weeklyBriefing(g, u).find((i) => i.id === `tired-${keeper}`)!
    expect(line().action).toMatchObject({ op: 'rest', playerId: keeper })
    expect(line().text).toMatch(/: rest him for .+$/)
    for (const id of others) g.squad[id].injury = { description: 'Knock', weeksOut: 2 }
    expect(restPlan(g, u)).toEqual([])
    expect(line().action).toEqual({ label: 'View', op: 'player', playerId: keeper })
    expect(restTired(g, u)).toEqual([])
    expect(g.lineup[keeperSlot]).toBe(keeper)
  })

  it('puts two or more tired starters on one line', () => {
    const g = newGame('play-rest-many')
    const xi = Object.values(g.lineup)
    for (const id of xi.slice(1, 4)) g.squad[id].condition = 40
    const items = weeklyBriefing(g, u)
    const line = items.find((i) => i.id === 'tired')!
    expect(line.text).toMatch(/^3 starters are tired: .+ \(40\), .+ \(40\) and .+ \(40\)$/)
    expect(items.some((i) => i.id.startsWith('tired-'))).toBe(false)
    const n = restPlan(g, u).length
    expect(line.action).toEqual(n ? { label: n === 1 ? 'Rest one' : `Rest ${n}`, op: 'rest' } : { label: 'Squad', tab: 'squad' })
  })
})

describe('the promised start', () => {
  it('puts the man into a slot he plays, where he costs the XI least, and the warning goes', () => {
    for (let i = 0; i < 8; i++) {
      const g = newGame(`play-promise-${i}`)
      const get = playerLookup(g, u)
      const man = g.bench.find((id) => !get(id)!.positions.includes('GK'))!
      g.promisedStart = man
      expect(weeklyBriefing(g, u).find((x) => x.id === 'promise')?.action).toMatchObject({ op: 'startPromised', playerId: man })
      const slot = promiseSlot(g, u, man)!
      const position = getFormation(g.tactics.formationId).slots.find((s) => s.id === slot)!.position
      expect(get(man)!.positions).toContain(position)
      expect(startPromised(g, u)).toBe(slot)
      expect(g.lineup[slot]).toBe(man)
      expect(weeklyBriefing(g, u).some((x) => x.id === 'promise')).toBe(false)
      expect(promiseSlot(g, u, man)).toBeNull()
    }
  })

  it('does nothing for an injured man', () => {
    const g = newGame('play-promise-hurt')
    const man = g.bench[0]
    g.promisedStart = man
    g.squad[man].injury = { description: 'Knock', weeksOut: 1 }
    const lineup = { ...g.lineup }
    expect(startPromised(g, u)).toBeNull()
    expect(g.lineup).toEqual(lineup)
    expect(weeklyBriefing(g, u).find((x) => x.id === 'promise')?.action?.op).toBe('player')
  })
})

describe('the Continental Cup stakes', () => {
  const europe = (seed: string) => newGame(seed, { mode: 'dynasty', wheelLeagues: LEAGUES, rules: { ...SEASON_RULES, leagues: LEAGUES, squadSize: 20 }, leagueSeason: 2024, continental: true, jobSecurity: false })

  /** Play the group up to (not including) `matchday`, the user's results by `mine`, the rest by `rest`. */
  function playGroup(g: Game, matchday: number, mine: 'W' | 'L' | 'D', rest: (m: Fixture) => [number, number]) {
    const plan = continentalPlan(g.season!.matchweeks)
    const group = g.season!.continental!.groups!.find((x) => x.teams.includes(USER_TEAM))!
    for (const m of group.matches) {
      if (m.matchday >= matchday) continue
      if (m.homeTeamId === USER_TEAM || m.awayTeamId === USER_TEAM) {
        const us = mine === 'W' ? 2 : mine === 'D' ? 1 : 0
        const them = mine === 'L' ? 2 : 1
        if (m.homeTeamId === USER_TEAM) score(m, us, them)
        else score(m, them, us)
      } else score(m, ...rest(m))
    }
    g.season!.matchweek = plan.groupWeeks[matchday - 1] - 1
    return group
  }

  it('names the group standing and what the matches left can change', () => {
    const g = europe('play-europe-through')
    expect(europeStake(g)).toBeNull()
    // Before the first matchday every table is level: no stake yet, the plain midweek line
    playGroup(g, 1, 'W', () => [0, 0])
    expect(upcomingCupTie(g)?.round).toBe('G')
    expect(europeStake(g)).toBeNull()
    // Four wins, every other match drawn: no one else can reach twelve points
    playGroup(g, 5, 'W', () => [1, 1])
    expect(upcomingCupTie(g)?.round).toBe('G')
    const through = europeStake(g)!
    expect(through).toMatchObject({ kind: 'group', position: 1, points: 12, left: 2, state: 'through' })
    expect(europeLine(through)).toMatch(/^1st in Group [A-D] on 12 points, 2 to play: through already, rest who you like$/)
    expect(weeklyBriefing(g, u).find((i) => i.id === 'cup')?.text).toMatch(/midweek\. 1st in Group [A-D] on 12 points/)

    const h = europe('play-europe-out')
    // Four defeats, every other match a home win: two sides past the six points the user can still reach
    playGroup(h, 5, 'L', () => [2, 0])
    const out = europeStake(h)!
    expect(out).toMatchObject({ kind: 'group', position: 4, points: 0, state: 'out' })
    expect(europeLine(out)).toMatch(/: out whatever happens$/)

    const k = europe('play-europe-open')
    // Two draws from the first two matchdays, every other match drawn: four sides on two points, all to play for
    playGroup(k, 3, 'D', () => [0, 0])
    const open = europeStake(k)!
    expect(open).toMatchObject({ kind: 'group', points: 2, left: 4, state: 'open', margin: 0 })
  })

  it('says what a second leg needs from the first leg', () => {
    const line = (ours: number, theirs: number) => europeLine({ kind: 'second-leg', ours, theirs })
    expect(line(2, 1)).toBe('You lead 2-1 from the first leg: a draw takes you through')
    expect(line(3, 0)).toBe('You lead 3-0 from the first leg: you can lose by 2 goals and go through')
    expect(line(1, 1)).toBe('Level at 1-1 from the first leg: win to go through, a draw means extra time')
    expect(line(0, 1)).toBe('You trail 0-1 from the first leg: win by 2 goals to go through, by 1 goal for extra time')
    expect(line(1, 3)).toBe('You trail 1-3 from the first leg: win by 3 goals to go through, by 2 goals for extra time')

    // From a real tie: the user away in the first leg, so the first leg's home goals are theirs
    const g = europe('play-europe-leg')
    const c = g.season!.continental!
    for (const grp of c.groups!) for (const m of grp.matches) score(m, 1, 0)
    const qf = continentalPlan(g.season!.matchweeks).rounds[0]
    c.ties.push({ round: qf.round, afterMatchweek: qf.afterMatchweek, homeTeamId: 'rival-x', awayTeamId: USER_TEAM, firstLeg: { afterMatchweek: qf.firstLeg! } })
    const tie = c.ties.at(-1)!
    tie.firstLeg!.result = { homeTeamId: 'rival-x', awayTeamId: USER_TEAM, homeGoals: 2, awayGoals: 1, events: [], homeStats: [], awayStats: [], xg: { home: 1, away: 1 } }
    g.season!.matchweek = qf.afterMatchweek - 1
    expect(europeStake(g)).toEqual({ kind: 'second-leg', ours: 1, theirs: 2 })
    // A first leg still to play has no stake yet
    delete tie.firstLeg!.result
    g.season!.matchweek = qf.firstLeg! - 1
    expect(europeStake(g)).toBeNull()
  })
})

describe('contracts that run out', () => {
  it('a Dynasty names them in its last ten weeks; a Season never does', () => {
    const g = newGame('play-contracts', { mode: 'dynasty', jobSecurity: false })
    const ids = Object.keys(g.squad).slice(0, 5)
    for (const id of ids) g.contracts[id] = { ...g.contracts[id], years: 1 }
    for (const id of Object.keys(g.squad).slice(5)) g.contracts[id] = { ...g.contracts[id], years: 3 }
    g.contracts[ids[0]].renewed = true
    g.contracts[ids[1]].declined = true
    g.season!.matchweek = g.season!.matchweeks - CONTRACT_REMINDER_WEEKS - 1
    expect(contractsEnding(g, u)).toEqual([])
    g.season!.matchweek += 1
    const ending = contractsEnding(g, u)
    expect(new Set(ending)).toEqual(new Set(ids.slice(2)))
    const line = weeklyBriefing(g, u).find((i) => i.id === 'contracts')
    // The line may be capped away by louder ones; when shown it names the count and opens the contracts
    if (line) expect(line).toMatchObject({ level: 'info', text: expect.stringMatching(/^3 contracts end this summer: /), action: { tab: 'planner' } })
    const s = newGame('play-contracts-season', { jobSecurity: false })
    for (const id of Object.keys(s.squad)) s.contracts[id] = { ...s.contracts[id], years: 1 }
    s.season!.matchweek = s.season!.matchweeks - 2
    expect(contractsEnding(s, u)).toEqual([])
  })

  it('the summer opener posts one item for the assistant renewals, with the terms', () => {
    const g = createGame(settings('play-quiet-summer', { mode: 'dynasty', jobSecurity: false }))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    postRenewals(g, u)
    startSeasonProper(g, u)
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    for (const id of Object.keys(g.squad)) g.contracts[id] = { ...g.contracts[id], years: 1 }
    advanceToNextSeason(g, u)
    const r2 = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, r2)
    g.rngState = r2.getState()
    beginSeason(g, u)
    g.finances.wageCap = 1e6
    const before = g.season!.news.length
    const out = settleRenewals(g, u)
    expect(out.renewed.length).toBeGreaterThan(5)
    const posted = g.season!.news.slice(0, g.season!.news.length - before)
    expect(posted.filter((n) => n.title.endsWith('signs a new contract'))).toEqual([])
    const settled = posted.find((n) => n.title === 'Contracts settled')!
    expect(settled.body).toMatch(/^Renewed by the assistant: .+ \(£\d+k, [12] seasons?\)/)
  }, 60_000)
})

describe('objectives already gone', () => {
  it('leave the briefing once failed', () => {
    const g = newGame('play-objectives', { jobSecurity: false })
    g.season!.objectives = [{ id: 'home-form', label: 'Lose at most one home league match', target: 1 }]
    const homes = g.season!.fixtures.filter((f) => f.homeTeamId === USER_TEAM).slice(0, 2)
    score(homes[0], 0, 1)
    g.season!.matchweek = 5
    expect(weeklyBriefing(g, u).some((i) => i.id === 'objective-home-form')).toBe(true)
    score(homes[1], 0, 1)
    expect(weeklyBriefing(g, u).some((i) => i.id === 'objective-home-form')).toBe(false)
  })
})
