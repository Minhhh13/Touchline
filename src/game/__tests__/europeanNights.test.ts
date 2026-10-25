import { describe, expect, it, vi } from 'vitest'

// The store persists to localStorage; node has none, so give it an in-memory one before the store module loads
vi.hoisted(() => {
  const mem = new Map<string, string>()
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size } }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
})
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason, summariseSetup } from '../logic/setup'
import { startSeasonProper } from '../logic/week'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { continentalRounds, describeImportance } from '@engine/season'
import { ACHIEVEMENT_BY_ID, shareText } from '@engine/awards'
import { useStore, SAVE_KEY } from '../store'
import { Dugout } from '@ui/screens/Dugout'
import { ProfileScreen } from '@ui/screens/ProfileScreen'
import type { Game, GameSettings, Profile } from '../types'

/**
 * The Continental Cup became European Nights in the UI only: every persisted name (settings.continental,
 * season.continental, qualifiedContinental, history continentalWon, profile.trophies.continental, the 'europe' tab)
 * is unchanged, so a save written before the rename loads as it was and simply reads European Nights on screen.
 */
const u = loadTestUniverse(['england', 'spain', 'germany'])

function settings(): GameSettings {
  return {
    mode: 'season',
    seed: 'european-nights-save',
    formationId: '4-3-3',
    teamName: 'Old Save XI',
    shortName: 'OLD',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'everton',
    leagueSeason: 2024,
    rules: { ...SEASON_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    continental: true,
  }
}

/** A season game as an older build saved it: the continental field and its news written under the old name. */
function oldSave(): { game: Game; profile: Profile } {
  const g = createGame(settings())
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  g.season!.news = g.season!.news.map((n) => (n.title === 'European Nights draw' ? { ...n, title: 'Continental Cup draw' } : n))
  const game = JSON.parse(JSON.stringify(g)) as Game
  const profile: Profile = { ...useStore.getState().profile, trophies: { league: 1, cup: 0, continental: 2, doubles: 0, trebles: 0 } }
  return { game, profile }
}

describe('European Nights is a display name over unchanged save fields', () => {
  it('keeps every persisted continental field under its old name', () => {
    const { game } = oldSave()
    expect(game.settings.continental).toBe(true)
    expect(Object.keys(game.season!.continental!).sort()).toEqual(['clubs', 'eliminated', 'ties', 'won'])
    expect(game.season!.continental!.ties.length).toBe(8)
    expect('qualifiedContinental' in game).toBe(true)
  })

  it('loads an old save through the store merge unchanged, and the Dugout and Record page read European Nights', async () => {
    const { game, profile } = oldSave()
    // What localStorage held under SAVE_KEY before the rename, through the real persist merge
    expect(SAVE_KEY).toBe('touchline-save-v1')
    localStorage.setItem(SAVE_KEY, JSON.stringify({ state: { game, parked: {}, shortlist: [], h2h: null, profile, screen: 'game' }, version: 1 }))
    await useStore.persist.rehydrate()
    const merged = useStore.getState()
    expect(merged.game?.season?.continental).toEqual(game.season!.continental)
    expect(merged.game?.settings.continental).toBe(true)
    expect(merged.profile.trophies?.continental).toBe(2)
    // The news written by the old build stays as written; nothing rewrites saved text
    expect(merged.game?.season?.news.some((n) => n.title === 'Continental Cup draw')).toBe(true)

    useStore.setState({ universe: u, loadedLeagues: ['england', 'spain', 'germany'] })
    // A static server render reads the store's initial state (React's server snapshot); point it at the loaded state
    const initial = useStore.getInitialState()
    const before = { ...initial }
    Object.assign(initial, useStore.getState())
    const dugout = renderToStaticMarkup(createElement(Dugout))
    expect(dugout).toMatch(/<img[^>]*src="\/flags\/eu\.svg"[^>]*>\s*European Nights/)
    expect(dugout).not.toMatch(/Continental Cup|>Europe</)
    const record = renderToStaticMarkup(createElement(ProfileScreen))
    expect(record).toMatch(/European Nights/)
    expect(record).toMatch(/flags\/eu\.svg/)
    expect(record).not.toMatch(/Continental Cup/)
    Object.assign(initial, before)
    useStore.setState({ game: null, universe: null, loadedLeagues: [], screen: 'home' })
    localStorage.clear()
  })

  it('names the competition European Nights in every string the logic and engine generate', () => {
    const g = createGame(settings())
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    expect(g.season!.news.some((n) => n.title === 'European Nights draw')).toBe(true)
    expect(summariseSetup(u, g.settings)).toMatch(/, European Nights$/)
    expect(summariseSetup(u, { ...g.settings, continental: false, wheelLeagues: ['england', 'spain'] })).toContain('All of Europe wheel of 2 leagues')
    for (const mws of [38, 34]) for (const r of continentalRounds(mws)) expect(r.label).toMatch(/^European Nights /)
    expect(describeImportance(u, 'everton', 'real-madrid', null, 10, 'F', 'continental').label).toBe('European Nights final')
    expect(ACHIEVEMENT_BY_ID['continental'].description).toBe('Win European Nights.')
    const share = shareText({ teamName: 'X', tier: 'CHAMPIONS', row: { teamId: 'x', played: 38, won: 30, drawn: 5, lost: 3, goalsFor: 90, goalsAgainst: 20, points: 95, form: [] }, position: 1, cupWon: true, continentalWon: true, leagueSeason: 2024, hostClubName: 'Everton', mode: 'Season' })
    expect(share).toContain('CHAMPIONS + CUP + EUROPEAN NIGHTS')
  })
})
