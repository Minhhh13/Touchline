import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { developedOverall, developSquad, growthRate, DEVELOPMENT_INTERVAL } from '../logic/development'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { playerLookup } from '../logic/players'
import type { GameSettings } from '../types'
import { overallOf } from '@engine/positions'
import { runInJob } from '@engine/scenario'
import { beginRunIn, runInGameSettings, seedRunInDraft } from '../logic/runin'
import { ageOneYear } from '../logic/dynasty'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'dynasty',
    seed: 'dev-test',
    formationId: '4-3-3',
    teamName: 'Test XI',
    shortName: 'TST',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'everton',
    leagueSeason: 2023,
    rules: { ...SEASON_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

describe('development and legends', () => {
  const u = loadTestUniverse()

  it('young regulars grow, veterans fade, ids stay stable', () => {
    const g = createGame(settings())
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    startSeasonProper(g)
    expect(growthRate(19)).toBeGreaterThan(growthRate(25))
    expect(growthRate(34)).toBeLessThan(0)
    const get = playerLookup(g, u)
    // Simulate a block of full minutes for everyone, then develop with a coach
    for (const s of Object.values(g.squad)) s.seasonStats.minutes = DEVELOPMENT_INTERVAL * 90
    g.staff = { coach: 2 }
    const before = Object.fromEntries(Object.keys(g.squad).map((id) => [id, get(id)!.overall]))
    const rng = new Rng('dev')
    // Run several blocks worth of growth to see the direction clearly
    let changes = 0
    for (let i = 0; i < 6; i++) {
      for (const s of Object.values(g.squad)) s.seasonStats.minutes += DEVELOPMENT_INTERVAL * 90
      changes += developSquad(g, u, rng).length
    }
    expect(changes).toBeGreaterThan(0)
    for (const id of Object.keys(g.squad)) {
      const p = get(id)!
      expect(p.id).toBe(id)
      const age = p.age
      if (age <= 21 && p.overall < 85) expect(p.overall).toBeGreaterThanOrEqual(before[id])
      if (age >= 33) expect(p.overall).toBeLessThanOrEqual(before[id])
      expect(g.development![id].base).toBe(before[id])
    }
    // A player who never played does not grow
    const g2 = createGame(settings({ seed: 'dev-idle' }))
    autoDraft(u, g2.draft!, Rng.fromState(g2.rngState))
    beginSeason(g2, u)
    const get2 = playerLookup(g2, u)
    const young = Object.keys(g2.squad).find((id) => get2(id)!.age <= 21)
    const out = developSquad(g2, u, new Rng('idle'))
    if (young) expect(out.find((c) => c.id === young)).toBeUndefined()
  })

  it('a season produces development reports and all-time records', () => {
    const g = createGame(settings({ seed: 'dev-season' }))
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    startSeasonProper(g)
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    expect(g.season!.news.some((n) => n.title === 'Development report')).toBe(true)
    const career = g.careerStats!
    expect(Object.keys(career).length).toBeGreaterThan(10)
    const totalApps = Object.values(career).reduce((s, r) => s + r.apps, 0)
    expect(totalApps).toBeGreaterThanOrEqual(38 * 11)
    for (const r of Object.values(career)) {
      expect(r.seasons).toBe(1)
      expect(r.lastYear).toBe(1)
    }
  })

  /**
   * INV-01: development moves the overall a player shows, never the one his attributes derive. The imported overall
   * sits above `overallOf` of the imported attributes for most men (2.6 points on average over the packs), so
   * ENGINE_VERSION 4, which stored `overallOf` after the first change, reset them at their first update: the playtest's
   * run-in (seed TX3U-SU25, Norwich 2015-16, Survival) reported R. Bennett 72→63, A. Doucouré 81→77 and H. Kane, 23,
   * 89→84 after five appearances, exactly each man's derived figure.
   */
  it('developedOverall moves the shown overall by what the attributes moved, never to the derived figure', () => {
    const bennett = u.clubSeasonByKey['norwich-city@2015'].squad.find((p) => p.name === 'R. Bennett')!
    expect(bennett.overall).toBe(72)
    expect(overallOf(bennett)).toBe(63)
    expect(developedOverall(bennett, bennett.attributes)).toBe(72)
    const up = Object.fromEntries(Object.entries(bennett.attributes).map(([k, v]) => [k, v + 2])) as typeof bennett.attributes
    expect(developedOverall(bennett, up)).toBe(72 + overallOf({ ...bennett, attributes: up }) - 63)
    expect(developedOverall({ ...bennett, overall: 99 }, up)).toBe(99)
  })

  it('the playtest run-in: nobody resets at the first update, and the young regulars hold or grow', () => {
    const job = runInJob(u, 'survival', 'england', 2015, 'norwich-city')!
    const g = createGame(runInGameSettings(u, job, { seed: 'TX3U-SU25' }))
    seedRunInDraft(g, u)
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginRunIn(g, u)
    for (let i = 0; i < 5; i++) {
      playMatchweek(g, u, true)
      if (g.phase === 'match') g.phase = 'week'
    }
    expect(g.season!.matchweek).toBe(33)
    const get = playerLookup(g, u)
    for (const id of Object.keys(g.squad)) {
      const now = get(id)!
      const was = u.index[id]
      if (!was) continue
      // One block: growth or a veteran's point or two, never the reset
      if (was.age < 30) expect(now.overall, was.name).toBeGreaterThanOrEqual(was.overall)
      else expect(now.overall, was.name).toBeGreaterThanOrEqual(was.overall - 2)
    }
    const report = g.season!.news.find((n) => n.title === 'Development report')
    expect(report?.body ?? '').not.toMatch(/Bennett 72→63|Doucouré 81→77|Kane 89→84/)
  })

  it('over twelve seasons: no first-update reset by age band, growth for young regulars, decline still for the old', () => {
    const firstDrop: number[] = []
    const season: Record<'young' | 'old', number[]> = { young: [], old: [] }
    for (let i = 0; i < 12; i++) {
      const g = createGame(settings({ seed: `dev-bands-${i}`, mode: 'season' }))
      const r = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, r)
      g.rngState = r.getState()
      beginSeason(g, u)
      startSeasonProper(g)
      const get = playerLookup(g, u)
      const start = Object.fromEntries(Object.keys(g.squad).map((id) => [id, get(id)!.overall]))
      for (let w = 0; w < 38 && g.phase !== 'summary'; w++) {
        playMatchweek(g, u, true)
        if (g.phase === 'match') g.phase = 'week'
        if (w === 4) for (const id of Object.keys(start)) if (get(id)!.age < 30) firstDrop.push(start[id] - get(id)!.overall)
      }
      for (const id of Object.keys(start)) {
        const p = get(id)!
        const mins = g.squad[id]?.seasonStats.minutes ?? 0
        if (p.age <= 23 && mins >= 1500) season.young.push(p.overall - start[id])
        if (p.age >= 31) season.old.push(p.overall - start[id])
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(firstDrop.length).toBeGreaterThan(100)
    expect(Math.max(...firstDrop)).toBeLessThanOrEqual(0)
    expect(season.young.length).toBeGreaterThan(20)
    expect(mean(season.young)).toBeGreaterThan(1.5)
    expect(Math.min(...season.young)).toBeGreaterThanOrEqual(0)
    expect(season.old.length).toBeGreaterThan(20)
    expect(mean(season.old)).toBeLessThan(-0.75)
  }, 120_000)

  it('the dynasty summer ages from the shown overall: growth young, a fall old, no derived reset', () => {
    const rng = new Rng('summer-bands')
    const bands: Record<string, number[]> = { young: [], prime: [], old: [] }
    for (const cs of u.clubSeasons.filter((_, i) => i % 9 === 0)) {
      for (const p of cs.squad) {
        const d = ageOneYear(p, rng, 1).overall - p.overall
        bands[p.age + 1 <= 23 ? 'young' : p.age + 1 <= 29 ? 'prime' : p.age + 1 >= 33 ? 'old' : 'skip']?.push(d)
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const share = (xs: number[], f: (x: number) => boolean) => xs.filter(f).length / xs.length
    expect(mean(bands.young)).toBeGreaterThan(1.5)
    expect(share(bands.young, (x) => x <= -3)).toBeLessThan(0.01)
    expect(Math.abs(mean(bands.prime))).toBeLessThan(1)
    expect(share(bands.prime, (x) => x <= -4)).toBeLessThan(0.01)
    expect(mean(bands.old)).toBeLessThan(-2)
  })
})
