/**
 * Pins: the season loop of a fixed seed, played by the assistant from the
 * draft to the summary, frozen as literals. This freezes week.ts (league,
 * cup, shoot-outs, events, market days) so a new mode that touches it by
 * accident fails here.
 *
 * New modes draw from their own place in the stream and must leave this green
 * unchanged. Re-baseline it only in the commit that deliberately moves the
 * stream: an `ENGINE_VERSION` bump (with its line in docs/GAME_DESIGN.md
 * section 15) or a data rebuild (a new `generatedAt`), such as a later
 * fm-depth retune or the 1992-93 packs. Recompute the literals on that branch;
 * never copy them. Baselined on ENGINE_VERSION '4' with the 2026-10-25 packs; re-baselined when main (d4d9b2f) merged
 * into the casual modes, from a run on origin/main itself: main's own changes since 3e9a594 (the audit sweep,
 * the match-day work) moved this season, and main's `noMove.test.ts` season hash holds unchanged. Re-baselined on
 * ENGINE_VERSION '5' (the playtest fixes: fixtures, the assistant's placement, keeper subs, development).
 */
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { computeTable, USER_TEAM } from '@engine/season'
import { beginSeason, createGame } from '../logic/setup'
import { playMatchweek } from '../logic/week'

describe('pins', () => {
  it('pins the assistant-managed season loop', () => {
    const u = loadTestUniverse()
    // The settings of flow.test.ts
    const g = createGame({ mode: 'season', seed: 'flow-test', formationId: '4-3-3', teamName: 'Test XI', shortName: 'TST', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    let weeks = 0
    while (g.phase !== 'summary' && weeks < 60) {
      playMatchweek(g, u, true)
      weeks++
    }
    expect(g.phase).toBe('summary')
    expect(weeks).toBe(38)
    const s = g.season!
    const table = computeTable(s.fixtures, [USER_TEAM, ...Object.keys(s.ai)])
    expect(table.slice(0, 3).map((r) => `${r.teamId}:${r.points}`)).toEqual(['user:94', 'manchester-united:89', 'manchester-city:87'])
    expect(s.cup.find((t) => t.round === 'F')?.winnerId).toBe('arsenal')
    expect(g.rngState).toEqual({ a: -519650793, b: -663731353, c: -1408666288, d: 1976968796 })
    // A whole season: allow for a loaded machine rather than the 5 s default
  }, 30_000)
})
