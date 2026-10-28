import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loopKeep } from '../components/LivePitch'
import { keepPlace } from '../components/PowerUpButton'

const source = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8')

describe('the live pitch loop keeps the device and the camera across its restarts (LivePitch)', () => {
  it('keeps the same state while the orientation and the match are the same', () => {
    const a = loopKeep(null, false, 'match-1')
    a.perf.frames = 120
    a.perf.lite = true
    a.cam.s = 1.6
    // A substitution's new placements restart the effect: nothing is lost
    expect(loopKeep(a, false, 'match-1')).toBe(a)
  })

  it('keeps the frame-time record and the cap but resets the camera for a new match or orientation', () => {
    const a = loopKeep(null, false, 'match-1')
    a.perf.frames = 120
    a.perf.lite = true
    a.cam.s = 1.6
    for (const b of [loopKeep(a, false, 'match-2'), loopKeep(a, true, 'match-1')]) {
      expect(b).not.toBe(a)
      expect(b.perf).toBe(a.perf)
      expect(b.cap).toBe(a.cap)
      expect(b.cam.s).toBe(1)
    }
    // The fresh camera stands at the centre of its own box
    expect(loopKeep(null, true, 'm').cam).toEqual({ x: -3 + 74 / 2, y: -3 + 111 / 2, s: 1 })
    expect(loopKeep(null, false, 'm').cam).toEqual({ x: -3 + 111 / 2, y: -3 + 74 / 2, s: 1 })
  })

  it('reads the kept state in the effect rather than making a fresh one', () => {
    const src = source('components/LivePitch.tsx')
    expect(src).toContain('keepRef.current = loopKeep(keepRef.current, portrait, seed)')
    expect(src).not.toMatch(/const perf = \{ mean: 16\.7/)
    expect(src).not.toMatch(/const cap = frameCap\(\)/)
  })
})

describe('a tip re-measured on every scroll renders only when it moves (PowerUpButton)', () => {
  it('keeps the placement already shown when the measure is the same', () => {
    const p = { left: 10, top: 20, maxHeight: 300, below: true }
    expect(keepPlace(p, { ...p })).toBe(p)
    expect(keepPlace(null, p)).toBe(p)
    for (const next of [{ ...p, left: 11 }, { ...p, top: 21 }, { ...p, maxHeight: 299 }, { ...p, below: false }]) expect(keepPlace(p, next)).toBe(next)
  })

  it('both tips go through it, and the bubble width is written only when it changes', () => {
    const src = source('components/PowerUpButton.tsx')
    expect(src.match(/setPlace\(\(prev\) => keepPlace\(prev, next\)\)/g)?.length).toBe(2)
    expect(src).toContain('if (b.style.width !== px) b.style.width = px')
  })
})

describe('components read the store field by field', () => {
  // A bare useStore() re-renders on every store write (LeagueAwards worked out the whole league's awards each time)
  for (const file of ['LeagueAwards', 'Locker', 'PlayerCard', 'PowerUps', 'ShootoutPanel']) {
    it(`${file} has no whole-store subscription`, () => {
      expect(source(`components/${file}.tsx`)).not.toMatch(/useStore\(\)/)
    })
  }
})

describe('one reduced-motion helper', () => {
  it('Upgrader and ShootoutPanel use motion.ts, not their own copy', () => {
    for (const file of ['Upgrader', 'ShootoutPanel']) {
      const src = source(`components/${file}.tsx`)
      expect(src).toContain("import { prefersReducedMotion } from '../motion'")
      expect(src).not.toMatch(/function prefersReducedMotion/)
    }
  })

  it("the Upgrader's announcement names an unknown player through t()", () => {
    expect(source('components/Upgrader.tsx')).not.toContain("?? 'Your player'")
  })
})
