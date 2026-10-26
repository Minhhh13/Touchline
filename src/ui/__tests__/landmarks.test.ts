import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAIN_ID, pickMain, skipToMain, watchMainLandmark } from '../landmarks'

/** A stand-in element: the class list, the attributes and the id the landmark code reads and writes. */
function el(...classes: string[]) {
  const attrs = new Map<string, string>()
  const listeners: Array<() => void> = []
  return {
    classList: { contains: (c: string) => classes.includes(c) },
    id: '',
    focused: false,
    getAttribute: (k: string) => attrs.get(k) ?? null,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    addEventListener: (_: string, f: () => void) => void listeners.push(f),
    focus() {
      this.focused = true
    },
    blur: () => listeners.splice(0).forEach((f) => f()),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('the main landmark', () => {
  it('is the first .page child, never the top bar, the skip link or the toast', () => {
    const page = el('page', 'home')
    expect(pickMain([el('skip-link'), el('topbar'), page, el('page', 'other')])).toBe(page)
    expect(pickMain([el('topbar'), el('toast')])).toBeNull()
    expect(pickMain([])).toBeNull()
  })

  it('marks the page at once and again when a screen swaps it', () => {
    let onChange: () => void = () => {}
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(cb: () => void) {
          onChange = cb
        }
        observe = observe
        disconnect = disconnect
      },
    )
    const first = el('page')
    const app = { children: [el('topbar'), first] as ReturnType<typeof el>[] }
    const stop = watchMainLandmark(app as unknown as HTMLElement)
    expect(first.getAttribute('role')).toBe('main')
    expect(first.id).toBe(MAIN_ID)
    expect(observe).toHaveBeenCalledWith(app, { childList: true })
    const next = el('page', 'dugout-page')
    app.children = [el('topbar'), next]
    onChange()
    expect(next.getAttribute('role')).toBe('main')
    expect(next.id).toBe(MAIN_ID)
    stop?.()
    expect(disconnect).toHaveBeenCalled()
  })

  it('does nothing without an element or a MutationObserver', () => {
    expect(watchMainLandmark(null)).toBeUndefined()
    vi.stubGlobal('MutationObserver', undefined)
    expect(watchMainLandmark({ children: [el('page')] } as unknown as HTMLElement)).toBeUndefined()
  })
})

describe('the skip link', () => {
  it('focuses the page, which drops its tabindex on blur, and keeps the hash', () => {
    const main = el('page')
    vi.stubGlobal('document', { getElementById: (id: string) => (id === MAIN_ID ? main : null) })
    const preventDefault = vi.fn()
    skipToMain({ preventDefault })
    expect(preventDefault).toHaveBeenCalled()
    expect(main.focused).toBe(true)
    expect(main.getAttribute('tabindex')).toBe('-1')
    main.blur()
    expect(main.getAttribute('tabindex')).toBeNull()
  })

  it('is harmless when no screen is mounted', () => {
    vi.stubGlobal('document', { getElementById: () => null })
    expect(() => skipToMain()).not.toThrow()
  })
})
