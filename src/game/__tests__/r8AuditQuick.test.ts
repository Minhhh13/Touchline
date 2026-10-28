import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { createGame } from '../logic/setup'
import { kickOff, QUICK_UNLOCKS, toKickoff } from '../logic/quick'
import { earnsMoneyball } from '../logic/cap'
import { earnsChainChampions } from '../logic/chain'

const u = loadTestUniverse(['england'])

describe('r8 audit: a quick season works its unlocks out again on every run', () => {
  it('lists every achievement runQuickSeason can push, so a bench change never keeps one the season lost', () => {
    const src = readFileSync('src/game/logic/quick.ts', 'utf8')
    const pushed = new Set<string>()
    for (const m of src.matchAll(/game\.unlocked\.push\(([^)]*)\)/g)) for (const id of m[1].matchAll(/'([a-z0-9-]+)'/g)) pushed.add(id[1])
    expect(pushed.size).toBeGreaterThan(8)
    for (const id of pushed) expect(QUICK_UNLOCKS, id).toContain(id)
  })

  it('a run that does not earn Moneyball or the chain drops them from an earlier run', () => {
    for (const seed of ['r8-unlocks-1', 'r8-unlocks-2']) {
      const g = createGame({ mode: 'quick', seed, formationId: '4-3-3', teamName: 'Unlock XI', shortName: 'UNL', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: false })
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      toKickoff(g, u)
      expect(earnsMoneyball(g) || earnsChainChampions(g)).toBe(false)
      // As a first run of a bench season left them, before a change plays it again
      g.unlocked.push('moneyball', 'chain-champions')
      kickOff(g, u)
      expect(g.unlocked, seed).not.toContain('moneyball')
      expect(g.unlocked, seed).not.toContain('chain-champions')
    }
  })
})
