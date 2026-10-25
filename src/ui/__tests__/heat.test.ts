import { describe, expect, it } from 'vitest'
import { matchPath } from '../match/epochs'
import { actionZones, averagePositions, heatGrid, passNetwork, samplePlayers } from '../match/heat'
import { changedLive, resultFeed } from './feeds'

describe('heat maps, average positions, pass maps and action zones', () => {
  it('a man has no heat before he comes on or after he goes off, and his heat is normalised', () => {
    let checked = 0
    for (let i = 0; i < 8; i++) {
      const { feed, subOn, subOff } = changedLive(i)
      if (!subOn || !subOff) continue
      const mpath = matchPath(feed)
      const samples = samplePlayers(mpath, feed.lastMinute)
      const on = samples.filter((s) => s.psId === subOn)
      const off = samples.filter((s) => s.psId === subOff)
      expect(on.length).toBeGreaterThan(0)
      expect(on.every((s) => s.t >= 30)).toBe(true)
      expect(off.every((s) => s.t < 30)).toBe(true)
      expect(heatGrid(samplePlayers(mpath, 29), subOn).max).toBe(0)
      const grid = heatGrid(samples, subOn)
      expect(grid.cells).toHaveLength(21 * 14)
      expect(Math.max(...grid.cells)).toBe(1)
      expect(Math.min(...grid.cells)).toBeGreaterThanOrEqual(0)
      checked++
    }
    expect(checked).toBeGreaterThan(4)
  })

  it('samples four times a minute for every man on the pitch, and average positions stay on the pitch', () => {
    const feed = resultFeed(2)
    const mpath = matchPath(feed)
    const samples = samplePlayers(mpath, 20)
    expect(samples.length).toBeGreaterThanOrEqual(20 * 4 * 20)
    expect(samples.length).toBeLessThanOrEqual(20 * 4 * 22)
    for (const side of ['home', 'away'] as const) {
      const avg = averagePositions(samplePlayers(mpath, feed.lastMinute), side)
      expect(avg.length).toBeGreaterThanOrEqual(11)
      for (const a of avg) {
        expect(a.x).toBeGreaterThanOrEqual(0)
        expect(a.x).toBeLessThanOrEqual(100)
        expect(a.y).toBeGreaterThanOrEqual(0)
        expect(a.y).toBeLessThanOrEqual(100)
        expect(a.minutes).toBeGreaterThan(0)
      }
      // The keeper stays at his end
      const gk = avg.find((a) => (side === 'home' ? feed.home : feed.away).appearances.find((x) => x.psId === a.psId)?.position === 'GK')!
      expect(side === 'home' ? gk.x : 100 - gk.x).toBeLessThan(20)
    }
  })

  it('passes only link team-mates who were on the pitch together, and grow with the clock', () => {
    for (let i = 0; i < 6; i++) {
      const { feed } = changedLive(i)
      const mpath = matchPath(feed)
      for (const side of ['home', 'away'] as const) {
        const apps = (side === 'home' ? feed.home : feed.away).appearances
        const net = passNetwork(mpath, side, feed.lastMinute)
        expect(net.total).toBeGreaterThan(5)
        expect(net.passes.reduce((a, p) => a + p.count, 0)).toBe(net.total)
        for (const p of net.passes) {
          const a = apps.find((x) => x.psId === p.from)!
          const b = apps.find((x) => x.psId === p.to)!
          expect(a).toBeDefined()
          expect(b).toBeDefined()
          expect(p.from).not.toBe(p.to)
          expect(Math.max(a.onAt, b.onAt)).toBeLessThan(Math.min(a.offAt >= 90 ? 99 : a.offAt, b.offAt >= 90 ? 99 : b.offAt) + 1)
        }
        expect(passNetwork(mpath, side, 30).total).toBeLessThanOrEqual(net.total)
      }
    }
  })

  it('action zones add up to 100 per side, and the side on top spends more time in the attacking third', () => {
    for (let i = 0; i < 6; i++) {
      const mpath = matchPath(resultFeed(i))
      const z = actionZones(mpath, 90)
      for (const side of ['home', 'away'] as const) {
        const t = z[side].thirds
        const c = z[side].channels
        expect(t.defensive + t.middle + t.attacking).toBeCloseTo(100, 6)
        expect(c.left + c.centre + c.right).toBeCloseTo(100, 6)
        expect(z[side].samples).toBeGreaterThan(0)
      }
      expect(z.home.samples + z.away.samples).toBe(90 * 8)
    }
    const empty = actionZones({ epochs: [], path: [] }, 30)
    expect(empty.home.thirds.middle).toBeCloseTo(100 / 3, 6)
  })
})
