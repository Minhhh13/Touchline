import type { GameSettings, Mode, Profile } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { QUICK_RULES } from '@engine/draft'
import { eraHandles, wheelSeasons } from '@engine/era'
import { defaultHostClub, setupRules, shortNameFor, startFormation } from './setup'
import { leagueSeasonChoices } from './era'
import { DEFAULT_CAP_CHOICE, withCap } from './cap'
import { isQuickLike } from './modes'

/**
 * The first ten minutes: who counts as new, the one-tap first draft and what the first result points to next.
 * Pure, no draws; the first draft is exactly what an untouched Quick Draft setup would start.
 */

/** The team name every untouched setup starts with. */
export const FIRST_TEAM_NAME = 'Touchline XI'

/** The game in three steps, for the first-run panel on Home: a short title and one plain line each. */
export const FIRST_RUN_STEPS: ReadonlyArray<{ id: 'spin' | 'draft' | 'play'; title: string; line: string }> = [
  { id: 'spin', title: 'Spin', line: 'The wheel lands on a real club in a real season.' },
  { id: 'draft', title: 'Draft', line: 'Take one player from that squad. Eleven spins make your XI.' },
  { id: 'play', title: 'Play', line: 'Your XI plays the whole season. Can it win all 38?' },
]

type ProfileBits = Pick<Profile, 'leaderboard' | 'seasonsSimulated' | 'dailyResults' | 'arenaRuns' | 'runIns' | 'cabinet'>

/** How many results of any kind this profile has finished: league seasons, Dailies, arena runs, run-ins and head-to-heads. */
export function resultsFinished(p: ProfileBits): number {
  return Math.max(p.leaderboard.length, p.seasonsSimulated, Object.keys(p.dailyResults).length) + (p.arenaRuns?.length ?? 0) + (p.runIns?.length ?? 0) + (p.cabinet?.h2h?.played ?? 0)
}

/**
 * A manager who has never finished anything in this browser and has no game waiting: Home shows them the
 * first-run panel. Anyone with a result, or a game to resume, sees Home as before.
 */
export function isNewcomer(p: ProfileBits, gameWaiting: boolean): boolean {
  return !gameWaiting && resultsFinished(p) === 0
}

/**
 * The Quick Draft an untouched setup starts (the Setup screen's defaults: the Premier League's newest complete
 * season, its mid-table club replaced, a 4-3-3, Normal, ratings on, Squad First, Prime ratings, all-time, twists,
 * a bench of one, the manager spin, the end case and the January window), on `seed`. Null until England is loaded.
 */
export function firstDraftSettings(u: LoadedUniverse, seed: string, teamName = FIRST_TEAM_NAME): GameSettings | null {
  const leagueId = 'england'
  if (!u.clubSeasons.some((cs) => cs.leagueId === leagueId)) return null
  const stops = wheelSeasons(u, [leagueId], false)
  const first = stops[0] ?? u.firstSeason
  const last = stops[stops.length - 1] ?? u.lastSeason
  const [eraFrom, eraTo] = eraHandles('all', first, last)
  const chosen = setupRules(QUICK_RULES, { difficulty: QUICK_RULES.difficulty ?? 'normal', showRatings: true, draftMode: 'squad', ratings: 'prime', eraFrom, eraTo, first, last, twists: !!QUICK_RULES.twists, leagues: [leagueId], benchPicks: 1, modes: [], powerUps: false, classic: false, superLeague: false, managers: true, managerSpin: true, endCase: true })
  const rules = withCap({ ...chosen, onlyClub: undefined, onlyNation: undefined }, DEFAULT_CAP_CHOICE)
  // As Setup: the newest complete season loaded, kept when the league has it, else the league's newest
  const newest = Math.max(...u.clubSeasons.filter((cs) => cs.complete).map((cs) => cs.season))
  const seasons = leagueSeasonChoices(u, leagueId).filter((c) => !c.classic).map((c) => c.season)
  const leagueSeason = seasons.includes(newest) ? newest : seasons[seasons.length - 1]
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === leagueSeason).map((cs) => cs.clubId).sort((a, b) => (u.clubById[a]?.name ?? a).localeCompare(u.clubById[b]?.name ?? b))
  return {
    mode: 'quick',
    seed,
    formationId: startFormation(rules, seed, '4-3-3'),
    teamName,
    shortName: shortNameFor(teamName),
    leagueId,
    wheelLeagues: [leagueId],
    hostClubId: defaultHostClub(u, leagueId, leagueSeason, clubs),
    leagueSeason,
    rules,
    jobSecurity: false,
    difficulty: 'calibrated',
    continental: false,
    january: true,
  }
}

/** Where the first result points: today's Daily, another draft of your own, or both. */
export type FirstNext = 'daily' | 'quick'

/**
 * The next steps the summary offers after the first result ever, a quick-like season: today's Daily (unless that
 * was it, or it is played today) and a new Quick Draft. Null for every later result, so a returning player's
 * summary is unchanged.
 */
export function firstResultNext(p: ProfileBits, mode: Mode, dailyPlayedToday: boolean): FirstNext[] | null {
  if (!isQuickLike(mode) || resultsFinished(p) !== 1) return null
  const out: FirstNext[] = []
  if (mode !== 'daily' && !dailyPlayedToday) out.push('daily')
  out.push('quick')
  return out
}
