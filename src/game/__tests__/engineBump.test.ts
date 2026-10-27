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
import { advanceToNextSeason } from '../logic/dynasty'
import { advanceLiveMatch, completeLiveMatch, playMatchweek } from '../logic/week'
import type { Game, GameSettings } from '../types'
import { seasonGame } from './seasonGame'

/**
 * What an ENGINE_VERSION bump (here '5' to '6', as '4' to '5' before it) does to what a player already has: a link made on the old engine opens
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
  it('runs on engine 7', () => {
    expect(ENGINE_VERSION).toBe('7')
  })

  it('opens a challenge link made on engine 6 (or 5, or 4) as unverified, with its draft resolved', () => {
    const g = quickPlayed('bump-link')
    const c = challengeFromGame(g, u, 'Minh')!
    for (const engine of ['6', '5', '4']) {
      const old = decodeChallenge(encodeChallenge({ ...c, engine }))
      const out = replayChallenge(u, old)
      expect(out.verified).toBe('unverified')
      expect(out.reason).toBe(`built with engine ${engine}, this build is 7`)
      expect(out.picks.length).toBeGreaterThan(0)
    }
    // The same link on this engine verifies
    expect(replayChallenge(u, decodeChallenge(encodeChallenge(c))).verified).toBe('yes')
  })

  it('a quick season whose stored games this engine plays differently shows no reel, and never throws', () => {
    const g = quickPlayed('bump-reel')
    expect(quickHighlights(g, u, 1)).not.toBeNull()
    // As an engine 5 save looks to engine 6: the stored games are not the ones the replay produces
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

  it('an engine 5 Season plays on: AI morale and form that drifted, drafted men still in their real squads, no unavailable list', () => {
    const g = seasonGame(u, 'bump-e5-season', 10)
    const old = clone(g)
    // What engine 5 left in a save: winners' morale at 100 and form from their ratings, a drafted man in his club's squad
    for (const c of Object.values(old.season!.ai)) for (const st of Object.values(c.state)) {
      st.morale = 100
      st.recentRatings = [8.1, 7.9, 8.4]
      st.familiarity = 98
    }
    const mine = u.index[Object.keys(old.squad)[0]]
    const club = old.season!.ai[mine.clubId]
    if (club && !club.squad.includes(mine.id)) club.squad.push(mine.id)
    delete old.weekUnavailable
    const back = normaliseGame(old)!
    for (let i = 0; i < 40 && back.phase !== 'summary'; i++) {
      playMatchweek(back, u, true)
      if (back.phase === 'match') back.phase = 'week'
    }
    expect(back.phase).toBe('summary')
    expect(back.season!.fixtures.every((f) => !!f.result)).toBe(true)
  })

  it('a live match saved at half time on engine 5 (no goal factor on its sides) plays to the whistle', () => {
    const g = seasonGame(u, 'bump-e5-live', 6)
    playMatchweek(g, u, false)
    expect(g.live).not.toBeNull()
    const old = clone(g)
    delete old.live!.mp.home.goalFactor
    delete old.live!.mp.away.goalFactor
    const back = normaliseGame(old)!
    advanceLiveMatch(back, u, undefined, true)
    if (back.live) completeLiveMatch(back, u, true)
    expect(back.live).toBeNull()
    expect(back.lastMatch).not.toBeNull()
  })

  it('a Dynasty finished on engine 5 goes into its summer and the next season', () => {
    const g = seasonGame(u, 'bump-e5-dynasty')
    g.settings = { ...g.settings, mode: 'dynasty' }
    for (let i = 0; i < 40 && g.phase !== 'summary'; i++) {
      playMatchweek(g, u, true)
      if (g.phase === 'match') g.phase = 'week'
    }
    const back = normaliseGame(clone(g))!
    advanceToNextSeason(back, u)
    expect(back.phase).toBe('draft')
    expect(back.draft).not.toBeNull()
  })
})
