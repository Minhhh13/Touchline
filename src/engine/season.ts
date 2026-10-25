/**
 * A season: fixtures, table, cup, and the week-to-week state of a squad.
 * The user's club replaces one real club in a chosen real league season; the
 * other nineteen play with their real squads of that season.
 */
import type { Fixture, Lineup, MatchResult, PlayerSeason, SquadPlayer, TableRow, Tactics, SeasonTier, ClubSeason } from './types'
import { familiarityGainFactor } from './depth'
import type { Rng } from './rng'
import { isClassicSeason, ordinal, poolClubSeasons, type LoadedUniverse } from './universe'
import type { Objective } from './objectives'
import { simulateMatch, type FullMatchResult, type MatchTeamInput, type TeamTalk } from './match'
import { tacticsForStyle, formationForStyle } from './tactics'
import { autoPickLineup, computeTeamStrength } from './ratings'
import { getFormation } from './formations'

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
}

export type Competition = 'cup' | 'continental'

export interface ContinentalState {
  ties: CupTie[]
  /** Foreign clubs in the field, keyed by club id; the user is the sixteenth entrant. */
  clubs: Record<string, AiClub>
  eliminated: boolean
  won: boolean
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
}

export interface NewsItem {
  matchweek: number
  kind: 'result' | 'injury' | 'suspension' | 'board' | 'transfer' | 'award' | 'event' | 'cup' | 'training' | 'info'
  title: string
  body: string
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

/** Double round robin via the circle method, then a deterministic shuffle of rounds. */
export function generateFixtures(teamIds: string[], rng: Rng): Fixture[] {
  const teams = [...teamIds]
  if (teams.length % 2 === 1) teams.push('bye')
  const n = teams.length
  const rounds: Array<Array<[string, string]>> = []
  const arr = teams.slice(1)
  for (let r = 0; r < n - 1; r++) {
    const pairs: Array<[string, string]> = []
    const left = [teams[0], ...arr.slice(0, (n - 1) / 2 | 0)]
    const right = arr.slice((n - 1) / 2 | 0).reverse()
    for (let i = 0; i < left.length; i++) {
      const a = left[i]
      const b = right[i]
      if (!a || !b) continue
      if (a === 'bye' || b === 'bye') continue
      // Alternate home/away so teams do not have long runs
      if ((r + i) % 2 === 0) pairs.push([a, b])
      else pairs.push([b, a])
    }
    rounds.push(pairs)
    arr.unshift(arr.pop() as string)
  }
  rng.shuffle(rounds)
  const first = rounds.map((pairs, i) => pairs.map(([h, a]) => ({ matchweek: i + 1, homeTeamId: h, awayTeamId: a })))
  const second = rounds.map((pairs, i) => pairs.map(([h, a]) => ({ matchweek: i + 1 + rounds.length, homeTeamId: a, awayTeamId: h })))
  rng.shuffle(second)
  second.forEach((pairs, i) => pairs.forEach((f) => (f.matchweek = i + 1 + rounds.length)))
  return [...first.flat(), ...second.flat()]
}

export function buildAiClubs(u: LoadedUniverse, leagueId: string, leagueSeason: number, hostClubId: string): Record<string, AiClub> {
  const ai: Record<string, AiClub> = {}
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === leagueSeason && cs.clubId !== hostClubId)
  for (const cs of clubs) {
    const club = u.clubById[cs.clubId]
    const style = club?.style ?? 'balanced'
    const tactics = tacticsForStyle(style, formationForStyle(style))
    const state: Record<string, SquadPlayer> = {}
    for (const p of cs.squad) state[p.id] = newSquadPlayer(p.id, { familiarity: 70, sharpness: 85 })
    ai[cs.clubId] = { id: cs.clubId, clubId: cs.clubId, name: club?.name ?? cs.clubId, shortName: club?.shortName ?? cs.clubId, tactics, squad: cs.squad.map((p) => p.id), state }
  }
  return ai
}

export function aiTeamInput(u: LoadedUniverse, club: AiClub, ratingOffset = 0): MatchTeamInput {
  const pool = club.squad.map((id) => u.index[id]).filter(Boolean)
  const formation = getFormation(club.tactics.formationId)
  const getState = (id: string) => club.state[id]
  const { lineup, bench } = autoPickLineup(formation, pool, club.tactics, (p) => {
    const s = club.state[p.id]
    return !s || (!s.injury && s.suspension <= 0)
  }, getState)
  return { teamId: club.id, teamName: club.name, shortName: club.shortName, tactics: club.tactics, lineup, bench, getPlayer: (id) => u.index[id], getState, ratingOffset }
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
  const strengths = Object.values(ai).map((c) => {
    const inp = aiTeamInput(u, c)
    return computeTeamStrength(c.tactics, inp.lineup, inp.getPlayer, inp.getState).overall
  })
  const avg = strengths.reduce((a, b) => a + b, 0) / Math.max(1, strengths.length)
  return Math.max(0, Math.round((avg - CALIBRATED_LEAGUE_AVERAGE) * 10) / 10)
}

export function computeTable(fixtures: Fixture[], teamIds: string[]): TableRow[] {
  const rows = new Map<string, TableRow>()
  for (const id of teamIds) rows.set(id, { teamId: id, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, form: [] })
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
  return [...rows.values()].sort((x, y) => y.points - x.points || y.goalsFor - y.goalsAgainst - (x.goalsFor - x.goalsAgainst) || y.goalsFor - x.goalsFor || x.teamId.localeCompare(y.teamId))
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
export function buildContinentalClubs(u: LoadedUniverse, leagueId: string, leagueSeason: number, hostClubId: string, n = 15): Record<string, AiClub> {
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
  for (const cs of strongest) {
    const club = u.clubById[cs.clubId]
    const style = club?.style ?? 'balanced'
    const tactics = tacticsForStyle(style, formationForStyle(style))
    const state: Record<string, SquadPlayer> = {}
    for (const p of cs.squad) state[p.id] = newSquadPlayer(p.id, { familiarity: 70, sharpness: 85 })
    clubs[cs.clubId] = { id: cs.clubId, clubId: cs.clubId, name: club?.name ?? cs.clubId, shortName: club?.shortName ?? cs.clubId, tactics, squad: cs.squad.map((p) => p.id), state }
  }
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
  if (comp === 'continental' && cupRound) {
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
