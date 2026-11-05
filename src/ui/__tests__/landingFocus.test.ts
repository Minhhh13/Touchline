import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pending = vi.hoisted(() => ({ effects: [] as Array<() => (() => void) | void>, paints: [] as Array<() => void> }))
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useEffect: (effect: () => (() => void) | void) => pending.effects.push(effect) }))
vi.mock('../afterPaint', () => ({ runAfterPaint: (callback: () => void) => pending.paints.push(callback) }))
import { useFocusOnLanding } from '../a11y'

beforeEach(() => {
  pending.effects.length = 0
  pending.paints.length = 0
})
afterEach(() => vi.unstubAllGlobals())

describe('focus after a reel lands', () => {
  it('announces the new club without moving the viewport that holds the reel', () => {
    const body = {}
    vi.stubGlobal('document', { body, activeElement: { disabled: true } })
    const focus = vi.fn()
    const target = { current: { focus } as unknown as HTMLElement }
    useFocusOnLanding(true, target, { preventScroll: true })
    pending.effects[0]()
    expect(focus).not.toHaveBeenCalled()
    pending.paints[0]()
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
  })

  it('leaves a real control alone if the viewer moved there while the reel ran', () => {
    const body = {}
    vi.stubGlobal('document', { body, activeElement: { disabled: false } })
    const focus = vi.fn()
    useFocusOnLanding(true, { current: { focus } as unknown as HTMLElement }, { preventScroll: true })
    pending.effects[0]()
    pending.paints[0]()
    expect(focus).not.toHaveBeenCalled()
  })

  it('keeps the existing scroll-to-next-action behavior and cancels a departed screen', () => {
    const body = {}
    vi.stubGlobal('document', { body, activeElement: body })
    const focus = vi.fn()
    useFocusOnLanding(true, { current: { focus } as unknown as HTMLElement })
    const cleanup = pending.effects[0]()
    pending.paints[0]()
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: false })
    focus.mockClear()
    cleanup?.()
    pending.paints[0]()
    expect(focus).not.toHaveBeenCalled()
  })
})
