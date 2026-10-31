/**
 * QA round 11 (r14, docs/QA.md): Squad complete's odds after round 13 stepped the league's build
 * (`oddsLeagueSteps`, PERFORMANCE.md round 11). The hook builds the league a few pairings a slice, may drop a half-built
 * league when the tactics change, then samples the seasons in slices. Over setups the round 13 test did not cover
 * (another league, a bench, the Super League with and without its ease, a changed mentality) the odds read that way
 * must equal `preSeasonOdds` worked out in one go, and the game must never move. (Against the build before the
 * stepping, 30 seeded games gave byte-identical odds: QA.md round 11.)
 */
import { describe, expect, it } from 'vitest'
import { breathe, loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { createGame } from '../logic/setup'
import { toKickoff } from '../logic/quick'
import { emptyTally, ODDS_SEASONS, oddsFrom, oddsLeagueSteps, oddsRng, preSeasonOdds, sampleSeasons, type OddsLeague } from '../logic/odds'
import type { Game } from '../types'

const ALL = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']

function drafted(seed: string, leagues: string[], leagueId: string, extra: Record<string, unknown>, formationId: string): { g: Game; u: ReturnType<typeof loadTestUniverse> } {
  const u = loadTestUniverse(leagues)
  const host = u.clubSeasons.find((c) => c.leagueId === leagueId && c.season === 2024)!.clubId
  const g = createGame({ mode: 'quick', seed, formationId, teamName: 'R14 XI', shortName: 'R14', leagueId, wheelLeagues: leagues, hostClubId: host, leagueSeason: 2024, rules: { ...QUICK_RULES, leagues, ...extra }, jobSecurity: false, difficulty: 'calibrated' })
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, u)
  return { g, u }
}

/** As the hook reads them: the league a step at a time, then the seasons in uneven slices. */
function stepped(g: Game, u: ReturnType<typeof loadTestUniverse>, slices: number[]) {
  const steps = oddsLeagueSteps(g, u)
  let league: OddsLeague | null = null
  while (!league) {
    const r = steps.next()
    if (r.done) league = r.value
  }
  const rng = oddsRng(g)
  const tally = emptyTally(league.ids.length)
  for (let i = 0; tally.seasons < ODDS_SEASONS; i++) sampleSeasons(league, rng, Math.min(slices[i % slices.length], ODDS_SEASONS - tally.seasons), tally)
  return oddsFrom(tally)
}

describe('QA r14: Squad complete odds a step at a time', { timeout: 60_000 }, () => {
  it('equal the odds in one go over leagues, a bench, the Super League and a changed mentality', async () => {
    const setups: Array<[string, string[], string, Record<string, unknown>, string]> = [
      ['spain', ['spain'], 'spain', {}, '4-4-2'],
      ['bench', ['england'], 'england', { benchPicks: 3 }, '4-3-3'],
      ['super', ALL, 'england', { superLeague: true }, '4-2-3-1'],
      ['super-ease', ALL, 'england', { superLeague: true, superEase: true }, '4-3-3'],
      ['germany', ['germany'], 'germany', {}, '3-5-2'],
    ]
    let i = 0
    for (const [name, leagues, leagueId, extra, formationId] of setups) {
      const { g, u } = drafted(`r14-odds-${name}`, leagues, leagueId, extra, formationId)
      if (i++ % 2) g.tactics = { ...g.tactics, mentality: 'attacking' }
      const before = JSON.stringify(g)
      // A half-built league dropped (the tactics changed mid-build), then built again from the start
      const dropped = oddsLeagueSteps(g, u)
      for (let n = 0; n < 7; n++) dropped.next()
      const whole = preSeasonOdds(g, u)
      expect(stepped(g, u, [5, 1, 17, 250])).toEqual(whole)
      expect(stepped(g, u, [ODDS_SEASONS])).toEqual(whole)
      expect(whole.seasons).toBe(ODDS_SEASONS)
      expect(whole.finishes.reduce((a, b) => a + b, 0)).toBe(ODDS_SEASONS)
      expect(JSON.stringify(g)).toBe(before)
      await breathe()
    }
  })
})
