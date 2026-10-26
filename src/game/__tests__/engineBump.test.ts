import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { decodeChallenge, encodeChallenge } from '@engine/challenge'
import { Rng } from '@engine/rng'
import { ENGINE_VERSION } from '@engine/version'
import { challengeFromGame, replayChallenge } from '../logic/challenge'
import { quickHighlights } from '../logic/highlights'
import { closeJanuary, kickOff, toKickoff } from '../logic/quick'
import { normaliseGame } from '../logic/save'
import { createGame } from '../logic/setup'
import { playMatchweek } from '../logic/week'
import type { Game, GameSettings } from '../types'
import { seasonGame } from './seasonGame'

/**
 * What an ENGINE_VERSION bump (here '4' to '5') does to what a player already has: a link made on the old engine opens
 * as unverified with its draft shown, a save carries on, and a quick season whose stored games the new engine would
 * play differently shows no highlight reel rather than a wrong one. Nothing throws.
 */
const u = loadTestUniverse(['england'])
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T

function quickPlayed(seed: string): Game {
  const s: GameSettings = { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Bump XI', shortName: 'BMP', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: false }
  const g = createGame(s)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, u)
  kickOff(g, u, true)
  if (g.phase === 'january') closeJanuary(g, u, null)
  return g
}

describe('after the engine bump', () => {
  it('runs on engine 5', () => {
    expect(ENGINE_VERSION).toBe('5')
  })

  it('opens a challenge link made on engine 4 as unverified, with its draft resolved', () => {
    const g = quickPlayed('bump-link')
    const c = challengeFromGame(g, u, 'Minh')!
    const old = decodeChallenge(encodeChallenge({ ...c, engine: '4' }))
    const out = replayChallenge(u, old)
    expect(out.verified).toBe('unverified')
    expect(out.reason).toBe('built with engine 4, this build is 5')
    expect(out.picks.length).toBeGreaterThan(0)
    // The same link on this engine verifies
    expect(replayChallenge(u, decodeChallenge(encodeChallenge(c))).verified).toBe('yes')
  })

  it('a quick season whose stored games this engine plays differently shows no reel, and never throws', () => {
    const g = quickPlayed('bump-reel')
    expect(quickHighlights(g, u, 1)).not.toBeNull()
    // As an engine 4 save looks to engine 5: the stored games are not the ones the replay produces
    const stale = clone(g)
    const results = stale.quickResult!.results!
    for (const r of results) r.home = !r.home
    for (const r of results) expect(quickHighlights(stale, u, r.matchweek)).toBeNull()
  })

  it('a Season saved mid-season plays on to the end through the save path', () => {
    const g = seasonGame(u, 'bump-season', 12)
    const back = normaliseGame(clone(g))!
    for (let i = 0; i < 40 && back.phase !== 'summary'; i++) {
      playMatchweek(back, u, true)
      if (back.phase === 'match') back.phase = 'week'
    }
    expect(back.phase).toBe('summary')
    expect(back.season!.fixtures.every((f) => !!f.result)).toBe(true)
  })
})
