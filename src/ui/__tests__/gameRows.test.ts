import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GameByGame } from '../components/GameByGame'
import type { QuickGameResult } from '@game/types'

const games: QuickGameResult[] = [
  { matchweek: 1, opponentId: 'wolverhampton-wanderers', home: true, gf: 2, ga: 1, scorers: [], position: 3 },
  { matchweek: 2, opponentId: 'sunderland', home: false, gf: 0, ga: 0, scorers: [], position: 4 },
]
const NAMES: Record<string, { name: string; short?: string }> = { 'wolverhampton-wanderers': { name: 'Wolverhampton Wanderers', short: 'Wolves' }, sunderland: { name: 'Sunderland', short: 'Sunderland' } }

describe('the game rows (U19)', () => {
  it("carry a club's short name beside the full one, for a narrow list, and the full one as its tooltip", () => {
    const html = renderToString(createElement(GameByGame, { results: games, opponent: (id: string) => ({ clubId: id, ...NAMES[id] }) }))
    expect(html).toContain('class="gbg-name has-short" title="Wolverhampton Wanderers"')
    expect(html).toContain('<span class="gbg-short">Wolves</span>')
    // The same name twice is one name
    expect(html).toMatch(/<span class="gbg-name">Sunderland<\/span>/)
  })

  it('the stylesheet shows the short name only in a narrow list', () => {
    const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8')
    expect(css).toMatch(/\.gbg-name\.has-short \.gbg-short \{\s*display: none;/)
    expect(css).toMatch(/@container gbg \(max-width: 26rem\) \{\s*\.gbg-name\.has-short \.gbg-full \{\s*display: none;/)
  })
})
