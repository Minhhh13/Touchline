import { describe, expect, it } from 'vitest'
import type { KeyboardEvent } from 'react'
import { isActivationKey, outcomeWord, pressable, resultsLabel } from '../a11y'
import { scrollFocusAction, SCROLL_BOXES } from '../scrollFocus'
import { contrastRatio, inkOn } from '../format'

/** A stand-in keyboard event: only what `pressable` reads. */
function key(k: string, onInner = false) {
  const target = {}
  const current = onInner ? {} : target
  let prevented = false
  const e = { key: k, target, currentTarget: current, preventDefault: () => (prevented = true) } as unknown as KeyboardEvent<HTMLElement>
  return { e, prevented: () => prevented }
}

describe('activation keys', () => {
  it('Enter and Space press, other keys do not', () => {
    expect(isActivationKey('Enter')).toBe(true)
    expect(isActivationKey(' ')).toBe(true)
    expect(isActivationKey('Spacebar')).toBe(true)
    for (const k of ['Tab', 'Escape', 'a', 'ArrowDown', 'Shift']) expect(isActivationKey(k)).toBe(false)
  })

  it('pressable joins the Tab order and runs its action on Enter or Space only', () => {
    let runs = 0
    const p = pressable(() => runs++)
    expect(p.tabIndex).toBe(0)
    const enter = key('Enter')
    p.onKeyDown(enter.e)
    expect(runs).toBe(1)
    expect(enter.prevented()).toBe(true)
    p.onKeyDown(key(' ').e)
    expect(runs).toBe(2)
    const tab = key('Tab')
    p.onKeyDown(tab.e)
    expect(runs).toBe(2)
    expect(tab.prevented()).toBe(false)
  })

  it('pressable leaves keys on a control inside it alone', () => {
    let runs = 0
    const p = pressable(() => runs++)
    const inner = key('Enter', true)
    p.onKeyDown(inner.e)
    expect(runs).toBe(0)
    expect(inner.prevented()).toBe(false)
  })
})

describe('results in words', () => {
  it('names each outcome', () => {
    expect(outcomeWord('W')).toBe('won')
    expect(outcomeWord('D')).toBe('drawn')
    expect(outcomeWord('L')).toBe('lost')
  })
  it('reads a run as one sentence', () => {
    expect(resultsLabel(['W', 'W', 'D', 'L'])).toBe('Results, oldest first: won, won, drawn, lost')
    expect(resultsLabel([], 'Form')).toBe('Form: none yet')
  })
})

describe('scroll boxes', () => {
  const base = { scrollable: false, hasFocusable: false, managed: false, ownTabIndex: false }
  it('a box that scrolls with nothing focusable joins the Tab order', () => {
    expect(scrollFocusAction({ ...base, scrollable: true })).toBe('add')
  })
  it('a box with a control inside, or one that does not scroll, is left alone', () => {
    expect(scrollFocusAction({ ...base, scrollable: true, hasFocusable: true })).toBe('none')
    expect(scrollFocusAction(base)).toBe('none')
  })
  it('a box we added leaves the Tab order once it stops scrolling or gains a control', () => {
    expect(scrollFocusAction({ ...base, managed: true, ownTabIndex: true })).toBe('remove')
    expect(scrollFocusAction({ ...base, scrollable: true, hasFocusable: true, managed: true, ownTabIndex: true })).toBe('remove')
    expect(scrollFocusAction({ ...base, scrollable: true, managed: true, ownTabIndex: true })).toBe('none')
  })
  it('never touches a tabindex a component set itself', () => {
    expect(scrollFocusAction({ ...base, scrollable: true, ownTabIndex: true })).toBe('none')
  })
  it('covers the shell boxes and the table wrappers', () => {
    for (const sel of ['.fit-cell', '.tab-body', '.tbl-wrap', '.screen-body', '.draft-log', '.summary-body']) expect(SCROLL_BOXES).toContain(sel)
  })
})

describe('badge ink', () => {
  it('clears 4.5:1 on every kit colour', () => {
    let worst = 21
    for (let r = 0; r < 256; r += 15) {
      for (let g = 0; g < 256; g += 15) {
        for (let b = 0; b < 256; b += 15) {
          const bg = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
          worst = Math.min(worst, contrastRatio(inkOn(bg), bg))
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(4.5)
  })
  it('the reds axe flagged now pass, and pale or dark kits keep their ink', () => {
    for (const red of ['#ef0107', '#eb172b']) expect(contrastRatio(inkOn(red), red)).toBeGreaterThanOrEqual(4.5)
    expect(inkOn('#ffffff')).toBe('#111')
    expect(inkOn('#132257')).toBe('#fff')
  })
  it('contrast ratios match the WCAG figures', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#fff', '#fff')).toBeCloseTo(1, 5)
    expect(contrastRatio('not a colour', '#fff')).toBe(1)
  })
})
