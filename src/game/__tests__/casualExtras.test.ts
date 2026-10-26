import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { runInJob } from '@engine/scenario'
import { createGame } from '../logic/setup'
import { cupGameSettings, finalGameSettings, gauntletGameSettings, type ArenaChoices } from '../logic/arena'
import { dailyArenaGameSettings } from '../logic/arenaDaily'
import { runInGameSettings } from '../logic/runin'
import { endCaseOn, endCaseRule, kickoffStep, lockerOn, rollEndCase } from '../logic/endCase'
import { managerSpinOn, managersOn, rollManagerSpin } from '../logic/managers'
import type { Game, GameSettings, Mode } from '../types'

// Main's manager spin, end-of-draft case and locker belong to a Quick Draft only: never an arena run (the Cup Final,
// the Cup, the Gauntlet, the Daily Arena), a Run-in or the Weekly, even when the rules would ask for them
const u = loadTestUniverse(['england'])

const choices = (seed: string): ArenaChoices => ({ teamName: 'Extras XI', formationId: '4-3-3', field: 'giants', wheelLeagues: ['england'], difficulty: 'calibrated', seed, hardMode: false, twists: true })

function drafted(settings: GameSettings): Game {
  const g = createGame(settings)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  return g
}

describe('Quick Draft extras in the casual modes', () => {
  const builders: Array<[string, () => GameSettings]> = [
    ['cup final', () => finalGameSettings(u, choices('extras-final'), 'EXI')],
    ['cup', () => cupGameSettings(u, { ...choices('extras-cup'), size: 16 }, 'EXI')],
    ['gauntlet', () => gauntletGameSettings(u, choices('extras-gauntlet'), 'EXI')],
    ['daily arena', () => dailyArenaGameSettings(u, 'arena-2026-10-25')],
    ['run-in', () => runInGameSettings(u, runInJob(u, 'survival', 'england', 2025, 'west-ham-united')!, { seed: 'extras-runin' })],
  ]

  it('builds every casual mode without the manager spin or the end case', () => {
    for (const [name, build] of builders) {
      const s = build()
      expect(s.mode, name).not.toBe('quick')
      expect(s.rules.managerSpin, name).toBeUndefined()
      expect(s.rules.endCase, name).toBeUndefined()
    }
  })

  it('keeps them off in every mode but the Quick Draft even when the rules ask for them', () => {
    const modes: Mode[] = ['daily', 'season', 'dynasty', 'arena', 'weekly', 'runin']
    for (const [name, build] of builders) {
      const base = drafted(build())
      for (const mode of modes) {
        const g: Game = { ...base, settings: { ...base.settings, mode, rules: { ...base.settings.rules, managers: true, managerSpin: true, endCase: true, powerUps: false } } }
        const label = `${name} as ${mode}`
        expect(managersOn(g), label).toBe(false)
        expect(managerSpinOn(g), label).toBe(false)
        expect(endCaseRule(g), label).toBe(false)
        expect(endCaseOn(g), label).toBe(false)
        expect(lockerOn({ ...g, phase: 'draft' }), label).toBe(false)
        const before = g.rngState
        rollManagerSpin(g, u)
        rollEndCase(g, u)
        rollEndCase(g, u, true)
        expect(g.managerSpin, label).toBeUndefined()
        expect(g.endCase, label).toBeUndefined()
        expect(g.rngState, label).toEqual(before)
        expect(kickoffStep(g), label).toBe('tactics')
      }
    }
  }, 60000)

  it('still gives a casual Quick Draft (Moneyball or the chain) both, from forks that leave the stream alone', () => {
    const g = drafted({ ...finalGameSettings(u, choices('extras-quick'), 'EXI'), mode: 'quick', arena: undefined })
    g.settings.rules = { ...QUICK_RULES, ...g.settings.rules, squadSize: 11, managers: true, managerSpin: true, endCase: true, chain: true }
    const before = g.rngState
    rollManagerSpin(g, u)
    rollEndCase(g, u)
    expect(g.managerSpin?.options.length).toBe(3)
    expect(g.endCase?.drop).toBeDefined()
    expect(g.rngState).toEqual(before)
  }, 30000)
})
