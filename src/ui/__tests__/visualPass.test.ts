/**
 * Round 9's visual consistency pass: the empty states and the layout rules it added, held so a later stylesheet
 * merge cannot quietly undo them.
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
import { SEASON_RULES } from '@engine/draft'
import { useStore } from '@game/store'
import { OppositionReport } from '../screens/OppositionReport'
import { show } from './qaSsr'

const UI = join(__dirname, '..')
const css = readFileSync(join(UI, 'styles.css'), 'utf8')
const src = (p: string) => readFileSync(join(UI, p), 'utf8')

describe('the visual pass', () => {
  it("the opposition report says there are no games yet before a ball is kicked, never an empty Form row", () => {
    const u = loadTestUniverse(['england'])
    show({ universe: u, loadedLeagues: ['england'], game: null, parked: {}, screen: 'game' })
    useStore.getState().startGame({ mode: 'season', seed: 'visual-pass-opp', formationId: '4-3-3', teamName: 'Visual Pass', shortName: 'VIS', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: true, difficulty: 'calibrated', continental: false })
    useStore.getState().autoDraftRest()
    useStore.getState().finishDraft()
    const g = useStore.getState().game!
    show({ game: g })
    expect(g.season).toBeTruthy()
    const clubId = Object.keys(g.season!.ai)[0]
    const html = renderToString(createElement(OppositionReport, { clubId, home: true, open: true }))
    expect(html).toContain('No games yet')
  })

  it('the arena and run-in summaries fold their share text like the Summary and Head-to-head: a panel head with the chevron', () => {
    for (const f of ['screens/ArenaSummary.tsx', 'screens/RunInSummary.tsx', 'screens/Summary.tsx', 'screens/H2H.tsx']) {
      const s = src(f)
      const at = s.indexOf("<h3>{t('shareText')}</h3>")
      expect(at, f).toBeGreaterThan(0)
      const around = s.slice(at - 80, at + 140)
      expect(around, f).toContain('<summary className="panel-head">')
      expect(around, f).toContain('fold-chevron')
    }
  })

  it('every way home reads "← Home" (the Draft and the head-to-head draft too)', () => {
    expect(src('i18n/en/draft.ts')).toContain("home: '← Home'")
    expect(src('i18n/en/h2h.ts')).toContain("homeBack: '← Home'")
  })

  it("keeps the layout fixes: the summary banner never cut off, the empty unlock region out of the flow, the tier chip without a stray dot", () => {
    expect(css).toMatch(/\.app\.shell \.page\.summary > \.tier-banner \{[^}]*justify-content: safe center;/)
    expect(css).toMatch(/\.unlock-live:empty \{\s*position: absolute;/)
    expect(css).toContain('.club-sub > span:not(.chip, .tier-chip) + span:not(.chip, .tier-chip)::before')
    // The run-in's game rows: fixed columns, so a W, D or L chip never moves the row's text
    expect(css).toMatch(/\.runin-games li \{[^}]*grid-template-columns: 2\.4em 3\.6em minmax\(0, 1fr\) 3em 3em;/)
    // A long spin label wraps inside the button
    expect(css).toMatch(/\.spin-btn \{[^}]*white-space: normal;/)
  })
})
