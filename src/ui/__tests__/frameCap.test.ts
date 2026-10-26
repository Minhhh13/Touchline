import { describe, expect, it } from 'vitest'
import { capFrame, FRAME_CAP, frameCap, wakeCap, type FrameCap } from '../match/frameCap'

/** Drive the cap with a device whose drawn frames take `drawMs` until the next animation frame (a skipped one 16.7 ms). */
function run(c: FrameCap, start: number, frames: number, drawMs: number): { t: number; drawn: number[] } {
  let t = start
  const drawn: number[] = []
  for (let i = 0; i < frames; i++) {
    const { draw } = capFrame(c, t)
    if (draw) drawn.push(t)
    t += draw ? Math.max(16.7, drawMs) : 16.7
  }
  return { t, drawn }
}

describe('the live pitch frame cap', () => {
  it('draws every frame on a device that keeps up, and a hiccup never caps it', () => {
    const c = frameCap()
    const a = run(c, 1000, 600, 16.7)
    expect(a.drawn.length).toBe(600)
    // A few long frames among quick ones
    let t = a.t
    for (let i = 0; i < 300; i++) {
      expect(capFrame(c, t).draw).toBe(true)
      t += i % 7 === 0 ? 60 : 16.7
    }
    expect(c.capped).toBe(false)
  })

  it('caps a device that keeps missing 60 fps at 30, and lifts the cap once drawn frames fit again', () => {
    const c = frameCap()
    // 40 ms a frame: capped after the streak
    const slow = run(c, 0, 200, 40)
    expect(c.capped).toBe(true)
    // Capped, drawn frames are at least a 30 fps frame apart (less the slack), never closer
    const capped = run(c, slow.t, 300, 30)
    const gaps = capped.drawn.slice(1).map((x, i) => x - capped.drawn[i])
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(FRAME_CAP.interval - FRAME_CAP.slack)
    expect(c.capped).toBe(true)
    // The device recovers: every drawn frame is followed by a 60 fps frame
    run(c, capped.t, 4 * FRAME_CAP.recover, 16.7)
    expect(c.capped).toBe(false)
    const after = run(c, 1e6, 100, 16.7)
    expect(after.drawn.length).toBe(100)
  })

  it('always draws the first frame after a sleep', () => {
    const c = frameCap()
    run(c, 0, 200, 40)
    expect(c.capped).toBe(true)
    capFrame(c, 5000)
    wakeCap(c)
    expect(capFrame(c, 5001)).toEqual({ draw: true, interval: 0 })
  })
})
