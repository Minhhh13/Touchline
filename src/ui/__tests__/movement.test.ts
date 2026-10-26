import { describe, expect, it } from 'vitest'
import { dotPosition, swayPhase } from '../match/movement'
import { matchPath } from '../match/epochs'
import { metres, onPitchAt, type PlacedPlayer } from '../match/pitchGeometry'
import { ballAt } from '../match/possession'
import { block, sceneAt, shapePoint } from '../match/shape'
import { resultFeed } from './feeds'

const along = (p: { side: 'home' | 'away' }, pt: { x: number }) => (p.side === 'home' ? pt.x : 100 - pt.x)

describe('dot movement', () => {
  const feeds = Array.from({ length: 6 }, (_, i) => resultFeed(i))
  const paths = feeds.map((f) => matchPath(f))

  it('is deterministic, stays on the pitch, and the man on the ball has it at his feet', () => {
    let carries = 0
    for (const mpath of paths) {
      const { home, away } = mpath.epochs[0]
      for (let T = 0.2; T < 45; T += 0.19) {
        const b = ballAt(mpath.path, T)!
        const men = [...onPitchAt(home, Math.floor(T)), ...onPitchAt(away, Math.floor(T))]
        for (const p of men) {
          const a = dotPosition(p, mpath.path, b, T, swayPhase(p.psId))
          expect(dotPosition(p, mpath.path, b, T, swayPhase(p.psId))).toEqual(a)
          expect(a.x).toBeGreaterThanOrEqual(-1)
          expect(a.x).toBeLessThanOrEqual(101)
          expect(a.y).toBeGreaterThanOrEqual(-1)
          expect(a.y).toBeLessThanOrEqual(101)
        }
        const cur = mpath.path[b.index]
        const next = b.next
        if (next?.kind === 'carry' && cur.holder && next.holder === cur.holder && cur.side === next.side) {
          const p = men.find((m) => m.psId === cur.holder && m.side === cur.side)
          if (!p) continue
          const at = dotPosition(p, mpath.path, b, T, swayPhase(p.psId))
          expect(Math.hypot(at.x - b.x, at.y - b.y)).toBeLessThan(1.6)
          carries++
        }
      }
    }
    expect(carries).toBeGreaterThan(100)
  })

  it('climbs as a block with the ball in possession and drops and narrows out of it', () => {
    const inPos: number[] = []
    const outPos: number[] = []
    const inWidth: number[] = []
    const outWidth: number[] = []
    for (const mpath of paths) {
      const { home, away } = mpath.epochs[0]
      for (let T = 2; T < 44; T += 0.37) {
        const b = ballAt(mpath.path, T)!
        const sc = sceneAt(mpath.path, b, T)
        if (sc.settle < 1 || sc.setPiece) continue
        for (const side of [home, away]) {
          const men = onPitchAt(side, Math.floor(T)).filter((p) => p.position !== 'GK')
          const pts = men.map((p) => shapePoint(p, sc, swayPhase(p.psId)))
          const depth = Math.max(...pts.map((p, i) => along(men[i], p))) - Math.min(...pts.map((p, i) => along(men[i], p)))
          const width = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y))
          if (men[0].side === sc.poss) {
            inPos.push(depth)
            inWidth.push(width)
          } else {
            outPos.push(depth)
            outWidth.push(width)
          }
        }
      }
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(inPos.length).toBeGreaterThan(200)
    expect(outPos.length).toBeGreaterThan(200)
    // Out of possession a side is compact, short and narrow; on the ball it stretches out
    expect(avg(outPos)).toBeLessThan(avg(inPos) - 8)
    expect(avg(outWidth)).toBeLessThan(avg(inWidth) - 8)
    // The block's lines: higher with the ball than without it, and never inverted
    for (let ab = 0; ab <= 100; ab += 5) {
      const on = block(ab, true)
      const off = block(ab, false)
      expect(on.front).toBeGreaterThan(on.back)
      expect(off.front).toBeGreaterThan(off.back)
      expect(on.back).toBeGreaterThanOrEqual(off.back - 12)
    }
  })

  it('closes the ball down: out of possession the nearest man is drawn towards it from his place in the shape', () => {
    let closer = 0
    let total = 0
    for (const mpath of paths) {
      const { home, away } = mpath.epochs[0]
      for (let T = 2; T < 44; T += 0.53) {
        const b = ballAt(mpath.path, T)!
        const sc = sceneAt(mpath.path, b, T)
        if (sc.settle < 1 || sc.setPiece) continue
        const defenders = onPitchAt(sc.poss === 'home' ? away : home, Math.floor(T)).filter((p) => p.position !== 'GK')
        const nearest = defenders.reduce((a, p) => (metres(shapePoint(p, sc, swayPhase(p.psId)), b) < metres(shapePoint(a, sc, swayPhase(a.psId)), b) ? p : a))
        const spot = shapePoint(nearest, sc, swayPhase(nearest.psId))
        if (metres(spot, b) > 18) continue
        total++
        if (metres(dotPosition(nearest, mpath.path, b, T, swayPhase(nearest.psId), sc), b) < metres(spot, b) - 1) closer++
      }
    }
    expect(total).toBeGreaterThan(40)
    expect(closer / total).toBeGreaterThan(0.8)
  })

  it('lines both sides up in their own halves for a kick-off, and keeps a keeper at his end', () => {
    for (const mpath of paths) {
      const { home, away } = mpath.epochs[0]
      const T = 0.05
      const b = ballAt(mpath.path, T)!
      const sc = sceneAt(mpath.path, b, T)
      expect(sc.setPiece?.kind).toBe('kickoff')
      for (const p of [...home, ...away].filter((x) => x.onAt === 0)) {
        const pt = shapePoint(p, sc, swayPhase(p.psId))
        expect(along(p, pt)).toBeLessThanOrEqual(50.5)
      }
      for (let T2 = 1; T2 < 44; T2 += 1.3) {
        const b2 = ballAt(mpath.path, T2)!
        for (const gk of [...home, ...away].filter((x) => x.position === 'GK')) expect(along(gk, dotPosition(gk, mpath.path, b2, T2, 0))).toBeLessThan(30)
      }
    }
    const lone: PlacedPlayer = { psId: 'x', slotId: 'gk', position: 'GK', onAt: 0, offAt: 90, red: false, injured: false, side: 'home', x: 5, y: 50 }
    expect(dotPosition(lone, [], null, 10, 0)).toEqual({ x: 5, y: 50 })
  })

  it('gives every man a fixed sway phase from his id', () => {
    expect(swayPhase('abc')).toBe(swayPhase('abc'))
    expect(swayPhase('abc')).not.toBe(swayPhase('abd'))
    expect(swayPhase('a')).toBeGreaterThanOrEqual(0)
    expect(swayPhase('a-long-player-season-id@2020@club')).toBeLessThan(6.283)
  })
})
