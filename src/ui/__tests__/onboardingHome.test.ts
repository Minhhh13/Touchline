/**
 * Home for a newcomer and an early player (round 9's onboarding pass): the newcomer's Home keeps to the first draft
 * and the four modes, the five more modes come in with the first result, the Daily is pointed at once (the Try next
 * marker, not the nudge as well), Try next never sends a player to start a Season while one waits, and the next
 * badge says what is left in its own words. Server-rendered from the store, as `i18nScreens.test.ts` does.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, setupRules } from '@game/logic/setup'
import { SEASON_RULES } from '@engine/draft'
import type { LeaderboardEntry, Profile } from '@game/types'
import { show } from './qaSsr'
import { Home } from '../screens/Home'
import HomeBadgeNudge from '../components/HomeBadgeNudge'

const u = loadTestUniverse(['england'])
const fresh: Profile = { achievements: {}, leaderboard: [], dailyStreak: 0, lastDailyDate: null, dailyResults: {}, gamesPlayed: 0, seasonsSimulated: 0, theme: 'auto', managerName: '' }
const quick = { mode: 'quick', points: 70 } as unknown as LeaderboardEntry
const base = { universe: u, loadedLeagues: ['england'], game: null, parked: {}, toast: null, screen: 'home' as const }
const render = () => renderToString(createElement(Home))
const testIds = (html: string) => [...html.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1])
/** The test id of the card that carries the Try next marker. */
const markedCard = (html: string): string | null => {
  const at = html.indexOf('data-testid="next-up"')
  if (at < 0) return null
  const before = html.slice(0, at)
  const cards = [...before.matchAll(/data-testid="(daily-card|season-card|world-card)"/g)]
  return cards.at(-1)?.[1] ?? null
}

describe("a newcomer's Home", () => {
  it('shows the first-run panel and the four modes, not the five more modes', () => {
    show({ ...base, profile: fresh })
    const ids = testIds(render())
    expect(ids).toContain('first-run')
    expect(ids).toContain('first-draft')
    expect(ids).toContain('daily-card')
    expect(ids).toContain('season-card')
    expect(ids).not.toContain('casual-row')
    expect(ids).not.toContain('arena-daily-card')
    expect(ids).not.toContain('next-up')
  })

  it('brings the five more modes in with the first result', () => {
    show({ ...base, profile: { ...fresh, leaderboard: [quick], seasonsSimulated: 1 } })
    const ids = testIds(render())
    expect(ids).not.toContain('first-run')
    expect(ids).toContain('casual-row')
    for (const id of ['arena-daily-card', 'weekly-card', 'arena-cup-card', 'arena-gauntlet-card', 'runin-card']) expect(ids).toContain(id)
  })
})

describe("an early player's Try next", () => {
  it("marks today's Daily, and the hero's Daily nudge stands down so the Daily is pointed at once", () => {
    show({ ...base, profile: { ...fresh, leaderboard: [quick], seasonsSimulated: 1 } })
    const html = render()
    expect(markedCard(html)).toBe('daily-card')
    expect(testIds(html)).not.toContain('daily-nudge')
  })

  it('keeps the Daily nudge once Try next has moved on', () => {
    show({ ...base, profile: { ...fresh, leaderboard: [quick, quick], seasonsSimulated: 2, dailyResults: { 'daily-2026-10-01': { points: 60, tier: 'MID_TABLE' } } } })
    const html = render()
    expect(markedCard(html)).toBe('season-card')
    expect(testIds(html)).toContain('daily-nudge')
  })

  it('never marks Season while a Season waits on the resume strip, parked or current', () => {
    const profile = { ...fresh, leaderboard: [quick, quick], seasonsSimulated: 2, dailyResults: { 'daily-2026-10-01': { points: 60, tier: 'MID_TABLE' } } } as Profile
    const settings = { mode: 'season' as const, seed: 'ONBOARD-HOME-1', formationId: '4-3-3', teamName: 'Test Town', shortName: 'TST', leagueId: 'england', wheelLeagues: ['england'], hostClubId: u.clubSeasons.find((cs) => cs.leagueId === 'england' && cs.season === u.lastSeason - 1)!.clubId, leagueSeason: u.lastSeason - 1, rules: setupRules(SEASON_RULES, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: u.firstSeason, eraTo: u.lastSeason, first: u.firstSeason, last: u.lastSeason, twists: false, leagues: ['england'], benchPicks: 0, modes: [], powerUps: false, classic: false, superLeague: false }), jobSecurity: false, difficulty: 'calibrated' as const, continental: false, january: true }
    const season = createGame(settings)
    show({ ...base, profile, game: season })
    expect(markedCard(render())).toBeNull()
    show({ ...base, profile, game: null, parked: { season } })
    expect(markedCard(render())).toBeNull()
    show({ ...base, profile, game: null, parked: {} })
    expect(markedCard(render())).toBe('season-card')
  })
})

describe("Home's next badge", () => {
  it("says what is left in the badge's own words, never a tier's fraction", () => {
    show({ ...base, profile: { ...fresh, leaderboard: [quick], seasonsSimulated: 1 } })
    const html = renderToString(createElement(HomeBadgeNudge, { onOpen: () => undefined }))
    const text = html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'")
    expect(text).toMatch(/^Next badge: .+, .+ to go$/)
    expect(text).not.toMatch(/ of \d+ for (bronze|silver|gold)/)
  })
})
