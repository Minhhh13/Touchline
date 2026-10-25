import { describe, expect, it } from 'vitest'
import { getFormation } from '@engine/formations'
import { defaultTactics } from '@engine/tactics'
import type { Appearance } from '@engine/match'
import { momentumScale, territory, xgSeries } from '../match/charts'
import { metres, placeSide, separateSides } from '../match/pitchGeometry'
import { buildBallPath, MAX_HOP } from '../match/possession'

describe('xG race series', () => {
  it('starts at nothing, never falls and ends exactly on the match total', () => {
    const momentum = Array.from({ length: 18 }, (_, i) => 0.3 + (i % 5) * 0.1)
    for (const [side, total] of [['home', 2.23], ['away', 0.81]] as const) {
      const s = xgSeries(momentum, total, side)
      expect(s).toHaveLength(91)
      expect(s[0]).toBe(0)
      expect(s[90]).toBeCloseTo(total, 10)
      for (let m = 1; m <= 90; m++) expect(s[m]).toBeGreaterThanOrEqual(s[m - 1])
    }
  })

  it('climbs faster in the spells a side is on top, and evenly with no momentum', () => {
    const momentum = Array.from({ length: 18 }, (_, i) => (i < 9 ? 0.8 : 0.2))
    const h = xgSeries(momentum, 2, 'home')
    const a = xgSeries(momentum, 2, 'away')
    expect(h[45]).toBeGreaterThan(1.5)
    expect(a[45]).toBeLessThan(0.5)
    const even = xgSeries([], 1.8, 'home')
    expect(even[45]).toBeCloseTo(0.9, 10)
    // Half a match played (a paused segment): the unplayed bins read as even
    const half = xgSeries(momentum.slice(0, 9), 2, 'home')
    expect(half[90]).toBeCloseTo(2, 10)
    expect(half[45]).toBeGreaterThan(1)
  })

  it('territory is the mean share of the pressure', () => {
    expect(territory([])).toBeNull()
    expect(territory([0.6, 0.7, 0.8])).toBe(70)
  })
})

describe('separating mirrored shapes', () => {
  const xi = (id: string, prefix: string): Appearance[] => getFormation(id).slots.map((s) => ({ psId: `${prefix}-${s.id}`, slotId: s.id, position: s.position, onAt: 0, offAt: 90, red: false, injured: false }))
  const sub: Appearance = { psId: 'h-sub', slotId: 'lw', position: 'LW', onAt: 60, offAt: 90, red: false, injured: false }

  it('leaves no opposing pair on top of each other, keeps everyone on the pitch and moves a substitute with his slot', () => {
    for (const [hf, af] of [['4-3-3', '4-3-3'], ['4-4-2', '4-2-3-1'], ['3-5-2', '4-3-3']]) {
      const home = placeSide([...xi(hf, 'h'), ...(hf === '4-3-3' ? [sub] : [])], defaultTactics(hf), 'home')
      const away = placeSide(xi(af, 'a'), defaultTactics(af), 'away')
      const sep = separateSides(home, away)
      expect(separateSides(home, away)).toEqual(sep)
      for (const h of sep.home) {
        expect(h.x).toBeGreaterThanOrEqual(0)
        expect(h.x).toBeLessThanOrEqual(100)
        expect(h.y).toBeGreaterThanOrEqual(0)
        expect(h.y).toBeLessThanOrEqual(100)
        for (const a of sep.away) expect(metres(h, a)).toBeGreaterThan(5.4)
      }
      const lw = sep.home.find((p) => p.psId === 'h-lw')
      const s = sep.home.find((p) => p.psId === 'h-sub')
      if (lw && s) expect({ x: s.x, y: s.y }).toEqual({ x: lw.x, y: lw.y })
      // The ball still never jumps more than a hop between separated men
      const path = buildBallPath({ from: 0, to: 90, momentum: [], events: [], home: sep.home, away: sep.away, seed: hf + af })
      for (let i = 1; i < path.length; i++) if (path[i].kind !== 'reset') expect(Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)).toBeLessThanOrEqual(MAX_HOP + 1)
    }
  })
})

describe('momentum scale', () => {
  it('is the largest swing played so far, rounded up to 5 per cent, between 10 and 50', () => {
    const momentum = Array.from({ length: 18 }, (_, i) => (i === 3 ? 0.66 : i === 12 ? 0.18 : 0.52))
    expect(momentumScale(momentum, 30)).toBeCloseTo(0.2, 10)
    expect(momentumScale(momentum, 95)).toBeCloseTo(0.35, 10)
    expect(momentumScale(momentum, 0)).toBeCloseTo(0.1, 10)
    expect(momentumScale(Array(18).fill(0.5), 95)).toBeCloseTo(0.1, 10)
    expect(momentumScale(Array(18).fill(1), 95)).toBeCloseTo(0.5, 10)
  })
})
