import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { bidFor } from '../logic/marketOps'
import { bidYearChoices, defaultBidYears } from '../logic/bidTerms'
import type { Game } from '../types'

const u = loadTestUniverse()

function januaryGame(seed: string): Game {
  const g = createGame({ mode: 'dynasty', seed, formationId: '4-3-3', teamName: 'Bid XI', shortName: 'BID', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  while (g.season!.matchweek < 19) playMatchweek(g, u, true)
  g.finances.budget = 9999
  g.finances.wageCap = 999999
  return g
}

describe('the market screen offers the contract lengths a bid signs (r8 audit: the rule out of the screen)', () => {
  it('lists one season to four, two at most from 33', () => {
    expect(bidYearChoices(25)).toEqual([1, 2, 3, 4])
    expect(bidYearChoices(32)).toEqual([1, 2, 3, 4])
    expect(bidYearChoices(33)).toEqual([1, 2])
    for (let age = 16; age <= 40; age++) expect(bidYearChoices(age)).toContain(defaultBidYears(age))
  })

  it('a bid with no length signs him for exactly the default the screen shows, and a listed length is kept', () => {
    const g = januaryGame('r8-bid-terms')
    expect(g.window?.kind).toBe('january')
    let signed = 0
    for (const l of g.window!.listings.filter((x) => x.status === 'available').slice(0, 30)) {
      const p = u.index[l.playerSeasonId]
      const choices = bidYearChoices(p.age)
      const years = signed % 2 ? choices[choices.length - 1] : undefined
      const out = bidFor(g, u, l.playerSeasonId, l.asking * 2, years === undefined ? {} : { years })
      if (!out.accepted) continue
      expect(g.contracts[p.id].years).toBe(years ?? defaultBidYears(p.age))
      signed++
      if (Object.keys(g.squad).length >= 30) break
    }
    expect(signed).toBeGreaterThan(2)
  })
})
