/** QA r14, R14-1: the tap that ends typing on a phone lands on the bar it was aimed at (typingHold.ts, styles.css). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isTypingField, TYPING_HOLD_ATTR, TYPING_HOLD_MS, watchTypingHold } from '../typingHold'

const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8')

/** A page with one `.app` and whatever has the focus, enough for the watcher. */
function fakePage() {
  const attrs = new Set<string>()
  const app = { setAttribute: (k: string) => void attrs.add(k), removeAttribute: (k: string) => void attrs.delete(k), held: () => attrs.has(TYPING_HOLD_ATTR) }
  const doc = Object.assign(new EventTarget(), { activeElement: null as { tagName: string; type?: string } | null })
  const stop = watchTypingHold(doc as unknown as Document, () => app as unknown as Element)
  const fire = (type: string) => doc.dispatchEvent(new Event(type))
  return { app, doc, stop, fire }
}

afterEach(() => vi.useRealTimers())

describe('the typing hold (R14-1)', () => {
  it('reads a typing field as styles.css does', () => {
    for (const type of ['text', 'search', 'email', 'number', 'password', undefined]) expect(isTypingField({ tagName: 'INPUT', type })).toBe(true)
    for (const type of ['checkbox', 'radio', 'range', 'button', 'submit']) expect(isTypingField({ tagName: 'input', type })).toBe(false)
    expect(isTypingField({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTypingField({ tagName: 'BUTTON' })).toBe(false)
    expect(isTypingField(null)).toBe(false)
  })

  it('holds the typing layout from a press that starts while typing until its click has gone out', () => {
    vi.useFakeTimers()
    const { app, doc, stop, fire } = fakePage()
    doc.activeElement = { tagName: 'INPUT', type: 'text' }
    fire('pointerdown')
    expect(app.held()).toBe(true)
    // The press moves the focus off the field: the layout still holds through the release
    doc.activeElement = { tagName: 'BUTTON' }
    fire('pointerup')
    expect(app.held()).toBe(true)
    fire('click')
    expect(app.held()).toBe(true)
    vi.advanceTimersByTime(0)
    expect(app.held()).toBe(false)
    stop()
  })

  it('never holds for a press made with nothing typed, and lets a press with no click go after its limit', () => {
    vi.useFakeTimers()
    const { app, doc, stop, fire } = fakePage()
    doc.activeElement = { tagName: 'BUTTON' }
    fire('pointerdown')
    expect(app.held()).toBe(false)
    fire('click')
    expect(app.held()).toBe(false)
    // A scroll that began in a field: no click comes
    doc.activeElement = { tagName: 'TEXTAREA' }
    fire('pointerdown')
    vi.advanceTimersByTime(TYPING_HOLD_MS - 1)
    expect(app.held()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(app.held()).toBe(false)
    // Stopping drops a hold in progress
    fire('pointerdown')
    expect(app.held()).toBe(true)
    stop()
    expect(app.held()).toBe(false)
    fire('pointerdown')
    expect(app.held()).toBe(false)
  })

  it('holds what the focus rule holds, and outranks the dock (its --dock-h would win the tie otherwise)', () => {
    const at = css.indexOf('/* The keyboard: while a text field has the focus on a phone')
    const block = css.slice(at, css.indexOf('\n}\n', at))
    expect(block).toContain('.app:not(.bar-hidden):not(.dock-off)[data-typing-hold] {\n    --dock-h: 0px;')
    for (const part of ['> .topbar nav', '.bottom-bar', '.cta-bar']) expect(block).toContain(`.app[data-typing-hold] ${part}`)
    // The dock's own rule comes earlier with three classes: the hold has four
    expect(css.indexOf('  .app:not(.bar-hidden):not(.dock-off) {\n    --dock-h: calc(58px')).toBeLessThan(at)
  })
})
