import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { STATUSES } from '@engine/status'
import { playMatchweek } from '../logic/week'
import { agentMood, contractDemand, evaluateOffer, MAX_FAILED_OFFERS, openingOffer, proposeContract, REFUSAL_MORALE, setShopped, TALKS_CLOSED_WEEKS, type ContractOffer } from '../logic/contracts'
import { acceptOffer, AGENT_CUT, bidFor, releaseClauses, tickWindow } from '../logic/marketOps'
import { playerLookup, squadPlayers } from '../logic/players'
import { clone, seasonGame } from './seasonGame'

const u = loadTestUniverse(['england'])

describe('contract talks', () => {
  it('gives every player a fixed agent mood, about a third greedy and a quarter loyal', () => {
    const ids = [...new Set(Object.values(u.index).map((p) => p.playerId))].slice(0, 4000)
    const moods = ids.map(agentMood)
    expect(ids.map(agentMood)).toEqual(moods)
    const share = (m: string) => moods.filter((x) => x === m).length / moods.length
    expect(share('greedy')).toBeGreaterThan(0.25)
    expect(share('greedy')).toBeLessThan(0.35)
    expect(share('loyal')).toBeGreaterThan(0.2)
    expect(share('loyal')).toBeLessThan(0.3)
  })

  it('is monotone: raising the wage never turns an acceptance into a refusal', () => {
    let accepts = 0
    let refusals = 0
    for (const seed of ['talks-mono-1', 'talks-mono-2', 'talks-mono-3']) {
      const g = seasonGame(u, seed)
      for (const id of Object.keys(g.squad)) {
        for (const status of STATUSES) {
          const d = contractDemand(g, u, id, status)!
          for (const extra of [{ signingFee: 0, appearance: 0, goal: 0 }, { signingFee: 3, appearance: 10, goal: 20 }]) {
            let accepted = false
            for (let wage = Math.round(d.wage * 0.5); wage <= d.wage * 1.3; wage += Math.max(1, Math.round(d.wage / 40))) {
              const offer: ContractOffer = { wage, years: 2, status, ...extra }
              const v = evaluateOffer(g, u, id, offer)!
              if (accepted) expect(v.accepted).toBe(true)
              accepted = v.accepted
              if (v.accepted) accepts++
              else refusals++
            }
            // Paying the full ask with nothing excluded always lands him
            expect(evaluateOffer(g, u, id, { wage: d.wage, years: 2, status, ...extra })!.accepted).toBe(true)
          }
        }
      }
    }
    expect(accepts).toBeGreaterThan(100)
    expect(refusals).toBeGreaterThan(100)
  }, 60_000)

  it('values a signing fee and bonuses, honours a greedy agent\'s wage floor and a loyal one\'s excluded release clause', () => {
    const g = seasonGame(u, 'talks-terms')
    const ids = Object.keys(g.squad)
    for (const id of ids) {
      const d = contractDemand(g, u, id, 'rotation')!
      const low = { wage: Math.round(d.wage * 0.92), years: 2, status: 'rotation' as const, signingFee: 0, appearance: 0, goal: 0 }
      const plus = { ...low, signingFee: 4, appearance: 15 }
      expect(evaluateOffer(g, u, id, plus)!.score).toBeGreaterThan(evaluateOffer(g, u, id, low)!.score)
      if (d.mood === 'greedy') expect(evaluateOffer(g, u, id, { ...plus, wage: Math.round(d.wage * 0.8), signingFee: 50 })!.accepted).toBe(false)
      if (d.mood === 'loyal') expect(evaluateOffer(g, u, id, { ...low, wage: d.wage * 2, release: 100 })!.accepted).toBe(false)
    }
  })

  it('signs an agreed contract: years, status, clauses, wage and fee, and clears a declined renewal', () => {
    const g = seasonGame(u, 'talks-agree')
    const id = Object.keys(g.squad).find((x) => agentMood(playerLookup(g, u)(x)!.playerId) !== 'loyal')!
    g.contracts[id].declined = true
    const open = openingOffer(g, u, id)!
    const budget = g.finances.budget
    const out = proposeContract(g, u, id, { ...open, years: 3, signingFee: 1, release: 80, appearance: 5, goal: 10 })
    expect(out.accepted).toBe(true)
    const c = g.contracts[id]
    expect(c.years).toBe(3)
    expect(c.declined).toBeUndefined()
    expect(c.clauses).toEqual({ release: 80, appearance: 5, goal: 10 })
    expect(playerLookup(g, u)(id)!.wage).toBe(open.wage)
    expect(g.finances.budget).toBeCloseTo(budget - 1, 5)
  })

  it('annoys him with a bad offer and ends talks for four weeks after three', () => {
    const g = seasonGame(u, 'talks-refuse')
    const id = Object.keys(g.squad)[0]
    const bad = { ...openingOffer(g, u, id)!, wage: 1 }
    for (let i = 1; i <= MAX_FAILED_OFFERS; i++) {
      const before = g.squad[id].morale
      expect(proposeContract(g, u, id, bad).accepted).toBe(false)
      expect(g.squad[id].morale).toBe(Math.max(10, before + REFUSAL_MORALE))
    }
    const mw = g.season!.matchweek
    expect(g.negotiations![playerLookup(g, u)(id)!.playerId].closedUntil).toBe(mw + TALKS_CLOSED_WEEKS)
    // Closed: even a generous offer is not heard, and no more morale is lost
    const morale = g.squad[id].morale
    expect(proposeContract(g, u, id, { ...bad, wage: 9999 }).message).toContain('will not talk')
    expect(g.squad[id].morale).toBe(morale)
  })

  it('pays appearance and goal bonuses with the weekly wages, and they reconcile with wagesPaid over a season', () => {
    const plain = seasonGame(u, 'talks-bonus')
    const paid = clone(plain)
    const stars = squadPlayers(paid, u).sort((a, b) => b.p.overall - a.p.overall).slice(0, 5).map((x) => x.p.id)
    for (const id of stars) paid.contracts[id].clauses = { appearance: 8, goal: 25 }
    let guard = 0
    while (plain.phase !== 'summary' && guard++ < 60) playMatchweek(plain, u, true)
    guard = 0
    while (paid.phase !== 'summary' && guard++ < 60) playMatchweek(paid, u, true)
    // Bonuses touch only money: the season itself is identical
    expect(paid.rngState).toEqual(plain.rngState)
    const expected = stars.reduce((t, id) => t + (paid.squad[id] ? paid.squad[id].seasonStats.apps * 8 + paid.squad[id].seasonStats.goals * 25 : 0), 0) / 1000
    expect(expected).toBeGreaterThan(0.5)
    expect(paid.finances.bonusesPaid).toBeCloseTo(expected, 6)
    expect(paid.finances.wagesPaid - plain.finances.wagesPaid).toBeCloseTo(expected, 6)
    expect(plain.finances.bonusesPaid).toBeUndefined()
  }, 120_000)
})

describe('release clauses and the agent', () => {
  it('triggers a release clause only when one is set, and a cheap one often', () => {
    let triggered = 0
    let unset = 0
    for (let i = 0; i < 12; i++) {
      const base = seasonGame(u, `release-${i % 3}`, 0)
      // A January window on day zero for the test
      base.season!.matchweek = 19
      const star = squadPlayers(base, u).sort((a, b) => b.p.overall - a.p.overall)[i % 3].p
      const withClause = clone(base)
      withClause.contracts[star.id].clauses = { release: Math.max(1, Math.round(star.value * 0.4)) }
      for (const g of [base, withClause]) {
        g.window = { kind: 'january', day: 0, days: 7, listings: [], offers: [], log: [] }
        const rng = new Rng(`release-window-${i}`)
        for (let d = 0; d < 6; d++) {
          g.window.day = d
          releaseClauses(g, u, rng)
        }
      }
      if (!withClause.squad[star.id]) triggered++
      if (!base.squad[star.id]) unset++
    }
    expect(unset).toBe(0)
    expect(triggered).toBeGreaterThanOrEqual(6)
  }, 60_000)

  it('brings more offers for a player his agent is shopping, and the agent takes 5% of the fee', () => {
    let shoppedOffers = 0
    let plainOffers = 0
    for (let i = 0; i < 12; i++) {
      const g = seasonGame(u, `shop-${i}`, 18)
      playMatchweek(g, u, true)
      expect(g.window?.kind).toBe('january')
      const mid = squadPlayers(g, u).sort((a, b) => b.p.overall - a.p.overall)[8].p
      const shopped = clone(g)
      expect(setShopped(shopped, u, mid.id, true).ok).toBe(true)
      for (const x of [g, shopped]) {
        const rng = Rng.fromState(x.rngState)
        x.window!.days = 30
        for (let d = 0; d < 25; d++) tickWindow(x, u, rng)
      }
      plainOffers += g.window!.offers.filter((o) => o.playerSeasonId === mid.id).length
      shoppedOffers += shopped.window!.offers.filter((o) => o.playerSeasonId === mid.id).length
      const offer = shopped.window!.offers.findIndex((o) => o.playerSeasonId === mid.id && o.status === 'open')
      if (offer >= 0) {
        // The same sale without an agent: the difference is his cut
        const noAgent = clone(shopped)
        delete noAgent.contracts[mid.id].shopped
        const amount = shopped.window!.offers[offer].amount
        acceptOffer(shopped, u, offer)
        acceptOffer(noAgent, u, offer)
        expect(noAgent.finances.budget - shopped.finances.budget).toBeCloseTo(Math.round(amount * AGENT_CUT * 10) / 10, 5)
      }
    }
    expect(shoppedOffers).toBeGreaterThan(plainOffers * 1.5 + 2)
  }, 120_000)

  it('credits a sell-on share to the selling club when the player is sold on', () => {
    const g = seasonGame(u, 'sell-on', 18)
    playMatchweek(g, u, true)
    const listing = g.window!.listings.find((l) => l.status === 'available' && l.asking < g.finances.budget * 0.5 && u.index[l.playerSeasonId].age < 30)!
    const p = u.index[listing.playerSeasonId]
    const out = bidFor(g, u, listing.playerSeasonId, listing.asking, { sellOn: 0.2 })
    expect(out.accepted).toBe(true)
    expect(g.contracts[p.id].sellOn).toEqual({ pct: 0.2, clubId: p.clubId })
    g.window!.offers.push({ playerSeasonId: p.id, fromClubId: Object.keys(g.season!.ai)[0], amount: 30, day: 1, status: 'open' })
    const noClause = clone(g)
    delete noClause.contracts[p.id].sellOn
    acceptOffer(g, u, g.window!.offers.length - 1)
    acceptOffer(noClause, u, noClause.window!.offers.length - 1)
    expect(noClause.finances.budget - g.finances.budget).toBeCloseTo(6, 5)
    expect(g.window!.log.some((l) => l.includes('sell-on'))).toBe(true)
  }, 60_000)
})
