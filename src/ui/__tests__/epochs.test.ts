import { describe, expect, it } from 'vitest'
import { epochAt, epochStarts, matchPath } from '../match/epochs'
import { MAX_HOP } from '../match/possession'
import { changedLive, resultFeed } from './feeds'

describe('epochs and the match path', () => {
  it('a result without a timeline is one epoch per canonical segment with the final tactics', () => {
    const feed = resultFeed(1)
    const old = { ...feed, timeline: feed.timeline.filter((e) => e.by === 'kickoff') }
    const mpath = matchPath(old)
    expect(mpath.epochs.map((e) => [e.from, e.to])).toEqual([
      [0, 45],
      [46, 70],
      [71, 90],
    ])
    expect(mpath.epochs[0].home).toEqual(mpath.epochs[2].home)
  })

  it('splits at 46, 71 and the minute after every change; the shape moves with the change and the ball carries on', () => {
    for (let i = 0; i < 12; i++) {
      const { feed } = changedLive(i)
      const starts = epochStarts(feed)
      expect(starts).toContain(31)
      expect(starts).toContain(46)
      expect(starts).toContain(71)
      expect(starts).toContain(76)
      const mpath = matchPath(feed)
      const at31 = mpath.epochs.find((e) => e.from === 31)!
      const before = mpath.epochs.find((e) => e.from === 0)!
      expect(before.to).toBe(30)
      // Attacking or defensive from 31: the outfield block stands somewhere else
      const st = (e: typeof before) => e.home.find((p) => p.position !== 'GK' && p.onAt === 0)!
      expect(st(at31).x).not.toBe(st(before).x)
      expect(mpath.epochs[mpath.epochs.length - 1].to).toBe(90)
      for (let k = 1; k < mpath.path.length; k++) expect(mpath.path[k].t).toBeGreaterThan(mpath.path[k - 1].t)
      for (const e of mpath.epochs.slice(1)) {
        const first = mpath.path.findIndex((k) => k.t >= e.from)
        if (first <= 0) continue
        const a = mpath.path[first - 1]
        const b = mpath.path[first]
        // A kick-off restarts from the centre spot; anywhere else the ball moves on from where it stood
        if (e.from === 46) expect(Math.hypot(b.x - 50, b.y - 50)).toBeLessThanOrEqual(MAX_HOP + 1)
        // (a keeper's long ball goes further, in the air, taking its time like any other hop)
        else if (b.kind !== 'reset' && (b.loft ?? 0) < 0.5) expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(MAX_HOP + 1)
      }
      expect(epochAt(mpath, 30.9).from).toBe(0)
      expect(epochAt(mpath, 31).from).toBe(31)
      expect(epochAt(mpath, 93.5).from).toBe(76)
    }
  })

  it('is deterministic for a feed', () => {
    const { feed } = changedLive(3)
    expect(matchPath(feed)).toEqual(matchPath(feed))
  })
})
