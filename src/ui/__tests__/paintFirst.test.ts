import { describe, expect, it } from 'vitest'
import { afterNextPaint, runAfterPaint, usePaintFirst } from '../paintFirst'
import { PAINT_FALLBACK_MS, useAfterPaint } from '../afterPaint'

/** A fake clock: frames and timed tasks, run by hand. */
function fakeClock() {
  const frames: Array<() => void> = []
  const tasks: Array<{ at: number; cb: () => void }> = []
  let now = 0
  return {
    raf: (cb: () => void) => frames.push(cb),
    later: (cb: () => void, ms: number) => tasks.push({ at: now + ms, cb }),
    frame: () => frames.splice(0).forEach((cb) => cb()),
    advance(ms: number) {
      now += ms
      for (const t of tasks.filter((x) => x.at <= now).sort((a, b) => a.at - b.at)) {
        tasks.splice(tasks.indexOf(t), 1)
        t.cb()
      }
    },
  }
}

describe('one paint-first helper', () => {
  it('the Dugout Play button and Sim 5, Kick off share it (the copies had drifted: Play had no hidden-tab fallback)', () => {
    expect(usePaintFirst).toBe(useAfterPaint)
  })

  it('runs once after the next paint, and the fallback then does nothing', () => {
    const c = fakeClock()
    let runs = 0
    runAfterPaint(() => runs++, c.raf, c.later)
    expect(runs).toBe(0)
    c.frame()
    c.advance(0)
    expect(runs).toBe(1)
    c.advance(PAINT_FALLBACK_MS)
    expect(runs).toBe(1)
  })

  it('runs once in a hidden tab that paints no frame, and a late frame then does nothing', () => {
    const c = fakeClock()
    let runs = 0
    runAfterPaint(() => runs++, c.raf, c.later)
    c.advance(PAINT_FALLBACK_MS - 1)
    expect(runs).toBe(0)
    c.advance(1)
    expect(runs).toBe(1)
    c.frame()
    c.advance(0)
    expect(runs).toBe(1)
  })
})

describe('afterNextPaint', () => {
  it('waits for a frame, then a task after it, before running', () => {
    const log: string[] = []
    const frames: Array<() => void> = []
    const tasks: Array<() => void> = []
    afterNextPaint(() => log.push('ran'), (cb) => frames.push(cb), (cb) => tasks.push(cb))
    expect(log).toEqual([])
    expect(tasks.length).toBe(0)
    frames.shift()!()
    expect(log).toEqual([])
    expect(tasks.length).toBe(1)
    tasks.shift()!()
    expect(log).toEqual(['ran'])
  })

  it('falls back to a task alone where there is no frame callback', () => {
    const log: string[] = []
    const tasks: Array<() => void> = []
    afterNextPaint(() => log.push('ran'), undefined, (cb) => tasks.push(cb))
    tasks.shift()!()
    expect(log).toEqual(['ran'])
  })
})
