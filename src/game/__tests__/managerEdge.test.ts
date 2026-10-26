import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { MANAGER_EDGE, MANAGER_STYLES, YOUTH_AGE } from '@engine/managers'
import { toKickoff } from '../logic/quick'
import { quickManagerBoost } from '../logic/managers'
import { edgeHint, edgeLine, managerEdge } from '../logic/managerEdge'
import { createGame } from '../logic/setup'
import { playerLookup } from '../logic/players'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function atKickoff(seed: string): Game {
  const s: GameSettings = { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Edge XI', shortName: 'EDG', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' }
  const g = createGame(s)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, u)
  return g
}

describe("a manager's edge on the XI", () => {
  it('is the boost the quick season applies, in per cent, for every style, and reads the game without changing it', () => {
    for (const seed of ['edge-1', 'edge-2', 'edge-3']) {
      const g = atKickoff(seed)
      expect(g.manager).toBeDefined()
      const get = playerLookup(g, u)
      const before = JSON.stringify(g)
      for (const style of MANAGER_STYLES) {
        const e = managerEdge(g, style, get)
        const b = quickManagerBoost({ ...g, manager: { ...g.manager!, style } }, g.lineup, g.tactics, get)!
        expect(e.attack).toBeCloseTo((b.attack - 1) * 100, 1)
        expect(e.defence).toBeCloseTo((b.defence - 1) * 100, 1)
        expect(Math.abs(e.attack)).toBeLessThanOrEqual(MANAGER_EDGE * 100)
        expect(Math.abs(e.defence)).toBeLessThanOrEqual(MANAGER_EDGE * 100)
        expect(e.xi).toBe(11)
        expect(e.young).toBe(Object.values(g.lineup).filter((id) => get(id)!.age <= YOUTH_AGE).length)
      }
      expect(JSON.stringify(g)).toBe(before)
    }
  }, 60_000)

  it('grows when the instructions suit the style, and says what would suit it', () => {
    const g = atKickoff('edge-suits')
    const get = playerLookup(g, u)
    const plain = { ...g, tactics: { ...g.tactics, mentality: 'balanced' as const } }
    const attacking = { ...g, tactics: { ...g.tactics, mentality: 'attacking' as const } }
    const off = managerEdge(plain, 'attacking', get)
    const on = managerEdge(attacking, 'attacking', get)
    expect(off.suits).toBe(false)
    expect(on.suits).toBe(true)
    expect(on.attack).toBeGreaterThan(off.attack)
    expect(edgeHint('attacking', off)).toBeNull()
    expect(edgeHint('attacking', on)).toBe('Your team instructions suit him')
    expect(edgeHint('youth', off)).toBe(`${off.young} of your 11 starters are 23 or under`)
  })

  it('words the edge with signs and one decimal', () => {
    expect(edgeLine({ attack: 3, defence: -1 })).toBe('+3.0% goals · −1.0% conceded')
    expect(edgeLine({ attack: -1, defence: 0 })).toBe('−1.0% goals · ±0.0% conceded')
    expect(edgeLine({ attack: 1.5, defence: 1 })).toBe('+1.5% goals · +1.0% conceded')
  })
})
