/**
 * The 38-0 chase: Quick Draft's world leaderboard. Pure, shared by the client and the verifier bundle.
 *
 * A Quick Draft seed is the player's own, so a board of player-seeded seasons would reward grinding seeds offline
 * until the wheel deals a lucky run. The chase therefore ranks only seasons played on a wheel the server issued: the
 * Edge Function's `chase.start` hands out an attempt (a random code, seed `chase-<code>`, the league and shape the
 * player picked), at most `CHASE_ATTEMPTS_PER_DAY` per account per UTC day, each open for `CHASE_ATTEMPT_HOURS` and
 * posted at most once. Everything else is fixed by `chaseGameSettings` below: the standard Quick Draft (normal
 * difficulty, one re-spin, ratings on, Squad First, season ratings, all-time wheel of the league played in, twists,
 * the plain manager pick, calibrated opposition, the January window), the real season and the side replaced chosen
 * by the code's hash. Changing the mapping changes every open attempt under its player, so treat it like the Daily
 * mapping (CLAUDE.md invariant 4).
 *
 * The plain manager pick counts: it is part of every standard Quick Draft (`QUICK_RULES.managers`), it chooses among
 * the real managers of the clubs drafted, draws nothing and replays exactly (`x.m`). The manager spin does not (three
 * reels of chance on top of the wheel), nor do the modes, the Upgrader, power-ups, the Super League, the end case and
 * its Icon, classic seasons, the cap or the teammate chain.
 */
import { hashString } from '@engine/rng'
import { encodeChallenge } from '@engine/challenge'
import { FORMATIONS } from '@engine/formations'
import type { DraftRules } from '@engine/draft'
import type { LoadedUniverse } from '@engine/universe'
import type { Game, GameSettings } from '@game/types'
import { defaultHostClub, shortNameFor } from '@game/logic/setup'
import { challengeFromGame } from '@game/logic/challenge'
import { NON_STANDARD_RULES } from './daily'
import { nonStandardRun, settingsHash, type RankedBody } from './server/dailyVerify'

/** Attempts per account per UTC day (`private.chase_daily_cap()` in the database). */
export const CHASE_ATTEMPTS_PER_DAY = 5
/** How long an attempt stays open for its one post. */
export const CHASE_ATTEMPT_HOURS = 48

/** An attempt code: ten characters of the game's seed alphabet (no I, O, 0 or 1), as `private.random_code(10)` draws them. */
export const CHASE_CODE_RE = /^[A-HJ-NP-Z2-9]{10}$/

export const chaseSeed = (code: string) => `chase-${code}`

/** The attempt code of a chase seed, or null for any other seed. */
export function chaseCodeOfSeed(seed: string): string | null {
  const m = /^chase-([A-HJ-NP-Z2-9]{10})$/.exec(seed)
  return m ? m[1] : null
}

/** Every shape a chase run may be played in (the player's choice when the attempt is issued). */
export const CHASE_FORMATIONS: readonly string[] = FORMATIONS.map((f) => f.id)

/**
 * The standard Quick Draft's rules, written out in full (never `QUICK_RULES` spread, so a later change to Quick Draft's
 * defaults cannot move an open attempt): the normal difficulty and its one re-spin, ratings shown, Squad First, season
 * ratings, the all-time wheel, twists, managers picked from the drafted clubs. `leagues` is the league played in.
 */
export const CHASE_RULES: DraftRules = {
  squadSize: 11,
  respins: 1,
  difficulty: 'normal',
  hardMode: false,
  minFit: 'accomplished',
  uniqueClubSeasons: true,
  twists: true,
  showRatings: true,
  draftMode: 'squad',
  ratings: 'season',
  managers: true,
  managerSpin: undefined,
  fromSeason: undefined,
  toSeason: undefined,
  onlyClub: undefined,
  onlyNation: undefined,
  modes: undefined,
  benchPicks: undefined,
  budget: undefined,
  chain: undefined,
}

/** The season options of a chase run: the January window on (Quick Draft's default), no Continental Cup run. */
export const CHASE_SEASON = { january: true, continental: false } as const

/** The rules that make a Quick Draft non-standard for the chase: the ranked boards' list less the plain manager pick. */
export const CHASE_NON_STANDARD_RULES = NON_STANDARD_RULES.filter((k) => k !== 'managers')

/** The first rule outside the standard Quick Draft a game's settings switch on, or null. */
export function chaseNonStandardRule(settings: Pick<GameSettings, 'rules'>): string | null {
  const r = settings.rules
  for (const k of CHASE_NON_STANDARD_RULES) {
    const v = r[k]
    if (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== false) return k
  }
  return null
}

/** The leagues a chase run can be played in: those of this universe with a complete real season. */
export function chaseLeagues(u: Pick<LoadedUniverse, 'clubSeasons'>): string[] {
  return [...new Set(u.clubSeasons.filter((cs) => cs.complete && !cs.classic).map((cs) => cs.leagueId))]
}

/**
 * The complete settings of a chase attempt: the standard Quick Draft in `leagueId` and `formationId`, a complete real
 * season chosen by the code's hash and the club whose place the XI takes chosen as Quick Draft chooses by default
 * (mid-table, `defaultHostClub`). Null when the code or shape is not one, or this universe has no complete season of
 * that league loaded. Pure: the same attempt and data give the same settings on every device and on the server.
 */
export function chaseGameSettings(u: LoadedUniverse, code: string, leagueId: string, formationId: string, teamName = 'Touchline XI'): GameSettings | null {
  if (!CHASE_CODE_RE.test(code) || !CHASE_FORMATIONS.includes(formationId)) return null
  const seed = chaseSeed(code)
  const n = hashString(seed)
  const complete = u.clubSeasons.filter((cs) => cs.complete && cs.leagueId === leagueId && !cs.classic)
  const seasons = [...new Set(complete.map((cs) => cs.season))].sort((a, b) => a - b)
  if (!seasons.length) return null
  const season = seasons[n % seasons.length]
  const clubs = complete.filter((cs) => cs.season === season).map((cs) => cs.clubId).sort()
  const host = defaultHostClub(u, leagueId, season, clubs)
  if (!host) return null
  const name = teamName.trim() || 'Touchline XI'
  return {
    mode: 'quick',
    seed,
    formationId,
    teamName: name,
    shortName: shortNameFor(name),
    leagueId,
    wheelLeagues: [leagueId],
    hostClubId: host,
    leagueSeason: season,
    rules: { ...CHASE_RULES, leagues: [leagueId] },
    jobSecurity: false,
    difficulty: 'calibrated',
    continental: CHASE_SEASON.continental,
    january: CHASE_SEASON.january,
  }
}

/** Whether a game's settings are a chase attempt (a chase seed played as itself, not raced as a challenge). */
export function isChaseGame(settings: Pick<GameSettings, 'mode' | 'seed' | 'challenge'>): boolean {
  return settings.mode === 'quick' && !settings.challenge && chaseCodeOfSeed(settings.seed) !== null
}

/** What the Summary says to a Quick Draft that is not a chase run. */
export const NOT_A_CHASE_RUN = 'Only a 38-0 chase run counts: start one from the World leaderboard, which issues its wheel'

/**
 * Why a finished Quick Draft cannot go to the chase, or null when it can: not a chase run, a rule outside the
 * standard Quick Draft, settings that are not the attempt's, or something the season used outside the puzzle (the
 * Upgrader, power-ups, the case's Icon), the same checks the verifier makes.
 */
export function chaseUnrankedReason(game: Game, u: LoadedUniverse): string | null {
  const s = game.settings
  const code = chaseCodeOfSeed(s.seed)
  if (s.mode !== 'quick' || s.challenge || !code) return NOT_A_CHASE_RUN
  if (chaseNonStandardRule(s)) return 'This run used rules outside the standard Quick Draft'
  const expected = chaseGameSettings(u, code, s.leagueId, s.formationId, s.teamName)
  if (!expected || settingsHash(expected) !== settingsHash(s)) return "This run's settings are not its chase attempt's"
  if (game.draft?.locker?.length) return 'Power-ups from the locker are not part of the chase'
  if (game.endCase?.sub) return "The case's Icon is not part of the chase"
  const payload = challengeFromGame(game, u, 'check')
  if (!payload) return 'The season has not finished'
  return nonStandardRun(payload, s.rules)
}

export interface ChaseSubmission extends RankedBody {
  op: 'chase.submit'
}

/** The body a finished chase run posts (its ghost-draft payload and the names played with), or null when it cannot. */
export function buildChaseSubmission(game: Game, u: LoadedUniverse, name: string): ChaseSubmission | null {
  if (chaseUnrankedReason(game, u)) return null
  const payload = challengeFromGame(game, u, name)
  if (!payload) return null
  return { op: 'chase.submit', encoded: encodeChallenge(payload), teamName: game.settings.teamName, shortName: game.settings.shortName }
}

