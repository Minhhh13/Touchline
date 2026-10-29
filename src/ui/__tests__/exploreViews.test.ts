/**
 * Explore's deeper views and the Stats tab's tables, rendered on the server: every view renders with real packs,
 * classic seasons carry their estimated chip, and the markup passes the QA checks (named buttons, labelled inputs).
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
vi.setConfig({ testTimeout: 60_000 })
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { BLANK_SEARCH } from '@game/logic/exploreFilter'
import { exploreIndexed, playerIndex } from '@game/logic/exploreIndex'
import { ClubView, CompareView, LeagueView, SearchView } from '../screens/ExploreViews'
import { PlayerStatsTable, TeamStats } from '../screens/StatsTables'
import { StatsTab } from '../screens/StatsTab'
import { markupProblems, show } from './qaSsr'
import { seasonGame } from '../../game/__tests__/seasonGame'

const noop = () => {}

describe("Explore's deeper views", () => {
  const u = loadTestUniverse(['england', 'germany'])
  show({ universe: u, loadedLeagues: ['england', 'germany'], game: null, screen: 'explore' })
  // Search and compare wait for the player index (built in slices on the page): built here first
  playerIndex(u)

  it('shows the search waiting, not building, while the index of a new universe is not built', () => {
    const fresh = loadTestUniverse(['england', 'spain'])
    show({ universe: fresh, loadedLeagues: ['england', 'spain'], game: null, screen: 'explore' })
    const html = renderToString(createElement(SearchView, { form: { ...BLANK_SEARCH, query: 'kane' }, setForm: noop, onPlayer: noop, compare: [], toggleCompare: noop }))
    expect(html).toContain('Loading')
    expect(exploreIndexed(fresh)).toBe(false)
    show({ universe: u, loadedLeagues: ['england', 'germany'], game: null, screen: 'explore' })
  })

  it('renders a club page with its seasons, wheel chances and best XI', () => {
    const html = renderToString(createElement(ClubView, { leagueId: 'england', clubId: 'arsenal', onClub: noop, onPlayer: noop }))
    expect(markupProblems(html)).toEqual([])
    expect(html).toContain('data-testid="club-history"')
    expect(html).toContain('data-testid="wheel-line"')
    expect(html.match(/data-testid="club-pick"/g)!.length).toBeGreaterThan(20)
  })

  it('renders a league page with champions, top rated and the record book', () => {
    for (const leagueId of ['england', 'germany']) {
      const html = renderToString(createElement(LeagueView, { leagueId, onClub: noop, onPlayer: noop }))
      expect(markupProblems(html)).toEqual([])
      expect(html).toContain('Most points')
    }
  })

  it('renders the filtered search, empty and filtered', () => {
    expect(markupProblems(renderToString(createElement(SearchView, { form: BLANK_SEARCH, setForm: noop, onPlayer: noop, compare: [], toggleCompare: noop })))).toEqual([])
    const html = renderToString(createElement(SearchView, { form: { ...BLANK_SEARCH, leagueId: 'germany', minRating: '85' }, setForm: noop, onPlayer: noop, compare: [], toggleCompare: noop }))
    expect(markupProblems(html)).toEqual([])
    expect(html).toContain('class="prow')
  })

  it('renders compare with two players side by side', () => {
    const ids = [u.clubSeasonByKey['manchester-city@2022'].squad[0].playerId, u.clubSeasonByKey['bayern-munich@2020'].squad[0].playerId]
    const html = renderToString(createElement(CompareView, { ids, setIds: noop, onPlayer: noop }))
    expect(markupProblems(html)).toEqual([])
    expect(html.match(/data-testid="compare-col"/g)).toHaveLength(2)
    expect(html).toContain('data-testid="season-chart"')
    expect(markupProblems(renderToString(createElement(CompareView, { ids: [], setIds: noop, onPlayer: noop })))).toEqual([])
  })

  it('marks classic seasons as estimated on the club and league pages', () => {
    const classic = loadTestUniverse(['england'])
    show({ universe: classic, loadedLeagues: ['england'] })
    const club = renderToString(createElement(ClubView, { leagueId: 'england', clubId: 'arsenal', onClub: noop, onPlayer: noop }))
    expect(club).toContain('estimated-chip')
    expect(club).toContain('1995-96')
    const league = renderToString(createElement(LeagueView, { leagueId: 'england', onClub: noop, onPlayer: noop }))
    expect(league).toContain('estimated-chip')
    show({ universe: u, loadedLeagues: ['england', 'germany'] })
  })
})

describe("the Stats tab's tables", () => {
  it('renders the players and team views of a season under way', () => {
    const u = loadTestUniverse(['england'])
    const g = seasonGame(u, 'stats-views', 6)
    show({ universe: u, loadedLeagues: ['england'], game: g, screen: 'game' })
    for (const c of [PlayerStatsTable, TeamStats, StatsTab]) {
      const html = renderToString(createElement(c))
      expect(markupProblems(html)).toEqual([])
    }
    const html = renderToString(createElement(PlayerStatsTable))
    expect(html).toContain('aria-sort="descending"')
  })
})
