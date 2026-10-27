import { describe, expect, it } from 'vitest'
import type { KeyboardEvent } from 'react'
import { onTabListKey, tabStep } from '../a11y'
import { focusHasFallen, pickRescue, RESCUE_BOXES } from '../focusRescue'
import { SCROLL_BOXES } from '../scrollFocus'
import { upgraderAnnouncement } from '../upgradeDial'

describe('tab strips (WAI-ARIA tabs)', () => {
  it('the arrows move and wrap, Home and End jump, other keys do nothing', () => {
    expect(tabStep('ArrowRight', 0, 4)).toBe(1)
    expect(tabStep('ArrowDown', 3, 4)).toBe(0)
    expect(tabStep('ArrowLeft', 0, 4)).toBe(3)
    expect(tabStep('ArrowUp', 2, 4)).toBe(1)
    expect(tabStep('Home', 2, 4)).toBe(0)
    expect(tabStep('End', 0, 4)).toBe(3)
    expect(tabStep('Enter', 0, 4)).toBeNull()
    expect(tabStep('Tab', 0, 4)).toBeNull()
    expect(tabStep('ArrowRight', 0, 0)).toBeNull()
  })

  it('a key on the strip focuses and chooses the next tab', () => {
    const log: string[] = []
    const tab = (id: string) => ({ id, focus: () => log.push(`focus ${id}`), click: () => log.push(`click ${id}`) })
    const tabs = [tab('a'), tab('b'), tab('c')]
    let prevented = false
    const e = { key: 'ArrowLeft', target: tabs[0], currentTarget: { querySelectorAll: () => tabs }, preventDefault: () => (prevented = true) } as unknown as KeyboardEvent<HTMLElement>
    onTabListKey(e)
    expect(prevented).toBe(true)
    expect(log).toEqual(['focus c', 'click c'])
    // A key from something inside a tab that is not a tab itself is left alone
    log.length = 0
    const inner = { key: 'ArrowRight', target: {}, currentTarget: { querySelectorAll: () => tabs }, preventDefault: () => (prevented = false) } as unknown as KeyboardEvent<HTMLElement>
    onTabListKey(inner)
    expect(log).toEqual([])
  })
})

describe('focus rescue', () => {
  type Node = { name: string; on: boolean; box: boolean }
  const n = (name: string, on: boolean, box: boolean): Node => ({ name, on, box })

  it('goes back to the nearest box still on the page', () => {
    const chain = [n('row', false, false), n('list', false, false), n('panel', true, true), n('page', true, false)]
    expect(pickRescue(chain, (x) => x.on, (x) => x.box)?.name).toBe('panel')
  })

  it('skips a box that went with the control, and gives null (the new page) when the whole screen changed', () => {
    const swapped = [n('button', false, false), n('panel', false, true), n('old page', false, false)]
    expect(pickRescue(swapped, (x) => x.on, (x) => x.box)).toBeNull()
    const inner = [n('button', false, false), n('inner panel', false, true), n('outer panel', true, true)]
    expect(pickRescue(inner, (x) => x.on, (x) => x.box)?.name).toBe('outer panel')
  })

  it('a landing moves the focus from nowhere, a disabled control or a rescued spot, never from a real control', () => {
    const body = {}
    const rescued = {}
    expect(focusHasFallen(null, body, null)).toBe(true)
    expect(focusHasFallen(body, body, null)).toBe(true)
    expect(focusHasFallen({ disabled: true }, body, null)).toBe(true)
    expect(focusHasFallen(rescued, body, rescued)).toBe(true)
    expect(focusHasFallen({ disabled: false }, body, rescued)).toBe(false)
    expect(focusHasFallen({}, body, null)).toBe(false)
  })

  it('names the dialogs, panels and shell boxes', () => {
    for (const s of ['[role="dialog"]', '.panel', '.fit-cell']) expect(RESCUE_BOXES).toContain(s)
  })
})

describe('scroll boxes found in round 3', () => {
  it('the manager guide, the case guide and locker, a bracket and the head-to-head log join the Tab order when they scroll', () => {
    expect(SCROLL_BOXES).toContain('.mspin-guide')
    expect(SCROLL_BOXES).toContain('.case-guide')
    expect(SCROLL_BOXES).toContain('.bracket')
    expect(SCROLL_BOXES).toContain('.h2h-log')
    expect(SCROLL_BOXES).toContain('.case-locker')
  })
})

describe('the Upgrader for a screen reader', () => {
  const base = { name: 'H. Kane', chance: 38, boost: 10, won: true, locked: false, delta: 10, base: 85, hideRatings: false, roll: 12 }
  it('says the gamble while the dial turns, then the verdict once', () => {
    expect(upgraderAnnouncement({ ...base, landed: false })).toBe('H. Kane: 38% for plus 10. The dial is turning.')
    expect(upgraderAnnouncement({ ...base, landed: true })).toBe('Upgraded! H. Kane plus 10, 85 to 95. Rolled 12 against 38%.')
  })
  it('a loss, a lock and hidden ratings', () => {
    expect(upgraderAnnouncement({ ...base, landed: true, won: false, delta: -5, roll: 70 })).toBe('Downgraded. H. Kane minus 5, 85 to 80. Rolled 70 against 38%.')
    expect(upgraderAnnouncement({ ...base, landed: true, won: false, locked: true, delta: 0, roll: 70 })).toBe('The lock held. H. Kane keeps his rating. Rolled 70 against 38%.')
    expect(upgraderAnnouncement({ ...base, landed: true, hideRatings: true })).toBe('Upgraded! H. Kane plus 10. Rolled 12 against 38%.')
  })
})
