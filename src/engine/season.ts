/**
 * A season: fixtures, table, cup, and the week-to-week state of a squad.
 * The user's club replaces one real club in a chosen real league season; the
 * other nineteen play with their real squads of that season.
 */
import type { Fixture, Lineup, MatchResult, PlayerSeason, SquadPlayer, TableRow, Tactics, SeasonTier, ClubSeason } from './types'
import { familiarityGainFactor } from './depth'
import { compareText, type Rng } from './rng'
import { isClassicSeason, ordinal, poolClubSeasons, type LoadedUniverse } from './universe'
import type { Objective } from './objectives'
import { simulateMatch, type FullMatchResult, type MatchTeamInput, type TeamTalk } from './match'
import { tacticsForStyle, formationForStyle } from './tactics'
import { autoPickLineup, computeTeamStrength } from './ratings'
import { getFormation } from './formations'
import { aiLookup, reserveKeeper } from './reserve'
import type { ContinentalGroup } from './continental'

export const USER_TEAM = 'user'
/** Matchweeks in a double round robin of `teams` clubs. */
/** League matchweeks: a double round-robin; an odd number of clubs adds a bye slot. */
export function matchweeksFor(teams: number): number {
  const slots = teams % 2 === 1 ? teams + 1 : teams
  return (slots - 1) * 2
}

export interface AiClub {
  id: string
  clubId: string
  name: string
  shortName: string
  tactics: Tactics
  /** Player-season ids of the squad. */
  squad: string[]
  /** Live state for AI players too, so injuries and suspensions exist for them. */
  state: Record<string, SquadPlayer>
}

export interface CupTie {
  round: 'R16' | 'QF' | 'SF' | 'F'
  /** Matchweek after which this tie is played. */
  afterMatchweek: number
  homeTeamId: string
  awayTeamId: string
  result?: MatchResult & { penalties?: { home: number; away: number } }
  winnerId?: string
  /**
   * A two-legged tie (the Continental Cup's quarter- and semi-finals from engine 7, `continental.ts`): the first leg,
   * at `homeTeamId`'s ground after this matchweek, and its result once played. The tie's own `afterMatchweek` and
   * `result` are then the second leg's, at `awayTeamId`'s ground: `result` keeps that match's own sides (its
   * `homeTeamId` is the tie's `awayTeamId`). Absent on every single-match tie.
   */
  firstLeg?: { afterMatchweek: number; result?: MatchResult }
  /**
   * The settled score of an engine 7 Continental Cup tie from the tie's sides (`homeTeamId` first): goals over both
   * legs (or the final) with extra time, whether the deciding match went to extra time, and the shoot-out. Read a
   * tie's score through `tieScore` (`continental.ts`), which also reads a single tie's `result`.
   */
  agg?: { home: number; away: number; et?: true; pens?: { home: number; away: number } }
}

export type Competition = 'cup' | 'continental'

export interface ContinentalState {
  /** The knockout ties: from engine 7 the two-legged quarter- and semi-finals and the final, before it the four single rounds from the round of 16. */
  ties: CupTie[]
  /** Foreign clubs in the field, keyed by club id; the user is the sixteenth entrant. */
  clubs: Record<string, AiClub>
  eliminated: boolean
  won: boolean
  /**
   * Engine 7's group stage (`continental.ts`): four groups of four, home and away, the top two through to the
   * quarter-finals. Absent on a Continental Cup drawn before engine 7, which plays on as the single-tie knockout from
   * the round of 16 it was drawn as.
   */
  groups?: ContinentalGroup[]
}

export interface SeasonState {
  /** League the user plays in. */
  leagueId: string
  /** Real season whose clubs form the league. */
  leagueSeason: number
  /** Number of league matchweeks (38 for 20 clubs, 34 for 18). */
  matchweeks: number
  /** Club the user replaced (name, colours and fixtures are theirs). */
  hostClubId: string
  teamName: string
  fixtures: Fixture[]
  matchweek: number
  cup: CupTie[]
  cupEliminated: boolean
  cupWon: boolean
  /** The Continental Cup: a midweek knockout against the best of the other leagues that season. */
  continental?: ContinentalState
  ai: Record<string, AiClub>
  /** Rolling news feed for the inbox. */
  news: NewsItem[]
  /** Rating points subtracted from AI clubs for difficulty calibration. */
  aiOffset: number
  /** Board confidence 0..100. */
  confidence: number
  /** Position the board expects at the end of the season. */
  boardTarget: number
  /** Secondary asks from the board, judged at the end of the season. */
  objectives?: Objective[]
  sacked: boolean
  /** Run-in: the table the manager took over, keyed by team id (the user's row under `USER_TEAM`), projected from the real final table; absent in every other season. */
  carryIn?: Record<string, CarryRow>
  /** Run-in: the matchweek the manager took over after; fixtures up to it carry no result ("before you arrived"). */
  takeoverAt?: number
  /**
   * Run-in in a play-off league (engine 7): the relegation play-off a 16th-placed finish leads to, two legs after the
   * last matchweek against `scenario.ts`'s `playOffOpponent` (`opponent`, a club-season key `clubId@season`): the
   * user at home first. Absent unless it was played.
   */
  playOff?: { opponent: string; tie: CupTie }
  /** Requests made to the board this season (`src/game/logic/board.ts`); absent until the first. */
  requests?: Array<{ kind: 'budget' | 'staff' | 'youth'; mw: number; accepted: boolean }>
}

/** A league row carried into a season that starts part-way through (the run-in): its points are `3 × won + drawn`. */
export interface CarryRow {
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
}

export interface NewsItem {
  matchweek: number
  kind: 'result' | 'injury' | 'suspension' | 'board' | 'transfer' | 'award' | 'event' | 'cup' | 'training' | 'info'
  title: string
  body: string
  /** The player the item is about, when there is one, so the Inbox can offer to act on him. Absent on older saves. */
  playerId?: string
}

export function newSquadPlayer(playerSeasonId: string, opts: Partial<SquadPlayer> = {}): SquadPlayer {
  return {
    playerSeasonId,
    condition: 96,
    morale: 70,
    sharpness: 70,
    familiarity: 35,
    recentRatings: [],
    injury: null,
    suspension: 0,
    yellowCards: 0,
    seasonStats: { apps: 0, starts: 0, goals: 0, assists: 0, minutes: 0, ratingSum: 0, cleanSheets: 0, motm: 0 },
    ...opts,
  }
}

/**
 * Double round robin with balanced venues, in matchweek order. The clubs are shuffled onto the places of the circle
 * method's canonical schedule (one shuffle, the only draw): in round r the place m = n − 1 meets place r, home on odd
 * rounds, and places r + k and r − k (mod m) meet, the first at home when k is even. That schedule gives every club at
 * most one pair of games at the same venue running in a half. The second half is the first with the venues swapped
 * and its first round moved to the end, so a half's join never makes three in a row and no rematch follows straight
 * on: every club plays at most two home or two away games running, all season (`season.test.ts` checks every size
 * from 2 to 24). An odd field puts the bye on the fixed place, so each club sits out once a half.
 *
 * ENGINE_VERSION 4 and before shuffled the rounds of a circle whose venues alternated only along each side of it, so
 * a club could be away for a whole half and home for the other (TL-05).
 */
export function generateFixtures(teamIds: string[], rng: Rng): Fixture[] {
  const teams = [...teamIds]
  rng.shuffle(teams)
  if (teams.length % 2 === 1) teams.push('bye')
  const n = teams.length
  const m = n - 1
  const rounds: Array<Array<[string, string]>> = []
  for (let r = 0; r < m; r++) {
    const pairs: Array<[string, string]> = [r % 2 === 0 ? [teams[r], teams[m]] : [teams[m], teams[r]]]
    for (let k = 1; k < n / 2; k++) {
      const a = teams[(r + k) % m]
      const b = teams[(r - k + m) % m]
      pairs.push(k % 2 === 0 ? [a, b] : [b, a])
    }
    rounds.push(pairs.filter(([h, a]) => h !== 'bye' && a !== 'bye'))
  }
  const second = [...rounds.slice(1), ...rounds.slice(0, 1)]
  const first = rounds.map((pairs, i) => pairs.map(([h, a]) => ({ matchweek: i + 1, homeTeamId: h, awayTeamId: a })))
  const back = second.map((pairs, i) => pairs.map(([h, a]) => ({ matchweek: i + 1 + rounds.length, homeTeamId: a, awayTeamId: h })))
  return [...first.flat(), ...back.flat()]
}

/**
 * The league's other clubs as AI sides. `taken` holds the real player ids (`PlayerSeason.playerId`) of the humans the
 * user's side holds: none of them also plays for his real club, in any season (engine 6, E6-2).
 */
export function buildAiClubs(u: LoadedUniverse, leagueId: string, leagueSeason: number, hostClubId: string, taken?: ReadonlySet<string>): Record<string, AiClub> {
  const ai: Record<string, AiClub> = {}
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === leagueSeason && cs.clubId !== hostClubId)
  for (const cs of clubs) ai[cs.clubId] = aiClubOf(u, cs, taken)
  return ai
}

/**
 * One real club-season as an AI side: its style's tactics and shape, its squad (less any human in `taken`, by real
 * player id), every player fresh. Draws nothing.
 */
export function aiClubOf(u: LoadedUniverse, cs: ClubSeason, taken?: ReadonlySet<string>): AiClub {
  const club = u.clubById[cs.clubId]
  const style = club?.style ?? 'balanced'
  const tactics = tacticsForStyle(style, formationForStyle(style))
  const squad = taken?.size ? cs.squad.filter((p) => !taken.has(p.playerId)) : cs.squad
  const state: Record<string, SquadPlayer> = {}
  for (const p of squad) state[p.id] = newSquadPlayer(p.id, { familiarity: 70, sharpness: 85 })
  return { id: cs.clubId, clubId: cs.clubId, name: club?.name ?? cs.clubId, shortName: club?.shortName ?? cs.clubId, tactics, squad: squad.map((p) => p.id), state }
}

/** The real player ids of a set of player-season ids (resolved through `get`): what `taken` holds. */
export function humansOf(ids: Iterable<string>, get: (id: string) => PlayerSeason | undefined): Set<string> {
  const out = new Set<string>()
  for (const id of ids) {
    const p = get(id)
    if (p) out.add(p.playerId)
  }
  return out
}

/** An AI side's overall team strength as the season fields it: its auto-picked best XI rated by `computeTeamStrength`. Pure. */
export function aiStrength(u: LoadedUniverse, club: AiClub): number {
  const inp = aiTeamInput(u, club)
  return computeTeamStrength(club.tactics, inp.lineup, inp.getPlayer, inp.getState).overall
}

/**
 * An AI side as the match engine fields it: the auto-picked best XI and bench of its fit, unsuspended men. `taken` (real
 * player ids) leaves out humans who already play for the other side of this match (E6-2). A squad with no fit keeper
 * left fields its reserve keeper (`src/engine/reserve.ts`, E6-5) rather than an outfielder in goal.
 */
export function aiTeamInput(u: LoadedUniverse, club: AiClub, ratingOffset = 0, taken?: ReadonlySet<string>): MatchTeamInput {
  let pool = club.squad.map((id) => u.index[id]).filter(Boolean)
  if (taken?.size) pool = pool.filter((p) => !taken.has(p.playerId))
  const formation = getFormation(club.tactics.formationId)
  const getState = (id: string) => club.state[id]
  const fit = (p: PlayerSeason) => {
    const s = club.state[p.id]
    return !s || (!s.injury && s.suspension <= 0)
  }
  const reserve = pool.length && !pool.some((p) => p.positions.includes('GK') && fit(p)) ? reserveKeeper(u, pool[0].clubId, pool[0].season) : undefined
  if (reserve) pool = [...pool, reserve]
  const { lineup, bench } = autoPickLineup(formation, pool, club.tactics, fit, getState)
  const getPlayer = aiLookup(u)
  const goalFactor = leagueGoalFactor(u.clubById[club.clubId]?.leagueId)
  return { teamId: club.id, teamName: club.name, shortName: club.shortName, tactics: club.tactics, lineup, bench, getPlayer, getState, ratingOffset, ...(goalFactor !== 1 ? { goalFactor } : {}) }
}

/**
 * Each league's scoring level against the Premier League's (engine 6, E6-7), set so its all-AI seasons score what the
 * real tables did from 2008-09 (England 2.78 a game, Spain 2.68, Italy 2.74, Germany 3.07): the packs rate La Liga's,
 * Serie A's and the Bundesliga's sides closer together than their results were, so one base undershot them by 0.4 to
 * 0.5 goals. France, the Netherlands and Portugal have no tables and keep England's.
 */
export const LEAGUE_GOAL_FACTOR: Readonly<Record<string, number>> = { spain: 1.21, italy: 1.22, germany: 1.22 }

export function leagueGoalFactor(leagueId: string | undefined): number {
  return (leagueId && LEAGUE_GOAL_FACTOR[leagueId]) || 1
}

/**
 * Two AI sides for one match with no human on both (E6-2): a player listed for both clubs (a January move inside one
 * league season, or two seasons of one club meeting in the arena) plays for the home side, which is fielded first.
 */
export function aiFixtureInputs(u: LoadedUniverse, home: AiClub, away: AiClub, offset = 0, taken?: ReadonlySet<string>): { home: MatchTeamInput; away: MatchTeamInput } {
  const h = aiTeamInput(u, home, offset, taken)
  const homeMen = humansOf([...Object.values(h.lineup), ...h.bench], h.getPlayer)
  for (const id of taken ?? []) homeMen.add(id)
  return { home: h, away: aiTeamInput(u, away, offset, homeMen) }
}

/**
 * Difficulty calibration. A wheel draft rarely assembles eleven 85s, while a
 * real top club fields exactly that. 'calibrated' pulls every AI club down so
 * the league average sits near what a decent draft produces; 'realistic'
 * leaves the real squads untouched.
 */
export const CALIBRATED_LEAGUE_AVERAGE = 75

export function aiRatingOffset(u: LoadedUniverse, ai: Record<string, AiClub>, difficulty: 'calibrated' | 'realistic'): number {
  if (difficulty === 'realistic') return 0
  const strengths = Object.values(ai).map((c) => aiStrength(u, c))
  const avg = strengths.reduce((a, b) => a + b, 0) / Math.max(1, strengths.length)
  return Math.max(0, Math.round((avg - CALIBRATED_LEAGUE_AVERAGE) * 10) / 10)
}

export function computeTable(fixtures: Fixture[], teamIds: string[], carryIn?: Record<string, CarryRow>): TableRow[] {
  const rows = new Map<string, TableRow>()
  for (const id of teamIds) {
    // A carried row (the run-in's projection) is where the club starts; its form is not known
    const c = carryIn?.[id]
    rows.set(id, c ? { teamId: id, played: c.won + c.drawn + c.lost, won: c.won, drawn: c.drawn, lost: c.lost, goalsFor: c.goalsFor, goalsAgainst: c.goalsAgainst, points: 3 * c.won + c.drawn, form: [] } : { teamId: id, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, form: [] })
  }
  const sorted = [...fixtures].filter((f) => f.result).sort((a, b) => a.matchweek - b.matchweek)
  for (const f of sorted) {
    const r = f.result!
    const h = rows.get(f.homeTeamId)!
    const a = rows.get(f.awayTeamId)!
    h.played++
    a.played++
    h.goalsFor += r.homeGoals
    h.goalsAgainst += r.awayGoals
    a.goalsFor += r.awayGoals
    a.goalsAgainst += r.homeGoals
    if (r.homeGoals > r.awayGoals) {
      h.won++
      a.lost++
      h.points += 3
      h.form.push('W')
      a.form.push('L')
    } else if (r.homeGoals < r.awayGoals) {
      a.won++
      h.lost++
      a.points += 3
      a.form.push('W')
      h.form.push('L')
    } else {
      h.drawn++
      a.drawn++
      h.points++
      a.points++
      h.form.push('D')
      a.form.push('D')
    }
    if (h.form.length > 5) h.form.shift()
    if (a.form.length > 5) a.form.shift()
  }
  return [...rows.values()].sort((x, y) => y.points - x.points || y.goalsFor - y.goalsAgainst - (x.goalsFor - x.goalsAgainst) || y.goalsFor - x.goalsFor || compareText(x.teamId, y.teamId))
}

/**
 * The league table of a season in play: its fixtures' results over the rows it
 * carried in (a run-in's projected table), or from zero. Every screen and rule
 * reads a season's table through here, so a carried table is never left out.
 */
export function seasonTable(season: Pick<SeasonState, 'fixtures' | 'ai' | 'carryIn'>): TableRow[] {
  return computeTable(season.fixtures, [USER_TEAM, ...Object.keys(season.ai)], season.carryIn)
}

export function positionOf(table: TableRow[], teamId: string): number {
  return table.findIndex((r) => r.teamId === teamId) + 1
}

export interface CupRoundInfo {
  round: CupTie['round']
  afterMatchweek: number
  label: string
}

/** Cup schedule: 16 teams, four rounds spread across the season (after MW 6, 14, 24 and 36 of 38). */
export function cupRounds(matchweeks: number): CupRoundInfo[] {
  const at = (mw38: number) => Math.max(1, Math.min(matchweeks - 1, Math.round((mw38 / 38) * matchweeks)))
  return [
    { round: 'R16', afterMatchweek: at(6), label: 'Fourth round' },
    { round: 'QF', afterMatchweek: at(14), label: 'Quarter-final' },
    { round: 'SF', afterMatchweek: at(24), label: 'Semi-final' },
    { round: 'F', afterMatchweek: at(36), label: 'Final' },
  ]
}

/** Continental Cup rounds sit on the midweeks the domestic cup leaves free. */
export function continentalRounds(matchweeks: number): CupRoundInfo[] {
  const at = (mw38: number) => Math.max(1, Math.min(matchweeks - 1, Math.round((mw38 / 38) * matchweeks)))
  return [
    { round: 'R16', afterMatchweek: at(10), label: 'Continental round of 16' },
    { round: 'QF', afterMatchweek: at(19), label: 'Continental quarter-final' },
    { round: 'SF', afterMatchweek: at(29), label: 'Continental semi-final' },
    { round: 'F', afterMatchweek: at(33), label: 'Continental final' },
  ]
}

export function roundsFor(comp: Competition, matchweeks: number): CupRoundInfo[] {
  return comp === 'cup' ? cupRounds(matchweeks) : continentalRounds(matchweeks)
}

export function drawFirstRound(teamIds: string[], rng: Rng, rounds: CupRoundInfo[]): CupTie[] {
  const entrants = rng.shuffle([...teamIds]).slice(0, 16)
  if (!entrants.includes(USER_TEAM)) entrants[0] = USER_TEAM
  const ties: CupTie[] = []
  const first = rounds[0]
  for (let i = 0; i + 1 < entrants.length; i += 2) ties.push({ round: first.round, afterMatchweek: first.afterMatchweek, homeTeamId: entrants[i], awayTeamId: entrants[i + 1] })
  return ties
}

export function drawFirstCupRound(teamIds: string[], rng: Rng, matchweeks: number): CupTie[] {
  return drawFirstRound(teamIds, rng, cupRounds(matchweeks))
}

export function drawNextRound(ties: CupTie[], round: CupTie['round'], rng: Rng, rounds: CupRoundInfo[]): CupTie[] {
  const prevIndex = rounds.findIndex((r) => r.round === round) - 1
  if (prevIndex < 0) return []
  const prev = rounds[prevIndex]
  const winners = ties.filter((t) => t.round === prev.round && t.winnerId).map((t) => t.winnerId!)
  rng.shuffle(winners)
  const info = rounds[prevIndex + 1]
  const next: CupTie[] = []
  for (let i = 0; i + 1 < winners.length; i += 2) next.push({ round: info.round, afterMatchweek: info.afterMatchweek, homeTeamId: winners[i], awayTeamId: winners[i + 1] })
  return next
}

export function drawNextCupRound(cup: CupTie[], round: CupTie['round'], rng: Rng, matchweeks: number): CupTie[] {
  return drawNextRound(cup, round, rng, cupRounds(matchweeks))
}

/**
 * The Continental Cup field: the fifteen strongest clubs from the other loaded
 * leagues in the same season, by league position then squad rating. Leagues
 * without that season contribute their nearest one.
 */
/** The Continental Cup's field: the strongest clubs of the other loaded leagues. `taken` as in `buildAiClubs`: the field is chosen on full squads, then the user's humans leave them. */
export function buildContinentalClubs(u: LoadedUniverse, leagueId: string, leagueSeason: number, hostClubId: string, n = 15, taken?: ReadonlySet<string>): Record<string, AiClub> {
  const others = u.leagues.filter((l) => l.id !== leagueId)
  const picked: ClubSeason[] = []
  // Classic club-seasons only enter the field of a classic league season
  const pool = poolClubSeasons(u, isClassicSeason(u, leagueId, leagueSeason))
  for (const league of others) {
    const seasons = [...new Set(pool.filter((cs) => cs.leagueId === league.id).map((cs) => cs.season))]
    if (!seasons.length) continue
    const season = seasons.includes(leagueSeason) ? leagueSeason : seasons.sort((a, b) => Math.abs(a - leagueSeason) - Math.abs(b - leagueSeason))[0]
    const field = pool.filter((cs) => cs.leagueId === league.id && cs.season === season && cs.clubId !== hostClubId).sort((a, b) => (a.position || 99) - (b.position || 99) || avgTop(b) - avgTop(a))
    // Four per league keeps the field spread; the remainder is filled by strength below.
    picked.push(...field.slice(0, 4))
  }
  // Top up with the strongest remaining clubs if fewer than four leagues are loaded
  if (picked.length < n) {
    const have = new Set(picked.map((cs) => `${cs.clubId}@${cs.season}`))
    const rest = pool.filter((cs) => cs.leagueId !== leagueId && cs.clubId !== hostClubId && !have.has(`${cs.clubId}@${cs.season}`) && Math.abs(cs.season - leagueSeason) <= 1).sort((a, b) => avgTop(b) - avgTop(a))
    const seen = new Set(picked.map((cs) => cs.clubId))
    for (const cs of rest) {
      if (picked.length >= n) break
      if (seen.has(cs.clubId)) continue
      seen.add(cs.clubId)
      picked.push(cs)
    }
  }
  const strongest = picked.sort((a, b) => avgTop(b) - avgTop(a)).slice(0, n)
  const clubs: Record<string, AiClub> = {}
  for (const cs of strongest) clubs[cs.clubId] = aiClubOf(u, cs, taken)
  return clubs
}

function avgTop(cs: ClubSeason): number {
  const top = [...cs.squad].sort((a, b) => b.overall - a.overall).slice(0, 14)
  return top.length ? top.reduce((s, p) => s + p.overall, 0) / top.length : 0
}

/** Weekly recovery for every squad player, user or AI. */
export function recoverWeek(state: SquadPlayer, player: PlayerSeason, played: boolean, trainingBonus = 0): void {
  const ageF = player.age >= 33 ? 0.85 : player.age >= 30 ? 0.93 : 1
  // A week's rest covers one match for a fit player; two matches in a week do not.
  const recover = (31 + (player.attributes.physical - 70) * 0.12 + trainingBonus) * ageF
  state.condition = Math.min(100, Math.round(state.condition + recover))
  if (!played) state.sharpness = Math.max(30, state.sharpness - 6)
  if (state.injury) {
    state.injury.weeksOut--
    if (state.injury.weeksOut <= 0) {
      state.injury = null
      state.sharpness = Math.max(40, state.sharpness - 10)
    }
  }
}

export function applyMatchToState(state: SquadPlayer, stats: { minutes: number; goals: number; assists: number; rating: number; yellow: boolean; red: boolean; injured: { description: string; weeksOut: number } | null } | undefined, started: boolean, conditionLoss: number, cleanSheet: boolean, motm: boolean, teamResult: 'W' | 'D' | 'L', workRate = 55): void {
  if (!stats) return
  state.condition = Math.max(5, state.condition - conditionLoss)
  state.sharpness = Math.min(100, state.sharpness + (started ? 12 : 6))
  // A player who does not work for the team learns it more slowly: the gain is cut to 80 per cent at work rate 35
  state.familiarity = Math.min(100, state.familiarity + Math.round((started ? 4 : 2) * familiarityGainFactor(workRate)))
  state.recentRatings.push(stats.rating)
  if (state.recentRatings.length > 6) state.recentRatings.shift()
  state.seasonStats.apps++
  if (started) state.seasonStats.starts++
  state.seasonStats.goals += stats.goals
  state.seasonStats.assists += stats.assists
  state.seasonStats.minutes += stats.minutes
  state.seasonStats.ratingSum += stats.rating
  if (cleanSheet && stats.minutes >= 60) state.seasonStats.cleanSheets++
  if (motm) state.seasonStats.motm++
  if (stats.yellow) {
    state.yellowCards++
    if (state.yellowCards % 5 === 0) state.suspension = Math.max(state.suspension, 1)
  }
  // A straight red for violent conduct (a very poor rating) is three matches; otherwise two.
  if (stats.red) state.suspension = Math.max(state.suspension, stats.rating < 5.5 ? 3 : 2)
  if (stats.injured) state.injury = { ...stats.injured }
  // morale: results and personal performance
  const resultDelta = teamResult === 'W' ? 5 : teamResult === 'D' ? 0 : -5
  const perfDelta = (stats.rating - 6.8) * 2
  state.morale = clamp(state.morale + resultDelta + perfDelta, 10, 100)
}

/**
 * An AI side's man after a match (engine 6, E6-3): fitness, sharpness, cards, suspensions, injuries and his season's
 * figures move as a user's do; morale, familiarity and form stay where they began. A real squad already knows its
 * system, and the AI never rotates or talks, so nothing would pull a winning side's morale and form back: managed
 * leagues drifted from 2.7 to 3.7 goals a game and 100-point champions. Draws nothing.
 */
export function applyMatchToAiState(state: SquadPlayer, stats: Parameters<typeof applyMatchToState>[1], conditionLoss: number, cleanSheet: boolean, motm: boolean, teamResult: 'W' | 'D' | 'L'): void {
  const { morale, familiarity } = state
  const recent = [...state.recentRatings]
  applyMatchToState(state, stats, true, conditionLoss, cleanSheet, motm, teamResult)
  state.morale = morale
  state.familiarity = familiarity
  state.recentRatings = recent
}

export function seasonTier(table: TableRow[], teamId: string, cupWon: boolean, matchweeks = 38): SeasonTier {
  const row = table.find((r) => r.teamId === teamId)!
  const pos = positionOf(table, teamId)
  const n = table.length
  const played = row.won + row.drawn + row.lost
  void matchweeks
  if (played > 0 && row.won === played) return 'PERFECT'
  if (row.lost === 0 && pos === 1) return 'INVINCIBLE'
  if (pos === 1) return 'CHAMPIONS'
  if (pos <= 2) return 'TITLE_RACE'
  if (pos <= 6) return 'EUROPEAN'
  if (pos <= n - 5) return 'MID_TABLE'
  if (pos <= n - 3) return 'RELEGATION_BATTLE'
  void cupWon
  return 'RELEGATED'
}

/**
 * The season tiers as plain outcomes. The ids are saved (game, history, challenge links, daily results) and never
 * change; only the words do. EUROPEAN covers 3rd to 6th: `tierLabel` splits it into Top 4 and Top 6
 * when the position is known, and this table carries the wider name for where it is not.
 */
export const TIER_LABEL: Record<SeasonTier, string> = {
  PERFECT: 'Perfect season',
  INVINCIBLE: 'Invincibles',
  CHAMPIONS: 'Champions',
  TITLE_RACE: 'Title race',
  EUROPEAN: 'Top 6',
  MID_TABLE: 'Mid-table',
  RELEGATION_BATTLE: 'Relegation battle',
  RELEGATED: 'Relegated',
}

/** The tier's headline, with the position when it is known: a 3rd or 4th place reads as "Top 4". */
export function tierLabel(tier: SeasonTier, position?: number): string {
  if (tier === 'EUROPEAN' && position !== undefined && position >= 1 && position <= 4) return 'Top 4'
  return TIER_LABEL[tier]
}

/**
 * One short line under the headline saying what the tier means. `teams` is the size of the league (20 by default),
 * `sacked` a managed season cut short.
 */
export function tierBlurb(tier: SeasonTier, position: number, teams = 20, sacked = false): string {
  const place = `${ordinal(position)} of ${teams}`
  if (sacked) return `Sacked at ${place}.`
  switch (tier) {
    case 'PERFECT':
      return 'Every game won.'
    case 'INVINCIBLE':
      return 'Champions without a defeat.'
    case 'CHAMPIONS':
      return 'Top of the table.'
    case 'TITLE_RACE':
      return 'Runners-up, just short.'
    case 'EUROPEAN':
      return `${place}, ${position <= 4 ? 'a top-four' : 'a top-six'} side.`
    case 'MID_TABLE':
      return `${place}, safe.`
    case 'RELEGATION_BATTLE':
      return `${place}, survived.`
    case 'RELEGATED':
      return `${place}, down a division.`
  }
}

/**
 * Board target from how strong the drafted squad is relative to the league.
 * A side rated far above the league is expected to win it.
 */
export function boardTargetFor(userOverall: number, aiOveralls: number[]): number {
  const sorted = [...aiOveralls].sort((a, b) => b - a)
  let better = 0
  for (const o of sorted) if (o > userOverall - 1.5) better++
  return Math.max(1, Math.min(17, better + 1))
}

export function updateConfidence(confidence: number, table: TableRow[], teamId: string, target: number, matchweek: number, lastResult: 'W' | 'D' | 'L' | null): number {
  const pos = positionOf(table, teamId)
  const expectedGap = pos - target // positive = below expectations
  let delta = 0
  if (lastResult === 'W') delta += 2.5
  else if (lastResult === 'D') delta += 0
  else if (lastResult === 'L') delta -= 3
  if (matchweek >= 6) delta += expectedGap <= 0 ? 1.5 : -Math.min(4, expectedGap * 0.8)
  return clamp(confidence + delta, 0, 100)
}

export function describeImportance(u: LoadedUniverse, hostClubId: string, opponentClubId: string, table: TableRow[] | null, matchweek: number, cupRound?: CupTie['round'], comp: Competition = 'cup'): { importance: number; label?: string } {
  // Every Continental Cup match is a European night, an engine 7 group match (no round) included
  if (comp === 'continental') {
    if (cupRound === 'F') return { importance: 1.5, label: 'Continental final' }
    if (cupRound === 'SF') return { importance: 1.35, label: 'Continental semi-final' }
    return { importance: 1.15, label: 'European night' }
  }
  if (cupRound === 'F') return { importance: 1.4, label: 'Cup final' }
  if (cupRound === 'SF') return { importance: 1.25, label: 'Cup semi-final' }
  const host = u.clubById[hostClubId]
  if (host?.rivals.includes(opponentClubId)) return { importance: 1.25, label: 'Derby day' }
  if (table && matchweek >= Math.round((28 / 38) * (table.length - 1) * 2)) {
    const us = positionOf(table, USER_TEAM)
    const them = positionOf(table, opponentClubId)
    if (us <= 2 && them <= 3) return { importance: 1.3, label: 'Title decider' }
  }
  if (cupRound) return { importance: 1.1, label: 'Cup tie' }
  return { importance: 1 }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export interface UserTeamInput {
  teamName: string
  shortName: string
  tactics: Tactics
  lineup: Lineup
  bench: string[]
  state: Record<string, SquadPlayer>
  teamTalk: TeamTalk
  captainId?: string
  talkSkill?: number
  markTarget?: string
}

export function userTeamInput(u: LoadedUniverse, t: UserTeamInput): MatchTeamInput {
  return { teamId: USER_TEAM, teamName: t.teamName, shortName: t.shortName, tactics: t.tactics, lineup: t.lineup, bench: t.bench, getPlayer: (id) => u.index[id], getState: (id) => t.state[id], teamTalk: t.teamTalk, captainId: t.captainId, talkSkill: t.talkSkill, markTarget: t.markTarget }
}

/** Play one match between two inputs, returning the full result. */
export function playMatch(rng: Rng, home: MatchTeamInput, away: MatchTeamInput, importance: number, label: string | undefined, neutral: boolean, detail: 'full' | 'summary'): FullMatchResult {
  return simulateMatch({ rng, home, away, importance, importanceLabel: label, neutral, detail })
}

/** Penalty shoot-out for drawn cup ties. */
export function shootout(rng: Rng, homeMentality: number, awayMentality: number): { home: number; away: number } {
  let h = 0
  let a = 0
  const pH = 0.72 + (homeMentality - 70) * 0.003
  const pA = 0.72 + (awayMentality - 70) * 0.003
  for (let i = 0; i < 5; i++) {
    if (rng.chance(pH)) h++
    if (rng.chance(pA)) a++
  }
  while (h === a) {
    if (rng.chance(pH)) h++
    if (rng.chance(pA)) a++
  }
  return { home: h, away: a }
}

/** Extra time is thirty minutes, a third of a match, played by tired legs at 85% of the ninety minutes' rate. */
export const EXTRA_TIME_RATE = 0.85 / 3

/**
 * Extra time after a level ninety minutes: each side's goals are Poisson draws from its expected goals over the match
 * times `EXTRA_TIME_RATE`, home first. Two draws, nothing else.
 */
export function extraTime(rng: Rng, xg: { home: number; away: number }): { home: number; away: number } {
  return { home: rng.poisson(Math.max(0, xg.home) * EXTRA_TIME_RATE), away: rng.poisson(Math.max(0, xg.away) * EXTRA_TIME_RATE) }
}

export function clubSeasonFor(u: LoadedUniverse, clubId: string, season: number): ClubSeason | undefined {
  return u.clubSeasonByKey[`${clubId}@${season}`]
}
