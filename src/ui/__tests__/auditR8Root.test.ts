/** r8 audit of the root UI modules (src/ui/*.ts): the fixes found there. */
import { afterEach, describe, expect, it } from 'vitest'
import { withViewTransition } from '../motion'
import * as motion from '../motion'
import { pngAndRelease } from '../shareCard'

const g = globalThis as unknown as { document?: unknown }

describe('withViewTransition: overlapping transitions', () => {
  afterEach(() => {
    delete g.document
  })

  it('keeps the vt class while a newer transition still runs after an older one was skipped', async () => {
    const classes = new Set<string>()
    const finishes: Array<() => void> = []
    g.document = {
      documentElement: { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } },
      startViewTransition: (cb: () => void) => {
        cb()
        let finish = () => {}
        const finished = new Promise<void>((r) => (finish = r))
        finishes.push(finish)
        return { ready: Promise.resolve(), finished, updateCallbackDone: Promise.resolve() }
      },
    }
    let ran = 0
    withViewTransition(() => ran++)
    withViewTransition(() => ran++)
    expect(ran).toBe(2)
    // The browser skips the first when the second starts: its `finished` settles while the second runs
    finishes[0]()
    await new Promise((r) => setTimeout(r, 0))
    expect(classes.has('vt')).toBe(true)
    finishes[1]()
    await new Promise((r) => setTimeout(r, 0))
    expect(classes.has('vt')).toBe(false)
  })

  it('clears the class when the browser throws on start, and a later transition still sets and clears it', async () => {
    const classes = new Set<string>()
    let throwNext = true
    g.document = {
      documentElement: { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } },
      startViewTransition: (cb: () => void) => {
        if (throwNext) {
          throwNext = false
          throw new Error('no')
        }
        cb()
        return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve() }
      },
    }
    let ran = 0
    withViewTransition(() => ran++)
    expect(ran).toBe(1)
    expect(classes.has('vt')).toBe(false)
    withViewTransition(() => ran++)
    expect(classes.has('vt')).toBe(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(ran).toBe(2)
    expect(classes.has('vt')).toBe(false)
  })
})

describe('share cards give their canvas back', () => {
  it('returns the PNG and empties the canvas', () => {
    const canvas = { width: 1080, height: 1350, toDataURL: (type: string) => `data:${type};base64,AAAA` }
    expect(pngAndRelease(canvas)).toBe('data:image/png;base64,AAAA')
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
  })
})

describe('dead code', () => {
  it('useOncePerVisit (nothing used it) is gone', () => {
    expect('useOncePerVisit' in motion).toBe(false)
  })
})
