import { describe, expect, it } from 'vitest'
import { Rng } from '@engine/rng'
import { advanceMatch, beginMatch, finishMatch, simulateMatch, type MatchInProgress } from '@engine/match'
import { feedFromLive, type MatchFeed } from '@engine/matchFeed'
import { statsSeries } from '@engine/matchStats'
import { matchPath } from '../match/epochs'
import { actionZones, averagePositions, heatGrid, passNetwork, samplePlayers } from '../match/heat'
import { commentaryUpTo, keepersOf } from '../match/commentary'
import { cueTimes, goalHolds } from '../match/possession'
import { focusMoments } from '../match/keyMoments'
import { shotMarks } from '../match/overlays'
import { assistantSubsBetween } from '../match/assistantSubs'
import { assistantLine } from '../match/assistant'
import { liveFeed, pathOf, samplesOf } from '../match/prepare'
import { changedLive, getName, resultFeed, sides, u } from './feeds'

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v)
  }
  return o
}

/** Every pure match-day helper the dashboard runs over a decided feed. */
function decorate(feed: MatchFeed): void {
  const mpath = matchPath(feed)
  const ranges = mpath.epochs.map((e) => ({ from: e.from, to: e.to }))
  const samples = samplePlayers(mpath, feed.lastMinute)
  for (const side of ['home', 'away'] as const) {
    averagePositions(samples, side)
    passNetwork(mpath, side, feed.lastMinute)
    assistantSubsBetween(feed, side, 0, feed.lastMinute)
  }
  if (samples.length) heatGrid(samples, samples[0].psId)
  actionZones(mpath, feed.lastMinute)
  for (const r of ranges) {
    goalHolds(feed.events, r.from, r.to, { userSide: 'home', replay: true })
    cueTimes(feed.events, r.from, r.to)
  }
  focusMoments(feed.events, ranges)
  shotMarks(mpath.path, feed.events, ranges)
  commentaryUpTo(feed, mpath, feed.lastMinute, { home: 'HOM', away: 'AWA' }, getName, [], { userSide: 'home' })
  const series = statsSeries(feed, (id) => u.index[id])
  for (const m of [15, 30, 60, 80]) assistantLine(feed, series, 'home', m, getName)
}

describe('r8 audit: the match visuals are decoration only (src/ui/match)', () => {
  it('never mutates a decided feed: every helper runs over a deep-frozen one', () => {
    for (let i = 0; i < 4; i++) {
      for (const feed of [resultFeed(i), changedLive(i).feed]) {
        const frozen = deepFreeze(feed)
        expect(() => decorate(frozen)).not.toThrow()
      }
    }
  })

  it('an untouched match decorated at every stop still equals simulateMatch event for event', () => {
    for (let i = 0; i < 6; i++) {
      const s = sides(i)
      const mp: MatchInProgress = beginMatch({ rng: new Rng(`r8-audit-${i}`), ...s, detail: 'full' })
      const look = (key: string) => {
        const before = JSON.stringify(mp)
        const feed = liveFeed(mp, key)
        samplesOf(pathOf(feed), feed.lastMinute)
        decorate(feedFromLive(mp, key))
        expect(JSON.stringify(mp)).toBe(before)
      }
      look(`r8-${i}-45`)
      advanceMatch(mp, s, undefined, 70)
      look(`r8-${i}-70`)
      advanceMatch(mp, s, undefined, 90)
      look(`r8-${i}-90`)
      const played = finishMatch(mp, s)
      const plain = simulateMatch({ rng: new Rng(`r8-audit-${i}`), ...sides(i), detail: 'full' })
      expect(played.events).toEqual(plain.events)
      expect([played.homeGoals, played.awayGoals]).toEqual([plain.homeGoals, plain.awayGoals])
    }
  })

  it('the commentary reads the keepers once per match: keepersOf is every keeper in the epochs', () => {
    for (let i = 0; i < 4; i++) {
      const { feed } = changedLive(i)
      const mpath = matchPath(feed)
      const keepers = keepersOf(mpath)
      const expected = new Set(mpath.epochs.flatMap((e) => [...e.home, ...e.away]).filter((p) => p.position === 'GK').map((p) => p.psId))
      expect([...keepers].sort()).toEqual([...expected].sort())
      expect(keepers.size).toBeGreaterThanOrEqual(2)
      // The same lines on every reading (a pure hash, no draw)
      const n = { home: 'HOM', away: 'AWA' }
      expect(commentaryUpTo(feed, mpath, feed.lastMinute, n, getName, [])).toEqual(commentaryUpTo(feed, matchPath(feed), feed.lastMinute, n, getName, []))
    }
  })
})
