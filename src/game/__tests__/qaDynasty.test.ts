/**
 * QA round 2 (r7, engine 6): long Dynasties through the store. Six seasons each, a random manager every week, the
 * summer's bonus spins drafted by hand or by the assistant. Beyond the per-week invariants of `driveSeason`, each new
 * season checks engine 6's Dynasty economy (a club out of debt starts the summer with at least `SUMMER_FLOOR`), the
 * assistant's keeper limits in the summer draft (`MAX_KEEPERS`) and that the save does not grow without bound.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { MAX_KEEPERS, SEASON_RULES } from '@engine/draft'
import { wheelSeasons } from '@engine/era'
import { SUMMER_FLOOR } from '@engine/market'
import { defaultHostClub, setupRules, shortNameFor } from '../logic/setup'
import { playerLookup } from '../logic/players'
import { encodeSave } from '../saveStorage'
import { persistedState, useStore } from '../store'
import type { GameSettings } from '../types'
import { breathe, Chooser, driveDraft, loadStore, seeds } from './qaHarness'
import { driveSeason } from './qaSeasonHarness'

// Every league, so a side that qualifies for Europe plays on into its next summer
const LEAGUES = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
const u = loadTestUniverse(LEAGUES)
const st = () => useStore.getState()
const YEARS = 6

function dynastySettings(seed: string, ch: Chooser): GameSettings {
  const stops = wheelSeasons(u, ['england'], false)
  const rules = setupRules({ ...SEASON_RULES, squadSize: ch.pick([16, 18, 20]) }, { difficulty: ch.pick(['easy', 'normal', 'hard'] as const), showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: stops[0], eraTo: stops[stops.length - 1], first: stops[0], last: stops[stops.length - 1], twists: ch.chance(0.4), leagues: ['england'], benchPicks: 0, modes: [], powerUps: false, classic: false })
  const leagueSeason = ch.pick([2012, 2016, 2019])
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === leagueSeason).map((cs) => cs.clubId)
  return { mode: 'dynasty', seed, formationId: ch.pick(['4-3-3', '4-4-2', '4-2-3-1', '3-5-2']), teamName: 'QA Dynasty', shortName: shortNameFor('QA Dynasty'), leagueId: 'england', wheelLeagues: ['england'], hostClubId: ch.chance(0.5) ? defaultHostClub(u, 'england', leagueSeason, clubs) : ch.pick(clubs), leagueSeason, rules, jobSecurity: false, difficulty: ch.pick(['calibrated', 'realistic'] as const), continental: false }
}

const saveSize = () => encodeSave(JSON.stringify({ state: persistedState(st()), version: 1 })).length

describe('QA: long Dynasties through the store', () => {
  for (let batch = 0; batch < 2; batch++) {
    it(`runs random ${YEARS}-season Dynasties (batch ${batch}): the summer floor, the keepers, the save size`, async () => {
      const fails: string[] = []
      for (let i = 0; i < seeds(3); i++) {
        await breathe()
        const seed = `qa-dynasty-long-${batch}-${i}`
        const ch = new Chooser(seed)
        loadStore(u, LEAGUES)
        st().startGame(dynastySettings(seed, ch))
        const problems: string[] = []
        // Each summer: the budget the season ended on, then what the new season starts with
        let lastYear = st().game!.year
        let endBudget: number | null = null
        const sizes: number[] = []
        const keepers = () => {
          const g = st().game!
          const get = playerLookup(g, u)
          return Object.keys(g.squad).filter((id) => get(id)?.positions[0] === 'GK').length
        }
        const unsub = useStore.subscribe((s) => {
          const g = s.game
          if (!g) return
          if (g.phase === 'summary' && g.year === lastYear) {
            endBudget = g.finances.budget
          }
          if (g.year !== lastYear && g.phase !== 'summary') {
            lastYear = g.year
            sizes.push(saveSize())
            if (endBudget !== null && endBudget >= 0 && g.finances.budget < SUMMER_FLOOR - 1e-9 && !g.pendingMove) problems.push(`y${g.year}: started the season on £${g.finances.budget}M after ending the last on £${endBudget}M`)
            endBudget = null
          }
        })
        const draft = (label: string) => {
          const before = keepers()
          const auto = ch.chance(0.7)
          const log = driveDraft(u, ch, { autoAt: auto ? 0 : undefined })
          // The assistant takes no keeper past three in the summer (it counts the ones the squad holds)
          if (auto && st().game?.phase !== 'draft' && keepers() > Math.max(MAX_KEEPERS, before) && st().game!.year > 1) problems.push(`${label}: the assistant's summer draft took the squad from ${before} to ${keepers()} keepers`)
          return log.problems.map((p) => `${label}: ${p}`)
        }
        try {
          problems.push(...draft('draft'))
          const run = driveSeason(u, ch, { years: YEARS - 1, draft, simBias: 8 })
          problems.push(...run.problems)
          if (!run.problems.length && run.seasons < YEARS && !st().game?.season?.sacked ) problems.push(`only ${run.seasons} seasons`)
          // The save grows by about a season's history each summer (2K compressed characters, most of it the squad's aged
          // custom players, docs/QA.md R7-O3), never by more: a cap left off a list shows up here as a jump
          for (let k = 1; k < sizes.length; k++) if (sizes[k] - sizes[k - 1] > 4000) problems.push(`the save grew by ${sizes[k] - sizes[k - 1]} characters in one summer (${sizes.join(', ')})`)
        } catch (e) {
          problems.push(`threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 5).join(' | ') : String(e)}`)
        } finally {
          unsub()
        }
        if (problems.length) fails.push(`${seed}\n  ${problems.slice(0, 6).join('\n  ')}`)
      }
      expect(fails).toEqual([])
    }, 600_000)
  }
})
