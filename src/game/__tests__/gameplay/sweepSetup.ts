/** Gameplay sweep: the env switch, seed counts, the settings builders the sweeps share and the report writer. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { QUICK_RULES, SEASON_RULES, type QuickMode } from '@engine/draft'
import { wheelSeasons } from '@engine/era'
import type { LoadedUniverse } from '@engine/universe'
import { defaultHostClub, setupRules, shortNameFor, startFormation } from '../../logic/setup'
import { withCap, type CapPreset } from '../../logic/cap'
import { classicFromFor } from '../../logic/era'
import type { GameSettings, Mode } from '../../types'
import type { Chooser } from '../qaHarness'

export const SWEEP = !!process.env.GAMEPLAY_SWEEP
/** Seeds per batch: `GAMEPLAY_N` scales the default (1 = as written). */
export function sweepN(n: number): number {
  return Math.max(1, Math.round(n * Number(process.env.GAMEPLAY_N ?? 1)))
}
const OUT = process.env.GAMEPLAY_OUT ?? '.gameplay'
export function writeReport(name: string, text: string, data: unknown): void {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(`${OUT}/${name}.txt`, text)
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(data))
}

export const FORMATIONS_ALL = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '4-4-2-diamond', '5-3-2', '3-4-3', '4-1-4-1']

export interface QuickCombo {
  modes: Array<QuickMode | 'upgrader'>
  difficulty: 'easy' | 'normal' | 'hard'
  powerUps: boolean
  endCase: boolean
  managers: 'spin' | 'pick' | 'off'
  bench: number
  cap: CapPreset
  chain: boolean
  classic: boolean
  superLeague: boolean
  draftMode: 'squad' | 'position'
  ratings: 'season' | 'prime'
  january: boolean
  era: [number, number] | null
}

export function randomCombo(ch: Chooser): QuickCombo {
  const modes: Array<QuickMode | 'upgrader'> = (['crazy', 'underdog', 'legends', 'speedrun', 'gamble', 'upgrader'] as const).filter(() => ch.chance(0.25))
  // Setup's mode cards keep Underdog and Legends apart (`toggleModeCard`): a bottom-half side with an 85+ player is too rare
  if (modes.includes('underdog') && modes.includes('legends')) modes.splice(modes.indexOf(ch.chance(0.5) ? 'underdog' : 'legends'), 1)
  return {
    modes,
    difficulty: ch.pick(['easy', 'normal', 'hard'] as const),
    powerUps: ch.chance(0.35),
    endCase: ch.chance(0.5),
    managers: ch.pick(['spin', 'pick', 'off'] as const),
    bench: ch.pick([0, 0, 1, 3, 5]),
    cap: ch.pick(['off', 'off', 'shoestring', 'moneyball', 'big-spender'] as const),
    chain: ch.chance(0.2),
    classic: ch.chance(0.2),
    superLeague: ch.chance(0.1),
    draftMode: ch.chance(0.3) ? 'position' : 'squad',
    ratings: ch.pick(['season', 'prime'] as const),
    january: ch.chance(0.75),
    era: ch.chance(0.2) ? ch.pick([[2016, 2026], [2010, 2015], [2008, 2012]] as Array<[number, number]>) : null,
  }
}

/** The settings the Setup screen's Start sends for these choices (its `buildSettings`, England only). */
export function quickSettings(u: LoadedUniverse, seed: string, c: QuickCombo, formationId: string): GameSettings {
  const classicFrom = classicFromFor(u, ['england'])
  const classic = c.classic && classicFrom !== undefined
  const stops = wheelSeasons(u, ['england'], classic)
  const first = stops[0]
  const last = stops[stops.length - 1]
  const [eraFrom, eraTo] = c.era ?? [first, last]
  const chosen = setupRules(QUICK_RULES, { difficulty: c.difficulty, showRatings: true, draftMode: c.draftMode, ratings: c.ratings, eraFrom, eraTo, first, last, twists: true, leagues: ['england'], benchPicks: c.bench, modes: c.modes, powerUps: c.powerUps, classic, managers: c.managers !== 'off', managerSpin: c.managers === 'spin', endCase: c.endCase })
  const rules = withCap({ ...chosen, ...(c.chain ? { chain: true } : {}), ...(c.superLeague ? { superLeague: true } : {}) }, { preset: c.cap, custom: 180 })
  const leagueSeason = 2025
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === leagueSeason).map((cs) => cs.clubId)
  return {
    mode: 'quick',
    seed,
    formationId: startFormation(rules, seed, formationId),
    teamName: 'QA XI',
    shortName: shortNameFor('QA XI'),
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: clubs[seed.length % clubs.length],
    leagueSeason,
    rules,
    jobSecurity: false,
    difficulty: 'calibrated',
    continental: false,
    january: c.january,
  }
}

/** The settings the Setup screen's Start sends for a managed season (its `buildSettings`), England only. */
export function managedSettings(u: LoadedUniverse, mode: Mode, seed: string, ch: Chooser): GameSettings {
  const stops = wheelSeasons(u, ['england'], false)
  const first = stops[0]
  const last = stops[stops.length - 1]
  const squadSize = ch.pick([16, 18, 20, 22])
  const chosen = setupRules({ ...SEASON_RULES, squadSize }, { difficulty: ch.pick(['easy', 'normal', 'hard'] as const), showRatings: true, draftMode: ch.chance(0.3) ? 'position' : 'squad', ratings: 'season', eraFrom: first, eraTo: last, first, last, twists: ch.chance(0.4), leagues: ['england'], benchPicks: 0, modes: [], powerUps: false, classic: false })
  const rules = withCap({ ...chosen, ...(ch.chance(0.1) ? { chain: true } : {}) }, { preset: ch.pick(['off', 'off', 'off', 'moneyball', 'big-spender'] as const), custom: 180 })
  const leagueSeason = ch.pick([2009, 2012, 2015, 2018, 2021, 2023, 2025])
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
