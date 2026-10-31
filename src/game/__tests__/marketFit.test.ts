/** r8 Season play: the window's listings measured against the budget, the wage room and the squad. Display only. */
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { openWindow } from '@engine/market'
import { beginSeason, createGame } from '../logic/setup'
import { startSeasonProper } from '../logic/week'
import { playerLookup, squadPlayers } from '../logic/players'
import { wageRoom } from '../logic/board'
import { maskedView } from '../logic/scouting'
import { listingFit, sortListings } from '../logic/marketFit'
import type { Game } from '../types'

const u = loadTestUniverse()

function withWindow(seed: string, hide = false): Game {
  const g = createGame({ mode: 'season', seed, formationId: '4-3-3', teamName: 'Fit XI', shortName: 'FIT', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2023, rules: { ...SEASON_RULES, leagues: ['england'], squadSize: 20, ...(hide ? { showRatings: false } : {}) }, jobSecurity: false, difficulty: 'calibrated' })
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g, u)
  g.window = openWindow({ u, rng: new Rng(`${seed}-window`), ownedPlayerIds: new Set(squadPlayers(g, u).map((x) => x.p.playerId)), leagueSeason: 2023, priceLevel: 1, leagues: ['england'] }, 'january')
  return g
}

describe('the market fit', () => {
  it('says what the club can pay and what each man would be at his position', () => {
    let upgrades = 0
    for (let i = 0; i < 6; i++) {
      const g = withWindow(`fit-${i}`)
      const get = playerLookup(g, u)
      const state = JSON.stringify(g)
      for (const l of g.window!.listings) {
        const fit = listingFit(g, u, l)!
        const p = get(l.playerSeasonId)!
        expect(fit.fee).toBe(l.asking <= g.finances.budget)
        expect(fit.wages).toBe(p.wage <= wageRoom(g, u))
        expect(fit.position).toBe(p.positions[0])
        const view = maskedView(g, u, p)
        const shown = view.exact ? p.overall : Math.round((view.overall.lo + view.overall.hi) / 2)
        expect(fit.estimate).toBe(!view.exact)
        const mates = squadPlayers(g, u).filter((x) => x.p.positions[0] === fit.position).map((x) => x.p.overall)
        if (mates.length) expect(fit.upgrade).toBe(shown - Math.max(...mates))
        expect(fit.rank).toBe(mates.filter((o) => o >= shown).length + 1)
        if ((fit.upgrade ?? 0) > 0) {
          upgrades++
          expect(fit.rank).toBe(1)
        }
      }
      // Reading draws nothing and changes nothing
      expect(JSON.stringify(g)).toBe(state)
    }
    expect(upgrades).toBeGreaterThan(0)
  })

  it('filters to the affordable and orders by upgrade, ties in the market order', () => {
    const g = withWindow('fit-sort')
    const list = g.window!.listings
    g.finances.budget = [...list].map((l) => l.asking).sort((a, b) => a - b)[Math.floor(list.length / 2)]
    const cheap = sortListings(g, u, list, { affordable: true })
    expect(cheap.length).toBeGreaterThan(0)
    expect(cheap.length).toBeLessThan(list.length)
    for (const l of cheap) expect(listingFit(g, u, l)).toMatchObject({ fee: true, wages: true })
    const byUp = sortListings(g, u, list, { sort: 'upgrade' })
    expect(new Set(byUp)).toEqual(new Set(list))
    const ups = byUp.map((l) => listingFit(g, u, l)!.upgrade ?? -Infinity)
    for (let i = 1; i < ups.length; i++) expect(ups[i]).toBeLessThanOrEqual(ups[i - 1])
    expect(sortListings(g, u, list)).toEqual(list)
  })

  it('shows no comparison while blind mode hides the market', () => {
    const g = withWindow('fit-blind', true)
    for (const l of g.window!.listings) expect(listingFit(g, u, l)).toMatchObject({ upgrade: null, rank: null })
  })
})
