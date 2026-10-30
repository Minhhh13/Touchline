/**
 * Regression tests for the screen bugs the QA hunt of 2026-10-26 fixed (docs/QA.md), rendered on the server.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
// Server renders and seeded seasons: a loaded machine can take longer than the default five seconds
vi.setConfig({ testTimeout: 60_000 })
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { beginSeason, createGame } from '@game/logic/setup'
import { H2HSetup } from '../screens/H2H'
import { Dugout, TacticsTab } from '../screens/Dugout'
import { MatchScreen } from '../screens/MatchScreen'
import { Explore } from '../screens/Explore'
import { Home } from '../screens/Home'
import { ProfileScreen } from '../screens/ProfileScreen'
import { StatsTab } from '../screens/StatsTab'
import { useStore } from '@game/store'
import { markupProblems, openFiltered, renderProblems, show } from './qaSsr'
import { isChunkLoadError, ScreenBoundary } from '../lazyScreens'
import { SCROLL_BOXES } from '../scrollFocus'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('QA screen fixes', () => {
  it('keeps Daily as one equal mode card and places Explore navigation at opposite edges', () => {
    const u = loadTestUniverse(['england'])
    show({ universe: u, loadedLeagues: ['england'], game: null, parked: {}, screen: 'home' })
    const home = renderToString(createElement(Home))
    expect(home).toContain('data-testid="daily-card"')
    expect(home).not.toContain('data-testid="daily-play"')
    expect(home).not.toContain('data-testid="daily-ranked"')

    const explore = readFileSync(join(__dirname, '..', 'screens', 'Explore.tsx'), 'utf8')
    expect(explore).toMatch(/explore-head-actions[\s\S]*?← Home[\s\S]*?<BoxesMenu/)
  })

  it('QA-2: the head-to-head setup renders while the chosen league is still loading (it was a white page)', () => {
    // England is the setup's first league; a universe without its pack is the moment after a new league is picked
    show({ universe: loadTestUniverse(['spain']), loadedLeagues: ['spain'], h2h: null, screen: 'h2h' })
    expect(renderProblems(H2HSetup)).toEqual([])
    show({ universe: loadTestUniverse(['england']), loadedLeagues: ['england'] })
    expect(renderProblems(H2HSetup)).toEqual([])
  })

  it('QA-3: the set-piece taker and Explore season selects have accessible names', () => {
    const u = loadTestUniverse(['england'])
    const g = createGame({ mode: 'season', seed: 'qa-fix-a11y', formationId: '4-3-3', teamName: 'QA', shortName: 'QAA', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    show({ universe: u, loadedLeagues: ['england'], game: g, screen: 'game' })
    expect(renderProblems(TacticsTab)).toEqual([])
    show({ game: null, screen: 'explore' })
    expect(renderProblems(Explore)).toEqual([])
  })
})

describe('QA-4: a screen that throws while rendering', () => {
  it('shows a way out instead of a white page, and clears on the next screen', () => {
    const boom = new Error('boom')
    expect(ScreenBoundary.getDerivedStateFromError(boom)).toEqual({ error: boom })
    // The same screen keeps the error; another screen or phase clears it
    expect(ScreenBoundary.getDerivedStateFromProps({ resetKey: 'game|week|setup', onHome: () => {}, children: null }, { error: boom, key: 'game|week|setup' })).toBeNull()
    expect(ScreenBoundary.getDerivedStateFromProps({ resetKey: 'home||setup', onHome: () => {}, children: null }, { error: boom, key: 'game|week|setup' })).toEqual({ error: null, key: 'home||setup' })
    const b = new ScreenBoundary({ resetKey: 'game|week|setup', onHome: () => {}, children: null })
    b.state = { error: boom, key: 'game|week|setup' }
    const html = renderToString(createElement(() => b.render()))
    expect(html).toContain('data-testid="screen-error"')
    expect(html).toContain('Back to home')
    expect(markupProblems(html)).toEqual([])
  })

  it('tells a chunk that did not load from a render error, and offers the reload and the way home for both', () => {
    for (const m of ['Failed to fetch dynamically imported module: https://touchline.quest/assets/Draft-abc.js', 'Importing a module script failed.', 'error loading dynamically imported module', 'Unable to preload CSS for /assets/Draft-abc.css']) expect(isChunkLoadError(new TypeError(m))).toBe(true)
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'badge')"))).toBe(false)
    expect(isChunkLoadError('boom')).toBe(false)
    const b = new ScreenBoundary({ resetKey: 'game|draft|setup', onHome: () => {}, children: null })
    b.state = { error: new TypeError('Failed to fetch dynamically imported module: /assets/Draft-abc.js'), key: 'game|draft|setup' }
    const html = renderToString(createElement(() => b.render()))
    expect(html).toContain('data-testid="screen-load-error"')
    expect(html).toContain('did not load')
    expect(html).toContain('Back to home')
    expect(html).toContain('Reload')
    expect(markupProblems(html)).toEqual([])
  })

  it('wraps the screens in App, so a render error never blanks the top bar', () => {
    const src = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8')
    expect(src).toMatch(/<ScreenBoundary resetKey=[\s\S]{0,200}?\{body\}\s*<\/ScreenBoundary>/)
  })
})

describe('QA-6: key-value lists are description lists', () => {
  it('the Profile chase, the season records and the Club tab put their dt and dd inside a dl', () => {
    const u = loadTestUniverse(['england'])
    const g = createGame({ mode: 'season', seed: 'qa-fix-dl', formationId: '4-3-3', teamName: 'QA', shortName: 'QAA', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    show({ universe: u, loadedLeagues: ['england'], game: g, screen: 'game' })
    expect(renderProblems(StatsTab)).toEqual([])
    show({ screen: 'profile' })
    expect(renderProblems(ProfileScreen)).toEqual([])
    // The Club tab is inside the Dugout: its source holds no key-value div any more
    const src = readFileSync(join(__dirname, '..', 'screens', 'Dugout.tsx'), 'utf8') + readFileSync(join(__dirname, '..', 'components', 'ContractTalks.tsx'), 'utf8')
    expect(src).not.toMatch(/<div className="kv/)
  })
})

describe('QA-8: ARIA states and keyboard-reachable scroll panels', () => {
  it('the squad view switch is a radio group without aria-pressed, and the match-day panels that scroll take focus', () => {
    const u = loadTestUniverse(['england'])
    const g = createGame({ mode: 'season', seed: 'qa-fix-aria', formationId: '4-3-3', teamName: 'QA', shortName: 'QAA', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    show({ universe: u, loadedLeagues: ['england'], game: g, screen: 'game', matchView: 'ticker' })
    // The screens themselves: App renders them as lazy chunks, which renderToString leaves on the loading fallback
    const dugout = renderToString(createElement(Dugout))
    expect(dugout).toContain('data-testid="squad-view-overview"')
    expect(openFiltered(dugout)).toEqual([])
    // A live match on the dashboard: the panel bodies and the table join the Tab order while they scroll, through
    // scrollFocus.ts (the accessibility pass), so they carry no fixed tabindex of their own
    useStore.getState().startSeason()
    useStore.getState().setMatchPlay('watch')
    useStore.getState().playWeek()
    show({})
    const match = renderToString(createElement(MatchScreen))
    const bodies = [...match.matchAll(/<div class="(md-slot-body|md-table)"([^>]*)>/g)]
    expect(bodies.length).toBeGreaterThan(0)
    const boxes = SCROLL_BOXES.split(',').map((b) => b.trim())
    for (const b of bodies) expect(boxes).toContain(`.${b[1]}`)
  })
})

describe('QA-11: a game link that arrives damaged', () => {
  it('reads past punctuation glued to its end and says so when it still cannot be read', async () => {
    const { readGameHash } = await import('../gameHash')
    expect(readGameHash('#c=eyJ2IjoxfQ')).toEqual({ link: { kind: 'c', payload: 'eyJ2IjoxfQ' }, damaged: false })
    expect(readGameHash('#c=eyJ2IjoxfQ).')).toEqual({ link: { kind: 'c', payload: 'eyJ2IjoxfQ' }, damaged: false })
    expect(readGameHash('#s=K7Q2MX9A!')).toEqual({ link: { kind: 's', code: 'K7Q2MX9A' }, damaged: false })
    expect(readGameHash('#h=K7Q2MX9A%29')).toEqual({ link: { kind: 'h', code: 'K7Q2MX9A' }, damaged: false })
    // Damaged inside, or a short code that is not one: say so (the page used to ignore it without a word)
    expect(readGameHash('#c=eyJ2Ij oxfQ')).toEqual({ link: null, damaged: true })
    expect(readGameHash('#s=K7Q2MX91')).toEqual({ link: null, damaged: true })
    // Anything else is not a game link at all
    expect(readGameHash('')).toEqual({ link: null, damaged: false })
    expect(readGameHash('#top')).toEqual({ link: null, damaged: false })
    expect(readGameHash('#access_token=abc')).toEqual({ link: null, damaged: false })
  })
})
