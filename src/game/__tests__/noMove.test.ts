import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { breathe, loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { computeTable, USER_TEAM } from '@engine/season'
import { createGame, beginSeason, dailyGameSettings } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { closeJanuary, kickOff, toKickoff } from '../logic/quick'
import type { Game, GameSettings } from '../types'

/**
 * The "See your squad" batch (dressing room, happiness, medical, planner, personalities, league awards, inbox
 * actions) is views and bookkeeping only: it must not move a single seeded outcome. The Season hash was captured on
 * origin/main at 2bfa023, before the batch. The Quick Draft and Daily hashes were re-captured on origin/main at
 * 35e4ae7 (plain main and this batch merged onto it agree): #39 turned the Quick Draft manager on in `QUICK_RULES`
 * (a style boost on expected goals, section 12 "Managers") and added `quickResult.rounds`; the Daily's results did
 * not move, only that field. Every later build must reproduce them. A change that is meant to move them belongs with
 * an ENGINE_VERSION bump (CLAUDE.md invariant 2) or, like #39, a documented new default, and re-baselines this file.
 */

const u = loadTestUniverse(['england'])
const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex')

/** A squad state without the bookkeeping the batch adds (the happiness log), in a fixed key order. */
function coreState(g: Game): unknown {
  return Object.keys(g.squad)
    .sort()
    .map((id) => {
      const s = g.squad[id]
      return [id, s.condition, s.morale, s.sharpness, s.familiarity, s.recentRatings, s.recentMinutes ?? null, s.injury, s.suspension, s.yellowCards, s.seasonStats]
    })
}

function seasonSettings(seed: string): GameSettings {
  return { mode: 'season', seed, formationId: '4-3-3', teamName: 'Pin XI', shortName: 'PIN', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2022, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' }
}

function quickSettings(seed: string): GameSettings {
  return { mode: 'quick', seed, formationId: '4-4-2', teamName: 'Pin XI', shortName: 'PIN', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2023, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: false }
}

/** A seeded Season, auto-managed through all 38 matchweeks. */
function seasonPin(seed: string): string {
  const g = createGame(seasonSettings(seed))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  let guard = 0
  while (g.phase !== 'summary' && guard++ < 60) playMatchweek(g, u, true)
  expect(g.phase).toBe('summary')
  const table = computeTable(g.season!.fixtures, [USER_TEAM, ...Object.keys(g.season!.ai)])
  return hash([table, g.rngState, g.finances, coreState(g), g.tier, g.history])
}

/** A Quick Draft or a Daily, drafted by the assistant and played to the summary (January passed when it opens). */
function quickPin(s: GameSettings): string {
  const g = createGame(s)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, u)
  kickOff(g, u)
  if (g.phase === 'january') closeJanuary(g, u, null)
  expect(g.phase).toBe('summary')
  return hash([g.quickResult, g.rngState, g.tier])
}

// Re-baselined on ENGINE_VERSION '5' (the playtest fixes: fixtures, the assistant's placement, keeper subs, development)
// and on '6' (every match moved: the goal calibration, cards, the reserve keeper, the user's men out of their real clubs;
// the Season's finances follow the new economy and its squads the keeper limits), and again inside engine 6 for round 6
// item 6 (`assistantLineup`): the three Seasons open with the greedy's XI, but the assistant re-picks every matchweek
// with the squad's condition and some of those weeks now put a natural man where the greedy played a cover. The Quick
// Draft and the Daily field the draft's XI and hold. Re-baselined on '7': a cup tie the assistant plays settles on its
// week's stream (it rebuilt a stale one before), which moves these Seasons from their first drawn tie; the Quick Draft
// and the Daily hold. Re-baselined on '8': a simmed week with an event waiting starts its stream after the assistant
// answers it (`playMatchweekSteps`), which moves these Seasons from their first event; the Quick Draft and the Daily hold
// Re-baselined on '9': the assistant's lineups swap two men of the XI into their natural slots (P3), which moves these
// Seasons; the Quick Draft and the Daily hold (their quick seasons field the draft's XI and have no bench)
const SEASON_BASELINE = '257b89d73296a6570b8eea516bc38d1bca5081541da6ac2c776531af609d042c'
const QUICK_BASELINE = '4e07e3cec479ea921e46c0f8026e70fde73381812bf31118bb6bb6ed61dc5e6f'
const DAILY_BASELINE = '7a1c2fc4be66cb66acb142dd66c60def02c9df91e6c0f0b77746e301694b4c53'

describe('the See your squad batch moves no seeded outcome', () => {
  it('plays three seeded Seasons to the same table, stream, finances and squad states', () => {
    const pins = ['pin-season-1', 'pin-season-2', 'pin-season-3'].map(seasonPin)
    expect(hash(pins)).toBe(SEASON_BASELINE)
  }, 300_000)

  it('plays 30 seeded Quick Drafts to the same result', async () => {
    const pins: string[] = []
    for (let i = 0; i < 30; i++) {
      if (i % 5 === 0) await breathe()
      pins.push(quickPin(quickSettings(`pin-quick-${i}`)))
    }
    expect(hash(pins)).toBe(QUICK_BASELINE)
  }, 300_000)

  it('plays 60 Dailies to the same result', async () => {
    const seeds = Array.from({ length: 60 }, (_, i) => `daily-2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`)
    const pins: string[] = []
    for (const [i, seed] of seeds.entries()) {
      if (i % 5 === 0) await breathe()
      pins.push(quickPin(dailyGameSettings(u, seed, 'Pin XI')))
    }
    expect(hash(pins)).toBe(DAILY_BASELINE)
  }, 300_000)
})
