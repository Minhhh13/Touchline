import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { WAGE_MULT } from '@engine/status'
import { clubValuation, offerTerms, openingStatus, paymentPlan, proposeFee, termsDemand } from '../logic/transferTalks'
import { squadWages } from '../logic/squad'
import { officeTick } from '../logic/office'
import { seasonGame, seasonSettings } from './seasonGame'
import type { Game } from '../types'

/** Round 10: the fixes for what round 9 found and left open, each failing without its change. */
const u = loadTestUniverse(['england'])

/** A January window, room in the squad and a listing the budget covers. */
function january(seed: string, mode?: 'dynasty'): { g: Game; listingId: string } {
  const g = seasonGame(u, seed, 19, mode ? seasonSettings(seed, { mode }) : undefined)
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

/** Agree the club's price, then terms of half his wage a week and the rest as a signing-on fee over one season. */
function lowWageTerms(g: Game, listingId: string, instalments: 1 | 2 | 3 = 1): { wage: number; signingFee: number; status: ReturnType<typeof openingStatus>; fee: number } {
  const l = g.window!.listings.find((x) => x.playerSeasonId === listingId)!
  const fee = Math.round(clubValuation(g, l) * 1.3 * 10) / 10 + 0.1
  expect(proposeFee(g, u, listingId, { fee, sellOn: 0, instalments }).outcome).toBe('agreed')
  const status = openingStatus(g, u, listingId)
  const d = termsDemand(g, u, listingId, status)!
  const wage = Math.max(1, Math.round(d.wage * 0.5))
  const signingFee = Math.round((d.agentFee + ((d.wage - wage + 1) * 52) / 1000) * 10) / 10
  return { wage, signingFee, status, fee }
}

describe('r9-audit-new / R9-O2: the market checks the wage cap against the wage agreed in personal terms', () => {
  it('a low wage with a signing-on fee that fits the cap signs, where his wage at the status would not fit', () => {
    for (const seed of ['r10-wage-a', 'r10-wage-b', 'r10-wage-c']) {
      const { g, listingId } = january(seed)
      const p = u.index[listingId]
      const { wage, signingFee, status } = lowWageTerms(g, listingId)
      g.finances.wageCap = squadWages(g, u) + wage
      // The old check: his listed wage at the status breaks this cap
      expect(squadWages(g, u) + Math.round(p.wage * WAGE_MULT[status])).toBeGreaterThan(g.finances.wageCap)
      const out = offerTerms(g, u, listingId, { wage, years: 1, status, signingFee })
      expect(out.message).not.toMatch(/wage cap/)
      expect(out.signed).toBe(true)
      expect(g.squad[p.id]).toBeDefined()
      expect(squadWages(g, u)).toBeLessThanOrEqual(g.finances.wageCap)
    }
  })

  it('an agreed wage over the cap is still refused, before any bid', () => {
    const { g, listingId } = january('r10-wage-over')
    const { wage, signingFee, status } = lowWageTerms(g, listingId)
    g.finances.wageCap = squadWages(g, u) + wage - 1
    const out = offerTerms(g, u, listingId, { wage, years: 1, status, signingFee })
    expect(out.ok).toBe(false)
    expect(out.message).toMatch(/wage cap/)
  })
})

describe('r9-audit-new: a sacked manager\'s club pays the instalments it still owes', () => {
  for (const mode of [undefined, 'dynasty'] as const) {
    it(`${mode ?? 'season'}: what is owed is settled at the week of the sack`, () => {
      const { g, listingId } = january(`r10-sacked-${mode ?? 'season'}`, mode)
      g.finances.wageCap = 100000
      const { wage, signingFee, status, fee } = lowWageTerms(g, listingId, 3)
      expect(offerTerms(g, u, listingId, { wage, years: 1, status, signingFee }).signed).toBe(true)
      expect(g.office!.instalments).toHaveLength(1)
      const owed = paymentPlan({ fee, instalments: 3 }).later * 2
      const budget = g.finances.budget
      officeTick(g, u)
      expect(g.office!.instalments).toHaveLength(1)
      g.season!.sacked = true
      officeTick(g, u)
      expect(g.office!.instalments ?? []).toHaveLength(0)
      expect(g.finances.budget).toBeCloseTo(budget - owed, 1)
    })
  }
})
