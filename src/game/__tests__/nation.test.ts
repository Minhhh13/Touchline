import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { runQuickSeason } from '../logic/quick'
import { enquireFor } from '../logic/marketOps'
import { buildYouthIntake } from '../logic/youth'
import { autoDraft, isComplete, QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { enquire, openWindow } from '@engine/market'
import { Rng } from '@engine/rng'
import { ACHIEVEMENT_BY_ID, shareText } from '@engine/awards'
import type { Game, GameSettings } from '../types'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'season',
    seed: 'nation-test',
    formationId: '4-3-3',
    teamName: 'Seleção XI',
    shortName: 'SEL',
    leagueId: 'england',
    wheelLeagues: ['england', 'spain'],
    hostClubId: 'burnley',
    leagueSeason: 2025,
    rules: { ...SEASON_RULES, leagues: ['england', 'spain'], onlyNation: 'BRA' },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

describe('one-nation draft through a game', () => {
  const u = loadTestUniverse(['england', 'spain'])

  function draftedGame(partial: Partial<GameSettings> = {}): Game {
    const g = createGame(settings(partial))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    expect(isComplete(g.draft!)).toBe(true)
    return g
  }

  it('fills an 18-man season squad from one nation and the market only lists that nation', () => {
    const g = draftedGame()
    beginSeason(g, u)
    for (const id of Object.keys(g.squad)) expect(u.index[id].nationality).toBe('BRA')
    startSeasonProper(g)
    while (g.season!.matchweek < 19) playMatchweek(g, u, true)
    expect(g.window?.kind).toBe('january')
    expect(g.window!.listings.length).toBeGreaterThan(20)
    for (const l of g.window!.listings) expect(u.index[l.playerSeasonId].nationality).toBe('BRA')
    // An approach for a non-Brazilian (from the shortlist or the search box) is refused, not quietly listed
    const foreigner = Object.values(u.index).find((p) => p.nationality === 'ENG' && p.overall >= 80)!
    const before = g.window!.listings.length
    const out = enquireFor(g, u, foreigner.id)
    expect(out.ok).toBe(false)
    expect(out.message).toContain('The board wants a Brazil squad')
    expect(g.window!.listings.length).toBe(before)
    // A Brazilian not already ours gets the usual answer: a price or a refusal, never the nation line
    const owned = new Set(Object.keys(g.squad).map((id) => u.index[id].playerId))
    const brazilian = Object.values(u.index).find((p) => p.nationality === 'BRA' && !owned.has(p.playerId) && p.overall >= 70 && p.overall < 84 && p.season >= 2015)!
    const ok = enquire({ u, rng: new Rng('enq'), ownedPlayerIds: owned, leagueSeason: 2025, priceLevel: 1, onlyNation: 'BRA' }, g.window!, brazilian)
    expect(ok.message).not.toContain('The board wants')
  })

  it('a thin nation still gets a market because only club-seasons holding that nation are sampled', () => {
    const rng = new Rng('thin-market')
    const w = openWindow({ u, rng, ownedPlayerIds: new Set(), leagueSeason: 2025, priceLevel: 1, leagues: ['england'], onlyNation: 'CIV' }, 'january')
    expect(w.listings.length).toBeGreaterThan(5)
    for (const l of w.listings) expect(u.index[l.playerSeasonId].nationality).toBe('CIV')
    expect(new Set(w.listings.map((l) => u.index[l.playerSeasonId].playerId)).size).toBe(w.listings.length)
    // Without the rule the window is untouched by the change
    const plain = openWindow({ u, rng: new Rng('plain'), ownedPlayerIds: new Set(), leagueSeason: 2025, priceLevel: 1, leagues: ['england'] }, 'january')
    expect(plain.listings.length).toBe(36)
  })

  it('the academy only brings through youngsters of the nation', () => {
    const g = draftedGame({ mode: 'dynasty' })
    beginSeason(g, u)
    const candidates = buildYouthIntake(g, u, new Rng('intake'))
    expect(candidates.length).toBeGreaterThan(0)
    for (const id of candidates) {
      expect(u.index[id].nationality).toBe('BRA')
      expect(u.index[id].age).toBeLessThanOrEqual(20)
    }
  })

  it('a quick season unlocks International exactly when a one-nation side wins the league', () => {
    expect(ACHIEVEMENT_BY_ID['one-nation-champions'].title).toBe('International')
    for (let i = 0; i < 6; i++) {
      const g = draftedGame({ mode: 'quick', seed: `nation-quick-${i}`, rules: { ...QUICK_RULES, leagues: ['england', 'spain'], onlyNation: 'BRA' } })
      runQuickSeason(g, u)
      expect(g.phase).toBe('summary')
      expect(g.unlocked.includes('one-nation-champions')).toBe(g.quickResult!.position === 1)
    }
    // The share text carries the nation line before the seed
    const text = shareText({ teamName: 'Seleção XI', tier: 'CHAMPIONS', row: { teamId: 'me', played: 38, won: 30, drawn: 5, lost: 3, goalsFor: 90, goalsAgainst: 30, points: 95, form: [] }, position: 1, cupWon: false, leagueSeason: 2025, hostClubName: 'Burnley', mode: 'Quick Draft', seed: 'ABCD-EFGH', extraLines: [`One nation: ${u.nations['BRA'].flag} Brazil`] })
    const lines = text.split('\n')
    expect(lines.at(-2)).toBe('One nation: 🇧🇷 Brazil')
    expect(lines.at(-1)).toBe('Seed ABCD-EFGH')
  })
})
