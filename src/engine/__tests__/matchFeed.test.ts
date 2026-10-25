import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { sidesFactory } from './pools'
import { Rng } from '../rng'
import { advanceMatch, beginMatch, changeInPlay, finishMatch, simulateMatch, type Appearance } from '../match'
import { addedTime, appearancesAt, feedFromLive, feedFromResult, minutesInWords, playedMinute, scoreAt, sortEvents, tacticsAt } from '../matchFeed'
import type { MatchEvent } from '../types'

const ev = (minute: number, type: MatchEvent['type'], side: 'home' | 'away' = 'home'): MatchEvent => ({ minute, type, side, text: type })

describe('match feed', () => {
  const u = loadTestUniverse()
  const sides = sidesFactory(u)

  it('a match in play: decided to its stop, events sorted with the whistles last in their minute, kick-off entries, the seed key', () => {
    const s = sides(0)
    const mp = beginMatch({ rng: new Rng('feed-live'), ...s, detail: 'full' })
    const feed = feedFromLive(mp, 'fallback')
    expect(feed.source).toBe('live')
    expect([feed.decidedTo, feed.lastMinute, feed.addedTime]).toEqual([45, 45, 0])
    expect(feed.key).toBe(mp.seedKey)
    expect(feed.events[0].type).toBe('kickoff')
    expect(feed.events[feed.events.length - 1].type).toBe('half_time')
    for (let i = 1; i < feed.events.length; i++) expect(feed.events[i].minute).toBeGreaterThanOrEqual(feed.events[i - 1].minute)
    expect(feed.timeline.filter((e) => e.by === 'kickoff').map((e) => e.side).sort()).toEqual(['away', 'home'])
    expect(feed.home.bench).toEqual(mp.home.bench)
    expect(feed.home.appearances.every((a) => typeof a.effective === 'number')).toBe(true)
    // The feed is a copy: sorting never reorders the match's own log
    const before = JSON.stringify(mp.events)
    feedFromLive(mp, 'x')
    expect(JSON.stringify(mp.events)).toBe(before)

    advanceMatch(mp, s, undefined, 70)
    advanceMatch(mp, s, undefined, 90)
    const held = feedFromLive(mp, 'fallback')
    expect(held.decidedTo).toBe(90)
    expect(held.addedTime).toBe(addedTime(held.events))
    expect(held.lastMinute).toBe(90 + held.addedTime)
    expect(held.lastMinute).toBeGreaterThanOrEqual(Math.max(...held.events.map((e) => e.minute)))
  })

  it('a result: the same key and timeline, the engine ratings, and a fallback key and kick-off entries for an older result', () => {
    const r = simulateMatch({ rng: new Rng('feed-result'), ...sides(3), detail: 'full', neutral: true })
    const feed = feedFromResult(r, 'fallback', { home: 'HOM', away: 'AWA' })
    expect(feed.key).toBe(r.seedKey)
    expect(feed.neutral).toBe(true)
    expect(feed.home.shortName).toBe('HOM')
    expect(feed.finalStats!.home).toBe(r.homeStats)
    // The result keeps a compacted timeline; the feed reads back exactly the one the match had
    const mp = beginMatch({ rng: new Rng('feed-result'), ...sides(3), detail: 'full', neutral: true })
    advanceMatch(mp, sides(3), undefined, 70)
    advanceMatch(mp, sides(3), undefined, 90)
    expect(feed.timeline).toEqual(mp.timeline)
    expect(feed.lastMinute).toBeGreaterThanOrEqual(90)
    const older = { ...r, timeline: undefined, seedKey: undefined, neutral: undefined }
    const old = feedFromResult(older, 'H-A-3')
    expect(old.key).toBe('H-A-3')
    expect(old.neutral).toBe(false)
    expect(old.timeline.filter((e) => e.by === 'kickoff')).toHaveLength(2)
    for (const m of [0, 30, 60, 90]) expect(tacticsAt(old, 'home', m).mentality).toBe(r.homeReport.tactics!.mentality)
  })

  it('tactics at a minute: an entry at k applies from k + 1, at the stops and in play, set-piece takers with them', () => {
    for (let i = 0; i < 20; i++) {
      const s = sides(i)
      const mp = beginMatch({ rng: new Rng(`feed-tactics-${i}`), ...s, detail: 'full' })
      const kick = { ...mp.home.tactics }
      const t30 = { ...kick, mentality: kick.mentality === 'attacking' ? 'defensive' as const : 'attacking' as const }
      expect(changeInPlay(mp, s, { side: 'home', minute: 30, tactics: t30 }).applied).toBe(true)
      const pens = mp.hLive.find((p) => p.position === 'ST')?.psId ?? mp.hLive[10].psId
      advanceMatch(mp, s, { side: 'home', tactics: { ...t30, width: 'wide', setPieces: { penalties: pens } } }, 70)
      const feed = feedFromLive(mp, 'k')
      expect(tacticsAt(feed, 'home', 0).mentality).toBe(kick.mentality)
      expect(tacticsAt(feed, 'home', 30).mentality).toBe(kick.mentality)
      expect(tacticsAt(feed, 'home', 31).mentality).toBe(t30.mentality)
      expect(tacticsAt(feed, 'home', 45).width).toBe(kick.width)
      expect(tacticsAt(feed, 'home', 46).width).toBe('wide')
      expect(tacticsAt(feed, 'home', 45).setPieces?.penalties ?? undefined).toBe(kick.setPieces?.penalties ?? undefined)
      expect(tacticsAt(feed, 'home', 46).setPieces?.penalties).toBe(pens)
      expect(tacticsAt(feed, 'home', 46).formationId).toBe(kick.formationId)
      // The AI side's reaction at the break shows from 46
      const ai = feed.timeline.find((e) => e.side === 'away' && e.by === 'ai')
      if (ai) expect(tacticsAt(feed, 'away', 46)).toMatchObject(ai.instructions!)
      advanceMatch(mp, s, undefined, 90)
      const live = feedFromLive(mp, 'k')
      const r = finishMatch(mp, s)
      const res = feedFromResult(r, 'k')
      expect(tacticsAt(res, 'home', 31).mentality).toBe(t30.mentality)
      // However the result compacts its timeline, every minute reads the same tactics as in play
      expect(res.timeline).toEqual(live.timeline)
      for (let m = 0; m <= 94; m++) for (const side of ['home', 'away'] as const) expect(tacticsAt(res, side, m)).toEqual(tacticsAt(live, side, m))
    }
  })

  it('the score at a minute, the added time and the men on at a minute', () => {
    const events = [ev(0, 'kickoff'), ev(12, 'goal'), ev(30, 'own_goal', 'away'), ev(45, 'half_time'), ev(70, 'penalty', 'away'), ev(92, 'goal')]
    expect(scoreAt(events, 11)).toEqual({ home: 0, away: 0 })
    expect(scoreAt(events, 30)).toEqual({ home: 1, away: 1 })
    expect(scoreAt(events, 95)).toEqual({ home: 2, away: 2 })
    expect(sortEvents([ev(45, 'half_time'), ev(45, 'goal'), ev(0, 'goal'), ev(0, 'kickoff')]).map((e) => e.type)).toEqual(['kickoff', 'goal', 'goal', 'half_time'])
    expect(addedTime([])).toBe(2)
    expect(addedTime([ev(50, 'yellow'), ev(55, 'substitution'), ev(60, 'goal')])).toBe(3)
    expect(addedTime(Array.from({ length: 20 }, (_, i) => ev(50 + i, 'substitution')))).toBe(6)
    expect(addedTime([ev(94, 'goal'), ev(94, 'full_time')])).toBe(4)
    expect(addedTime([ev(20, 'yellow'), ev(21, 'yellow'), ev(22, 'yellow')])).toBe(2)
    expect(minutesInWords(4)).toBe('four')

    const a = (psId: string, slotId: string, onAt: number, offAt: number, red = false): Appearance => ({ psId, slotId, position: 'CM', onAt, offAt, red, injured: false })
    const men = [a('x', 's1', 0, 60), a('y', 's1', 60, 90), a('r', 's2', 0, 40, true), a('w', 's3', 0, 90), a('z', 's3', 90, 90)]
    expect(appearancesAt(men, 39).map((p) => p.psId)).toEqual(['x', 'r', 'w'])
    expect(appearancesAt(men, 59).map((p) => p.psId)).toEqual(['x', 'w'])
    expect(appearancesAt(men, 60).map((p) => p.psId)).toEqual(['y', 'w'])
    expect(appearancesAt(men, 92).map((p) => p.psId)).toEqual(['y', 'z'])
    expect(appearancesAt(men, 40).map((p) => p.psId)).toEqual(['x', 'w'])
    // Played the minute: the man going off plays it, the man coming on starts the next
    expect(playedMinute(men, men[0], 60)).toBe(true)
    expect(playedMinute(men, men[1], 60)).toBe(false)
    expect(playedMinute(men, men[1], 61)).toBe(true)
    expect(playedMinute(men, men[2], 40)).toBe(true)
    expect(playedMinute(men, men[2], 41)).toBe(false)
    expect(playedMinute(men, men[3], 90)).toBe(true)
    expect(playedMinute(men, men[3], 91)).toBe(false)
    expect(playedMinute(men, men[4], 91)).toBe(true)
    expect(playedMinute(men, men[1], 93)).toBe(true)
  })
})
