import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { pairingGoalFactor, simulateMatch, softCeiling, XG_CEILING, XG_KNEE } from '../match'
import { aiClubOf, aiFixtureInputs, aiRatingOffset, aiTeamInput, applyMatchToAiState, buildAiClubs, computeTable, generateFixtures, LEAGUE_GOAL_FACTOR, leagueGoalFactor, newSquadPlayer, type AiClub } from '../season'
import { aiLookup, isReserveKeeperId, reserveKeeper, reserveKeeperById, reserveKeeperId } from '../reserve'
import { afterSeasonMoney, CONTINENTAL_PRIZE, HEADROOM_SHARE, prizeMoney, weeklyCashFlow } from '../market'
import { liveModifiers } from '../ratings'

/**
 * Engine 6's match-engine and economy changes, each against its own rule: the soft ceiling, the league scoring levels,
 * the discipline, the reserve keeper, the AI's steady state and the money. The calibration itself is measured in
 * docs/GAME_DESIGN.md section 8; the statistical guards here are loose enough to hold on any seed set.
 */
const u = loadTestUniverse(['england'])

describe('the soft ceiling on expected goals (E6-4)', () => {
  it('leaves every match up to the knee untouched and bends the rest below the ceiling, in order', () => {
    for (const x of [0.12, 0.5, 1, 1.5, 2.5, XG_KNEE]) expect(softCeiling(x)).toBe(x)
    let last = XG_KNEE
    for (let x = XG_KNEE + 0.1; x < 12; x += 0.1) {
      const y = softCeiling(x)
      expect(y).toBeGreaterThan(last)
      expect(y).toBeLessThan(XG_CEILING)
      expect(y).toBeLessThanOrEqual(x)
      last = y
    }
    expect(softCeiling(4)).toBeCloseTo(3.97, 2)
    expect(softCeiling(5.8)).toBeCloseTo(4.57, 2)
  })
})

describe('league scoring levels (E6-7)', () => {
  it('gives Spain, Italy and Germany their own level and every other league the base', () => {
    expect(leagueGoalFactor('england')).toBe(1)
    expect(leagueGoalFactor('france')).toBe(1)
    expect(leagueGoalFactor(undefined)).toBe(1)
    for (const id of ['spain', 'italy', 'germany']) expect(leagueGoalFactor(id)).toBe(LEAGUE_GOAL_FACTOR[id])
    // A pairing takes the mean of two leagues, one side's when only it has one (the user's side carries none)
    expect(pairingGoalFactor({ goalFactor: 1.2 }, { goalFactor: 1 })).toBeCloseTo(1.1)
    expect(pairingGoalFactor({}, { goalFactor: 1.22 })).toBe(1.22)
    expect(pairingGoalFactor({}, {})).toBe(1)
  })

  it('carries the factor on an AI side of those leagues only', () => {
    const all = loadTestUniverse(['england', 'spain'])
    const eng = buildAiClubs(all, 'england', 2018, '')
    const esp = buildAiClubs(all, 'spain', 2018, '')
    expect(aiTeamInput(all, Object.values(eng)[0]).goalFactor).toBeUndefined()
    expect(aiTeamInput(all, Object.values(esp)[0]).goalFactor).toBe(LEAGUE_GOAL_FACTOR.spain)
  })
})

/** One all-AI double round robin of a real league season, at summary detail, as a season's AI fixtures are played. */
function freshLeague(lu: ReturnType<typeof loadTestUniverse>, leagueId: string, season: number, seed: string) {
  const ai = buildAiClubs(lu, leagueId, season, '')
  const ids = Object.keys(ai)
  const offset = aiRatingOffset(lu, ai, 'calibrated')
  const rng = new Rng(seed)
  const fixtures = generateFixtures(ids, rng)
  const inputs = Object.fromEntries(ids.map((id) => [id, aiTeamInput(lu, ai[id], offset)]))
  let yellows = 0
  let reds = 0
  let keeperCards = 0
  let bookedAfterInjury = 0
  for (const f of fixtures) {
    const res = simulateMatch({ rng, home: inputs[f.homeTeamId], away: inputs[f.awayTeamId], detail: 'summary' })
    f.result = res
    const injuredAt = new Map(res.events.filter((e) => e.type === 'injury').map((e) => [e.playerId, e.minute]))
    for (const e of res.events) {
      if (e.type === 'yellow') yellows++
      if (e.type === 'red') reds++
      if ((e.type === 'yellow' || e.type === 'red') && lu.index[e.playerId ?? '']?.positions[0] === 'GK') keeperCards++
      if ((e.type === 'yellow' || e.type === 'red') && injuredAt.has(e.playerId) && e.minute > injuredAt.get(e.playerId)!) bookedAfterInjury++
    }
  }
  const table = computeTable(fixtures, ids)
  return { games: fixtures.length, goals: table.reduce((a, r) => a + r.goalsFor, 0), top: table[0], yellows, reds, keeperCards, bookedAfterInjury, maxSide: Math.max(...fixtures.map((f) => Math.max(f.result!.homeGoals, f.result!.awayGoals))) }
}

describe('fresh all-AI league seasons score like the real ones', { timeout: 600_000 }, () => {
  it('the Premier League: 2.5 to 2.9 goals a game, champions under 100 points, no side past 12, 3 to 4.2 yellows and 0.08 to 0.22 reds a match, keepers booked, never a card after the injury', () => {
    let games = 0
    let goals = 0
    let yellows = 0
    let reds = 0
    let keeperCards = 0
    for (const season of [2010, 2014, 2018, 2022, 2025]) {
      for (const rep of [0, 1]) {
        const r = freshLeague(u, 'england', season, `e6-fresh-${season}-${rep}`)
        games += r.games
        goals += r.goals
        yellows += r.yellows
        reds += r.reds
        keeperCards += r.keeperCards
        expect(r.top.points).toBeLessThan(100)
        expect(r.maxSide).toBeLessThanOrEqual(12)
        expect(r.bookedAfterInjury).toBe(0)
      }
    }
    expect(goals / games).toBeGreaterThan(2.5)
    expect(goals / games).toBeLessThan(2.9)
    expect(yellows / games).toBeGreaterThan(3)
    expect(yellows / games).toBeLessThan(4.2)
    expect(reds / games).toBeGreaterThan(0.08)
    expect(reds / games).toBeLessThan(0.22)
    expect(keeperCards).toBeGreaterThan(0)
  })

  it('La Liga, Serie A and the Bundesliga score within 0.3 of their real tables', () => {
    const all = loadTestUniverse(['england', 'spain', 'italy', 'germany'])
    for (const leagueId of ['spain', 'italy', 'germany']) {
      let games = 0
      let goals = 0
      let realGames = 0
      let realGoals = 0
      const have = Object.keys(all.tables[leagueId] ?? {}).map(Number).filter((y) => y >= 2008 && all.tables[leagueId][y].length).sort((a, b) => a - b)
      expect(have.length, leagueId).toBeGreaterThanOrEqual(3)
      for (const season of [have[0], have[Math.floor(have.length / 2)], have[have.length - 2]]) {
        const real = all.tables[leagueId][season]
        const r = freshLeague(all, leagueId, season, `e6-league-${leagueId}-${season}`)
        games += r.games
        goals += r.goals
        realGames += real.reduce((a, x) => a + x.won + x.drawn + x.lost, 0) / 2
        realGoals += real.reduce((a, x) => a + x.goalsFor, 0)
      }
      expect(Math.abs(goals / games - realGoals / realGames), leagueId).toBeLessThan(0.3)
    }
  })
})

describe('the reserve keeper (E6-5)', () => {
  it('is one fixed player-season per club-season, out of the index, found by his id', () => {
    const cs = u.clubSeasons.find((c) => c.leagueId === 'england' && c.season === 2018)!
    const r = reserveKeeper(u, cs.clubId, cs.season)!
    expect(r.id).toBe(reserveKeeperId(cs.clubId, cs.season))
    expect(isReserveKeeperId(r.id)).toBe(true)
    expect(u.index[r.id]).toBeUndefined()
    expect(reserveKeeperById(u, r.id)).toBe(r)
    expect(aiLookup(u)(r.id)).toBe(r)
    expect(r.positions).toEqual(['GK'])
    expect(r.playerId).not.toBe(reserveKeeper(u, u.clubSeasons.find((c) => c.clubId !== cs.clubId)!.clubId, cs.season)?.playerId)
    const overalls = cs.squad.map((p) => p.overall).sort((a, b) => a - b)
    expect(r.overall).toBeLessThanOrEqual(overalls[Math.ceil(overalls.length / 2)])
    expect(reserveKeeperById(u, 'reserve-gk-nobody@2018@nobody')).toBeUndefined()
    expect(isReserveKeeperId(cs.squad[0].id)).toBe(false)
  })

  it('takes the gloves when every keeper is out, and only then', () => {
    const cs = u.clubSeasons.find((c) => c.leagueId === 'england' && c.season === 2020)!
    const club = aiClubOf(u, cs)
    const before = aiTeamInput(u, club)
    const gk = before.lineup.GK ?? Object.values(before.lineup).find((id) => u.index[id]?.positions[0] === 'GK')!
    expect(isReserveKeeperId(gk)).toBe(false)
    for (const p of cs.squad) if (p.positions.includes('GK')) club.state[p.id] = { ...club.state[p.id], injury: { description: 'Knock', weeksOut: 2 } }
    const after = aiTeamInput(u, club)
    const inGoal = Object.values(after.lineup).filter((id) => after.getPlayer(id)?.positions[0] === 'GK')
    expect(inGoal).toHaveLength(1)
    expect(isReserveKeeperId(inGoal[0])).toBe(true)
    // He plays a whole match without a crash, and the match names him
    const opp = aiTeamInput(u, aiClubOf(u, u.clubSeasons.find((c) => c.leagueId === 'england' && c.season === 2020 && c.clubId !== cs.clubId)!))
    const res = simulateMatch({ rng: new Rng('e6-reserve'), home: after, away: opp, detail: 'full' })
    expect(res.homeStats.some((s) => s.playerSeasonId === inGoal[0])).toBe(true)
  })
})

describe("an AI side's state after a match (E6-3)", () => {
  it('moves fitness, cards and the season figures, never morale, familiarity or form', () => {
    const s = newSquadPlayer('x', { familiarity: 70, sharpness: 85 })
    const start = { morale: s.morale, familiarity: s.familiarity, recent: [...s.recentRatings] }
    applyMatchToAiState(s, { minutes: 90, goals: 2, assists: 1, rating: 9.1, yellow: true, red: false, injured: null }, 12, false, true, 'W')
    expect(s.morale).toBe(start.morale)
    expect(s.familiarity).toBe(start.familiarity)
    expect(s.recentRatings).toEqual(start.recent)
    expect(s.condition).toBeLessThan(100)
    expect(s.yellowCards).toBe(1)
    expect(s.seasonStats).toMatchObject({ apps: 1, goals: 2, assists: 1, motm: 1 })
  })

  it('keeps the live modifiers a winning side earns small: morale 2%, form 1.5%, familiarity at most 1.011', () => {
    const top = liveModifiers({ ...newSquadPlayer('x'), morale: 100, familiarity: 100, recentRatings: [9, 9, 9, 9, 9] })
    expect(top.morale).toBeCloseTo(1.02, 4)
    expect(top.form).toBeCloseTo(1.015, 4)
    expect(top.familiarity).toBeCloseTo(1.011, 4)
    const low = liveModifiers({ ...newSquadPlayer('x'), morale: 10, familiarity: 35, recentRatings: [5, 5, 5, 5, 5] })
    expect(low.form).toBeCloseTo(0.985, 4)
    // A new squad's handicap is as it was (the arena's and a first season's balance rest on it)
    expect(low.familiarity).toBeCloseTo(0.9745, 4)
    // An AI side's familiarity (70) is where it was
    expect(liveModifiers({ ...newSquadPlayer('x'), familiarity: 70 }).familiarity).toBeCloseTo(0.999, 4)
  })
})

describe('no human on both sides of an AI fixture (E6-2)', () => {
  it('a man listed at both clubs plays for the home side only', () => {
    const [a, b] = Object.values(buildAiClubs(u, 'england', 2019, '')) as [AiClub, AiClub]
    // Put one of the home side's starters into the away squad too, as a January move lists him
    const home = aiTeamInput(u, a)
    const shared = Object.values(home.lineup)[3]
    const away: AiClub = { ...b, squad: [...b.squad, shared], state: { ...b.state, [shared]: newSquadPlayer(shared) } }
    const sides = aiFixtureInputs(u, a, away)
    const ids = (t: typeof home) => new Set([...Object.values(t.lineup), ...t.bench].map((id) => t.getPlayer(id)?.playerId))
    expect(ids(sides.home).has(u.index[shared].playerId)).toBe(true)
    expect(ids(sides.away).has(u.index[shared].playerId)).toBe(false)
  })
})

describe('the money (item 2)', () => {
  it('pays the league money net of running costs: +20 for the title to −20 for last, +10 for the cup', () => {
    expect(prizeMoney(1, false)).toBe(20)
    expect(prizeMoney(20, false)).toBe(-20)
    expect(prizeMoney(1, true)).toBe(30)
    expect(prizeMoney(18, false, 18)).toBe(-20)
    expect(Math.abs(prizeMoney(10, false) + prizeMoney(11, false))).toBeLessThan(0.11)
    for (let p = 2; p <= 20; p++) expect(prizeMoney(p, false)).toBeLessThan(prizeMoney(p - 1, false))
    expect(CONTINENTAL_PRIZE.W).toBeGreaterThan(CONTINENTAL_PRIZE.F)
  })

  it('lets a losing season take the budget to nothing at worst, never into debt (only wages over the cap do)', () => {
    expect(afterSeasonMoney(50, 20)).toBe(70)
    expect(afterSeasonMoney(50, -20)).toBe(30)
    expect(afterSeasonMoney(8, -20)).toBe(0)
    expect(afterSeasonMoney(-5, -20)).toBe(-5)
    expect(afterSeasonMoney(-5, 12)).toBe(7)
  })

  it('drips a tenth of the wage headroom into the budget and drains the whole overspend', () => {
    const f = { budget: 50, wageCap: 3000, income: 0, spent: 0, wagesPaid: 0 }
    expect(weeklyCashFlow(f, 2000)).toBeCloseTo((1000 * HEADROOM_SHARE) / 1000)
    expect(weeklyCashFlow(f, 3500)).toBeCloseTo(-0.5)
  })
})
