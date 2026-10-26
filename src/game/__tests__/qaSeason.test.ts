import { describe, expect, it, vi } from 'vitest'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { SEASON_RULES } from '@engine/draft'
import { wheelSeasons } from '@engine/era'
import { defaultHostClub, setupRules, shortNameFor } from '../logic/setup'
import { withCap } from '../logic/cap'
import { compactGame } from '../logic/compact'
import { useStore } from '../store'
import type { Game, GameSettings, Mode } from '../types'
import { breathe, QA_FULL, seeds, Chooser, coverage, driveDraft, expectReloadSame, loadStore, reloadState } from './qaHarness'
import { driveSeason } from './qaSeasonHarness'

const u = loadTestUniverse(['england'])

/** The settings the Setup screen's Start sends for a managed season (its `buildSettings`), England only. */
function managedSettings(mode: Mode, seed: string, ch: Chooser): GameSettings {
  const stops = wheelSeasons(u, ['england'], false)
  const first = stops[0]
  const last = stops[stops.length - 1]
  const squadSize = ch.pick([16, 18, 20])
  const chosen = setupRules({ ...SEASON_RULES, squadSize }, { difficulty: ch.pick(['easy', 'normal', 'hard'] as const), showRatings: true, draftMode: ch.chance(0.3) ? 'position' : 'squad', ratings: 'season', eraFrom: first, eraTo: last, first, last, twists: ch.chance(0.4), leagues: ['england'], benchPicks: 0, modes: [], powerUps: false, classic: false })
  const rules = withCap({ ...chosen, ...(ch.chance(0.15) ? { chain: true } : {}) }, { preset: ch.pick(['off', 'off', 'off', 'moneyball', 'big-spender'] as const), custom: 180 })
  const leagueSeason = ch.pick([2012, 2018, 2023, 2025])
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === leagueSeason).map((cs) => cs.clubId)
  return {
    mode,
    seed,
    formationId: ch.pick(['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '5-3-2']),
    teamName: 'QA United',
    shortName: shortNameFor('QA United'),
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: ch.chance(0.5) ? defaultHostClub(u, 'england', leagueSeason, clubs) : ch.pick(clubs),
    leagueSeason,
    rules,
    jobSecurity: ch.chance(0.5),
    difficulty: ch.pick(['calibrated', 'realistic'] as const),
    continental: false,
  }
}

const draftWith = (ch: Chooser) => (label: string) => {
  const log = driveDraft(u, ch, { autoAt: ch.chance(0.5) ? ch.int(0, 14) : undefined })
  return log.problems.map((p) => `${label}: ${p}`)
}

async function playManaged(mode: Mode, seed: string, years = 0): Promise<string[]> {
  const ch = new Chooser(seed)
  loadStore(u, ['england'])
  useStore.getState().startGame(managedSettings(mode, seed, ch))
  const draft = draftWith(ch)
  const out = draft('draft')
  if (out.length) return out
  const run = driveSeason(u, ch, { years, draft, simBias: 6 })
  const problems = [...run.problems]
  const g = useStore.getState().game
  if (!g || g.phase !== 'summary') {
    problems.push(`ended in ${g?.phase}`)
    return problems
  }
  // Credited once per season: the leaderboard holds one row per finished season
  const profile = useStore.getState().profile
  useStore.getState().recordResult()
  if (useStore.getState().profile !== profile) problems.push('recordResult changed the profile a second time')
  expectReloadSame(`${seed} summary`)
  if (profile.seasonsSimulated !== run.seasons) problems.push(`seasonsSimulated ${profile.seasonsSimulated} for ${run.seasons} seasons`)
  return problems
}

describe('QA: managed seasons through the store', () => {
  for (let batch = 0; batch < 4; batch++) {
    it(`manages random Seasons (batch ${batch}) to the summary with every invariant`, async () => {
      const fails: string[] = []
      for (let i = 0; i < seeds(5); i++) {
      await breathe()
        const seed = `qa-season-${batch}-${i}`
        try {
          const problems = await playManaged('season', seed)
          if (problems.length) fails.push(`${seed}\n  ${problems.slice(0, 6).join('\n  ')}`)
        } catch (e) {
          fails.push(`${seed} threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 5).join(' | ') : String(e)}`)
        }
      }
      expect(fails).toEqual([])
    }, 60_000)
  }

  for (let batch = 0; batch < 3; batch++) {
    it(`runs random three-season Dynasties (batch ${batch})`, async () => {
      const fails: string[] = []
      for (let i = 0; i < seeds(2); i++) {
      await breathe()
        const seed = `qa-dynasty-${batch}-${i}`
        try {
          const problems = await playManaged('dynasty', seed, 2)
          if (problems.length) fails.push(`${seed}\n  ${problems.slice(0, 6).join('\n  ')}`)
        } catch (e) {
          fails.push(`${seed} threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 5).join(' | ') : String(e)}`)
        }
      }
      expect(fails).toEqual([])
    }, 60_000)
  }

  it('a reloaded season plays on exactly as the one that never reloaded', async () => {
    const fails: string[] = []
    for (let i = 0; i < seeds(6); i++) {
      await breathe()
      const seed = `qa-reload-${i}`
      const ch = new Chooser(seed)
      loadStore(u, ['england'])
      useStore.getState().startGame(managedSettings(i % 2 ? 'dynasty' : 'season', seed, ch))
      useStore.getState().autoDraftRest()
      useStore.getState().finishDraft()
      useStore.getState().simWeeks(ch.int(3, 30))
      if (useStore.getState().game?.phase === 'summary') continue
      // The live match stops at half time, mid-week, then the save is reloaded
      useStore.getState().setMatchPlay('watch')
      useStore.getState().playWeek()
      const before = useStore.getState().game!
      const reloaded = reloadState().game!
      const playOn = (g: Game): Game => {
        useStore.setState({ game: g })
        if (useStore.getState().game!.live) useStore.getState().advanceLive({ talk: 'calm' })
        if (useStore.getState().game!.live) useStore.getState().advanceLive({ shout: 'keep-shape' })
        if (useStore.getState().game!.phase === 'match') useStore.getState().closeMatch()
        useStore.getState().simWeeks(6)
        return useStore.getState().game!
      }
      const a = compactGame(playOn(before))
      const b = compactGame(playOn(reloaded))
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        const diff = Object.keys(a).filter((k) => JSON.stringify((a as unknown as Record<string, unknown>)[k]) !== JSON.stringify((b as unknown as Record<string, unknown>)[k]))
        fails.push(`${seed}: differs in ${diff.join(', ')}`)
      }
    }
    expect(fails).toEqual([])
  }, 60_000)

  // The full sweep only (QA_FULL=1): a share of the seeds need not reach every action
  it.runIf(QA_FULL)('exercised the managed flow', async () => {
    for (const key of ['season:simWeeks', 'season:playWeek', 'season:closeMatch', 'live:advance', 'live:intervene', 'live:finishNow', 'season:bid', 'season:advanceDay', 'season:nextSeason', 'season:friendly', 'season:setFormation', 'season:assign']) expect(coverage[key] ?? 0, key).toBeGreaterThan(0)
  })
})
