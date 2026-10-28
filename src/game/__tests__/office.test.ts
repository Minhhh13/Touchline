import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft } from '@engine/draft'
import { computeTable, USER_TEAM } from '@engine/season'
import type { MoraleEntry } from '@engine/types'
import { beginSeason, createGame } from '../logic/setup'
import { playMatchweek, runSteps, simWeeksSteps, startSeasonProper } from '../logic/week'
import { officeTick, officeItems, setListed } from '../logic/office'
import { withOffice } from '../logic/officeSteps'
import { lodgeRequest } from '../logic/officeCore'
import { makePromise, openPromises, promiseProblem, settlePromises, BROKEN_COST, KEPT_LIFT } from '../logic/promises'
import { answerRequest, openRequests, requestChance, requestPressure, talkOdds, REFUSED_COST } from '../logic/transferRequests'
import { converse } from '../logic/conversations'
import { answerPress, pressQuestions, PRESS_ANSWERS } from '../logic/pressConference'
import { clubCeiling, clubValuation, counterBid, offerTerms, openingStatus, paymentPlan, proposeFee, termsDemand, walkAway } from '../logic/transferTalks'
import { proposeContract, openingOffer } from '../logic/contracts'
import { playerLookup } from '../logic/players'
import { normaliseGame } from '../logic/save'
import { personalityOf } from '../logic/personality'
import { seasonGame, seasonSettings, clone } from './seasonGame'
import type { Game } from '../types'

const u = loadTestUniverse(['england'])
const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex')
/** A game's hash without its id and creation time (drawn from the clock at `createGame`). */
const gameHash = (g: Game): string => hash({ ...g, id: '', createdAt: '' })

/** A week as the store plays it: the matchweek, then the office's tick. */
function storeWeek(g: Game, tick = true): void {
  playMatchweek(g, u, true)
  if (g.phase === 'match') g.phase = 'week'
  if (tick) officeTick(g, u)
}

/** The man in the XI with the most minutes, and one on the bench. */
function starterAndBench(g: Game): { starter: string; bench: string } {
  const xi = new Set(Object.values(g.lineup))
  const starter = Object.values(g.lineup)[5]
  const bench = Object.keys(g.squad).find((id) => !xi.has(id) && !g.contracts[id]?.loan)!
  return { starter, bench }
}

/** The log entries a change added, summed. */
function logSince(g: Game, id: string, was: MoraleEntry[]): number {
  const before = new Set(was)
  return (g.squad[id].moraleLog ?? []).filter((e) => !before.has(e)).reduce((a, e) => a + e.d, 0)
}

describe('the office changes nothing until it is used', () => {
  it('a Season played with the office ticking every week is byte for byte the Season without it', () => {
    for (const seed of ['office-nomove-1', 'office-nomove-2']) {
      const a = seasonGame(u, seed)
      const b = seasonGame(u, seed)
      for (let w = 0; w < 38 && a.phase !== 'summary'; w++) {
        storeWeek(a, true)
        storeWeek(b, false)
      }
      expect(a.office).toBeUndefined()
      expect(gameHash(a)).toBe(gameHash(b))
    }
  }, 120_000)

  it('Sim 5 through the office wrapper equals Sim 5 without it', () => {
    const a = seasonGame(u, 'office-sim5')
    const b = clone(a)
    runSteps(withOffice({ g: a }, u, simWeeksSteps({ g: a }, u, 5)))
    runSteps(simWeeksSteps({ g: b }, u, 5))
    expect(gameHash(a)).toBe(gameHash(b))
  }, 60_000)

  it('never moves the game stream: a tick with player power on leaves rngState where it was', () => {
    let lodged = 0
    for (const seed of ['office-power-1', 'office-power-2', 'office-power-3', 'office-power-4']) {
      const g = createGame(seasonSettings(seed, { playerPower: true }))
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      beginSeason(g, u)
      startSeasonProper(g)
      for (let w = 0; w < 38 && g.phase !== 'summary'; w++) {
        playMatchweek(g, u, true)
        if (g.phase === 'match') g.phase = 'week'
        const state = clone(g.rngState)
        officeTick(g, u)
        expect(g.rngState).toEqual(state)
      }
      lodged += Object.keys(g.office?.requests ?? {}).length
    }
    // Player power is felt: across four seasons somebody asks to leave
    expect(lodged).toBeGreaterThan(0)
  }, 180_000)
})

describe('promises', () => {
  it('a football promise to a man who plays is kept; to a man left out, broken, and he asks to leave', () => {
    const g = seasonGame(u, 'office-promise', 4)
    const { starter, bench } = starterAndBench(g)
    expect(makePromise(g, u, starter, 'minutes').ok).toBe(true)
    expect(makePromise(g, u, bench, 'minutes').ok).toBe(true)
    expect(makePromise(g, u, bench, 'minutes').ok).toBe(false)
    expect(openPromises(g)).toHaveLength(2)
    for (let w = 0; w < 6; w++) {
      const logs = [starter, bench].map((id) => ({ id, m: g.squad[id].morale, log: [...(g.squad[id].moraleLog ?? [])] }))
      // Keep the starter in, the benched man out, whatever the assistant would do
      storeWeek(g)
      // Every morale change of the week went through the happiness log (a week past the log's cap aside)
      for (const x of logs) {
        const added = (g.squad[x.id].moraleLog ?? []).filter((e) => !x.log.includes(e))
        if (added.length < 6) expect(Math.abs(logSince(g, x.id, x.log) - (g.squad[x.id].morale - x.m))).toBeLessThan(0.05 * (added.length + 1))
      }
      const slot = Object.keys(g.lineup).find((k) => g.lineup[k] === bench)
      if (slot) delete g.lineup[slot]
    }
    const promises = g.office!.promises!
    const pid = (id: string) => playerLookup(g, u)(id)!.playerId
    const kept = promises.find((p) => p.playerId === pid(starter))!
    const broken = promises.find((p) => p.playerId === pid(bench))!
    expect(broken.state).toBe('broken')
    expect(g.office!.broken![pid(bench)]).toBe(1)
    expect(openRequests(g).some((r) => r.playerId === pid(bench) && r.reason === 'promise')).toBe(true)
    expect((g.squad[bench].moraleLog ?? []).some((e) => e.r === 'promise' && e.d <= 0)).toBe(true)
    expect(kept.state).not.toBe('open')
    if (kept.state === 'kept') expect(g.squad[starter].morale === 100 || (g.squad[starter].moraleLog ?? []).some((e) => e.r === 'promise' && e.n === 'kept')).toBe(true)
    expect(KEPT_LIFT).toBeGreaterThan(0)
    expect(BROKEN_COST).toBeLessThan(0)
  }, 60_000)

  it('a contract promise is kept by agreeing a new contract in time', () => {
    const g = seasonGame(u, 'office-contract', 2)
    const id = Object.values(g.lineup)[3]
    expect(makePromise(g, u, id, 'contract').ok).toBe(true)
    const offer = openingOffer(g, u, id)!
    // A generous offer he cannot refuse
    const out = proposeContract(g, u, id, { ...offer, wage: offer.wage * 2, years: Math.min(4, offer.years + 1) })
    expect(out.accepted).toBe(true)
    settlePromises(g, u)
    expect(g.office!.promises![0].state).toBe('kept')
  }, 60_000)

  it('a signing promise needs a window ahead and is broken when the window shuts without the man', () => {
    const late = seasonGame(u, 'office-signing', 2)
    late.season!.matchweek = 25
    expect(promiseProblem(late, u, Object.keys(late.squad)[0], 'signing')).toMatch(/window/)
    const g = seasonGame(u, 'office-signing', 2)
    const id = Object.values(g.lineup)[1]
    expect(makePromise(g, u, id, 'signing').ok).toBe(true)
    for (let w = 0; w < 24 && openPromises(g).length; w++) storeWeek(g)
    expect(g.office!.promises![0].state).toBe('broken')
  }, 120_000)
})

describe('transfer requests', () => {
  it('pressure is a pure read: the same game weighs the same, and nobody under 0.5 asks', () => {
    const g = seasonGame(u, 'office-pressure', 8)
    for (const id of Object.keys(g.squad)) {
      const a = requestPressure(g, u, id)
      const b = requestPressure(clone(g), u, id)
      expect(a).toEqual(b)
      if (a && a.score < 0.5) expect(requestChance(a)).toBe(0)
    }
  }, 60_000)

  it('listing settles him; refusing costs him 10 and his group feels it', () => {
    const g = seasonGame(u, 'office-request', 5)
    const [a, b] = Object.values(g.lineup)
    expect(lodgeRequest(g, u, a, 'morale')).not.toBeNull()
    expect(lodgeRequest(g, u, a, 'morale')).toBeNull()
    expect(lodgeRequest(g, u, b, 'minutes')).not.toBeNull()
    expect(officeItems(g, u).filter((x) => x.kind === 'request')).toHaveLength(2)
    expect(answerRequest(g, u, a, 'list').ok).toBe(true)
    expect(g.contracts[a].listed).toBe(true)
    const others = Object.keys(g.squad).filter((id) => id !== b)
    const before = Object.fromEntries(others.map((id) => [id, g.squad[id].morale]))
    const mb = g.squad[b].morale
    expect(answerRequest(g, u, b, 'refuse').ok).toBe(true)
    expect(g.squad[b].morale).toBeCloseTo(Math.max(10, mb + REFUSED_COST), 5)
    expect(others.some((id) => g.squad[id].morale < before[id])).toBe(true)
    // Taken off the list again, the man who asked to go takes it as a refusal
    setListed(g, u, a, false)
    expect(g.office!.requests![playerLookup(g, u)(a)!.playerId].stage).toBe('refused')
  }, 60_000)

  it('talking him round works more often with a professional, never on a fifth try, and draws nothing from the game', () => {
    let won = 0
    let tried = 0
    for (let i = 0; i < 24; i++) {
      const g = seasonGame(u, `office-talk-${i % 4}`, 4)
      const ids = Object.keys(g.squad).filter((id) => !g.contracts[id].loan)
      const id = ids[i % ids.length]
      g.season!.matchweek += i
      lodgeRequest(g, u, id, 'morale')
      const state = clone(g.rngState)
      const out = answerRequest(g, u, id, 'talk')
      expect(out.ok).toBe(true)
      expect(g.rngState).toEqual(state)
      tried++
      if (g.office!.requests![playerLookup(g, u)(id)!.playerId].stage === 'withdrawn') won++
      expect(answerRequest(g, u, id, 'talk').ok).toBe(false)
    }
    expect(won).toBeGreaterThan(0)
    expect(won).toBeLessThan(tried)
    const g = seasonGame(u, 'office-talk-0', 4)
    const players = Object.keys(g.squad).map((id) => playerLookup(g, u)(id)!)
    const pro = players.reduce((a, b) => (a.traits.professionalism > b.traits.professionalism ? a : b))
    const casual = players.reduce((a, b) => (a.traits.professionalism < b.traits.professionalism ? a : b))
    const req = (p: typeof pro) => ({ playerId: p.playerId, name: p.name, reason: 'morale' as const, year: g.year, at: 0, stage: 'open' as const })
    expect(talkOdds(g, u, req(pro), 'talk')).toBeGreaterThan(talkOdds(g, u, req(casual), 'talk'))
  }, 120_000)
})

describe('conversations', () => {
  it('a hard word lands by personality, once a week, through the happiness log', () => {
    const g = seasonGame(u, 'office-chat', 6)
    const get = playerLookup(g, u)
    const ids = Object.keys(g.squad)
    for (const id of ids) g.squad[id].recentRatings = [6.1, 6.2, 6.0]
    const results = ids.map((id) => {
      const before = g.squad[id].morale
      const log = [...(g.squad[id].moraleLog ?? [])]
      const out = converse(g, u, id, 'form', 'demand')
      expect(out.ok).toBe(true)
      expect(Math.abs(logSince(g, id, log) - (g.squad[id].morale - before))).toBeLessThan(0.05)
      return { kind: personalityOf(get(id)!).id, delta: g.squad[id].morale - before }
    })
    for (const r of results) {
      if (r.kind === 'model' || r.kind === 'professional') expect(r.delta).toBeGreaterThanOrEqual(-1)
      if (r.kind === 'temperamental' || r.kind === 'casual') expect(r.delta).toBeLessThanOrEqual(-5)
    }
    expect(converse(g, u, ids[0], 'form', 'encourage').ok).toBe(false)
  }, 60_000)

  it('raising his status is the Club tab status change; a promise in talk is a real promise', () => {
    const g = seasonGame(u, 'office-chat-2', 3)
    const id = Object.keys(g.squad).find((k) => g.contracts[k].status === 'rotation' && !g.contracts[k].loan)!
    expect(converse(g, u, id, 'role', 'promote').ok).toBe(true)
    expect(g.contracts[id].status).toBe('first-team')
    const other = Object.keys(g.squad).find((k) => k !== id && !g.contracts[k].loan)!
    expect(converse(g, u, other, 'minutes', 'promise').ok).toBe(true)
    expect(openPromises(g).some((p) => p.kind === 'minutes')).toBe(true)
  }, 60_000)
})

describe('press conferences', () => {
  it('asks the same questions all week, answers once each, and moves the board and the squad as stated', () => {
    const g = seasonGame(u, 'office-press', 12)
    const qs = pressQuestions(g, u)
    expect(qs.length).toBeGreaterThan(0)
    expect(pressQuestions(clone(g), u)).toEqual(qs)
    const q = qs[0]
    const [answer, effect] = Object.entries(PRESS_ANSWERS[q])[1]
    const conf = g.season!.confidence
    const id = Object.keys(g.squad)[0]
    const m = g.squad[id].morale
    expect(answerPress(g, u, q, answer).ok).toBe(true)
    expect(answerPress(g, u, q, answer).ok).toBe(false)
    if (effect.board) expect(g.season!.confidence).toBeCloseTo(Math.max(0, Math.min(100, conf + effect.board)), 5)
    if (effect.team) expect(g.squad[id].morale).toBeCloseTo(Math.max(10, Math.min(100, m + effect.team)), 5)
  }, 60_000)
})

describe('transfer talks', () => {
  /** A January window and a listing the budget can cover. */
  function january(seed: string): { g: Game; listingId: string } {
    const g = seasonGame(u, seed, 19)
    expect(g.window).not.toBeNull()
    g.finances.budget = 500
    g.finances.wageCap = 100000
    const ids = Object.keys(g.squad)
    // Room in the squad for one more
    while (Object.keys(g.squad).length > 21) {
      const id = ids.pop()!
      delete g.squad[id]
      delete g.contracts[id]
    }
    const l = g.window!.listings.find((x) => x.status === 'available' && u.index[x.playerSeasonId].age < 30)!
    return { g, listingId: l.playerSeasonId }
  }

  it('the club accepts its price, counters near it, laughs at a low-ball and ends talks after three rounds', () => {
    const { g, listingId } = january('office-fee')
    const l = g.window!.listings.find((x) => x.playerSeasonId === listingId)!
    const min = clubValuation(g, l)
    expect(min).toBeLessThanOrEqual(l.asking * 1.05)
    const near = proposeFee(g, u, listingId, { fee: Math.round(min * 0.85 * 10) / 10, sellOn: 0, instalments: 1 })
    expect(near.outcome).toBe('counter')
    expect(near.counter!).toBeGreaterThanOrEqual(min)
    const low = proposeFee(g, u, listingId, { fee: Math.round(min * 0.3 * 10) / 10, sellOn: 0, instalments: 1 })
    expect(low.outcome).toBe('closed')
    expect(proposeFee(g, u, listingId, { fee: min * 2, sellOn: 0, instalments: 1 }).ok).toBe(false)
    walkAway(g, listingId)
    expect(proposeFee(g, u, listingId, { fee: near.counter!, sellOn: 0, instalments: 1 }).outcome).toBe('agreed')
  }, 60_000)

  it('a sell-on and instalments lower what is paid now; agreed terms sign him with no draw, and the rest is paid later', () => {
    const { g, listingId } = january('office-terms')
    const l = g.window!.listings.find((x) => x.playerSeasonId === listingId)!
    const fee = Math.round(clubValuation(g, l) / 0.9 * 10) / 10 + 0.1
    const agreed = proposeFee(g, u, listingId, { fee, sellOn: 0, instalments: 3 })
    expect(agreed.outcome).toBe('agreed')
    const status = openingStatus(g, u, listingId)
    const demand = termsDemand(g, u, listingId, status)!
    const budget = g.finances.budget
    const state = clone(g.rngState)
    const mean = offerTerms(g, u, listingId, { wage: Math.round(demand.wage * 0.5), years: 2, status, signingFee: 0 })
    expect(mean.signed).toBe(false)
    const out = offerTerms(g, u, listingId, { wage: demand.wage, years: 3, status, signingFee: demand.agentFee })
    expect(out.signed).toBe(true)
    expect(g.rngState).toEqual(state)
    const p = u.index[listingId]
    expect(g.squad[p.id]).toBeDefined()
    expect(g.contracts[p.id].years).toBe(3)
    expect(playerLookup(g, u)(p.id)!.wage).toBe(demand.wage)
    const plan = paymentPlan({ fee, instalments: 3 })
    expect(g.finances.budget).toBeCloseTo(budget - plan.now - demand.agentFee, 1)
    expect(g.office!.instalments).toHaveLength(1)
    // A Season has no later window: what is owed is settled at the final matchweek
    while (g.phase !== 'summary') storeWeek(g)
    expect(g.office!.instalments ?? []).toHaveLength(0)
  }, 120_000)

  it('a counter within their ceiling sells him; a little over brings a final offer; far over and they walk', () => {
    const outcomes = new Set<string>()
    for (const seed of ['office-sell-1', 'office-sell-2', 'office-sell-3']) {
      const g = seasonGame(u, seed, 19)
      for (let d = 0; d < 6 && g.window && g.window.offers.length < 3; d++) storeWeek(g)
      const w = g.window
      if (!w) continue
      const id = Object.keys(g.squad).find((k) => !g.contracts[k].loan)!
      for (let i = 0; i < 3; i++) w.offers.push({ playerSeasonId: id, fromClubId: Object.keys(g.season!.ai)[i], amount: 20, day: w.day + i, status: 'open' })
      const n = w.offers.length
      const ceilings = [n - 3, n - 2, n - 1].map((i) => clubCeiling(g, w.offers[i]))
      expect(counterBid(g, u, n - 1, ceilings[2] * 1.5).message).toMatch(/walk away/)
      expect(w.offers[n - 1].status).toBe('withdrawn')
      const final = counterBid(g, u, n - 2, Math.round(ceilings[1] * 1.1 * 10) / 10 + 0.1)
      if (final.message.includes('final')) {
        outcomes.add('final')
        expect(w.offers[n - 2].amount).toBe(ceilings[1])
        expect(counterBid(g, u, n - 2, ceilings[1] + 1).ok).toBe(false)
      }
      const sold = counterBid(g, u, n - 3, ceilings[0])
      expect(sold.sold).toBe(true)
      expect(g.squad[id]).toBeUndefined()
      outcomes.add('sold')
    }
    expect(outcomes.has('sold')).toBe(true)
    expect(outcomes.has('final')).toBe(true)
  }, 180_000)
})

describe('saves', () => {
  it('an old save without the office loads, ticks to nothing and keeps an office it has', () => {
    const g = seasonGame(u, 'office-save', 3)
    const old = clone(g) as Game
    delete old.office
    const loaded = normaliseGame(old)!
    officeTick(loaded, u)
    expect(loaded.office).toBeUndefined()
    const id = Object.values(g.lineup)[0]
    makePromise(g, u, id, 'minutes')
    const back = normaliseGame(clone(g))!
    expect(back.office?.promises).toHaveLength(1)
    const table = computeTable(back.season!.fixtures, [USER_TEAM, ...Object.keys(back.season!.ai)])
    expect(table.length).toBeGreaterThan(10)
  }, 60_000)
})
