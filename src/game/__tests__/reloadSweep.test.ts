import { afterEach, describe, expect, it, vi } from 'vitest'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { wheelSeasons } from '@engine/era'
import { runInCatalogue, suggestRunIns } from '@engine/scenario'
import { setupRules, shortNameFor, startFormation } from '../logic/setup'
import { cupGameSettings, gauntletGameSettings } from '../logic/arena'
import { runInGameSettings } from '../logic/runin'
import { compactGame } from '../logic/compact'
import { encodeSave, parseSave } from '../saveStorage'
import { canonicalJson } from '../../online/core/canonical'
import { persistedState, useStore } from '../store'
import type { Game, GameSettings, Mode } from '../types'
import { breathe, Chooser, crashToast, driveDraft, driveQuickSeason, loadStore, seeds, stepHook } from './qaHarness'
import { driveArena, driveSeason } from './qaSeasonHarness'

/**
 * A reload can come at any step of any mode: the tab closed mid-draft, at the reel, at kick-off, in January, at a live
 * match's stop, mid-arena, in the summer window, mid-Run-in. Each run below is played twice with the same choices,
 * once straight through and once with the page "reloaded" at random steps (the save persisted, compacted, compressed,
 * read back and merged into a fresh store, as a real reload does), and must end on the same game.
 */
const u = loadTestUniverse(['england'])
const st = () => useStore.getState()
type Store = ReturnType<typeof useStore.getState>

/** A real reload: everything not in the save is gone, the store starts from its initial state and merges the save. */
function reloadNow(): void {
  const s = st()
  const raw = encodeSave(JSON.stringify({ state: persistedState(s), version: 1 }))
  const value = parseSave<Record<string, unknown>>(raw)
  const merge = useStore.persist.getOptions().merge!
  const fresh: Store = { ...useStore.getInitialState(), universe: s.universe, loadedLeagues: s.loadedLeagues }
  useStore.setState(merge(value.state, fresh) as Store, true)
}

/** The game with the per-run identity (its id and timestamps) taken out, compacted as it is stored, keys sorted (a reload may reorder them). */
function comparable(g: Game | null): string {
  if (!g) return 'null'
  return canonicalJson(compactGame(g)).split(g.id).join('ID').replace(/"\d{4}-\d\d-\d\dT[\d:.]+Z"/g, '"T"')
}

const SEASON_LEAGUE = 2023

function quickSettings(seed: string, ch: Chooser): GameSettings {
  const stops = wheelSeasons(u, ['england'], false)
  const rules = setupRules(QUICK_RULES, { difficulty: ch.pick(['easy', 'normal', 'hard'] as const), showRatings: true, draftMode: ch.chance(0.3) ? 'position' : 'squad', ratings: ch.pick(['season', 'prime'] as const), eraFrom: stops[0], eraTo: stops[stops.length - 1], first: stops[0], last: stops[stops.length - 1], twists: true, leagues: ['england'], benchPicks: ch.pick([0, 1, 3]), modes: ch.chance(0.3) ? ['gamble'] : [], powerUps: ch.chance(0.4), classic: false, managers: ch.chance(0.5), managerSpin: ch.chance(0.5), endCase: ch.chance(0.5) })
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === 2025).map((cs) => cs.clubId)
  return { mode: 'quick', seed, formationId: startFormation(rules, seed, '4-3-3'), teamName: 'Reload XI', shortName: shortNameFor('Reload XI'), leagueId: 'england', wheelLeagues: ['england'], hostClubId: clubs[seed.length % clubs.length], leagueSeason: 2025, rules, jobSecurity: false, difficulty: 'calibrated', continental: false, january: true }
}

function managedSettings(mode: Mode, seed: string, ch: Chooser): GameSettings {
  const stops = wheelSeasons(u, ['england'], false)
  const rules = setupRules({ ...SEASON_RULES, squadSize: 18 }, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: stops[0], eraTo: stops[stops.length - 1], first: stops[0], last: stops[stops.length - 1], twists: ch.chance(0.4), leagues: ['england'], benchPicks: 0, modes: [], powerUps: false, classic: false })
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === SEASON_LEAGUE).map((cs) => cs.clubId)
  return { mode, seed, formationId: '4-3-3', teamName: 'Reload United', shortName: shortNameFor('Reload United'), leagueId: 'england', wheelLeagues: ['england'], hostClubId: ch.pick(clubs), leagueSeason: SEASON_LEAGUE, rules, jobSecurity: false, difficulty: 'calibrated', continental: false }
}

type Kind = 'quick' | 'season' | 'dynasty' | 'cup' | 'gauntlet' | 'runin'

/** Play one run of `kind` from `seed`, reloading at each driver step with chance `p`; the problems and the final game. */
function play(kind: Kind, seed: string, p: number): { problems: string[]; game: string; reloads: number } {
  const ch = new Chooser(seed)
  // The reloads draw from their own stream, so both runs make exactly the same choices
  const reloads = new Rng(`reload:${seed}`)
  let n = 0
  stepHook.run = p > 0 ? () => {
    // The Sim digest is a pop-up a reload closes; the driver spends a choice on it, so a reload there would change the choices
    if (reloads.chance(p) && !st().digest) {
      reloadNow()
      n++
    }
  } : undefined
  loadStore(u, ['england'])
  const problems: string[] = []
  const draft = (label: string) => driveDraft(u, ch, { autoAt: ch.chance(0.5) ? ch.int(0, 12) : undefined, powerUps: true }).problems.map((x) => `${label}: ${x}`)
  if (kind === 'quick') {
    st().startGame(quickSettings(seed, ch))
    problems.push(...draft('draft'))
    if (!problems.length) problems.push(...driveQuickSeason(u, ch))
  } else if (kind === 'season' || kind === 'dynasty') {
    st().startGame(managedSettings(kind, seed, ch))
    problems.push(...draft('draft'))
    if (!problems.length) problems.push(...driveSeason(u, ch, { years: kind === 'dynasty' ? 1 : 0, draft, simBias: 4 }).problems)
  } else if (kind === 'runin') {
    const jobs = runInCatalogue(u, 'survival').filter((j) => j.leagueId === 'england')
    st().startGame(runInGameSettings(u, suggestRunIns(jobs, seed)[0], { seed, formationId: '4-3-3' }))
    problems.push(...draft('draft'))
    if (!problems.length) problems.push(...driveSeason(u, ch, { draft: () => ['a second draft in a run-in'], simBias: 3 }).problems)
  } else {
    const c = { teamName: 'Reload Arena', formationId: '4-3-3', field: 'wheel' as const, wheelLeagues: ['england'], difficulty: 'calibrated' as const, seed, hardMode: false, twists: true, decade: 2020 }
    st().startGame(kind === 'cup' ? cupGameSettings(u, { ...c, size: 8 }, 'RLA') : gauntletGameSettings(u, c, 'RLA'))
    problems.push(...draft('draft'))
    if (!problems.length) problems.push(...driveArena(u, ch))
  }
  const crash = crashToast()
  if (crash) problems.push(crash)
  stepHook.run = undefined
  return { problems, game: comparable(st().game), reloads: n }
}

afterEach(() => {
  stepHook.run = undefined
})

describe('a reload at any step plays on exactly as the run that never reloaded', () => {
  const runs: Array<[Kind, number, number]> = [['quick', 8, 0.3], ['season', 3, 0.15], ['dynasty', 2, 0.08], ['runin', 4, 0.08], ['cup', 6, 0.25], ['gauntlet', 6, 0.2]]
  for (const [kind, full, p] of runs) {
    it(`${kind}`, async () => {
      const fails: string[] = []
      let total = 0
      for (let i = 0; i < seeds(full); i++) {
        await breathe()
        const seed = `reload-${kind}-${i}`
        const a = play(kind, seed, 0)
        await breathe()
        const b = play(kind, seed, p)
        total += b.reloads
        if (a.problems.length || b.problems.length) fails.push(`${seed}: ${[...a.problems, ...b.problems.map((x) => `reloaded: ${x}`)].slice(0, 5).join(' | ')}`)
        else if (a.game !== b.game) {
          const ga = JSON.parse(a.game) as Record<string, unknown>
          const gb = JSON.parse(b.game) as Record<string, unknown>
          const diff = Object.keys({ ...ga, ...gb }).filter((k) => JSON.stringify(ga[k]) !== JSON.stringify(gb[k]))
          fails.push(`${seed} (${b.reloads} reloads): the game differs in ${diff.join(', ')}`)
        }
      }
      expect(fails).toEqual([])
      expect(total, 'the sweep reloaded').toBeGreaterThan(0)
    }, 180_000)
  }
})
