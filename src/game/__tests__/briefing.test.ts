import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { openWindow } from '@engine/market'
import { USER_TEAM } from '@engine/season'
import { getFormation } from '@engine/formations'
import { DEFAULT_ROLE, rolesFor } from '@engine/roles'
import { squadPlayers } from '../logic/players'
import { BRIEFING_CAP, BRIEFING_CONDITION, BRIEFING_SHARPNESS, briefingHeadline, LEADER_MENTALITY, objectiveRisk, suggestedCaptain, weeklyBriefing, YELLOWS_PER_BAN } from '../logic/briefing'
import type { Game, GameSettings } from '../types'
import type { Fixture } from '@engine/types'

/** A bare result for a fixture: the objectives only read the scoreline. */
function score(f: Fixture, homeGoals: number, awayGoals: number): void {
  f.result = { homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId, homeGoals, awayGoals, events: [], homeStats: [], awayStats: [], xg: { home: homeGoals, away: awayGoals } }
}

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'season',
    seed: 'briefing-test',
    formationId: '4-3-3',
    teamName: 'Test XI',
    shortName: 'TST',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'everton',
    leagueSeason: 2023,
    rules: { ...SEASON_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

function newGame(u: ReturnType<typeof loadTestUniverse>, partial: Partial<GameSettings> = {}): Game {
  const g = createGame(settings(partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  return g
}

const ids = (items: ReturnType<typeof weeklyBriefing>) => items.map((i) => i.id)

describe("the assistant's briefing", () => {
  const u = loadTestUniverse()

  it('is a pre-season checklist whose boxes tick as the systems are used', () => {
    const g = newGame(u)
    expect(g.phase).toBe('preseason')
    let items = weeklyBriefing(g, u)
    expect(ids(items)).toEqual(['friendlies', 'captain', 'roles', 'staff', 'set-pieces'])
    expect(items.every((i) => i.done === false && i.level === 'info' && i.action)).toBe(true)
    expect(items.find((i) => i.id === 'friendlies')?.text).toBe('Friendlies 0/3')
    expect(items.find((i) => i.id === 'friendlies')?.action).toEqual({ label: 'Play friendly', op: 'friendly' })
    // The captain suggestion is a real squad player, offered through the player modal
    const captain = items.find((i) => i.id === 'captain')!
    expect(captain.action?.op).toBe('player')
    expect(captain.action?.playerId).toBe(suggestedCaptain(g, u))
    expect(g.squad[captain.action!.playerId!]).toBeDefined()
    // The suggestion follows the engine's leadership modifier, pivoted at 75 mentality, with a starter's bonus of 10
    const xi = new Set(Object.values(g.lineup))
    const lead = (x: ReturnType<typeof squadPlayers>[number]) => (x.p.attributes.mentality - LEADER_MENTALITY) * (0.6 + 0.8 * x.p.traits.professionalism) + (xi.has(x.p.id) ? 10 : 0)
    const ranked = squadPlayers(g, u).sort((a, b) => lead(b) - lead(a))
    expect(captain.action?.playerId).toBe(ranked[0].p.id)
    expect(ranked[0].p.attributes.mentality).toBeGreaterThan(LEADER_MENTALITY)
    // A very professional man under 75 mentality drags the side down in the engine, so the steadier head above 75 is suggested over him
    const [benchA, benchB] = g.bench.map((id) => squadPlayers(g, u).find((x) => x.p.id === id)!)
    const twoMan: Game = { ...g, lineup: {}, squad: { a: benchA.s, b: benchB.s }, customPlayers: { a: { ...benchA.p, id: 'a', attributes: { ...benchA.p.attributes, mentality: 70 }, traits: { ...benchA.p.traits, professionalism: 1 } }, b: { ...benchB.p, id: 'b', attributes: { ...benchB.p.attributes, mentality: 78 }, traits: { ...benchB.p.traits, professionalism: 0 } } } }
    expect(suggestedCaptain(twoMan, u)).toBe('b')
    expect(items.find((i) => i.id === 'staff')?.text).toBe('Staff 0/4')
    expect(items.find((i) => i.id === 'staff')?.hint).toMatch(/^£\d+k a week of wage room; a senior physio costs £15k\.$/)
    // Short labels, the why behind an Info button
    expect(items.every((i) => i.text.length <= 20 && !!i.hint)).toBe(true)

    g.friendliesPlayed = 3
    g.captainId = captain.action!.playerId
    const formation = getFormation(g.tactics.formationId)
    const slot = formation.slots[1]
    g.tactics.roles[slot.id] = rolesFor(slot.position).find((r) => r.id !== DEFAULT_ROLE[slot.position])!.id
    g.staff = { physio: 1 }
    g.tactics.setPieces = { penalties: Object.values(g.lineup)[9] }
    items = weeklyBriefing(g, u)
    expect(items.every((i) => i.done === true && i.level === 'ok' && !i.action)).toBe(true)
    expect(items.find((i) => i.id === 'staff')?.text).toBe('Staff 1/4')
    // Done lines stay visible in pre-season: nothing is urgent, so nothing hides them
    expect(items.length).toBe(5)
    expect(briefingHeadline(items)?.id).toBe('friendlies')
  })

  it('adds the youth intake to a dynasty checklist until it is answered', () => {
    const g = newGame(u, { mode: 'dynasty' })
    g.youthIntake = { year: g.year, candidates: [] }
    expect(weeklyBriefing(g, u).find((i) => i.id === 'youth')).toMatchObject({ done: false, action: { tab: 'squad' } })
    g.youthIntake.chosen = null
    expect(weeklyBriefing(g, u).find((i) => i.id === 'youth')).toMatchObject({ done: true, text: 'Youth intake passed' })
    expect(weeklyBriefing(g, u).length).toBe(6)
  })

  it('in season shows one ok line when all is well, and hides it as soon as something needs doing', () => {
    const g = newGame(u)
    startSeasonProper(g)
    const items = weeklyBriefing(g, u)
    expect(items.length).toBe(1)
    expect(items[0]).toMatchObject({ id: 'knobs', level: 'ok', action: { tab: 'tactics' } })
    expect(items[0].text).toMatch(/^Training Balanced, team talk Encourage for .+ \(\d+(st|nd|rd|th)\)$/)

    const starter = Object.values(g.lineup)[5]
    g.squad[starter].condition = BRIEFING_CONDITION - 1
    const flagged = weeklyBriefing(g, u)
    expect(ids(flagged)).toEqual([`tired-${starter}`])
    expect(flagged[0].text).toContain(`(condition ${BRIEFING_CONDITION - 1})`)
    expect(flagged[0].action).toEqual({ label: 'View', op: 'player', playerId: starter })
    // Sharpness is the second flag; condition takes precedence for the same player
    g.squad[starter].condition = 100
    g.squad[starter].sharpness = BRIEFING_SHARPNESS - 5
    expect(ids(weeklyBriefing(g, u))).toEqual([`rusty-${starter}`])
    // Bench players are not starters, so they are not flagged
    g.squad[starter].sharpness = 100
    g.squad[g.bench[0]].condition = 10
    expect(ids(weeklyBriefing(g, u))).toEqual(['knobs'])
  })

  it('lists the week in priority order and caps the list at six', () => {
    const g = newGame(u)
    startSeasonProper(g)
    const xi = Object.values(g.lineup)
    const rng = new Rng('briefing-window')
    // Before matchweek 6, so the first-round cup tie after it is the midweek line
    g.season!.matchweek = 5
    g.pendingEvent = { id: 'test', title: 'A wantaway star', body: '', choices: [{ id: 'a', label: 'A', hint: '' }, { id: 'b', label: 'B', hint: '' }] }
    g.squad[xi[0]].injury = { description: 'Knock', weeksOut: 2 }
    g.squad[xi[1]].yellowCards = YELLOWS_PER_BAN - 1
    g.promisedStart = g.bench[0]
    g.window = openWindow({ u, rng, ownedPlayerIds: new Set(squadPlayers(g, u).map((x) => x.p.playerId)), leagueSeason: 2023, priceLevel: 1, leagues: ['england'] }, 'january')
    g.window.offers.push({ playerSeasonId: xi[2], fromClubId: 'arsenal', amount: 20, day: 0, status: 'open' })
    const items = weeklyBriefing(g, u)
    expect(ids(items)).toEqual(['event', 'lineup-0', `yellow-${xi[1]}`, 'promise', 'window', 'cup'])
    expect(items[0]).toMatchObject({ level: 'block', text: 'Decision needed: A wantaway star', action: { op: 'event' } })
    expect(items[1]).toMatchObject({ level: 'warn', action: { label: 'Auto-pick', op: 'autoPick' } })
    expect(items[1].text).toMatch(/is injured \(2 wk\)$/)
    expect(items[2].text).toMatch(/is one yellow card from a ban$/)
    expect(items[3].text).toMatch(/^You promised .+ a start and he is not in the XI$/)
    expect(items[4]).toMatchObject({ level: 'info', text: 'January window open, day 1 of 7 · 1 offer for your players', action: { tab: 'market' } })
    expect(items[5].text).toMatch(/^Fourth round (v|at) .+ midweek\. Rotate, you play again Thursday$/)
    expect(items[5].action).toEqual({ label: 'Cup', tab: 'cup' })
    expect(items.length).toBe(BRIEFING_CAP)
    expect(items.some((i) => i.level === 'ok')).toBe(false)
    expect(briefingHeadline(items)?.id).toBe('event')
    // A seventh candidate, an objective already gone, is the one the cap drops
    g.season!.objectives = [{ id: 'rivals', label: 'Do not lose to a rival' }]
    const derby = g.season!.fixtures.find((f) => f.homeTeamId === USER_TEAM && u.clubById[g.season!.hostClubId]!.rivals.includes(f.awayTeamId))!
    score(derby, 0, 1)
    expect(objectiveRisk(g.season!.objectives[0], g, u)).toBe('Lost a derby: the unbeaten-against-rivals objective is gone')
    const capped = weeklyBriefing(g, u)
    expect(ids(capped)).toEqual(ids(items))
    expect(capped.length).toBe(BRIEFING_CAP)
    g.season!.objectives = []

    // Deadline day is called out; three or more lineup problems collapse into one line
    g.window.day = g.window.days - 1
    g.squad[xi[3]].suspension = 1
    g.squad[xi[4]].injury = { description: 'Knock', weeksOut: 1 }
    const later = weeklyBriefing(g, u)
    expect(later.find((i) => i.id === 'lineup')?.text).toMatch(/^3 lineup issues: .+, .+ and .+$/)
    expect(later.find((i) => i.id === 'window')?.text).toMatch(/^Deadline day in the january window/)
    // The midweek tie is only mentioned when one is due after the next matchweek
    g.season!.matchweek = 0
    expect(weeklyBriefing(g, u).some((i) => i.id === 'cup')).toBe(false)
  })

  it('is empty once the season is over or the manager is sacked', () => {
    const g = newGame(u)
    startSeasonProper(g)
    g.season!.sacked = true
    expect(weeklyBriefing(g, u)).toEqual([])
    g.season!.sacked = false
    g.season!.matchweek = g.season!.matchweeks
    expect(weeklyBriefing(g, u)).toEqual([])
  })

  it('names objectives at risk with the numbers', () => {
    const g = newGame(u)
    startSeasonProper(g)
    const season = g.season!
    const homeForm = { id: 'home-form' as const, label: 'Lose at most four home league matches', target: 4 }
    expect(objectiveRisk(homeForm, g, u)).toBeNull()
    const homes = season.fixtures.filter((f) => f.homeTeamId === USER_TEAM).slice(0, 5)
    for (const f of homes.slice(0, 2)) score(f, 0, 1)
    expect(objectiveRisk(homeForm, g, u)).toBeNull()
    score(homes[2], 0, 2)
    expect(objectiveRisk(homeForm, g, u)).toBe('3 home defeats of 4 allowed')
    score(homes[3], 1, 2)
    score(homes[4], 0, 3)
    expect(objectiveRisk(homeForm, g, u)).toBe('5 home defeats, 4 allowed: the objective is gone')
    // A decided objective is never at risk
    expect(objectiveRisk({ ...homeForm, met: false }, g, u)).toBeNull()
    season.objectives = [homeForm]
    season.matchweek = 5
    // r8: an objective already gone is on the Club tab and in the Inbox, not in the week's briefing
    expect(weeklyBriefing(g, u).some((i) => i.id === 'objective-home-form')).toBe(false)
    // While it is still at risk (three defeats of four, on a copy) the line stays
    const risky = structuredClone(g)
    const riskyHomes = risky.season!.fixtures.filter((f) => f.homeTeamId === USER_TEAM).slice(0, 5)
    score(riskyHomes[3], 1, 0)
    score(riskyHomes[4], 1, 0)
    const line = weeklyBriefing(risky, u).find((i) => i.id === 'objective-home-form')
    expect(line).toMatchObject({ level: 'info', text: 'Lose at most four home league matches: 3 home defeats of 4 allowed', action: { tab: 'club' } })

    // Pace objectives wait for matchweek 8, then judge the projection
    const goals = { id: 'goals' as const, label: 'Score 57 league goals', target: 57 }
    season.matchweek = 7
    expect(objectiveRisk(goals, g, u)).toBeNull()
    season.matchweek = 8
    // One goal (the 1-2) over eight matchweeks projects to 4.75, rounded to 5
    expect(objectiveRisk(goals, g, u)).toBe('On pace for 5 of the 57 league goals asked (1 so far)')
    const youth = { id: 'youth' as const, label: 'Give a player aged 21 or under ten league starts', target: 10 }
    expect(objectiveRisk(youth, g, u)).toMatch(/^Best under-21 on pace for \d+ of the 10 starts asked \(\d+ so far\)$/)
    // Cup objectives are gone only once knocked out short of the round
    const cup = { id: 'cup-qf' as const, label: 'Reach the cup quarter-final' }
    expect(objectiveRisk(cup, g, u)).toBeNull()
    season.cupEliminated = true
    expect(objectiveRisk(cup, g, u)).toBe('Knocked out of the cup: the quarter-final objective is gone')
    const rivals = { id: 'rivals' as const, label: 'Do not lose to a rival' }
    expect(objectiveRisk(rivals, g, u)).toBeNull()
  })

  it('is deterministic and leaves the game untouched across a simulated run', () => {
    const g = newGame(u)
    startSeasonProper(g)
    for (let i = 0; i < 8; i++) playMatchweek(g, u, true)
    const before = JSON.stringify(g)
    const a = weeklyBriefing(g, u)
    const b = weeklyBriefing(g, u)
    expect(a).toEqual(b)
    expect(JSON.stringify(g)).toBe(before)
    expect(a.length).toBeGreaterThan(0)
    expect(a.length).toBeLessThanOrEqual(BRIEFING_CAP)
    for (const item of a) expect(['block', 'warn', 'info', 'ok']).toContain(item.level)
  })
})
