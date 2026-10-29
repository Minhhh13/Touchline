import { afterEach, describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { WAGE_MULT } from '@engine/status'
import { USER_TEAM, type ContinentalState } from '@engine/season'
import { groupTable } from '@engine/continental'
import { seasonGroupRead } from '../logic/feats'
import { makePromise, settlePromises } from '../logic/promises'
import { proposeContract, openingOffer } from '../logic/contracts'
import { clubValuation, offerTerms, openingStatus, proposeFee, termsDemand } from '../logic/transferTalks'
import { squadWages } from '../logic/squad'
import { seasonGame } from './seasonGame'
import type { Game } from '../types'

/** QA round 4 (r9): the fixes, each failing without its change. */
const u = loadTestUniverse(['england'])

describe('R9-1: a contract promise is kept by a new contract, and only by one signed after it', () => {
  it('a man renewed before the promise does not count it kept at once', () => {
    const g = seasonGame(u, 'r9-1-renewed', 2)
    const id = Object.values(g.lineup)[4]
    g.contracts[id].renewed = true
    const out = makePromise(g, u, id, 'contract')
    // Either refused (he has his new deal) or left running: never a free "kept"
    if (out.ok) {
      settlePromises(g, u)
      expect(g.office!.promises![0].state).toBe('open')
    } else expect(out.message).toMatch(/new contract/)
  })

  it('a new contract shorter than the old one keeps the promise', () => {
    const g = seasonGame(u, 'r9-1-shorter', 2)
    const id = Object.values(g.lineup)[3]
    g.contracts[id].years = 4
    expect(makePromise(g, u, id, 'contract').ok).toBe(true)
    const offer = openingOffer(g, u, id)!
    const out = proposeContract(g, u, id, { ...offer, wage: offer.wage * 2, years: 2 })
    expect(out.accepted).toBe(true)
    expect(g.contracts[id].years).toBe(2)
    settlePromises(g, u)
    expect(g.office!.promises![0].state).toBe('kept')
  })
})

describe('R9-2: personal terms the market refuses leave the listing as it was', () => {
  function january(seed: string): { g: Game; listingId: string } {
    const g = seasonGame(u, seed, 19)
    g.finances.budget = 500
    const ids = Object.keys(g.squad)
    while (Object.keys(g.squad).length > 21) {
      const id = ids.pop()!
      delete g.squad[id]
      delete g.contracts[id]
    }
    const l = g.window!.listings.find((x) => x.status === 'available' && u.index[x.playerSeasonId].age < 30 && u.index[x.playerSeasonId].wage > 20)!
    return { g, listingId: l.playerSeasonId }
  }

  it('a low wage with a big signing-on fee under a tight wage cap: refused or signed, the asking price never moves', () => {
    const { g, listingId } = january('r9-2-terms')
    const l = g.window!.listings.find((x) => x.playerSeasonId === listingId)!
    const asking = l.asking
    const fee = Math.round(clubValuation(g, l) * 1.02 * 10) / 10 + 0.1
    expect(proposeFee(g, u, listingId, { fee, sellOn: 0, instalments: 1 }).outcome).toBe('agreed')
    const status = openingStatus(g, u, listingId)
    const d = termsDemand(g, u, listingId, status)!
    const p = u.index[listingId]
    // Half his ask a week, the rest as a signing-on fee over one season; the cap fits the agreed wage only
    const wage = Math.max(1, Math.round(d.wage * 0.5))
    const signingFee = Math.round((d.agentFee + ((d.wage - wage + 1) * 52) / 1000) * 10) / 10
    g.finances.wageCap = squadWages(g, u) + wage
    expect(squadWages(g, u) + Math.round(p.wage * WAGE_MULT[status])).toBeGreaterThan(g.finances.wageCap)
    const out = offerTerms(g, u, listingId, { wage, years: 1, status, signingFee })
    const after = g.window!.listings.find((x) => x.playerSeasonId === listingId)!
    if (out.signed) expect(g.squad[listingId]).toBeDefined()
    else {
      expect(after.asking).toBe(asking)
      expect(after.status).toBe(l.status)
    }
  })
})

describe('R9-3: the office and the feats break ties in English on every device', () => {
  const original = String.prototype.localeCompare
  function asDeviceIn(locale: string): void {
    String.prototype.localeCompare = function (this: string, that: string, locales?: string | string[], options?: Intl.CollatorOptions) {
      return original.call(this, that, locales ?? locale, options)
    } as typeof String.prototype.localeCompare
  }
  afterEach(() => {
    String.prototype.localeCompare = original
  })

  it('a group level on everything is topped by the side the engine puts first, on a Lithuanian device too', () => {
    const teams = [USER_TEAM, 'yeti', 'zebra', 'xenon']
    const matches = [] as Array<{ matchday: number; matchweek: number; homeTeamId: string; awayTeamId: string; result: { homeGoals: number; awayGoals: number } }>
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j) matches.push({ matchday: matches.length + 1, matchweek: 1, homeTeamId: teams[i], awayTeamId: teams[j], result: { homeGoals: 1, awayGoals: 1 } })
    const cont = { groups: [{ name: 'A', teams, matches }] } as unknown as ContinentalState
    const engineFirst = groupTable(cont.groups![0]).map((r) => r.teamId)[0]
    expect(seasonGroupRead(cont)?.topped).toBe(engineFirst === USER_TEAM)
    asDeviceIn('lt')
    expect('yeti'.localeCompare('user')).toBeLessThan(0)
    expect(seasonGroupRead(cont)?.topped).toBe(engineFirst === USER_TEAM)
  })
})
