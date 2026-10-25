import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { benchAt, currentScore, onPitchAtMinute } from '@engine/match'
import { USER_TEAM } from '@engine/season'
import { advanceLiveMatch, changeLiveMatch, completeLiveMatch, finishLiveMatch, playFriendly, playMatchweek } from '../logic/week'
import { clone, seasonGame } from './seasonGame'
import type { Game } from '../types'

describe('the last twenty minutes held live, and changes with the ball in play', { timeout: 30_000 }, () => {
  const u = loadTestUniverse()

  /** A live league match standing at 70, the manager's half-time changes made. */
  function at70(seed: string, simmed = 2): Game {
    const g = seasonGame(u, seed, simmed)
    playMatchweek(g, u)
    expect(g.live?.kind).toBe('league')
    advanceLiveMatch(g, u, { talk: 'encourage' })
    expect(g.live?.mp.clock).toBe(70)
    return g
  }

  /** A fresh starter off and a fit man from the bench on, at a minute of the user's live match. */
  function oneSub(g: Game, minute: number): { off: string; on: string } {
    const live = g.live!
    const side = live.userIsHome ? 'home' : 'away'
    const off = onPitchAtMinute(live.mp, side, minute).find((p) => p.position !== 'GK' && p.offAt >= 90 && !p.red)!
    const on = benchAt(live.mp, side, minute, (id) => g.squad[id]).find((id) => !(side === 'home' ? live.mp.hLive : live.mp.aLive).some((p) => p.psId === id))!
    return { off: off.psId, on }
  }

  it('a match held to 90 and then completed leaves the game exactly as the unheld path from the same start', () => {
    for (let i = 0; i < 6; i++) {
      const g = at70(`hold-identity-${i}`, i)
      const sub = oneSub(g, 70)
      const changes = { shout: 'all-out-attack' as const, tactics: { ...g.tactics, tempo: 'fast' as const }, substitutions: [sub] }
      const unheld = clone(g)
      advanceLiveMatch(unheld, u, changes)
      // Over (a cup tie may follow it: the sixth matchweek has one)
      expect(unheld.live?.kind ?? 'none').not.toBe('league')
      const held = clone(g)
      advanceLiveMatch(held, u, changes, false, true)
      expect(held.live?.mp.clock).toBe(90)
      expect(held.lineup).toEqual(unheld.lineup)
      expect(held.tactics).toEqual(unheld.tactics)
      completeLiveMatch(held, u)
      expect(JSON.stringify(held)).toBe(JSON.stringify(unheld))
    }
  })

  it('a held match left open completes when the next week is played, and an old save at 70 still holds and completes', () => {
    const g = at70('hold-next-week')
    const mw = g.live!.ctx.matchweek
    advanceLiveMatch(g, u, {}, false, true)
    expect(g.live?.mp.clock).toBe(90)
    playMatchweek(g, u)
    const f = g.season!.fixtures.find((x) => x.matchweek === mw && (x.homeTeamId === USER_TEAM || x.awayTeamId === USER_TEAM))!
    expect(f.result).toBeDefined()
    expect(g.season!.matchweek).toBeGreaterThanOrEqual(mw)

    const old = at70('hold-old-save')
    const mp = old.live!.mp
    delete mp.segment
    delete mp.timeline
    delete mp.seedKey
    advanceLiveMatch(old, u, {}, false, true)
    expect(old.live?.mp.clock).toBe(90)
    // The last segment is now on record, so changes work from here
    expect(old.live?.mp.segment).toEqual(expect.objectContaining({ from: 71, to: 90 }))
    const out = changeLiveMatch(old, u, { minute: 80, tactics: { ...old.tactics, width: old.tactics.width === 'wide' ? 'narrow' : 'wide' } })
    expect(out.applied).toBe(true)
    completeLiveMatch(old, u)
    expect(old.live).toBeNull()
    expect(old.lastMatch?.homeStats.length).toBeGreaterThanOrEqual(11)
  })

  it('a change in play writes the substitution into the lineup and bench and the instructions into the tactics', () => {
    const g = seasonGame(u, 'inplay-week', 1)
    playMatchweek(g, u)
    const live = g.live!
    const sub = oneSub(g, 30)
    const slot = Object.keys(g.lineup).find((k) => g.lineup[k] === sub.off)!
    const tactics = { ...g.tactics, mentality: g.tactics.mentality === 'attacking' ? 'defensive' as const : 'attacking' as const }
    const out = changeLiveMatch(g, u, { minute: 30, tactics, substitutions: [sub] })
    expect(out.applied).toBe(true)
    expect(out.made).toHaveLength(1)
    expect(g.lineup[slot]).toBe(sub.on)
    expect(g.bench).toContain(sub.off)
    expect(g.bench).not.toContain(sub.on)
    expect(g.tactics.mentality).toBe(tactics.mentality)
    // A refused change touches nothing
    const before = JSON.stringify(g)
    expect(changeLiveMatch(g, u, { minute: 20, tactics: { ...g.tactics, width: 'wide' } }).refusal).toBe('in-the-past')
    expect(JSON.stringify(g)).toBe(before)
    // The man taken off cannot come back; the match plays on through both stops
    advanceLiveMatch(g, u, { substitutions: [{ off: sub.on, on: sub.off }] })
    expect((live.userIsHome ? g.live!.mp.hSubs : g.live!.mp.aSubs).filter((s) => s.on === sub.off)).toHaveLength(0)
    finishLiveMatch(g, u)
    expect(g.live?.kind === 'league').toBe(false)
    const ours = live.userIsHome ? g.lastMatch!.homeReport.substitutions : g.lastMatch!.awayReport.substitutions
    expect(ours).toContainEqual({ minute: 30, off: sub.off, on: sub.on, reason: 'manager' })
  })

  it('a friendly can be held and changed too; the score stands as the engine decided', () => {
    const g = seasonGame(u, 'inplay-friendly')
    g.phase = 'preseason'
    playFriendly(g, u)
    expect(g.live?.kind).toBe('friendly')
    advanceLiveMatch(g, u, {})
    advanceLiveMatch(g, u, {}, false, true)
    const score = currentScore(g.live!.mp)
    completeLiveMatch(g, u)
    expect(g.live).toBeNull()
    expect([g.lastMatch!.homeGoals, g.lastMatch!.awayGoals]).toEqual([score.home, score.away])
  })
})
