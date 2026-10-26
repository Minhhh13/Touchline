/** QA-10 (docs/QA.md): an aborted View Transition must not surface as an unhandled rejection (a page error). */
import { afterEach, describe, expect, it } from 'vitest'
import { withViewTransition } from '../motion'

const g = globalThis as unknown as { document?: unknown }

describe('QA-10: an aborted view transition', () => {
  afterEach(() => {
    delete g.document
  })

  it('still makes the change, clears the transition class and leaves no unhandled rejection', async () => {
    const classes = new Set<string>()
    const aborted = () => {
      const p = Promise.reject(new DOMException('Transition was aborted because of invalid state. Viewport size changed.', 'InvalidStateError'))
      return p
    }
    g.document = {
      documentElement: { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } },
      startViewTransition: (cb: () => void) => {
        cb()
        return { ready: aborted(), finished: aborted(), updateCallbackDone: Promise.resolve() }
      },
    }
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    let ran = 0
    withViewTransition(() => ran++)
    await new Promise((r) => setTimeout(r, 20))
    process.off('unhandledRejection', onUnhandled)
    expect(ran).toBe(1)
    expect(classes.has('vt')).toBe(false)
    expect(unhandled).toEqual([])
  })
})
