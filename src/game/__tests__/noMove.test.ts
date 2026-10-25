import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { computeTable, USER_TEAM } from '@engine/season'
import { createGame, beginSeason, dailyGameSettings } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { closeJanuary, kickOff, toKickoff } from '../logic/quick'
import type { Game, GameSettings } from '../types'

/**
 * The "See your squad" batch (dressing room, happiness, medical, planner, personalities, league awards, inbox
 * actions) is views and bookkeeping only: it must not move a single seeded outcome. These hashes were captured on
 * origin/main at 2bfa023, before the batch, and every later build must reproduce them. A change that is meant to
 * move them belongs with an ENGINE_VERSION bump (CLAUDE.md invariant 2), which re-baselines this file.
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

const SEASON_BASELINE = 'dbe2f750e506032cd097088e9014c4833d3321040e9bc488d5e918b6d4291970'
const QUICK_BASELINE = '6fe7747e5294eb31e31c4da3f92dd8a052bc9bcc61af995387c220b2ce1f3e73'
const DAILY_BASELINE = '1f08c186a95019b00f8a9003347bbacc9e22d8aabb5a9bf910792ed6e3b1fab5'

describe('the See your squad batch moves no seeded outcome', () => {
  it('plays three seeded Seasons to the same table, stream, finances and squad states', () => {
    const pins = ['pin-season-1', 'pin-season-2', 'pin-season-3'].map(seasonPin)
    expect(hash(pins)).toBe(SEASON_BASELINE)
  }, 300_000)

  it('plays 30 seeded Quick Drafts to the same result', () => {
    const pins = Array.from({ length: 30 }, (_, i) => quickPin(quickSettings(`pin-quick-${i}`)))
    expect(hash(pins)).toBe(QUICK_BASELINE)
  }, 300_000)

  it('plays 60 Dailies to the same result', () => {
    const seeds = Array.from({ length: 60 }, (_, i) => `daily-2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`)
    const pins = seeds.map((seed) => quickPin(dailyGameSettings(u, seed, 'Pin XI')))
    expect(hash(pins)).toBe(DAILY_BASELINE)
  }, 300_000)
})
