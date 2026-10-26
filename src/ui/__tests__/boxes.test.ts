import { describe, expect, it } from 'vitest'
import { boxesKey, canHide, gridTemplate, parseHidden, popPlacement, presentBoxes, readHidden, serialiseHidden, toggleBox, visibleIds, writeHidden, type BoxSet, type BoxStorage } from '../boxes'
import { ALL_SETS, DUGOUT_ALL, DUGOUT_TABS } from '../boxSets'
import { defaultSlots, MATCHDAY_COMPACT, matchdayBoxes, SLOT_IDS, WIDGET_LABEL } from '../matchday/widgetIds'

const SET: BoxSet = { screen: 'test', title: 'Test', boxes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] }
const FREE: BoxSet = { ...SET, screen: 'test-free', min: 0 }

function memory(): BoxStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }
}
const broken: BoxStorage = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
  removeItem: () => {
    throw new Error('blocked')
  },
}

describe('the stored hidden boxes', () => {
  it('keeps only the set’s ids, once each, in the set’s order; anything else reads as nothing hidden', () => {
    expect(parseHidden('["c","a","zz","a",3,null]', SET)).toEqual(['a', 'c'])
    for (const raw of [null, undefined, '', 'nope', '{"a":1}', '"a"', '42', '[']) expect(parseHidden(raw, SET)).toEqual([])
    expect(parseHidden(serialiseHidden(['b', 'b']), SET)).toEqual(['b'])
  })
  it('lives under one key per screen and survives storage that throws', () => {
    const s = memory()
    writeHidden(SET, ['b'], s)
    expect(s.data.get(boxesKey('test'))).toBe('["b"]')
    expect(readHidden(SET, s)).toEqual(['b'])
    // Nothing hidden removes the key: a reset leaves no trace
    writeHidden(SET, [], s)
    expect(s.data.has(boxesKey('test'))).toBe(false)
    expect(() => writeHidden(SET, ['a'], broken)).not.toThrow()
    expect(readHidden(SET, broken)).toEqual([])
    expect(readHidden(SET, null)).toEqual([])
    expect(boxesKey('dugout-squad')).toBe('touchline-boxes-dugout-squad')
  })
})

describe('which boxes show', () => {
  it('shows every box not hidden, and always keeps one on', () => {
    expect(visibleIds(SET, [])).toEqual(['a', 'b', 'c'])
    expect(visibleIds(SET, ['b'])).toEqual(['a', 'c'])
    // A stored choice that hides everything (a box renamed, or edited storage) brings the first back
    expect(visibleIds(SET, ['a', 'b', 'c'])).toEqual(['a'])
    // A set whose essential box lives outside it may hide them all
    expect(visibleIds(FREE, ['a', 'b', 'c'])).toEqual([])
  })
  it('counts only the boxes on the page now', () => {
    expect(presentBoxes(SET, ['c', 'a']).map((b) => b.id)).toEqual(['a', 'c'])
    // b is hidden but absent today: the one present box that is left stays on
    expect(visibleIds(SET, ['a', 'b'], ['a', 'c'])).toEqual(['c'])
    expect(visibleIds(SET, ['c'], ['a', 'c'])).toEqual(['a'])
    expect(visibleIds(SET, ['a', 'c'], ['a', 'c'])).toEqual(['a'])
    expect(visibleIds(SET, [], [])).toEqual([])
  })
  it('refuses to untick the last box that must stay, and ticks back freely', () => {
    let hidden: string[] = []
    hidden = toggleBox(SET, hidden, 'a')
    hidden = toggleBox(SET, hidden, 'c')
    expect(hidden).toEqual(['a', 'c'])
    expect(canHide(SET, hidden, 'b')).toBe(false)
    expect(toggleBox(SET, hidden, 'b')).toEqual(['a', 'c'])
    expect(toggleBox(SET, hidden, 'a')).toEqual(['c'])
    expect(toggleBox(SET, hidden, 'nope')).toEqual(['a', 'c'])
    expect(canHide(SET, hidden, 'a')).toBe(false)
    // min 0: the last may go
    expect(toggleBox(FREE, ['a', 'c'], 'b')).toEqual(['a', 'b', 'c'])
  })
  it('never leaves fewer than the minimum over any run of ticks', () => {
    const ids = ['a', 'b', 'c']
    let hidden: string[] = []
    for (let i = 0; i < 200; i++) {
      hidden = toggleBox(SET, hidden, ids[(i * 7 + (i >> 2)) % 3], i % 5 === 0 ? ['a', 'b'] : undefined)
      expect(visibleIds(SET, hidden).length).toBeGreaterThanOrEqual(1)
      expect(new Set(hidden).size).toBe(hidden.length)
    }
  })
})

describe('the grid the boxes left take', () => {
  const dugout = [
    { track: 'minmax(0, 1fr)', ids: ['list'] },
    { track: '380px', ids: ['pitch', 'depth'] },
  ]
  it('changes nothing while every column shows', () => {
    expect(gridTemplate(dugout, ['list', 'pitch', 'depth'])).toEqual({ template: null, count: 2 })
    // One box gone from a column that still has another: the column stays as it is
    expect(gridTemplate(dugout, ['list', 'depth']).template).toBeNull()
  })
  it('drops a hidden column and keeps the flexible tracks', () => {
    expect(gridTemplate(dugout, ['list'])).toEqual({ template: 'minmax(0, 1fr)', count: 1 })
    const three = [
      { track: 'minmax(0, 0.8fr)', ids: ['a'] },
      { track: 'minmax(0, 1.1fr)', ids: ['b'] },
      { track: 'minmax(0, 1.2fr)', ids: ['c'] },
    ]
    expect(gridTemplate(three, ['a', 'c'])).toEqual({ template: 'minmax(0, 0.8fr) minmax(0, 1.2fr)', count: 2 })
  })
  it('lets a fixed-width column take the room once no flexible one is left', () => {
    expect(gridTemplate(dugout, ['pitch'])).toEqual({ template: 'minmax(0, 1fr)', count: 1 })
    const draft = [
      { track: '300px', ids: ['reel'] },
      { track: 'minmax(0, 1fr)', ids: ['squad'] },
      { track: '360px', ids: ['pitch'] },
    ]
    expect(gridTemplate(draft, ['reel', 'pitch']).template).toBe('minmax(0, 1fr) minmax(0, 1fr)')
    expect(gridTemplate(draft, ['reel', 'squad']).template).toBe('300px minmax(0, 1fr)')
  })
  it('always shows a column of essentials (no ids)', () => {
    const cols = [
      { track: 'minmax(0, 1fr)', ids: ['a'] },
      { track: 'minmax(0, 1fr)', ids: [] },
    ]
    expect(gridTemplate(cols, [])).toEqual({ template: 'minmax(0, 1fr)', count: 1 })
    expect(gridTemplate(cols, ['a']).template).toBeNull()
    expect(gridTemplate([{ track: '1fr', ids: ['x'] }], [])).toEqual({ template: null, count: 0 })
  })
})

describe('where the checklist opens', () => {
  it('opens under the button, right-aligned, inside the gutters', () => {
    const p = popPlacement({ top: 60, bottom: 90, right: 1200 }, 1280, 720)
    expect(p).toEqual({ left: 920, width: 280, top: 96, maxHeight: 608 })
    // A button near the left edge: the list starts at the gutter
    expect(popPlacement({ top: 60, bottom: 90, right: 100 }, 1280, 720).left).toBe(16)
  })
  it('opens above a button low in the window, and fits a phone', () => {
    const p = popPlacement({ top: 640, bottom: 670, right: 400 }, 1280, 720)
    expect(p.top).toBeUndefined()
    expect(p.bottom).toBe(86)
    expect(p.maxHeight).toBe(618)
    const phone = popPlacement({ top: 100, bottom: 130, right: 380 }, 390, 844)
    expect(phone.left).toBeGreaterThanOrEqual(16)
    expect(phone.left + phone.width).toBeLessThanOrEqual(390 - 16)
  })
})

describe('the screens’ boxes', () => {
  it('names every set once, with ids unique inside it and labels to read', () => {
    const sets = [...ALL_SETS, matchdayBoxes(defaultSlots(false)), MATCHDAY_COMPACT]
    const screens = sets.map((s) => s.screen)
    expect(new Set(screens).size).toBe(screens.length)
    for (const s of sets) {
      const ids = s.boxes.map((b) => b.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids.length).toBeGreaterThan(0)
      for (const b of s.boxes) {
        expect(b.id).toMatch(/^[a-z][a-zA-Z-]*$/)
        expect(b.label.length).toBeGreaterThan(2)
      }
    }
    expect(DUGOUT_ALL).toHaveLength(Object.keys(DUGOUT_TABS).length + 1)
  })
  it('lists every dashboard slot by where it sits and the widget in it now', () => {
    const friendly = matchdayBoxes(defaultSlots(true))
    for (const id of SLOT_IDS) {
      const box = friendly.boxes.find((b) => b.id === `slot-${id}`)!
      expect(box.label).toContain(WIDGET_LABEL[defaultSlots(true)[id]])
    }
    // The ids do not depend on the widgets chosen: a stored choice survives a widget swap
    expect(matchdayBoxes(defaultSlots(false)).boxes.map((b) => b.id)).toEqual(friendly.boxes.map((b) => b.id))
  })
})
