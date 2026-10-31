import type { GameSettings, Mode, Profile } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { QUICK_RULES } from '@engine/draft'
import { eraHandles, wheelSeasons } from '@engine/era'
import { defaultHostClub, setupRules, shortNameFor, startFormation } from './setup'
import { leagueSeasonChoices } from './era'
import { DEFAULT_CAP_CHOICE, withCap } from './cap'
import { isQuickLike } from './modes'
import { dailyLeagueOf } from './daily'

/**
 * The first ten minutes: who counts as new, the one-tap first draft and what the first result points to next.
 * Pure, no draws; the first draft is exactly what an untouched Quick Draft setup would start.
 */

/** The game logic's fallback team name: the first draft's when no name is passed (Home passes an invented one, `src/ui/teamName.ts`). */
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
 * The first draft: the Quick Draft an untouched setup starts (the Setup screen's defaults: the Premier League's
 * newest complete season, its mid-table club replaced, a 4-3-3, Normal, ratings on, Squad First, Prime ratings,
 * all-time, twists, the manager settled for you and the January window), on `seed`, with only the core loop: no
 * bench (eleven spins make the XI, as the first-run panel says), no manager spin and no end-of-draft case, the
 * extras Setup offers from the second draft on. Null until England is loaded.
 */
export function firstDraftSettings(u: LoadedUniverse, seed: string, teamName = FIRST_TEAM_NAME): GameSettings | null {
  const leagueId = 'england'
  if (!u.clubSeasons.some((cs) => cs.leagueId === leagueId)) return null
  const stops = wheelSeasons(u, [leagueId], false)
  const first = stops[0] ?? u.firstSeason
  const last = stops[stops.length - 1] ?? u.lastSeason
  const [eraFrom, eraTo] = eraHandles('all', first, last)
  const chosen = setupRules(QUICK_RULES, { difficulty: QUICK_RULES.difficulty ?? 'normal', showRatings: true, draftMode: 'squad', ratings: 'prime', eraFrom, eraTo, first, last, twists: !!QUICK_RULES.twists, leagues: [leagueId], benchPicks: 0, modes: [], powerUps: false, classic: false, superLeague: false, managers: true, managerSpin: false, endCase: false })
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
 * was it, or it is played today) and a new Quick Draft. Null while a post-season cup is still on offer (the cup is
 * the next step then, and leaving would drop it), and for every later result, so a returning player's summary is
 * unchanged.
 */
export function firstResultNext(p: ProfileBits, mode: Mode, dailyPlayedToday: boolean, cupWaiting = false): FirstNext[] | null {
  if (cupWaiting || !isQuickLike(mode) || resultsFinished(p) !== 1) return null
  const out: FirstNext[] = []
  if (mode !== 'daily' && !dailyPlayedToday) out.push('daily')
  out.push('quick')
  return out
}

/** The one mode Home points a new player to next, after the first result: today's Daily, the online boards, then Season. */
export type NextUp = 'daily' | 'boards' | 'season'

/** Results after which Home stops pointing: by then the player has found their way around. */
export const NEXT_UP_UNTIL = 6

/**
 * Where Home points a player who has just started (one to `NEXT_UP_UNTIL` results finished): today's Daily until a
 * Daily is played; then, on an online build, the world boards once (the Daily's score is on them); then Season, the
 * managed mode, until one is finished. Null for a newcomer (the first-run panel is their step) and for everyone later.
 */
export function nextUpFor(p: ProfileBits, opts: { dailyPlayedToday: boolean; online: boolean; seasonWaiting?: boolean }): NextUp | null {
  const n = resultsFinished(p)
  if (n === 0 || n > NEXT_UP_UNTIL) return null
  const dailyEver = opts.dailyPlayedToday || Object.keys(p.dailyResults).length > 0
  if (!dailyEver) return 'daily'
  if (opts.online && n <= 2) return 'boards'
  const managed = p.leaderboard.some((e) => e.mode === 'season' || e.mode === 'dynasty')
  // A Season or Dynasty already under way is on the resume strip: the marker would only send them to start another
  return managed || opts.seasonWaiting ? null : 'season'
}

/**
 * The Daily's league rotation as its setup's tip tells it: today's league and tomorrow's, for two daily seeds. Null
 * when tomorrow repeats today's league (every day before the rotation's first, all Premier League), so the tip says
 * nothing untrue. Pure, from the seeds alone (`dailyLeagueOf`).
 */
export function dailyRotation(todaySeed: string, tomorrowSeed: string): { today: string; tomorrow: string } | null {
  const today = dailyLeagueOf(todaySeed)
  const tomorrow = dailyLeagueOf(tomorrowSeed)
  return today === tomorrow ? null : { today, tomorrow }
}
