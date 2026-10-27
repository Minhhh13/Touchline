import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { QUICK_RULES } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { ratingAt } from '@engine/positions'
import { createGame } from '../logic/setup'
import { runQuickSeason, toKickoff } from '../logic/quick'
import { preSeasonOdds } from '../logic/odds'
import type { Game } from '../types'

/**
 * Is 38-0 reachable? An elite XI (the best-rated player for each slot of a 4-3-3 across every standard Premier League
 * season in the pack (2008-09 on; the opt-in classic seasons are left out), one per human) plays the 2025-26 season again and again, one seed each, through the real engine. The
 * goal is meant to be rare but possible. PERFECT_SEEDS and PERFECT_OFFSET run a longer or another slice of seeds
 * (the release measured 2,000); the default is a quick sample.
 */
const u = loadTestUniverse(['england'])
const N = Number(process.env.PERFECT_SEEDS ?? 200)
const OFFSET = Number(process.env.PERFECT_OFFSET ?? 0)

function eliteLineup(): Record<string, string> {
  const used = new Set<string>()
  const lineup: Record<string, string> = {}
  for (const s of getFormation('4-3-3').slots) {
    const best = Object.values(u.index)
      // Standard seasons only (2008-09 on): the classic seasons' ratings are estimates and opt-in
      .filter((p) => !used.has(p.playerId) && !u.clubSeasonByKey[`${p.clubId}@${p.season}`]?.classic)
      .sort((a, b) => ratingAt(b, s.position) - ratingAt(a, s.position) || a.id.localeCompare(b.id))[0]
    used.add(best.playerId)
    lineup[s.id] = best.id
  }
  return lineup
}

function eliteGame(seed: string, lineup: Record<string, string>): Game {
  const g = createGame({ mode: 'quick', seed, formationId: '4-3-3', teamName: 'Elite XI', shortName: 'ELI', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'], managers: false }, jobSecurity: false, difficulty: 'calibrated', january: false })
  g.draft!.lineup = { ...lineup }
  toKickoff(g, u)
  return g
}

describe('the 38-0 chase is rare but reachable', { timeout: 1_800_000 }, () => {
  it('an elite XI goes 38-0 in a few seasons in a hundred, and unbeaten far more often', async () => {
    const lineup = eliteLineup()
    let perfect = 0
    let unbeaten = 0
    let champions = 0
    let wins = 0
    for (let i = OFFSET; i < OFFSET + N; i++) {
      // Yield to the event loop now and then: a minute of synchronous seasons starves the worker's RPC and Vitest
      // reports "Timeout calling onTaskUpdate" (exit 1) although every assertion passes. Results are unchanged.
      if ((i - OFFSET) % 20 === 0) await new Promise((r) => setTimeout(r, 0))
      const g = eliteGame(`elite-${i}`, lineup)
      runQuickSeason(g, u)
      const q = g.quickResult!
      wins += q.won
      if (q.won === 38) perfect++
      if (q.lost === 0) unbeaten++
      if (q.position === 1) champions++
    }
    const odds = preSeasonOdds(eliteGame('elite-odds', lineup), u)
    console.log(`P(38-0) elite XI: ${perfect}/${N} = ${((100 * perfect) / N).toFixed(2)}%; unbeaten ${unbeaten}/${N} = ${((100 * unbeaten) / N).toFixed(1)}%; champions ${champions}/${N}; mean wins ${(wins / N).toFixed(2)}; pundits' prediction: perfect ${(100 * odds.perfect).toFixed(2)}%, unbeaten ${(100 * odds.unbeaten).toFixed(1)}%`)
    expect(perfect).toBeGreaterThanOrEqual(1)
    expect(perfect / N).toBeLessThanOrEqual(0.06)
    expect(unbeaten).toBeGreaterThan(perfect)
    expect(unbeaten / N).toBeLessThan(0.6)
    expect(champions / N).toBeGreaterThan(0.9)
    expect(odds.perfect).toBeLessThanOrEqual(odds.unbeaten)
    expect(odds.unbeaten).toBeLessThanOrEqual(1)
  })
})
