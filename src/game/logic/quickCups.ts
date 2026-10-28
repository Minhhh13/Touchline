/**
 * The Quick Draft's post-season cups: once the league is done the manager may play the domestic cup and, after a
 * top-seven finish, the Continental Cup, tie by tie to a final, or skip either. Each run draws from its own fork of a
 * copy of the RNG state the league season ended on, so the league result, the RNG state and the other cup are the
 * same whether a cup is played, skipped, or played first or second.
 */
import type { Cabinet, Game, QuickBracketTie, QuickCupReach, QuickCupRound, QuickCupRun, QuickCupTie, QuickGroup, QuickResult, QuickScorer } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { simulateMatch, type MatchTeamInput } from '@engine/match'
import { aiFixtureInputs, aiRatingOffset, aiTeamInput, buildAiClubs, buildContinentalClubs, cupRounds, continentalRounds, drawFirstRound, drawNextRound, extraTime, humansOf, shootout, USER_TEAM, type AiClub, type CupRoundInfo, type CupTie } from '@engine/season'
import { getFormation } from '@engine/formations'
import { drawContinentalRound, drawGroups, extraTimeGoals, groupTable, POST_SEASON_PLAN, potOrder, quarterFinals, settleTie, throughGroups } from '@engine/continental'
import type { Lineup, Position } from '@engine/types'
import { playerLookup } from './players'
import { seasonEndLookup } from './januaryGamble'
import { quickUserInput } from './quick'
import { canPlayFor, fieldXI, injuredThrough, quickBenchRule } from './quickBench'
import { sideScorers } from './gameByGame'
import { isSuperLeague, quickLeague, superContinentalField } from './superLeague'
import { fileHonour, honourEntry, trophiesOf } from './cabinet'

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
  // The Super League has no domestic cup; its Continental Cup meets the next greatest clubs after the league's nineteen
  if (isSuperLeague(s)) return comp === 'cup' ? {} : superContinentalField(u, s, QUICK_CUP_ENTRANTS - 1)
  return comp === 'cup' ? buildAiClubs(u, s.leagueId, s.leagueSeason, s.hostClubId) : buildContinentalClubs(u, s.leagueId, s.leagueSeason, s.hostClubId, QUICK_CUP_ENTRANTS - 1)
}

/** Why a Super League season offers no domestic cup. */
export const SUPER_NO_CUP = 'The Super League has no domestic cup'

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
  if (comp === 'cup' && isSuperLeague(game.settings)) return SUPER_NO_CUP
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

/** Every round of a cup with its name: "Fourth round" to "Final", or "Continental round of 16" to "Continental final" (an engine 6 run's rounds, which name every round a run can hold). */
export function quickCupRounds(comp: QuickCupComp): CupRoundInfo[] {
  // The rounds' matchweeks only matter inside a league season; the post-season uses their order and names
  return comp === 'cup' ? cupRounds(38) : continentalRounds(38)
}

/** The knockout rounds a run was played over: from engine 7 the Continental Cup's start at the quarter-finals, after its groups. */
export function quickRunRounds(comp: QuickCupComp, run: Pick<QuickCupRun, 'groups'> | null): CupRoundInfo[] {
  return comp === 'continental' && run?.groups ? POST_SEASON_PLAN.rounds : quickCupRounds(comp)
}

const SCORER_WEIGHT: Record<Position, number> = { GK: 0, CB: 1, LB: 1, RB: 1, DM: 1.5, CM: 2, AM: 4, LW: 4, RW: 4, ST: 6 }

/**
 * Play one tie: ninety minutes, then extra time after a draw (the user's extra-time goals credited to his XI, a
 * forward more often than a defender, minutes 91 to 120) and a shoot-out if it is still level. AI-against-AI ties are
 * settled the same way, so the field's winners come out of the same rules.
 */
function playTie(rng: Rng, tie: CupTie, home: MatchTeamInput, away: MatchTeamInput, neutral: boolean, userSlots: Array<{ id: string; w: number }>, nameOf: (id: string) => string | undefined): { user: QuickCupTie | null; tie: QuickBracketTie } {
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
  const kept: QuickBracketTie = { home: tie.homeTeamId, away: tie.awayTeamId, hg, ag, ...(et ? { et: true as const } : {}), ...(pens ? { pens: { home: pens.home, away: pens.away } } : {}), winner }
  if (!userIn) return { user: null, tie: kept }
  const f = (h: number, a: number) => (userHome ? { for: h, against: a } : { for: a, against: h })
  const user: QuickCupTie = {
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
  return { user, tie: kept }
}

/**
 * Play a post-season cup through: sixteen entrants drawn at random (the user always among them), single ties round
 * by round to a neutral final, the field's ties played too so every round is drawn from real winners. The user's side
 * is the XI and tactics the league season ended with (no substitutes when a bench played between games, as in the
 * league; a starter still injured after the last league game is covered from that bench), the AI clubs carry the league's calibration. The user's run ends when he goes out; the rest of the field plays on to
 * the final for the bracket (`QuickCupRun.bracket`), after every draw the run took. Writes the run to `QuickResult` and
 * the trophies' achievements to `game.unlocked`; `Game.rngState` is never touched.
 */
export function playQuickCup(game: Game, u: LoadedUniverse, comp: QuickCupComp): void {
  const problem = quickCupProblem(game, u, comp)
  if (problem) throw new Error(problem)
  const q = game.quickResult!
  const s = game.settings
  // A January upgrade stays on him after the league season
  const get = seasonEndLookup(game, u)
  const nameOf = (id: string) => get(id)?.name
  const rng = Rng.fromState(game.rngState).fork(comp === 'cup' ? 'quick-cup' : 'quick-continental')
  const field = quickCupField(game, u, comp)
  // The AI sides carry the league's handicap: none in the Super League, whose rivals play at full strength
  const offset = comp === 'cup' ? aiRatingOffset(u, field, s.difficulty ?? 'calibrated') : quickLeague(u, s).offset
  const benchOn = quickBenchRule(game) && (game.draft?.bench.length ?? 0) > 0
  const formation = getFormation(game.tactics.formationId)
  const xi = quickCupXI(game, u)
  const user = quickUserInput(game, xi, benchOn ? [] : game.bench, game.tactics, game.captainId, get)
  const taken = humansOf([...Object.values(xi), ...game.bench, ...Object.values(game.draft?.lineup ?? {}), ...(game.draft?.bench ?? [])], get)
  const userSlots = formation.slots.filter((sl) => xi[sl.id]).map((sl) => ({ id: xi[sl.id], w: SCORER_WEIGHT[sl.position] }))
  const inputs = (h: string, a: string): { home: MatchTeamInput; away: MatchTeamInput } => {
    // No human on both sides (E6-2): the user's men never play for the field, and two AI sides never share one
    const both = h === USER_TEAM || a === USER_TEAM ? null : aiFixtureInputs(u, field[h], field[a], offset, taken)
    return { home: h === USER_TEAM ? user : both?.home ?? aiTeamInput(u, field[h], offset, taken), away: a === USER_TEAM ? user : both?.away ?? aiTeamInput(u, field[a], offset, taken) }
  }
  if (comp === 'continental') {
    // Engine 7: groups of four, two-legged quarter- and semi-finals, a one-off final
    const run = playQuickContinental(rng, Object.keys(field), inputs, userSlots, nameOf)
    q.continentalCup = run
    for (const id of cupUnlocks(q)) if (!game.unlocked.includes(id)) game.unlocked.push(id)
    return
  }
  const rounds = quickCupRounds(comp)
  const ties = drawFirstRound([USER_TEAM, ...Object.keys(field)], rng, rounds)
  const mine: QuickCupTie[] = []
  const bracket: QuickBracketTie[][] = []
  for (let r = 0; r < rounds.length; r++) {
    const round = rounds[r].round
    const kept: QuickBracketTie[] = []
    for (const tie of ties.filter((t) => t.round === round)) {
      const { home, away } = inputs(tie.homeTeamId, tie.awayTeamId)
      const played = playTie(rng, tie, home, away, round === 'F', userSlots, nameOf)
      if (played.user) mine.push(played.user)
      kept.push(played.tie)
    }
    bracket.push(kept)
    if (r === rounds.length - 1) break
    // Once the user is out the rest of the cup plays on, so the bracket reaches its final: every draw from here comes
    // after the last one the run took, on a fork nothing else reads, so the run and every other result stay as they were
    ties.push(...drawNextRound(ties, rounds[r + 1].round, rng, rounds))
  }
  const last = mine.at(-1)!
  const run: QuickCupRun = { ties: mine, reached: last.round === 'F' && last.won ? 'W' : last.round, bracket }
  if (comp === 'cup') q.cup = run
  else q.continentalCup = run
  for (const id of cupUnlocks(q)) if (!game.unlocked.includes(id)) game.unlocked.push(id)
}

/**
 * The post-season Continental Cup from engine 7 (`src/engine/continental.ts`): the sixteen drawn into four groups
 * (the user heading the second pot), every group match played matchday by matchday, the quarter-finals fixed by the
 * groups, each two-legged tie's legs then its settling (extra time and penalties after the second leg), the semi-finals
 * drawn, a one-off final at a neutral ground. The field plays on to the final whether the user is in it or not. The
 * user's goalscorers are kept for the knockout ties (both legs, and extra time's from the XI as the Cup credits them).
 */
function playQuickContinental(rng: Rng, fieldIds: string[], inputs: (h: string, a: string) => { home: MatchTeamInput; away: MatchTeamInput }, userSlots: Array<{ id: string; w: number }>, nameOf: (id: string) => string | undefined): QuickCupRun {
  const plan = POST_SEASON_PLAN
  const groups = drawGroups(potOrder(fieldIds, USER_TEAM), rng, plan)
  const play = (h: string, a: string, neutral: boolean) => simulateMatch({ rng, ...inputs(h, a), neutral, detail: 'summary' })
  for (let day = 1; day <= plan.groupWeeks.length; day++) for (const g of groups) for (const m of g.matches.filter((x) => x.matchday === day)) m.result = play(m.homeTeamId, m.awayTeamId, false)
  const ties = quarterFinals(groups, plan)
  const mine: QuickCupTie[] = []
  const bracket: QuickBracketTie[][] = []
  for (let r = 0; r < plan.rounds.length; r++) {
    const round = plan.rounds[r].round
    const kept: QuickBracketTie[] = []
    for (const tie of ties.filter((t) => t.round === round)) {
      const scorers: QuickScorer[] = []
      const userHome = tie.homeTeamId === USER_TEAM
      const userIn = userHome || tie.awayTeamId === USER_TEAM
      if (tie.firstLeg) {
        const l1 = play(tie.homeTeamId, tie.awayTeamId, false)
        tie.firstLeg.result = l1
        if (userIn) scorers.push(...sideScorers(l1.events, userHome ? 'home' : 'away', nameOf))
      }
      const deciding = tie.firstLeg ? play(tie.awayTeamId, tie.homeTeamId, false) : play(tie.homeTeamId, tie.awayTeamId, true)
      tie.result = deciding
      // The deciding match's own sides: the second leg is at the tie's away side's ground
      const userDecidingHome = tie.firstLeg ? !userHome : userHome
      if (userIn) scorers.push(...sideScorers(deciding.events, userDecidingHome ? 'home' : 'away', nameOf))
      settleTie(tie, rng, { home: deciding.homeReport.strength.overall, away: deciding.awayReport.strength.overall })
      const et = extraTimeGoals(tie)
      const ours = et && userIn ? (userDecidingHome ? et.home : et.away) : 0
      for (let i = 0; i < ours; i++) {
        const minute = rng.int(91, 120)
        const pick = rng.pickWeighted(userSlots, (sl) => sl.w)
        scorers.push({ name: nameOf(pick.id) ?? 'Unknown', minute, playerSeasonId: pick.id })
      }
      const agg = tie.agg!
      const legs = tie.firstLeg ? [{ hg: tie.firstLeg.result!.homeGoals, ag: tie.firstLeg.result!.awayGoals }, { hg: deciding.awayGoals, ag: deciding.homeGoals }] : undefined
      kept.push({ home: tie.homeTeamId, away: tie.awayTeamId, hg: agg.home, ag: agg.away, ...(agg.et ? { et: true as const } : {}), ...(agg.pens ? { pens: { home: agg.pens.home, away: agg.pens.away } } : {}), winner: tie.winnerId!, ...(legs ? { legs } : {}) })
      if (!userIn) continue
      const f = (h: number, a: number) => (userHome ? { for: h, against: a } : { for: a, against: h })
      mine.push({
        round: tie.round,
        opponentId: userHome ? tie.awayTeamId : tie.homeTeamId,
        home: userHome,
        ...(tie.firstLeg ? {} : { neutral: true }),
        gf: userHome ? agg.home : agg.away,
        ga: userHome ? agg.away : agg.home,
        ...(et ? { et: f(tie.firstLeg ? et.away : et.home, tie.firstLeg ? et.home : et.away) } : {}),
        ...(agg.pens ? { pens: f(agg.pens.home, agg.pens.away) } : {}),
        scorers,
        won: tie.winnerId === USER_TEAM,
        ...(legs ? { legs: legs.map((l, i) => ({ home: i === 0 ? userHome : !userHome, gf: userHome ? l.hg : l.ag, ga: userHome ? l.ag : l.hg })) } : {}),
      })
    }
    bracket.push(kept)
    if (r < plan.rounds.length - 1) ties.push(...drawContinentalRound(ties, round, rng, plan))
  }
  const quickGroups: QuickGroup[] = groups.map((g) => ({ name: g.name, teams: g.teams, matches: g.matches.map((m) => [m.matchday, m.homeTeamId, m.awayTeamId, m.result!.homeGoals, m.result!.awayGoals]) }))
  const last = mine.at(-1)
  const reached: QuickCupReach = !throughGroups(groups, USER_TEAM) || !last ? 'G' : last.round === 'F' && last.won ? 'W' : last.round
  return { ties: mine, reached, bracket, groups: quickGroups }
}

/** A post-season group's table from its stored matches (`QuickGroup`), ordered as the engine orders it. */
export function quickGroupTable(g: QuickGroup) {
  return groupTable({ teams: g.teams, matches: g.matches.map(([matchday, home, away, hg, ag]) => ({ matchday, matchweek: matchday, homeTeamId: home, awayTeamId: away, result: { homeTeamId: home, awayTeamId: away, homeGoals: hg, awayGoals: ag, events: [], homeStats: [], awayStats: [], xg: { home: 0, away: 0 } } })) })
}

/** The user's group as a line: "Group B: 2nd on 10 points (3-1-2), through". Null for a run without groups. */
export function quickGroupLine(run: Pick<QuickCupRun, 'groups'>): string | null {
  const g = run.groups?.find((x) => x.teams.includes(USER_TEAM))
  if (!g) return null
  const table = quickGroupTable(g)
  const i = table.findIndex((r) => r.teamId === USER_TEAM)
  const r = table[i]
  return `Group ${g.name}: ${['1st', '2nd', '3rd', '4th'][i]} on ${r.points} point${r.points === 1 ? '' : 's'} (${r.won}-${r.drawn}-${r.lost}), ${i < 2 ? 'through' : 'out'}`
}

/**
 * The XI a post-season cup is played with: the lineup the league season ended with and, when a bench played between
 * games, every starter still injured after the last league game covered from that bench by `fieldXI`, as the league
 * would have covered him. Draws nothing. Pure.
 */
export function quickCupXI(game: Game, u: LoadedUniverse): Lineup {
  if (!quickBenchRule(game) || !(game.draft?.bench.length ?? 0)) return game.lineup
  const results = game.quickResult?.results ?? []
  const through = injuredThrough(results)
  const after = Math.max(0, ...results.map((r) => r.matchweek)) + 1
  return fieldXI(getFormation(game.tactics.formationId), game.lineup, game.bench, (id) => (through[id] ?? 0) >= after, playerLookup(game, u), canPlayFor(game)).lineup
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

/**
 * The Trophy Room after a cup run (`playCup` in the store): the counts as `addCupTrophies` adds them and, when the run
 * completes a Treble or a Double with the league, the season on the honours board (a Double the second cup turns into
 * a Treble replaces its own entry). `before` is the quick result as it was before the run. Pure.
 */
export function creditCupRun(cabinet: Cabinet, before: QuickResult, game: Game, comp: QuickCupComp, date?: string): Cabinet {
  const after = game.quickResult
  if (!after) return cabinet
  const c: Cabinet = { ...cabinet, ...addCupTrophies(trophiesOf(cabinet), before, after, comp) }
  if (wonCup(before, comp) || !wonCup(after, comp)) return c
  const honour = honourEntry(game, { league: after.position === 1, cup: wonCup(after, 'cup'), continental: wonCup(after, 'continental') }, date)
  return honour ? fileHonour(c, honour) : c
}

const ROUND_NAME: Record<QuickCupReach, string> = { G: 'group stage', R16: 'round of 16', QF: 'quarter-finals', SF: 'semi-finals', F: 'final', W: 'winners' }

/**
 * "round of 16" to "final", or "winners". The Cup's first round is the fourth round, as its tie heading says
 * (`cupRoundLabel`), so a Cup run out at the first hurdle reads "fourth round", never "round of 16".
 */
export function cupReachLabel(r: QuickCupReach, comp: QuickCupComp = 'continental'): string {
  return comp === 'cup' && r === 'R16' ? 'fourth round' : ROUND_NAME[r]
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
  return run.reached === 'W' ? `${icon} ${name} winners` : `${icon} ${name}: ${cupReachLabel(run.reached, comp)}`
}

/** The round of a tie as a heading: "Fourth round", "Quarter-final", "Final". */
export function cupRoundLabel(comp: QuickCupComp, round: QuickCupRound): string {
  const info = quickCupRounds(comp).find((r) => r.round === round)
  return (info?.label ?? round).replace(/^Continental /, '').replace(/^./, (c) => c.toUpperCase())
}
