import { afterEach, describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { QUICK_RULES } from '@engine/draft'
import { runInCatalogue, suggestRunIns } from '@engine/scenario'
import { compareProgress, gameSlot, progressKey } from '../../online/core/slots'
import { useStore } from '../store'
import { setupRules } from '../logic/setup'
import { cupGameSettings, finalGameSettings, gauntletGameSettings } from '../logic/arena'
import { runInGameSettings } from '../logic/runin'
import type { Game, GameSettings } from '../types'
import { breathe, Chooser, driveDraft, driveQuickSeason, loadStore, seeds, stepHook } from './qaHarness'
import { driveArena, driveSeason } from './qaSeasonHarness'

/**
 * QA round 4 (r9): the cloud sync settles two copies of one game by `progressKey` (R8-1). Along every step of a Quick
 * Draft, the arena's three formats and the Run-in the key must never go backwards, or a copy saved later would read as
 * an older save and lose to the earlier one. (Season and Dynasty are checked the same way in `qaR9Europe.test.ts`.)
 */
const u = loadTestUniverse(['england'])
const st = () => useStore.getState()

function watch(problems: string[]): void {
  let last: { id: string; key: number[]; label: string } | null = null
  stepHook.run = () => {
    const g: Game | null = st().game
    const slot = g && gameSlot(g)
    // A live match is never uploaded or compared (`sync.ts`): the slot waits for the whistle
    if (!g || !slot || (g.phase === 'match' && g.live)) return
    const key = progressKey({ slot, kind: 'game', game: g, active: true })
    const label = `${g.phase} step ${g.arena?.step ?? '-'} mw ${g.season?.matchweek ?? '-'} spins ${g.draft?.spins ?? '-'}`
    if (last && last.id === g.id && compareProgress(key, last.key) < 0 && problems.length < 4) problems.push(`progress went back from ${last.label} [${last.key}] to ${label} [${key}]`)
    last = { id: g.id, key, label }
  }
}

afterEach(() => {
  stepHook.run = undefined
})

describe("QA r9: the sync's progress key never goes backwards", () => {
  it('Quick Drafts with every season extra', async () => {
    const fails: string[] = []
    for (let i = 0; i < seeds(12); i++) {
      await breathe()
      const seed = `r9-progress-quick-${i}`
      const ch = new Chooser(seed)
      loadStore(u, ['england'])
      const rules = setupRules(QUICK_RULES, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'prime', eraFrom: 2008, eraTo: 2026, first: 2008, last: 2026, twists: ch.chance(0.5), leagues: ['england'], benchPicks: ch.pick([0, 3, 5]), modes: ch.chance(0.4) ? [ch.pick(['crazy', 'gamble', 'upgrader'] as const)] : [], powerUps: ch.chance(0.5), managers: true, managerSpin: ch.chance(0.5), endCase: ch.chance(0.5) })
      const s: GameSettings = { mode: 'quick', seed, formationId: '4-3-3', teamName: 'R9', shortName: 'R9P', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024, rules, jobSecurity: false, difficulty: 'calibrated', continental: ch.chance(0.3), january: ch.chance(0.7) }
      const problems: string[] = []
      watch(problems)
      st().startGame(s)
      problems.push(...driveDraft(u, ch, { autoAt: ch.chance(0.5) ? ch.int(0, 8) : undefined }).problems)
      if (!problems.length) problems.push(...driveQuickSeason(u, ch))
      if (problems.length) fails.push(`${seed}: ${problems.join(' | ')}`)
    }
    expect(fails).toEqual([])
  }, 300_000)

  for (const format of ['final', 'cup', 'gauntlet'] as const)
    it(`arena ${format} runs`, async () => {
      const fails: string[] = []
      for (let i = 0; i < seeds(9); i++) {
        await breathe()
        const seed = `r9-progress-${format}-${i}`
        const ch = new Chooser(seed)
        loadStore(u, ['england'])
        const c = { teamName: 'R9', formationId: '4-3-3', field: ch.pick(['giants', 'wheel'] as const), wheelLeagues: ['england'], difficulty: 'calibrated' as const, seed, hardMode: false, twists: ch.chance(0.5) }
        const problems: string[] = []
        watch(problems)
        st().startGame(format === 'final' ? finalGameSettings(u, c, 'R9A') : format === 'cup' ? cupGameSettings(u, { ...c, size: ch.pick([8, 16] as const) }, 'R9A') : gauntletGameSettings(u, c, 'R9A'))
        problems.push(...driveDraft(u, ch, { autoAt: ch.chance(0.5) ? 0 : undefined }).problems)
        if (!problems.length) problems.push(...driveArena(u, ch))
        if (problems.length) fails.push(`${seed}: ${problems.join(' | ')}`)
      }
      expect(fails).toEqual([])
    }, 300_000)

  it('Run-ins', async () => {
    const fails: string[] = []
    for (let i = 0; i < seeds(6); i++) {
      await breathe()
      const seed = `r9-progress-runin-${i}`
      const ch = new Chooser(seed)
      loadStore(u, ['england'])
      const job = suggestRunIns(runInCatalogue(u, ch.pick(['title', 'europe', 'survival'] as const)).filter((j) => j.leagueId === 'england'), seed)[0]
      const problems: string[] = []
      watch(problems)
      st().startGame(runInGameSettings(u, job, { seed }))
      problems.push(...driveDraft(u, ch, {}).problems)
      if (!problems.length) problems.push(...driveSeason(u, ch, { draft: () => ['a second draft'], simBias: 4 }).problems)
      if (problems.length) fails.push(`${seed}: ${problems.join(' | ')}`)
    }
    expect(fails).toEqual([])
  }, 300_000)
})
