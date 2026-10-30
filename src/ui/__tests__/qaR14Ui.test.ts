/**
 * QA round 11 (r14, docs/QA.md): the screens round 13 changed, rendered on the server. Explore's club page before and
 * after its wheel is worked out (r13's `useWheelChances` works a wheel out after the paint, so the first render has
 * none: R14-2), and the hot-seat's controls carrying the ids the smokes drive in any language.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { freshTestUniverse } from '../../engine/__tests__/helpers'
import { wheelChances } from '@game/logic/exploreDb'
import { ClubView } from '../screens/ExploreViews'
import { markupProblems, show } from './qaSsr'

/** The club table's last column (the first spin's chance), row by row. */
const chanceCells = (html: string) => [...html.matchAll(/<td class="num small"[^>]*>([^<]*)<\/td>/g)].map((m) => m[1])

describe('QA r14: Explore while a wheel is worked out', { timeout: 60_000 }, () => {
  it('marks every chance as still coming, never as "never on the wheel", until the wheel is known (R14-2)', () => {
    const u = freshTestUniverse(['england'])
    show({ universe: u })
    const render = () => renderToString(createElement(ClubView, { leagueId: 'england', clubId: 'arsenal', onClub: () => undefined, onPlayer: () => undefined }))
    const before = render()
    const cells = chanceCells(before)
    expect(cells.length).toBeGreaterThan(15)
    expect(cells.every((c) => c === '…')).toBe(true)
    expect(before).toContain('aria-busy="true"')
    expect(markupProblems(before)).toEqual([])
    // Once the wheels are in, every season reads its chance
    wheelChances(u, 'england')
    // The standard seasons read the standard wheel; the classic ones (1992-93 to 2007-08) still wait for theirs
    const half = chanceCells(render())
    expect(half.filter((c) => c === '…').length).toBe(16)
    wheelChances(u, 'england', true)
    const after = chanceCells(render())
    expect(after.length).toBe(cells.length)
    expect(after.filter((c) => !/^1\/\d/.test(c))).toEqual([])
  })

  it("gives the hot-seat's spin, assistant, finish and draft buttons and the nav's head-to-head their test ids", () => {
    const h2h = readFileSync(join(__dirname, '..', 'screens', 'H2H.tsx'), 'utf8')
    for (const id of ['h2h-spin', 'h2h-auto', 'h2h-finish']) expect(h2h).toContain(`data-testid="${id}"`)
    expect(h2h).toContain('draftTestId="h2h-draft-btn"')
    expect(readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8')).toContain('data-testid="nav-h2h"')
  })
})
