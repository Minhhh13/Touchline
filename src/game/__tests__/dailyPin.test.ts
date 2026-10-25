import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, isComplete, modesOf, respin, spin, type DraftRules } from '@engine/draft'
import { historyKey } from '@engine/challenge'
import type { LoadedUniverse } from '@engine/universe'
import { createGame, DAILY_FORMATIONS, DAILY_RULES, dailyGameSettings, dailySettings, describeRules } from '../logic/setup'
import { closeJanuary, kickOff, toKickoff } from '../logic/quick'
import type { GameSettings } from '../types'

const u = loadTestUniverse(['england'])

/**
 * The Daily's rules as they were before the 38-0 options (commit a7b3ee5): the quick defaults of the time, twists on,
 * the Premier League wheel. Written out literally so this test never follows a later change to the quick defaults.
 */
const PRE_38_0_DAILY_RULES: DraftRules = { squadSize: 11, respins: 2, minFit: 'accomplished', hardMode: false, uniqueClubSeasons: true, twists: true, leagues: ['england'] }

/** The pre-38-0 Daily mapping for a seed (the same digits, sorted seasons and clubs, times seven and times three). */
function pre38Mapping(universe: LoadedUniverse, seed: string) {
  const n = Number(seed.split('-').slice(1).join('')) || 0
  // Before classic seasons existed: the standard (EA-rated) English seasons only
  const complete = universe.clubSeasons.filter((cs) => cs.complete && cs.leagueId === 'england' && !cs.classic)
  const seasons = [...new Set(complete.map((cs) => cs.season))].sort()
  const season = seasons[n % seasons.length]
  const clubs = complete.filter((cs) => cs.season === season).map((cs) => cs.clubId).sort()
  return { season, host: clubs[(n * 7) % clubs.length], formationId: ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '4-4-2-diamond'][(n * 3) % 5] }
}

/** A Daily played as a person would: spin, use both re-spins, let the assistant finish, pass in January, play the season. */
function play(settings: GameSettings) {
  const g = createGame(settings)
  const rng = Rng.fromState(g.rngState)
  const d = g.draft!
  spin(u, d, rng)
  respin(u, d, rng)
  respin(u, d, rng)
  expect(() => respin(u, d, rng)).toThrow('No re-spins left')
  d.history.push({ ...d.current!, pickedId: null, slotId: null, skipped: true, ...(d.twist ? { twist: d.twist } : {}) })
  d.current = null
  d.twist = null
  autoDraft(u, d, rng)
  g.rngState = rng.getState()
  expect(isComplete(d)).toBe(true)
  toKickoff(g, u)
  kickOff(g, u, true)
  if (g.phase === 'january') closeJanuary(g, u, null)
  expect(g.phase).toBe('summary')
  return { key: historyKey(d.history), lineup: d.lineup, result: g.quickResult }
}

/** The spins each date's Daily lands on, as `historyKey` (ENGINE_VERSION '4'); re-baseline only with an engine bump. */
const PINNED_KEYS: Record<string, string> = { 'daily-2026-10-25': 'ez08n9yv8i', 'daily-2026-12-31': '259rqyo5r6p', 'daily-2027-03-07': '9y7ck5om5c', 'daily-2027-06-15': 'a1y6wvzob3' }

const DATES = ['daily-2026-10-25', 'daily-2026-12-31', 'daily-2027-03-07', 'daily-2027-06-15']

describe('the Daily is pinned to its original rules', () => {
  it('has 2 re-spins, twists on, season ratings, Squad First and no modes', () => {
    expect(DAILY_RULES).toMatchObject({ respins: 2, twists: true, ratings: 'season', draftMode: 'squad', showRatings: true, hardMode: false })
    expect(modesOf(DAILY_RULES)).toEqual([])
    expect(DAILY_FORMATIONS).toEqual(['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '4-4-2-diamond'])
    expect(describeRules(u, dailyGameSettings(u, 'daily-2026-10-25').rules)).toEqual(['2 re-spins', 'Ratings on', 'Squad First', 'Season ratings', 'All-time', 'Twists on'])
  })

  it('maps every date to the season, host and shape it had before the 38-0 options', () => {
    for (const seed of [...DATES, 'daily-2026-01-01', 'daily-2028-02-29']) {
      const d = dailySettings(u, seed)
      expect({ season: d.season, host: d.host, formationId: d.formationId }).toEqual(pre38Mapping(u, seed))
      expect(d.rules.respins).toBe(2)
    }
  })

  it('plays every date exactly as the pre-38-0 Daily: the same spins, the same XI, the same season', () => {
    const keys: Record<string, string> = {}
    for (const seed of DATES) {
      const today = dailyGameSettings(u, seed, 'Pinned XI')
      const before: GameSettings = { ...today, rules: PRE_38_0_DAILY_RULES }
      const a = play(today)
      const b = play(before)
      expect(a.key, seed).toBe(b.key)
      expect(a.lineup, seed).toEqual(b.lineup)
      expect(a.result, seed).toEqual(b.result)
      keys[seed] = a.key
    }
    // Pinned literally, so a change to the draft engine itself (not only to the rules) shows up here too
    expect(keys).toEqual(PINNED_KEYS)
  })
})
