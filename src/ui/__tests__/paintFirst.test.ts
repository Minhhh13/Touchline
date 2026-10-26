import { describe, expect, it } from 'vitest'
import { afterNextPaint } from '../paintFirst'

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
