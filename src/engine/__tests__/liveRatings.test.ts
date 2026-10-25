import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { sidesFactory } from './pools'
import { Rng } from '../rng'
import { advanceMatch, beginMatch, finishMatch, simulateMatch } from '../match'
import { feedFromLive, feedFromResult } from '../matchFeed'
import { liveCondition, ratingsAt } from '../liveRatings'

describe('live ratings and condition', { timeout: 30_000 }, () => {
  const u = loadTestUniverse()
  const get = (id: string) => u.index[id]
  const sides = sidesFactory(u)

  it('nobody is rated before he plays; a substitute from the minute after he comes on', () => {
    for (let i = 0; i < 20; i++) {
      const feed = feedFromResult(simulateMatch({ rng: new Rng(`ratings-on-${i}`), ...sides(i), detail: 'full' }), 'k')
      expect(ratingsAt(feed, 0)).toEqual({})
      for (const a of [...feed.home.appearances, ...feed.away.appearances]) {
        if (a.onAt === 0) continue
        expect(ratingsAt(feed, a.onAt)[a.psId]).toBeUndefined()
        if (a.onAt < feed.lastMinute) expect(ratingsAt(feed, a.onAt + 1)[a.psId]).toBeDefined()
      }
    }
  })

  it('a goal lifts the scorer 0.9 more than a team-mate in the same line at its minute', () => {
    let checked = 0
    for (let i = 0; i < 80 && checked < 25; i++) {
      const s = sides(i)
      const mp = beginMatch({ rng: new Rng(`ratings-goal-${i}`), ...s, detail: 'full' })
      advanceMatch(mp, s, undefined, 70)
      const feed = feedFromLive(mp, 'k')
      for (const g of feed.events.filter((e) => e.type === 'goal' && e.minute >= 2 && e.minute <= 69)) {
        const side = g.side === 'home' ? feed.home : feed.away
        const scorer = side.appearances.find((a) => a.psId === g.playerId)
        if (!scorer || scorer.onAt > 0 || ['GK', 'CB', 'LB', 'RB', 'DM'].includes(scorer.position)) continue
        const mate = side.appearances.find((a) => a.psId !== g.playerId && a.psId !== g.secondaryId && a.onAt === 0 && a.offAt >= 90 && !['GK', 'CB', 'LB', 'RB', 'DM'].includes(a.position))
        if (!mate || feed.events.some((e) => e.minute === g.minute && e !== g)) continue
        const before = ratingsAt(feed, g.minute - 1)
        const after = ratingsAt(feed, g.minute)
        if ([before, after].some((r) => r[scorer.psId] >= 10 || r[mate.psId] <= 4.5)) continue
        const jump = after[scorer.psId] - before[scorer.psId] - (after[mate.psId] - before[mate.psId])
        expect(Math.abs(jump - 0.9)).toBeLessThanOrEqual(0.11)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(10)
  })

  it('a replay shows exactly the engine rating at each man’s last minute', () => {
    for (let i = 0; i < 60; i++) {
      const r = simulateMatch({ rng: new Rng(`ratings-replay-${i}`), ...sides(i), detail: 'full' })
      const feed = feedFromResult(r, 'k')
      const whistle = ratingsAt(feed, feed.lastMinute)
      for (const side of ['home', 'away'] as const) {
        for (const st of side === 'home' ? r.homeStats : r.awayStats) {
          const a = (side === 'home' ? feed.home : feed.away).appearances.find((x) => x.psId === st.playerSeasonId)!
          const last = a.red || a.offAt < 90 ? a.offAt : feed.lastMinute
          expect(ratingsAt(feed, last)[st.playerSeasonId]).toBe(st.rating)
          expect(whistle[st.playerSeasonId]).toBe(st.rating)
        }
      }
    }
  })

  it('in play the noise-free formula lands near the engine’s final ratings, and condition at the whistle is the engine’s loss', () => {
    let diff = 0
    let n = 0
    for (let i = 0; i < 200; i++) {
      const s = sides(i)
      const mp = beginMatch({ rng: new Rng(`ratings-live-${i}`), ...s, detail: 'full' })
      advanceMatch(mp, s, undefined, 70)
      advanceMatch(mp, s, undefined, 90)
      const feed = feedFromLive(mp, 'k')
      const live = ratingsAt(feed, feed.lastMinute)
      const r = finishMatch(mp, s)
      for (const st of [...r.homeStats, ...r.awayStats]) {
        diff += Math.abs(live[st.playerSeasonId] - st.rating)
        n++
      }
      for (const side of ['home', 'away'] as const) {
        for (const a of (side === 'home' ? feed.home : feed.away).appearances) {
          const loss = r.conditionLoss[a.psId] ?? 0
          expect(liveCondition(feed, side, a.psId, feed.lastMinute, 95, get)).toBe(95 - loss)
          expect(liveCondition(feed, side, a.psId, a.onAt, 95, get)).toBe(95)
        }
      }
    }
    console.log(`mean |live - final| ${(diff / n).toFixed(3)} over ${n} ratings`)
    expect(diff / n).toBeLessThan(0.6)
  })
})
