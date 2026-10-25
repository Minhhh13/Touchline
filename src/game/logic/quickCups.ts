/**
 * The Quick Draft's post-season cups: once the league is done the manager may play the domestic cup and, after a
 * top-seven finish, the Continental Cup, tie by tie to a final, or skip either. Each run draws from its own fork of a
 * copy of the RNG state the league season ended on, so the league result, the RNG state and the other cup are the
 * same whether a cup is played, skipped, or played first or second.
 */
import type { Game, QuickCupReach, QuickCupRound, QuickCupRun, QuickCupTie, QuickResult } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { simulateMatch, type MatchTeamInput } from '@engine/match'
import { aiRatingOffset, aiTeamInput, buildAiClubs, buildContinentalClubs, cupRounds, continentalRounds, drawFirstRound, drawNextRound, extraTime, shootout, USER_TEAM, type AiClub, type CupRoundInfo, type CupTie } from '@engine/season'
import { getFormation } from '@engine/formations'
import type { Position } from '@engine/types'
import { playerLookup } from './players'
import { quickUserInput } from './quick'
import { quickBenchRule } from './quickBench'
import { sideScorers } from './gameByGame'

export type QuickCupComp = 'cup' | 'continental'

/** A league finish in this place or higher earns the post-season Continental Cup. */
export const QUICK_CONTINENTAL_PLACES = 7
/** Entrants in either cup: the user and fifteen others, four rounds. */
export const QUICK_CUP_ENTRANTS = 16

/** Where a cup stands for the summary: still to be played, played, skipped, or not on offer (with why). */
export type QuickCupStatus = { state: 'open' } | { state: 'played'; run: QuickCupRun } | { state: 'skipped' } | { state: 'none'; reason: string }

/** The field a cup is played against: the league's own clubs for the domestic cup, the best of the other leagues for the Continental Cup. */
export function quickCupField(game: Game, u: LoadedUniverse, comp: QuickCupComp): Record<string, AiClub> {
  const s = game.settings
  return comp === 'cup' ? buildAiClubs(u, s.leagueId, s.leagueSeason, s.hostClubId) : buildContinentalClubs(u, s.leagueId, s.leagueSeason, s.hostClubId, QUICK_CUP_ENTRANTS - 1)
}

const FIELD_SHORT: Record<QuickCupComp, string> = { cup: 'Too few clubs in this league for a cup', continental: 'Too few clubs from the other leagues are loaded' }

function stored(q: QuickResult, comp: QuickCupComp): QuickCupRun | null | undefined {
  return comp === 'cup' ? q.cup : q.continentalCup
}

/**
 * Why a cup cannot be played now, or null when it can: a finished, closed Quick Draft season, the cup not played or
 * skipped yet, a top-seven finish for the Continental Cup, and a field of sixteen. Pure.
 */
export function quickCupProblem(game: Game, u: LoadedUniverse, comp: QuickCupComp): string | null {
  const q = game.quickResult
  if (game.settings.mode !== 'quick') return 'Only a Quick Draft plays the post-season cups'
  if (game.phase !== 'summary' || !q) return 'The league season is not over'
  if (game.quickOpen) return 'Close the season first'
  // A season played before the post-season cups ran its Continental Cup inside the league season
  if (comp === 'continental' && q.europe) return 'This season already had its Continental Cup run'
  const done = stored(q, comp)
  if (done !== undefined) return done === null ? 'Skipped' : 'Already played'
  if (comp === 'continental' && q.position > QUICK_CONTINENTAL_PLACES) return `A top-${QUICK_CONTINENTAL_PLACES} finish earns the Continental Cup`
  if (Object.keys(quickCupField(game, u, comp)).length < QUICK_CUP_ENTRANTS - 1) return FIELD_SHORT[comp]
  return null
}

/** The summary's view of a cup. */
export function quickCupStatus(game: Game, u: LoadedUniverse, comp: QuickCupComp): QuickCupStatus {
  const q = game.quickResult
  const done = q ? stored(q, comp) : undefined
  if (done) return { state: 'played', run: done }
  if (done === null) return { state: 'skipped' }
  const problem = quickCupProblem(game, u, comp)
  // The other leagues load when the Continental Cup is played: a field short only for want of loading is still on offer
  if (problem === FIELD_SHORT.continental && u.available.some((l) => !u.leagues.some((x) => x.id === l.id))) return { state: 'open' }
  return problem ? { state: 'none', reason: problem } : { state: 'open' }
}

/** Every round of a cup with its name: "Fourth round" to "Final", or "Continental round of 16" to "Continental final". */
export function quickCupRounds(comp: QuickCupComp): CupRoundInfo[] {
  // The rounds' matchweeks only matter inside a league season; the post-season uses their order and names
  return comp === 'cup' ? cupRounds(38) : continentalRounds(38)
}

const SCORER_WEIGHT: Record<Position, number> = { GK: 0, CB: 1, LB: 1, RB: 1, DM: 1.5, CM: 2, AM: 4, LW: 4, RW: 4, ST: 6 }

/**
 * Play one tie: ninety minutes, then extra time after a draw (the user's extra-time goals credited to his XI, a
 * forward more often than a defender, minutes 91 to 120) and a shoot-out if it is still level. AI-against-AI ties are
 * settled the same way, so the field's winners come out of the same rules.
 */
function playTie(rng: Rng, tie: CupTie, home: MatchTeamInput, away: MatchTeamInput, neutral: boolean, userSlots: Array<{ id: string; w: number }>, nameOf: (id: string) => string | undefined): QuickCupTie | null {
  const res = simulateMatch({ rng, home, away, neutral, detail: 'summary' })
  let hg = res.homeGoals
  let ag = res.awayGoals
  let et: { home: number; away: number } | undefined
  let pens: { home: number; away: number } | undefined
  const userHome = tie.homeTeamId === USER_TEAM
  const userIn = userHome || tie.awayTeamId === USER_TEAM
  const scorers = userIn ? sideScorers(res.events, userHome ? 'home' : 'away', nameOf) : []
  if (hg === ag) {
    et = extraTime(rng, res.xg)
    hg += et.home
    ag += et.away
    const mine = userHome ? et.home : et.away
    for (let i = 0; i < mine && userIn; i++) {
      const minute = rng.int(91, 120)
      const pick = rng.pickWeighted(userSlots, (s) => s.w)
      scorers.push({ name: nameOf(pick.id) ?? 'Unknown', minute, playerSeasonId: pick.id })
    }
    scorers.sort((a, b) => a.minute - b.minute)
    if (hg === ag) pens = shootout(rng, res.homeReport.strength.overall, res.awayReport.strength.overall)
  }
  const winner = hg > ag ? tie.homeTeamId : ag > hg ? tie.awayTeamId : pens!.home > pens!.away ? tie.homeTeamId : tie.awayTeamId
  tie.result = { ...res, homeGoals: hg, awayGoals: ag, ...(pens ? { penalties: pens } : {}) }
  tie.winnerId = winner
  if (!userIn) return null
  const f = (h: number, a: number) => (userHome ? { for: h, against: a } : { for: a, against: h })
  return {
    round: tie.round,
    opponentId: userHome ? tie.awayTeamId : tie.homeTeamId,
    home: userHome,
    ...(neutral ? { neutral: true } : {}),
    gf: userHome ? hg : ag,
    ga: userHome ? ag : hg,
    ...(et ? { et: f(et.home, et.away) } : {}),
    ...(pens ? { pens: f(pens.home, pens.away) } : {}),
    scorers,
    won: winner === USER_TEAM,
  }
}

/**
 * Play a post-season cup through: sixteen entrants drawn at random (the user always among them), single ties round
 * by round to a neutral final, the field's ties played too so every round is drawn from real winners. The user's side
 * is the XI and tactics the league season ended with (no substitutes when a bench played between games, as in the
 * league), the AI clubs carry the league's calibration. The run stops when the user goes out. Writes the run to
 * `QuickResult` and the trophies' achievements to `game.unlocked`; `Game.rngState` is never touched.
 */
export function playQuickCup(game: Game, u: LoadedUniverse, comp: QuickCupComp): void {
  const problem = quickCupProblem(game, u, comp)
  if (problem) throw new Error(problem)
  const q = game.quickResult!
  const s = game.settings
  const get = playerLookup(game, u)
  const nameOf = (id: string) => get(id)?.name
  const rng = Rng.fromState(game.rngState).fork(comp === 'cup' ? 'quick-cup' : 'quick-continental')
  const field = quickCupField(game, u, comp)
  const league = comp === 'cup' ? field : buildAiClubs(u, s.leagueId, s.leagueSeason, s.hostClubId)
  const offset = aiRatingOffset(u, league, s.difficulty ?? 'calibrated')
  const benchOn = quickBenchRule(game) && (game.draft?.bench.length ?? 0) > 0
  const user = quickUserInput(game, game.lineup, benchOn ? [] : game.bench, game.tactics, game.captainId, get)
  const formation = getFormation(game.tactics.formationId)
  const userSlots = formation.slots.filter((sl) => game.lineup[sl.id]).map((sl) => ({ id: game.lineup[sl.id], w: SCORER_WEIGHT[sl.position] }))
  const rounds = quickCupRounds(comp)
  const ties = drawFirstRound([USER_TEAM, ...Object.keys(field)], rng, rounds)
  const mine: QuickCupTie[] = []
  for (let r = 0; r < rounds.length; r++) {
    const round = rounds[r].round
    let out = false
    for (const tie of ties.filter((t) => t.round === round)) {
      const home = tie.homeTeamId === USER_TEAM ? user : aiTeamInput(u, field[tie.homeTeamId], offset)
      const away = tie.awayTeamId === USER_TEAM ? user : aiTeamInput(u, field[tie.awayTeamId], offset)
      const t = playTie(rng, tie, home, away, round === 'F', userSlots, nameOf)
      if (t) {
        mine.push(t)
        if (!t.won) out = true
      }
    }
    if (out || r === rounds.length - 1) break
    ties.push(...drawNextRound(ties, rounds[r + 1].round, rng, rounds))
  }
  const last = mine.at(-1)!
  const run: QuickCupRun = { ties: mine, reached: last.round === 'F' && last.won ? 'W' : last.round }
  if (comp === 'cup') q.cup = run
  else q.continentalCup = run
  for (const id of cupUnlocks(q)) if (!game.unlocked.includes(id)) game.unlocked.push(id)
}

/** Pass on a cup: it is not offered again. */
export function skipQuickCup(game: Game, u: LoadedUniverse, comp: QuickCupComp): void {
  const problem = quickCupProblem(game, u, comp)
  if (problem) throw new Error(problem)
  if (comp === 'cup') game.quickResult!.cup = null
  else game.quickResult!.continentalCup = null
}

/** Whether a stored run (or an older season's in-league Continental Cup run) ended with the trophy. */
export function wonCup(q: Pick<QuickResult, 'cup' | 'continentalCup' | 'europe'> | null | undefined, comp: QuickCupComp): boolean {
  if (!q) return false
  return comp === 'cup' ? q.cup?.reached === 'W' : q.continentalCup?.reached === 'W' || q.europe?.reached === 'W'
}

/** The achievements a quick season's trophies earn: Cup Winners, Kings of the Continent, the Double and the Treble. */
export function cupUnlocks(q: QuickResult): string[] {
  const league = q.position === 1
  const cup = wonCup(q, 'cup')
  const euro = wonCup(q, 'continental')
  return [...(cup ? ['cup'] : []), ...(euro ? ['continental'] : []), ...(league && cup ? ['double'] : []), ...(league && cup && euro ? ['treble'] : [])]
}

export type Trophies = { league: number; cup: number; continental: number; doubles: number; trebles: number }

/**
 * The trophy cabinet after a cup run is won: the cup itself, and the double or the treble it completes with what the
 * season already holds. `before` is the quick result as it was before the run. Pure.
 */
export function addCupTrophies(t: Trophies, before: QuickResult, after: QuickResult, comp: QuickCupComp): Trophies {
  if (wonCup(before, comp) || !wonCup(after, comp)) return t
  const league = after.position === 1
  const cup = wonCup(after, 'cup')
  const euro = wonCup(after, 'continental')
  return {
    ...t,
    cup: t.cup + (comp === 'cup' ? 1 : 0),
    continental: t.continental + (comp === 'continental' ? 1 : 0),
    // The double is league and cup; the treble arrives with whichever of the two cups is won last
    doubles: t.doubles + (comp === 'cup' && league ? 1 : 0),
    trebles: t.trebles + (league && cup && euro ? 1 : 0),
  }
}

const ROUND_NAME: Record<QuickCupReach, string> = { R16: 'round of 16', QF: 'quarter-finals', SF: 'semi-finals', F: 'final', W: 'winners' }

/** "round of 16" to "final", or "winners". */
export function cupReachLabel(r: QuickCupReach): string {
  return ROUND_NAME[r]
}

/** The cup's name as the summary prints it. */
export function cupName(comp: QuickCupComp): string {
  return comp === 'cup' ? 'the Cup' : 'the Continental Cup'
}

/** A tie's score: "2-0", "3-2 aet", "1-1 aet, 4-3 pens". */
export function cupScoreLabel(t: Pick<QuickCupTie, 'gf' | 'ga' | 'et' | 'pens'>): string {
  const base = `${t.gf}-${t.ga}`
  if (t.pens) return `${base} aet, ${t.pens.for}-${t.pens.against} pens`
  return t.et ? `${base} aet` : base
}

/** "🏆 Cup winners" or "🏆 Cup: semi-finals" for the share text, or null when the cup was not played. */
export function cupLine(run: QuickCupRun | null | undefined, comp: QuickCupComp): string | null {
  if (!run) return null
  const icon = comp === 'cup' ? '🏆' : '🌍'
  const name = comp === 'cup' ? 'Cup' : 'Continental Cup'
  return run.reached === 'W' ? `${icon} ${name} winners` : `${icon} ${name}: ${ROUND_NAME[run.reached]}`
}

/** The round of a tie as a heading: "Fourth round", "Quarter-final", "Final". */
export function cupRoundLabel(comp: QuickCupComp, round: QuickCupRound): string {
  const info = quickCupRounds(comp).find((r) => r.round === round)
  return (info?.label ?? round).replace(/^Continental /, '').replace(/^./, (c) => c.toUpperCase())
}
