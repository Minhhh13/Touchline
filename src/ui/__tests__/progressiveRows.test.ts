/**
 * Explore's search rows drawn a slice at a time (r10 perf): the slices are the list's own first rows in its order and
 * reach every row, a new list gets a new box, and the server-rendered search draws the first slice of exactly the
 * rows `filterPlayers` returns.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
vi.setConfig({ testTimeout: 60_000 })
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { BLANK_SEARCH, filterPlayers, formFilter } from '@game/logic/exploreFilter'
import { playerIndex } from '@game/logic/exploreIndex'
import { SearchView } from '../screens/ExploreViews'
import { firstShown, FIRST_ROWS, GROW_DELAY_MS, listKey, nextShown, ROW_STEP } from '../progressiveRows'
import { markupProblems, show } from './qaSsr'

const noop = () => {}

describe('progressive rows', () => {
  it('starts with a screenful and grows by steps to every row, never past the list', () => {
    expect(FIRST_ROWS).toBeGreaterThanOrEqual(8)
    expect(ROW_STEP).toBeGreaterThanOrEqual(FIRST_ROWS)
    expect(GROW_DELAY_MS).toBeGreaterThan(150)
    for (const total of [0, 1, 7, FIRST_ROWS, FIRST_ROWS + 1, 35, 199, 200]) {
      const steps = [firstShown(total)]
      while (steps[steps.length - 1] < total) steps.push(nextShown(steps[steps.length - 1], total))
      expect(steps[0]).toBe(Math.min(FIRST_ROWS, total))
      expect(steps[steps.length - 1]).toBe(total)
      for (let i = 1; i < steps.length; i++) expect(steps[i] - steps[i - 1]).toBeGreaterThan(0)
      expect(steps.length).toBeLessThanOrEqual(1 + Math.ceil(Math.max(0, total - FIRST_ROWS) / ROW_STEP))
    }
  })

  it('gives each list its own key and the same list the same one', () => {
    const a = [1, 2]
    const b = [1, 2]
    expect(listKey(a)).toBe(listKey(a))
    expect(listKey(b)).not.toBe(listKey(a))
    expect(listKey([])).not.toBe(listKey([]))
  })
})

describe("Explore's search draws the filter's rows a slice at a time", () => {
  const u = loadTestUniverse(['england', 'germany'])
  // The search draws its rows once the index is built (a render never builds it: r9 perf's `useExploreIndex`)
  playerIndex(u)
  show({ universe: u, loadedLeagues: ['england', 'germany'], game: null, screen: 'explore' })

  it('renders the first slice of the same rows, in the same order', () => {
    for (const query of ['ma', 'kane', 'son', 'de']) {
      const form = { ...BLANK_SEARCH, query }
      const html = renderToString(createElement(SearchView, { form, setForm: noop, onPlayer: noop, compare: [], toggleCompare: noop }))
      expect(markupProblems(html)).toEqual([])
      const rows = filterPlayers(u, formFilter(form)).rows
      expect(rows.length).toBeGreaterThan(0)
      const drawn = html.match(/class="prow-shell"/g) ?? []
      expect(drawn.length, query).toBe(firstShown(rows.length))
      // The count still names every match, not the slice drawn
      expect(html).toContain('data-testid="search-count"')
      // Each drawn row is the filter's row at that place: its name in order
      let at = 0
      for (const h of rows.slice(0, drawn.length)) {
        const next = html.indexOf(h.name.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'), at)
        expect(next, `${query}: ${h.name}`).toBeGreaterThan(at)
        at = next
      }
    }
  })

  it('keeps the rows that the containment skips focusable with the ring inside', () => {
    const css = readFileSync(path.join(__dirname, '../styles.css'), 'utf8')
    expect(css).toMatch(/\.explore-search \.plist > \.prow-shell \{\s*content-visibility: auto;/)
    expect(css).toMatch(/\.explore-search \.plist > \.prow-shell > \.prow:focus-visible \{\s*outline-offset: -2px;/)
  })
})
