import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, MAX_KEEPERS, MIN_KEEPERS, newDraft, QUICK_RULES, SEASON_RULES, withDifficulty } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { Rng } from '@engine/rng'
import { seasonTable, USER_TEAM } from '@engine/season'
import type { PlayerSeason } from '@engine/types'
import { advanceToNextSeason } from '../logic/dynasty'
import { playerLookup } from '../logic/players'
import { runQuickSeason, toKickoff } from '../logic/quick'
import { beginSeason, createGame, defaultHostClub } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import type { Game, GameSettings } from '../types'

/**
 * Engine 6 in the game: the assistant's keepers (item 3), minutes while injured (item 4), what a managed league scores
 * (item 1, E6-3) and the Dynasty's money (item 2). The numbers behind the bounds are in docs/GAME_DESIGN.md.
 */
const u = loadTestUniverse(['england'])
const T = 900_000

const isKeeper = (p: PlayerSeason | undefined) => p?.positions[0] === 'GK'
const keepersIn = (ids: string[], get: (id: string) => PlayerSeason | undefined) => ids.filter((id) => isKeeper(get(id))).length

function settings(seed: string, partial: Partial<GameSettings> = {}): GameSettings {
  const leagueSeason = partial.leagueSeason ?? 2018
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === leagueSeason).map((cs) => cs.clubId)
  return { mode: 'season', seed, formationId: '4-3-3', teamName: 'Six XI', shortName: 'SIX', leagueId: 'england', wheelLeagues: ['england'], hostClubId: defaultHostClub(u, 'england', leagueSeason, clubs), leagueSeason, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', ...partial }
}

function drafted(s: GameSettings): Game {
  const g = createGame(s)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  return g
}

function playOut(g: Game): void {
  for (let i = 0; i < 60 && g.phase !== 'summary'; i++) {
    playMatchweek(g, u, true)
    if (g.phase === 'match') g.phase = 'week'
  }
}

describe("the assistant's keepers (item 3)", () => {
  it(`drafts ${MIN_KEEPERS} or ${MAX_KEEPERS} keepers into every 18-man squad and never more than ${MAX_KEEPERS} into a Quick Draft bench`, { timeout: T }, () => {
    for (let i = 0; i < 200; i++) {
      const d = newDraft(getFormation(['4-3-3', '4-4-2', '3-5-2', '4-2-3-1'][i % 4]), { ...SEASON_RULES, leagues: ['england'] })
      autoDraft(u, d, new Rng(`e6-keepers-${i}`))
      const n = keepersIn([...Object.values(d.lineup), ...d.bench], (id) => u.index[id])
      expect(n, `seed ${i}`).toBeGreaterThanOrEqual(MIN_KEEPERS)
      expect(n, `seed ${i}`).toBeLessThanOrEqual(MAX_KEEPERS)
    }
    for (let i = 0; i < 60; i++) {
      const d = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues: ['england'], benchPicks: 5 })
      autoDraft(u, d, new Rng(`e6-bench-${i}`))
      expect(keepersIn([...Object.values(d.lineup), ...d.bench], (id) => u.index[id])).toBeLessThanOrEqual(MAX_KEEPERS)
    }
  })

  it('fills a Dynasty summer around the keepers the squad already has: never past three', { timeout: T }, () => {
    for (const seed of ['e6-summer-0', 'e6-summer-1', 'e6-summer-2']) {
      const g = drafted(settings(seed, { mode: 'dynasty' }))
      for (let y = 0; y < 2; y++) {
        playOut(g)
        advanceToNextSeason(g, u)
        const get = playerLookup(g, u)
        const held = keepersIn(Object.keys(g.squad), get)
        const rng = Rng.fromState(g.rngState)
        autoDraft(u, g.draft!, rng, get)
        g.rngState = rng.getState()
        const after = keepersIn([...Object.values(g.draft!.lineup), ...g.draft!.bench], get)
        expect(after, `${seed} summer ${y + 1}`).toBeLessThanOrEqual(Math.max(MAX_KEEPERS, held))
        expect(after, `${seed} summer ${y + 1}`).toBeGreaterThanOrEqual(Math.min(MIN_KEEPERS, held + g.bonusSpins))
        g.window = null
        beginSeason(g, u)
        startSeasonProper(g)
      }
    }
  })
})

describe('minutes while injured (item 4)', () => {
  it('records no zero-minute week and no missed match for a man out injured or banned', () => {
    const g = drafted(settings('e6-minutes'))
    for (let i = 0; i < 4; i++) playMatchweek(g, u, true)
    const id = Object.values(g.lineup)[5]
    const s = g.squad[id]
    const before = { minutes: [...(s.recentMinutes ?? [])], missed: g.consecutiveMissed[id] ?? 0 }
    s.injury = { description: 'Hamstring', weeksOut: 3 }
    for (let i = 0; i < 2; i++) playMatchweek(g, u, true)
    expect(s.recentMinutes).toEqual(before.minutes)
    expect(g.consecutiveMissed[id] ?? 0).toBe(before.missed)
    expect(g.weekUnavailable).toBeUndefined()
  })
})

describe('what a managed league scores (item 1, E6-3)', () => {
  it('managed Seasons: 2.5 to 3.15 goals a league game, AI champions under 112 goals, a Golden Boot under 45, the drafted side under 140', { timeout: T }, () => {
    let games = 0
    let goals = 0
    const topAi: number[] = []
    const boots: number[] = []
    const userGoals: number[] = []
    for (let i = 0; i < 8; i++) {
      const g = drafted(settings(`e6-managed-${i}`, { leagueSeason: [2012, 2018, 2021, 2025][i % 4], difficulty: i % 2 ? 'realistic' : 'calibrated' }))
      playOut(g)
      const season = g.season!
      const scorers: Record<string, number> = {}
      for (const f of season.fixtures) {
        const r = f.result!
        games++
        goals += r.homeGoals + r.awayGoals
        for (const st of [...r.homeStats, ...r.awayStats]) scorers[st.playerSeasonId] = (scorers[st.playerSeasonId] ?? 0) + st.goals
      }
      const table = seasonTable(season)
      topAi.push(Math.max(...table.filter((r) => r.teamId !== USER_TEAM).map((r) => r.goalsFor)))
      userGoals.push(table.find((r) => r.teamId === USER_TEAM)!.goalsFor)
      boots.push(Math.max(...Object.values(scorers)))
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(goals / games).toBeGreaterThan(2.5)
    expect(goals / games).toBeLessThan(3.15)
    expect(mean(topAi)).toBeLessThan(112)
    expect(mean(boots)).toBeLessThan(45)
    expect(mean(userGoals)).toBeLessThan(140)
  })

  it('quick seasons: 2.55 to 2.95 goals a game, the champions under 95 points on average', { timeout: T }, () => {
    let gpg = 0
    let champ = 0
    const n = 40
    for (let i = 0; i < n; i++) {
      const g = createGame({ mode: 'quick', seed: `e6-quick-${i}`, formationId: '4-3-3', teamName: 'Six XI', shortName: 'SIX', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: withDifficulty({ ...QUICK_RULES, leagues: ['england'], managers: false }, 'normal'), jobSecurity: false, difficulty: 'calibrated', january: false })
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      toKickoff(g, u)
      runQuickSeason(g, u)
      const q = g.quickResult!
      gpg += q.table.reduce((a, r) => a + r.goalsFor, 0) / (q.table.length * (q.table.length - 1))
      champ += q.table[0].points
    }
    expect(gpg / n).toBeGreaterThan(2.55)
    expect(gpg / n).toBeLessThan(2.95)
    expect(champ / n).toBeLessThan(95)
  })
})

describe('the Dynasty money (item 2)', () => {
  it('grows a winning side modestly and shrinks a losing one, signing nobody', { timeout: T }, () => {
    const path = (s: GameSettings) => {
      const g = drafted(s)
      const out = [g.finances.budget]
      const positions: number[] = []
      for (let y = 0; y < 3; y++) {
        playOut(g)
        out.push(g.finances.budget)
        positions.push(seasonTable(g.season!).findIndex((r) => r.teamId === USER_TEAM) + 1)
        if (y === 2) break
        advanceToNextSeason(g, u)
        const rng = Rng.fromState(g.rngState)
        autoDraft(u, g.draft!, rng, playerLookup(g, u))
        g.rngState = rng.getState()
        g.window = null
        beginSeason(g, u)
        startSeasonProper(g)
      }
      return { out, positions }
    }
    const strong = path(settings('e6-money-strong', { mode: 'dynasty', leagueSeason: 2015 }))
    // A wheel of Northern Ireland internationals against the real clubs: a bottom side every season
    const weak = path(settings('e6-money-weak', { mode: 'dynasty', leagueSeason: 2015, difficulty: 'realistic', rules: { ...SEASON_RULES, leagues: ['england'], onlyNation: 'NIR' } }))
    expect(Math.max(...strong.positions)).toBeLessThanOrEqual(4)
    expect(Math.min(...weak.positions)).toBeGreaterThanOrEqual(15)
    // Engine 5 added about £150M a season whatever the finish
    const strongGain = strong.out[3] - strong.out[0]
    expect(strongGain).toBeGreaterThan(30)
    expect(strongGain).toBeLessThan(180)
    expect(weak.out[3]).toBeLessThan(weak.out[0])
    expect(weak.out[3]).toBeGreaterThanOrEqual(0)
  })
})
