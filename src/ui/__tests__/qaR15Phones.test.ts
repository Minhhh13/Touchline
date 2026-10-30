/**
 * QA round 13 (r15, docs/QA.md, R15-1): Home's resume card at 200 % text on a 360 px phone. Continue and Abandon sat on
 * one row that could not wrap, so the page grew to 378 px, the phone zoomed out to fit it and the dock slid below the
 * screen (its tabs could not be tapped). The phone block lets that row wrap; the card still renders the class it names.
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
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { useStore } from '@game/store'
import { Home } from '../screens/Home'
import { SEASON_RULES } from '@engine/draft'
import { show } from './qaSsr'

const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8')

/** The rules inside every `@media (max-width: 720px)` block, in order. */
function phoneBlocks(sheet: string): string[] {
  const out: string[] = []
  let at = 0
  for (;;) {
    const start = sheet.indexOf('@media (max-width: 720px) {', at)
    if (start < 0) return out
    let depth = 0
    let i = sheet.indexOf('{', start)
    for (; i < sheet.length; i++) {
      if (sheet[i] === '{') depth++
      else if (sheet[i] === '}' && --depth === 0) break
    }
    out.push(sheet.slice(start, i + 1))
    at = i + 1
  }
}

describe('QA r15: Home at 200 % text on a small phone', { timeout: 60_000 }, () => {
  it('lets the resume card\'s Continue and Abandon wrap on a phone', () => {
    const rule = phoneBlocks(css).find((b) => /\.resume-actions \{[^}]*flex-wrap: wrap;/.test(b))
    expect(rule).toBeDefined()
    expect(rule).toMatch(/\.resume-actions \{[^}]*min-width: 0;/)
    // No later phone rule puts it back on one line
    const after = css.slice(css.lastIndexOf('.resume-actions {'))
    expect(after).not.toMatch(/\.resume-actions \{[^}]*flex-wrap: nowrap/)
  })

  it('renders the card with that class while a game waits', () => {
    const u = loadTestUniverse(['england'])
    show({ universe: u, loadedLeagues: ['england'], game: null, h2h: null, screen: 'home' })
    useStore.getState().startGame({ mode: 'season', seed: 'qa-r15-home', formationId: '4-3-3', teamName: 'Birchmere Dynamos', shortName: 'BIR', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2022, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', continental: false })
    show({ screen: 'home' })
    const html = renderToString(createElement(Home))
    expect(html).toContain('data-testid="resume-current"')
    expect(html).toMatch(/class="row resume-actions"[^>]*>.*data-testid="resume-continue"/)
  })
})
