import { describe, expect, it } from 'vitest'
import { statsAt, statsSeries } from '@engine/matchStats'
import { sinceMinute } from '../matchday/model'
import { dugoutKey, isControlTarget, type DugoutKeyContext } from '../dugoutKeys'
import { resultFeed, u } from './feeds'

const get = (id: string) => u.index[id]

describe('the since-the-shout read-out', () => {
  it('is the difference of the decided series between 70 and the clock, never negative, and nothing until after 70', () => {
    for (let i = 0; i < 8; i++) {
      const feed = resultFeed(i)
      const series = statsSeries(feed, get)
      expect(sinceMinute(series, 70, 70)).toBeNull()
      expect(sinceMinute(series, 70, 40)).toBeNull()
      const end = feed.lastMinute
      const out = sinceMinute(series, 70, end)!
      const a = statsAt(series, 70)
      const b = statsAt(series, end)
      expect(out.home.shots).toBe(b.home.shots - a.home.shots)
      expect(out.away.shots).toBe(b.away.shots - a.away.shots)
      expect(out.home.xg).toBeCloseTo(b.home.xg - a.home.xg, 1)
      // It only grows as the clock runs: it reads the series up to the clock and no further
      let prev = 0
      for (let m = 71; m <= end; m++) {
        const s = sinceMinute(series, 70, m)!
        expect(s.home.shots + s.away.shots).toBeGreaterThanOrEqual(prev)
        prev = s.home.shots + s.away.shots
        expect(s.home.xg).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('the Dugout keyboard', () => {
  const ctx = (over: Partial<DugoutKeyContext> = {}): DugoutKeyContext => ({ onControl: false, modalOpen: false, modifier: false, canPlay: true, tabs: 12, ...over })
  it('Space plays the week only when allowed and nothing else is in the way', () => {
    expect(dugoutKey(' ', ctx())).toEqual({ kind: 'play' })
    expect(dugoutKey(' ', ctx({ canPlay: false }))).toBeNull()
    expect(dugoutKey(' ', ctx({ onControl: true }))).toBeNull()
    expect(dugoutKey(' ', ctx({ modalOpen: true }))).toBeNull()
    expect(dugoutKey(' ', ctx({ modifier: true }))).toBeNull()
    expect(dugoutKey('Enter', ctx())).toBeNull()
  })
  it('1 to 9 and 0 open the first ten tabs, within the tabs shown', () => {
    expect(dugoutKey('1', ctx())).toEqual({ kind: 'tab', index: 0 })
    expect(dugoutKey('9', ctx())).toEqual({ kind: 'tab', index: 8 })
    expect(dugoutKey('0', ctx())).toEqual({ kind: 'tab', index: 9 })
    expect(dugoutKey('0', ctx({ tabs: 9 }))).toBeNull()
    expect(dugoutKey('3', ctx({ onControl: true }))).toBeNull()
    // Tabs still switch while a decision is pending
    expect(dugoutKey('2', ctx({ canPlay: false }))).toEqual({ kind: 'tab', index: 1 })
  })
  it('treats fields, buttons and widget roles as controls', () => {
    const el = (tagName: string, role: string | null = null, isContentEditable = false) => ({ tagName, isContentEditable, getAttribute: (n: string) => (n === 'role' ? role : null) })
    expect(isControlTarget(null)).toBe(false)
    expect(isControlTarget(el('BODY'))).toBe(false)
    expect(isControlTarget(el('DIV'))).toBe(false)
    for (const t of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']) expect(isControlTarget(el(t))).toBe(true)
    expect(isControlTarget(el('DIV', 'radio'))).toBe(true)
    expect(isControlTarget(el('DIV', null, true))).toBe(true)
  })
})
