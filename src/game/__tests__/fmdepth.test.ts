import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { developSquad, DEVELOPMENT_INTERVAL } from '../logic/development'
import { ageOneYear } from '../logic/dynasty'
import { normaliseGame } from '../logic/save'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { applyMatchToState } from '@engine/season'
import { DEPTH_KEYS, deriveAggression, deriveJumping, deriveStamina, deriveStrength, deriveWorkRate } from '@engine/depth'
import { playerLookup } from '../logic/players'
import type { GameSettings } from '../types'
import type { Attributes, PlayerSeason, SquadPlayer } from '@engine/types'
import type { Game } from '../types'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'dynasty',
    seed: 'fm-depth',
    formationId: '4-3-3',
    teamName: 'Depth XI',
    shortName: 'DEP',
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

const fresh = (): SquadPlayer => ({ playerSeasonId: 'x', condition: 90, morale: 70, sharpness: 70, familiarity: 50, recentRatings: [], injury: null, suspension: 0, yellowCards: 0, seasonStats: { apps: 0, starts: 0, goals: 0, assists: 0, minutes: 0, ratingSum: 0, cleanSheets: 0, motm: 0 } })
const stats = { minutes: 90, goals: 0, assists: 0, rating: 7, yellow: false, red: false, injured: null }

describe('depth attributes through a career', () => {
  const u = loadTestUniverse()
  const all = Object.values(u.index)
  /** A real outfielder with the depth attributes levelled, aged as asked. */
  const subject = (age: number): PlayerSeason => {
    const p = all.find((x) => x.positions[0] === 'CM' && x.overall >= 74 && x.overall <= 78)!
    return { ...p, age, attributes: { ...p.attributes, stamina: 70, strength: 70, aggression: 70, jumping: 70, workRate: 60 } }
  }
  /** Mean change of each depth attribute over many seeded summers. */
  const meanChange = (age: number, n = 400) => {
    const p = subject(age)
    const sum: Record<string, number> = Object.fromEntries(DEPTH_KEYS.map((k) => [k, 0]))
    for (let i = 0; i < n; i++) {
      const aged = ageOneYear(p, new Rng(`age-${age}-${i}`), 2030)
      expect(aged.age).toBe(age + 1)
      for (const k of DEPTH_KEYS) {
        expect(Number.isInteger(aged.attributes[k])).toBe(true)
        sum[k] += aged.attributes[k] - p.attributes[k]
      }
    }
    return Object.fromEntries(DEPTH_KEYS.map((k) => [k, sum[k] / n])) as Record<(typeof DEPTH_KEYS)[number], number>
  }

  it('dynasty ageing: stamina and jumping fall from 30, strength holds to 33, aggression and work rate stay', () => {
    const at31 = meanChange(30)
    const at33 = meanChange(32)
    const at21 = meanChange(20)
    console.log('ageing to 31', JSON.stringify(at31), 'to 33', JSON.stringify(at33), 'to 21', JSON.stringify(at21))
    expect(at31.stamina).toBeLessThan(-1.5)
    expect(at31.jumping).toBeLessThan(-1.5)
    expect(Math.abs(at31.strength)).toBeLessThan(0.4)
    expect(Math.abs(at31.aggression)).toBeLessThan(0.4)
    expect(Math.abs(at31.workRate)).toBeLessThan(0.4)
    // From 33 the strength goes too, faster than at 31
    expect(at33.strength).toBeLessThan(-2)
    expect(at33.stamina).toBeLessThan(at31.stamina)
    expect(Math.abs(at33.aggression)).toBeLessThan(0.4)
    // A youngster grows legs and power with everything else, but his character is set
    expect(at21.stamina).toBeGreaterThan(1.5)
    expect(at21.strength).toBeGreaterThan(1)
    expect(at21.jumping).toBeGreaterThan(1)
    expect(Math.abs(at21.aggression)).toBeLessThan(0.4)
    expect(Math.abs(at21.workRate)).toBeLessThan(0.4)
  })

  it('in-season development grows the depth attributes of young regulars and fades those of veterans', () => {
    const g = createGame(settings())
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    startSeasonProper(g)
    const get = playerLookup(g, u)
    const before = Object.fromEntries(Object.keys(g.squad).map((id) => [id, { ...get(id)!.attributes }]))
    g.staff = { coach: 2 }
    const rng = new Rng('dev-depth')
    for (let i = 0; i < 6; i++) {
      for (const s of Object.values(g.squad)) s.seasonStats.minutes += DEVELOPMENT_INTERVAL * 90
      developSquad(g, u, rng)
    }
    let grew = 0
    let faded = 0
    for (const id of Object.keys(g.squad)) {
      const p = get(id)!
      const depthSum = (a: PlayerSeason['attributes']) => a.stamina + a.strength + a.jumping
      if (p.age <= 21 && p.overall < 85) {
        expect(depthSum(p.attributes)).toBeGreaterThanOrEqual(depthSum(before[id]))
        if (depthSum(p.attributes) > depthSum(before[id])) grew++
      }
      if (p.age >= 33) {
        expect(p.attributes.stamina).toBeLessThanOrEqual(before[id].stamina)
        if (p.attributes.stamina < before[id].stamina) faded++
      }
      for (const k of DEPTH_KEYS) {
        expect(p.attributes[k]).toBeGreaterThanOrEqual(1)
        expect(p.attributes[k]).toBeLessThanOrEqual(99)
      }
    }
    console.log(`development: ${grew} youngsters grew their legs, ${faded} veterans lost some`)
    expect(grew + faded).toBeGreaterThan(0)
  })

  it('a low work rate costs familiarity from a start: +3 at 35 against +4 at 55 and above', () => {
    const lazy = fresh()
    const worker = fresh()
    const plain = fresh()
    applyMatchToState(lazy, stats, true, 20, false, false, 'D', 35)
    applyMatchToState(worker, stats, true, 20, false, false, 'D', 80)
    applyMatchToState(plain, stats, true, 20, false, false, 'D')
    expect(lazy.familiarity).toBe(53)
    expect(worker.familiarity).toBe(54)
    expect(plain.familiarity).toBe(54)
    // A substitute's +2 rounds back to +2 even for the laziest
    const sub = fresh()
    applyMatchToState(sub, stats, false, 10, false, false, 'D', 35)
    expect(sub.familiarity).toBe(52)
  })

  it('a dynasty summer keeps the depth attributes on every aged player in the save', () => {
    const g = createGame(settings({ seed: 'fm-depth-summer' }))
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    const get = playerLookup(g, u)
    for (const id of Object.keys(g.squad)) {
      const aged = ageOneYear(get(id)!, new Rng(`summer-${id}`), 2031)
      for (const k of DEPTH_KEYS) {
        expect(Number.isInteger(aged.attributes[k])).toBe(true)
        expect(aged.attributes[k]).toBeGreaterThanOrEqual(1)
        expect(aged.attributes[k]).toBeLessThanOrEqual(99)
      }
    }
  })

  it('an older save whose game-created players lack the depth attributes gets them derived on load', () => {
    const g = createGame(settings({ seed: 'fm-depth-oldsave' }))
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    startSeasonProper(g)
    // A dynasty save from before format 3: every squad player was aged into customPlayers without the five
    const get = playerLookup(g, u)
    for (const id of Object.keys(g.squad)) {
      const p = get(id)!
      const core: Record<string, number> = { ...p.attributes }
      for (const k of DEPTH_KEYS) delete core[k]
      g.customPlayers[id] = { ...p, attributes: core as unknown as Attributes }
    }
    // Normalised on load (played as saved, the missing attributes would turn condition into NaN), every custom player reads the engine's derivations and the week plays through
    const n = normaliseGame(structuredClone(g) as Game)!
    for (const id of Object.keys(n.squad)) {
      const p = n.customPlayers[id]
      expect(p.attributes.stamina).toBe(deriveStamina(p.attributes.physical, p.age))
      expect(p.attributes.strength).toBe(deriveStrength(p.attributes.physical, p.height))
      expect(p.attributes.aggression).toBe(deriveAggression(p.attributes.defending, p.attributes.mentality))
      expect(p.attributes.jumping).toBe(deriveJumping(p.height, p.attributes.physical))
      expect(p.attributes.workRate).toBe(deriveWorkRate(p.attributes.mentality))
    }
    playMatchweek(n, u, true)
    for (const s of Object.values(n.squad)) {
      expect(Number.isFinite(s.condition)).toBe(true)
      expect(s.condition).toBeGreaterThanOrEqual(5)
    }
    // A save whose players already carry the five is handed back as it is
    const fresh = normaliseGame(structuredClone(n) as Game)!
    expect(fresh.customPlayers).toEqual(n.customPlayers)
    const same = { ...n, customPlayers: { ...n.customPlayers } }
    expect(normaliseGame(same)!.customPlayers).toBe(same.customPlayers)
  })
})
