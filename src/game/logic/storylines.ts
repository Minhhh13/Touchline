/**
 * Storylines: a Season's and a Dynasty's sense of story, read from what the
 * game already holds. Match previews before each league and cup match (form,
 * the meetings so far, what is at stake, a player to watch, a derby, the old
 * boys), the running stories of the season (a title race or a relegation fight
 * tightening, the scoring chart, a run, a milestone, a former club's visit,
 * the board's patience, the run-in) and a Dynasty summer's review of the
 * season just finished.
 *
 * Facts only: every function returns plain data, and the words are chosen in
 * `src/ui/storyText.ts` through `format.ts` and `flavour.ts`. Display only:
 * nothing here draws from an `Rng`, reads a clock or writes to the game, and no
 * simulation, store or online module imports it (`contentDisplayOnly.test.ts`).
 */
import type { LoadedUniverse } from '@engine/universe'
import type { Fixture, PlayerSeason, SquadPlayer, TableRow } from '@engine/types'
import type { AiClub, CupTie, SeasonState } from '@engine/season'
import { computeTable, USER_TEAM } from '@engine/season'
import { legAt } from '@engine/continental'
import type { MatchResult } from '@engine/types'
import { aiLookup } from '@engine/reserve'
import type { Game, SeasonRecord } from '../types'
import { squadPlayers } from './players'

export type FormLetter = 'W' | 'D' | 'L'
export type PreviewComp = 'league' | 'cup' | 'continental'

/** A meeting already played this season, from the user's side. */
export interface Meeting {
  comp: PreviewComp
  /** The league matchweek, or the matchweek a tie was played after. */
  matchweek: number
  home: boolean
  gf: number
  ga: number
  /** A tie settled on penalties: the user's kicks first. */
  pens?: { ours: number; theirs: number }
}

/** What the match means. Gaps are points, the user's side minus the other. */
export type Stake =
  | { kind: 'title-decider'; gap: number }
  | { kind: 'title'; gap: number; leaderId: string }
  | { kind: 'europe'; gap: number }
  | { kind: 'six-pointer'; gap: number }
  | { kind: 'survival'; gap: number }
  | { kind: 'leapfrog'; gap: number }
  | { kind: 'final' }
  | { kind: 'semi' }
  | { kind: 'knockout'; round: CupTie['round'] }
  /** Engine 7's Continental Cup: a group match, and the first leg of a two-legged tie (the second decides it). */
  | { kind: 'group'; group: string }
  | { kind: 'first-leg'; round: CupTie['round'] }

export interface Watch {
  playerId: string
  name: string
  goals: number
  assists: number
  apps: number
  overall: number
  /** Why he is the one: his goals this season, his recent ratings, or simply the best man in the side. */
  why: 'goals' | 'form' | 'rating'
  /** His recent average rating, when he has played lately. */
  form?: number
}

export type Derby = { kind: 'named'; name: string } | { kind: 'rival' } | { kind: 'city'; city: string }

export interface OldBoy {
  playerId: string
  name: string
  /** The season he played for the opponent (2019 is 2019-20). */
  season: number
}

export interface MatchPreview {
  comp: PreviewComp
  opponentId: string
  home: boolean
  /** The matchweek it is played in, or after for a tie. */
  matchweek: number
  /** A tie's round. */
  round?: CupTie['round']
  /** Engine 7's Continental Cup: the leg of a two-legged tie, or the group of a group match. */
  leg?: 1 | 2
  group?: string
  /** League form, the last five, oldest first; empty for a side outside the league. */
  form: { ours: FormLetter[]; theirs: FormLetter[] }
  /** League places and points, when both sides are in the league. */
  table?: { ours: number; theirs: number; oursPts: number; theirsPts: number }
  meetings: Meeting[]
  stake: Stake | null
  watch: { ours?: Watch; theirs?: Watch }
  derby: Derby | null
  oldBoys: OldBoy[]
}

/**
 * Real derbies by the two club ids in alphabetical order, joined by `|`. Common names only (no marks); a pair not
 * listed is still a derby when the host club names the other as a rival, or when they share a city.
 */
export const DERBIES: Readonly<Record<string, string>> = {
  'arsenal|tottenham-hotspur': 'North London derby',
  'everton|liverpool': 'Merseyside derby',
  'manchester-city|manchester-united': 'Manchester derby',
  'aston-villa|birmingham-city': 'Second City derby',
  'sheffield-united|sheffield-wednesday': 'Steel City derby',
  'newcastle-united|sunderland': 'Tyne-Wear derby',
  'portsmouth|southampton': 'South Coast derby',
  'west-bromwich-albion|wolverhampton-wanderers': 'Black Country derby',
  'brighton|crystal-palace': 'M23 derby',
  'derby-county|nottingham-forest': 'East Midlands derby',
  'ipswich-town|norwich-city': 'East Anglian derby',
  'chelsea|fulham': 'West London derby',
  'fc-barcelona|real-madrid': 'El Clásico',
  'atletico-madrid|real-madrid': 'Madrid derby',
  'espanyol|fc-barcelona': 'Barcelona derby',
  'real-betis|sevilla': 'Seville derby',
  'athletic-club|real-sociedad': 'Basque derby',
  'levante|valencia': 'Valencia derby',
  'celta-vigo|deportivo': 'Galician derby',
  'inter|milan': 'Derby della Madonnina',
  'lazio|roma': 'Derby della Capitale',
  'juventus|torino': 'Derby della Mole',
  'inter|juventus': "Derby d'Italia",
  'genoa|sampdoria': 'Derby della Lanterna',
  'chievo|hellas-verona': 'Verona derby',
  'napoli|roma': 'Derby del Sole',
  'borussia-dortmund|schalke': 'Revierderby',
  'bayern-munich|borussia-dortmund': 'Der Klassiker',
  'hamburger-sv|werder-bremen': 'Nordderby',
  'hamburger-sv|st-pauli': 'Hamburg derby',
  'hertha-berlin|union-berlin': 'Berlin derby',
  'borussia-monchengladbach|koln': 'Rhine derby',
  'karlsruher-sc|vfb-stuttgart': 'Baden-Württemberg derby',
  'marseille|paris-saint-germain': 'Le Classique',
  'lyon|saint-etienne': 'Derby du Rhône',
  'monaco|nice': "Côte d'Azur derby",
  'lens|lille': 'Derby du Nord',
  'ajax|feyenoord': 'De Klassieker',
  'feyenoord|sparta-rotterdam': 'Rotterdam derby',
  'benfica|sporting-cp': 'Lisbon derby',
  'benfica|fc-porto': 'O Clássico',
  'boavista|fc-porto': 'Porto derby',
  'sc-braga|vitoria-guimaraes': 'Minho derby',
}

export function derbyKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** The derby between the club the user replaced and `opponentId`, or null. */
export function derbyOf(u: LoadedUniverse, hostClubId: string, opponentId: string): Derby | null {
  if (hostClubId === opponentId) return null
  const name = DERBIES[derbyKey(hostClubId, opponentId)]
  if (name) return { kind: 'named', name }
  const host = u.clubById[hostClubId]
  const opp = u.clubById[opponentId]
  if (!host || !opp) return null
  if (host.rivals.includes(opponentId) || opp.rivals.includes(hostClubId)) return { kind: 'rival' }
  if (host.city && host.city === opp.city) return { kind: 'city', city: host.city }
  return null
}

function outcome(gf: number, ga: number): FormLetter {
  return gf > ga ? 'W' : gf < ga ? 'L' : 'D'
}

/** The user's league results in the order played: matchweek, outcome, the opponent. */
export function userLeagueResults(season: Pick<SeasonState, 'fixtures'>): Array<{ matchweek: number; o: FormLetter; opp: string; gf: number; ga: number }> {
  return season.fixtures
    .filter((f) => f.result && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM))
    .sort((a, b) => a.matchweek - b.matchweek)
    .map((f) => {
      const home = f.homeTeamId === USER_TEAM
      const gf = home ? f.result!.homeGoals : f.result!.awayGoals
      const ga = home ? f.result!.awayGoals : f.result!.homeGoals
      return { matchweek: f.matchweek, o: outcome(gf, ga), opp: home ? f.awayTeamId : f.homeTeamId, gf, ga }
    })
}

function tableOf(season: SeasonState, upTo?: number): TableRow[] {
  const fixtures = upTo === undefined ? season.fixtures : season.fixtures.filter((f) => f.matchweek <= upTo)
  return computeTable(fixtures, [USER_TEAM, ...Object.keys(season.ai)], season.carryIn)
}

function rowOf(table: TableRow[], id: string): { pos: number; row: TableRow } | null {
  const i = table.findIndex((r) => r.teamId === id)
  return i < 0 ? null : { pos: i + 1, row: table[i] }
}

/** The opponent's club state, in the league or the Continental Cup. */
function opponentClub(season: SeasonState, clubId: string): AiClub | undefined {
  return season.ai[clubId] ?? season.continental?.clubs[clubId]
}

function available(s: SquadPlayer | undefined): boolean {
  return !!s && !s.injury && !s.suspension
}

function recentAverage(s: SquadPlayer): number | undefined {
  const r = s.recentRatings.slice(-5)
  return r.length >= 2 ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 100) / 100 : undefined
}

function watchOf(p: PlayerSeason, s: SquadPlayer, why: Watch['why']): Watch {
  const st = s.seasonStats
  return { playerId: p.id, name: p.name, goals: st.goals, assists: st.assists, apps: st.apps, overall: p.overall, why, form: recentAverage(s) }
}

/** The opponent's man to watch: their top scorer who can play, else the best man in the side. */
export function theirWatch(u: LoadedUniverse, club: AiClub): Watch | undefined {
  const get = aiLookup(u)
  const men = club.squad.map((id) => ({ p: get(id), s: club.state[id] })).filter((x): x is { p: PlayerSeason; s: SquadPlayer } => !!x.p && available(x.s))
  if (!men.length) return undefined
  const scorer = [...men].sort((a, b) => b.s.seasonStats.goals - a.s.seasonStats.goals || b.p.overall - a.p.overall || a.p.id.localeCompare(b.p.id))[0]
  if (scorer.s.seasonStats.goals >= 2) return watchOf(scorer.p, scorer.s, 'goals')
  const best = [...men].sort((a, b) => b.p.overall - a.p.overall || a.p.id.localeCompare(b.p.id))[0]
  return watchOf(best.p, best.s, 'rating')
}

/** The user's man to watch: the starter in the best recent form, else the top scorer, else the best starter. */
export function ourWatch(game: Game, u: LoadedUniverse): Watch | undefined {
  const inXI = new Set(Object.values(game.lineup))
  const men = squadPlayers(game, u).filter((x) => inXI.has(x.p.id) && available(x.s))
  if (!men.length) return undefined
  const formed = men.map((x) => ({ x, f: recentAverage(x.s) })).filter((m) => m.f !== undefined && m.f >= 7.2)
  if (formed.length) {
    const top = formed.sort((a, b) => b.f! - a.f! || a.x.p.id.localeCompare(b.x.p.id))[0].x
    return watchOf(top.p, top.s, 'form')
  }
  const scorer = [...men].sort((a, b) => b.s.seasonStats.goals - a.s.seasonStats.goals || b.p.overall - a.p.overall || a.p.id.localeCompare(b.p.id))[0]
  if (scorer.s.seasonStats.goals >= 2) return watchOf(scorer.p, scorer.s, 'goals')
  const best = [...men].sort((a, b) => b.p.overall - a.p.overall || a.p.id.localeCompare(b.p.id))[0]
  return watchOf(best.p, best.s, 'rating')
}

/** The user's men who played for `clubId` in the season they were drafted from (never the club the user replaced). */
export function oldBoysOf(game: Game, u: LoadedUniverse, clubId: string): OldBoy[] {
  if (!game.season || clubId === game.season.hostClubId) return []
  return squadPlayers(game, u)
    .filter((x) => x.p.clubId === clubId)
    .sort((a, b) => b.p.overall - a.p.overall || a.p.id.localeCompare(b.p.id))
    .map((x) => ({ playerId: x.p.id, name: x.p.name, season: x.p.season }))
}

/**
 * The meetings in a tie with `opp`, from the user's side: a single match, or both legs of a two-legged tie (engine 7:
 * the second leg's `result` keeps its own sides, the tie's away side at home). A shoot-out goes with the deciding match.
 */
function tieMeetings(t: CupTie, comp: PreviewComp, opp: string): Meeting[] {
  const userHome = t.homeTeamId === USER_TEAM
  if (!(userHome ? t.awayTeamId === opp : t.homeTeamId === opp && t.awayTeamId === USER_TEAM)) return []
  const meet = (r: MatchResult, home: boolean, matchweek: number, pens?: { home: number; away: number }): Meeting => ({ comp, matchweek, home, gf: home ? r.homeGoals : r.awayGoals, ga: home ? r.awayGoals : r.homeGoals, pens: pens ? { ours: userHome ? pens.home : pens.away, theirs: userHome ? pens.away : pens.home } : undefined })
  const out: Meeting[] = []
  if (t.firstLeg?.result) out.push(meet(t.firstLeg.result, userHome, t.firstLeg.afterMatchweek))
  // The shoot-out from the tie's sides: an engine 7 tie's aggregate, or an older single tie's result
  if (t.result) out.push(meet(t.result, t.firstLeg ? !userHome : userHome, t.afterMatchweek, t.agg?.pens ?? t.result.penalties))
  return out
}

/** Every meeting with `opp` already played this season, in the order played. */
export function meetingsWith(season: SeasonState, opp: string): Meeting[] {
  const out: Meeting[] = []
  for (const f of season.fixtures) {
    if (!f.result) continue
    const home = f.homeTeamId === USER_TEAM
    if (!(home ? f.awayTeamId === opp : f.homeTeamId === opp && f.awayTeamId === USER_TEAM)) continue
    const gf = home ? f.result.homeGoals : f.result.awayGoals
    const ga = home ? f.result.awayGoals : f.result.homeGoals
    out.push({ comp: 'league', matchweek: f.matchweek, home, gf, ga })
  }
  for (const t of season.cup) out.push(...tieMeetings(t, 'cup', opp))
  // Engine 7's group stage, then the Continental Cup's ties
  for (const g of season.continental?.groups ?? []) {
    for (const m of g.matches) {
      if (!m.result) continue
      const home = m.homeTeamId === USER_TEAM
      if (!(home ? m.awayTeamId === opp : m.homeTeamId === opp && m.awayTeamId === USER_TEAM)) continue
      out.push({ comp: 'continental', matchweek: m.matchweek, home, gf: home ? m.result.homeGoals : m.result.awayGoals, ga: home ? m.result.awayGoals : m.result.homeGoals })
    }
  }
  for (const t of season.continental?.ties ?? []) out.push(...tieMeetings(t, 'continental', opp))
  // A tie after matchweek n is played after that week's league game
  return out.sort((a, b) => a.matchweek - b.matchweek || (a.comp === 'league' ? 0 : 1) - (b.comp === 'league' ? 0 : 1))
}

/** What a league match means, from the table as it stands. Null early on and in a quiet mid-table week. */
export function leagueStake(table: TableRow[], opp: string, playedWeeks: number): Stake | null {
  const us = rowOf(table, USER_TEAM)
  const them = rowOf(table, opp)
  if (!us || !them || playedWeeks < 3) return null
  const clubs = table.length
  const safe = clubs - 3
  const gap = us.row.points - them.row.points
  if (us.pos <= 2 && them.pos <= 3) return { kind: 'title-decider', gap }
  const leader = table[0]
  const second = table[1]
  if (us.pos === 1 && second && us.row.points - second.points <= 6) return { kind: 'title', gap: us.row.points - second.points, leaderId: USER_TEAM }
  if (us.pos <= 3 && us.pos > 1 && leader.points - us.row.points <= 6) return { kind: 'title', gap: us.row.points - leader.points, leaderId: leader.teamId }
  if (us.pos > safe - 3 && them.pos > safe - 3) return { kind: 'six-pointer', gap }
  if (us.pos > safe - 3) {
    const zone = us.pos > safe ? table[safe - 1] : table[safe]
    if (zone) return { kind: 'survival', gap: us.row.points - zone.points }
  }
  const fourth = table[3]
  if (us.pos >= 4 && us.pos <= 7 && fourth && fourth.points - us.row.points <= 4) return { kind: 'europe', gap: us.row.points - fourth.points }
  if (them.pos < us.pos && them.row.points - us.row.points <= 3) return { kind: 'leapfrog', gap }
  return null
}

function tieStake(round: CupTie['round']): Stake {
  return round === 'F' ? { kind: 'final' } : round === 'SF' ? { kind: 'semi' } : { kind: 'knockout', round }
}

function formOf(table: TableRow[], id: string): FormLetter[] {
  return [...(table.find((r) => r.teamId === id)?.form ?? [])]
}

/**
 * The preview of the user's next league match (`comp` league) or of a midweek tie. `matchweek` is the week it is
 * played in, or after for a tie. Null without a season or an opponent.
 */
export function matchPreview(game: Game, u: LoadedUniverse, fixture: TieFixture): MatchPreview | null {
  const season = game.season
  if (!season) return null
  const opp = fixture.opponentId
  const table = tableOf(season)
  const inLeague = opp in season.ai
  const us = rowOf(table, USER_TEAM)
  const them = inLeague ? rowOf(table, opp) : null
  const club = opponentClub(season, opp)
  const played = userLeagueResults(season).length
  return {
    comp: fixture.comp,
    opponentId: opp,
    home: fixture.home,
    matchweek: fixture.matchweek,
    round: fixture.round,
    ...(fixture.leg ? { leg: fixture.leg } : {}),
    ...(fixture.group ? { group: fixture.group } : {}),
    form: { ours: formOf(table, USER_TEAM), theirs: inLeague ? formOf(table, opp) : [] },
    table: us && them ? { ours: us.pos, theirs: them.pos, oursPts: us.row.points, theirsPts: them.row.points } : undefined,
    meetings: meetingsWith(season, opp),
    stake: fixture.comp === 'league' ? leagueStake(table, opp, played) : fixture.group ? { kind: 'group', group: fixture.group } : fixture.leg === 1 ? { kind: 'first-leg', round: fixture.round ?? 'QF' } : tieStake(fixture.round ?? 'R16'),
    watch: { ours: ourWatch(game, u), theirs: club ? theirWatch(u, club) : undefined },
    derby: fixture.comp === 'continental' ? null : derbyOf(u, season.hostClubId, opp),
    oldBoys: oldBoysOf(game, u, opp),
  }
}

/** The user's next league fixture (the matchweek about to be played), or null on a free weekend and once the season is done. */
export function nextLeagueFixture(game: Game): { opponentId: string; home: boolean; matchweek: number; comp: PreviewComp } | null {
  const season = game.season
  if (!season || season.sacked || season.matchweek >= season.matchweeks) return null
  const mw = season.matchweek + 1
  const f = season.fixtures.find((x: Fixture) => x.matchweek === mw && !x.result && (x.homeTeamId === USER_TEAM || x.awayTeamId === USER_TEAM))
  if (!f) return null
  const home = f.homeTeamId === USER_TEAM
  return { opponentId: home ? f.awayTeamId : f.homeTeamId, home, matchweek: mw, comp: 'league' }
}

/** A match to preview: the league's (`comp` league), or a midweek tie's with its round, and on engine 7's Continental Cup its leg or group. */
export interface TieFixture {
  opponentId: string
  home: boolean
  matchweek: number
  comp: PreviewComp
  round?: CupTie['round']
  leg?: 1 | 2
  group?: string
}

/**
 * The user's match played midweek after the next matchweek, in either cup, or null. Engine 7's Continental Cup plays
 * a group matchday or a leg there, each at its own ground (the second leg at the tie's away side's).
 */
export function nextTieFixture(game: Game): TieFixture | null {
  const season = game.season
  if (!season || season.sacked) return null
  const mw = season.matchweek + 1
  const find = (ties: CupTie[], comp: PreviewComp) => {
    for (const t of ties) {
      if (t.homeTeamId !== USER_TEAM && t.awayTeamId !== USER_TEAM) continue
      const leg = legAt(t, mw)
      if (!leg || (leg.leg === 1 ? t.firstLeg?.result : t.result)) continue
      const home = leg.homeTeamId === USER_TEAM
      return { opponentId: home ? leg.awayTeamId : leg.homeTeamId, home, matchweek: mw, comp, round: t.round }
    }
    return null
  }
  if (!season.cupEliminated && !season.cupWon) {
    const c = find(season.cup, 'cup')
    if (c) return c
  }
  const k = season.continental
  if (!k || k.eliminated || k.won) return null
  if (!k.groups) return find(k.ties, 'continental')
  for (const g of k.groups) {
    const m = g.matches.find((x) => x.matchweek === mw && !x.result && (x.homeTeamId === USER_TEAM || x.awayTeamId === USER_TEAM))
    if (!m) continue
    const home = m.homeTeamId === USER_TEAM
    return { opponentId: home ? m.awayTeamId : m.homeTeamId, home, matchweek: mw, comp: 'continental', group: g.name }
  }
  for (const t of k.ties) {
    if (t.homeTeamId !== USER_TEAM && t.awayTeamId !== USER_TEAM) continue
    const leg = legAt(t, mw)
    if (!leg || (leg.leg === 1 ? t.firstLeg?.result : t.result)) continue
    const home = leg.homeTeamId === USER_TEAM
    return { opponentId: home ? leg.awayTeamId : leg.homeTeamId, home, matchweek: mw, comp: 'continental', round: t.round, ...(leg.leg ? { leg: leg.leg } : {}) }
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// Running storylines

export type Storyline =
  | { kind: 'title-race'; id: string; position: number; gap: number; before: number | null; rivalId: string; toPlay: number }
  | { kind: 'relegation'; id: string; position: number; gap: number; before: number | null; toPlay: number }
  | { kind: 'golden-boot'; id: string; playerId: string; name: string; goals: number; rank: number; rival: { name: string; teamId: string; goals: number } | null }
  | { kind: 'winning-run' | 'unbeaten-run' | 'losing-run' | 'winless-run'; id: string; length: number }
  | MilestoneStory
  | { kind: 'old-club'; id: string; playerId: string; name: string; clubId: string; season: number; comp: PreviewComp }
  | { kind: 'pressure'; id: string; confidence: number; canSack: boolean; target: number; position: number }
  | { kind: 'run-in'; id: string; toPlay: number; position: number; target: number; gapTop: number; gapSafety: number }

export interface MilestoneStory {
  kind: 'milestone'
  id: string
  playerId: string
  name: string
  stat: 'apps' | 'goals'
  target: number
  value: number
  reached: boolean
}

export type StorylineKind = Storyline['kind']

/** The weight each kind carries, highest first on the Dugout. */
export const STORY_WEIGHT: Record<StorylineKind, number> = {
  'title-race': 90,
  relegation: 88,
  pressure: 85,
  'run-in': 80,
  milestone: 70,
  'old-club': 65,
  'golden-boot': 60,
  'winning-run': 55,
  'losing-run': 55,
  'unbeaten-run': 50,
  'winless-run': 50,
}

/** Thresholds: a run must be this long to be a story. */
export const RUN_MIN = { 'winning-run': 4, 'unbeaten-run': 6, 'losing-run': 3, 'winless-run': 5 } as const
/** A title race or relegation fight is close within this many points. */
export const RACE_GAP = 6
/** The run-in: this many league games left or fewer. */
export const RUN_IN_GAMES = 6
/** The board's patience is a story below this confidence. */
export const PRESSURE_CONFIDENCE = 30
/** Appearance and goal milestones for the side. */
export const MILESTONES = [50, 100, 150, 200, 250, 300] as const

/** The run the user is on now: the longest of each kind ending with the last league game. */
export function currentRuns(results: Array<{ o: FormLetter }>): Record<'winning-run' | 'unbeaten-run' | 'losing-run' | 'winless-run', number> {
  const count = (keep: (o: FormLetter) => boolean) => {
    let n = 0
    for (let i = results.length - 1; i >= 0 && keep(results[i].o); i--) n++
    return n
  }
  return { 'winning-run': count((o) => o === 'W'), 'unbeaten-run': count((o) => o !== 'L'), 'losing-run': count((o) => o === 'L'), 'winless-run': count((o) => o !== 'W') }
}

/** Appearances and goals this week by each of the user's men, from the stored league and cup results of the week just played. */
function thisWeek(game: Game): { apps: Record<string, number>; goals: Record<string, number> } {
  const apps: Record<string, number> = {}
  const goals: Record<string, number> = {}
  const mw = game.season?.matchweek ?? 0
  for (const [m, ctx] of [[game.lastMatch, game.lastMatchContext], [game.lastCupMatch, game.lastCupContext]] as const) {
    if (!m || !ctx || ctx.matchweek !== mw) continue
    const ours = m.homeTeamId === USER_TEAM ? m.homeStats : m.awayTeamId === USER_TEAM ? m.awayStats : []
    for (const s of ours ?? []) {
      if (s.minutes > 0) apps[s.playerSeasonId] = (apps[s.playerSeasonId] ?? 0) + 1
      if (s.goals) goals[s.playerSeasonId] = (goals[s.playerSeasonId] ?? 0) + s.goals
    }
  }
  return { apps, goals }
}

/** A man's appearances and goals for the side: earlier seasons (a Dynasty's `careerStats`) plus this one. */
export function forTheSide(game: Game, p: PlayerSeason, s: SquadPlayer): { apps: number; goals: number } {
  const c = game.careerStats?.[p.playerId]
  return { apps: (c?.apps ?? 0) + s.seasonStats.apps, goals: (c?.goals ?? 0) + s.seasonStats.goals }
}

function milestonesOf(game: Game, u: LoadedUniverse): MilestoneStory[] {
  const out: MilestoneStory[] = []
  const week = thisWeek(game)
  for (const { p, s } of squadPlayers(game, u)) {
    const t = forTheSide(game, p, s)
    for (const target of MILESTONES) {
      // Appearances: one game away, or reached this week
      const played = week.apps[p.id] ?? 0
      if (t.apps === target - 1 && available(s)) out.push({ kind: 'milestone', id: `ms-apps-${p.playerId}-${target}`, playerId: p.id, name: p.name, stat: 'apps', target, value: t.apps, reached: false })
      if (played && t.apps >= target && t.apps - played < target) out.push({ kind: 'milestone', id: `ms-apps-${p.playerId}-${target}`, playerId: p.id, name: p.name, stat: 'apps', target, value: t.apps, reached: true })
      // Goals: within two, or crossed this week
      if (t.goals < target && t.goals >= target - 2 && t.goals > 0) out.push({ kind: 'milestone', id: `ms-goals-${p.playerId}-${target}`, playerId: p.id, name: p.name, stat: 'goals', target, value: t.goals, reached: false })
      const now = week.goals[p.id] ?? 0
      if (now && t.goals >= target && t.goals - now < target) out.push({ kind: 'milestone', id: `ms-goals-${p.playerId}-${target}`, playerId: p.id, name: p.name, stat: 'goals', target, value: t.goals, reached: true })
    }
  }
  return out.sort((a, b) => Number(b.reached) - Number(a.reached) || a.id.localeCompare(b.id))
}

/** The league's scoring chart, the user's men and every rival's, most goals first. */
export function scoringChart(game: Game, u: LoadedUniverse): Array<{ playerId: string; name: string; teamId: string; goals: number }> {
  const season = game.season
  if (!season) return []
  const rows: Array<{ playerId: string; name: string; teamId: string; goals: number }> = []
  for (const { p, s } of squadPlayers(game, u)) if (s.seasonStats.goals > 0) rows.push({ playerId: p.id, name: p.name, teamId: USER_TEAM, goals: s.seasonStats.goals })
  const get = aiLookup(u)
  for (const [clubId, club] of Object.entries(season.ai)) {
    for (const id of club.squad) {
      const s = club.state[id]
      const p = get(id)
      if (!p || !s || s.seasonStats.goals <= 0 || id in game.squad) continue
      rows.push({ playerId: id, name: p.name, teamId: clubId, goals: s.seasonStats.goals })
    }
  }
  return rows.sort((a, b) => b.goals - a.goals || a.playerId.localeCompare(b.playerId))
}

function bootStory(game: Game, u: LoadedUniverse): Storyline | null {
  const season = game.season!
  if (season.matchweek < Math.max(8, Math.round(season.matchweeks * 0.25))) return null
  const chart = scoringChart(game, u)
  const mineAt = chart.findIndex((r) => r.teamId === USER_TEAM)
  if (mineAt < 0) return null
  const mine = chart[mineAt]
  const leader = chart[0]
  if (mine.goals < 5 || leader.goals - mine.goals > 3) return null
  const rival = mineAt === 0 ? chart.find((r) => r.teamId !== USER_TEAM) : leader
  const rank = chart.filter((r) => r.goals > mine.goals).length + 1
  return { kind: 'golden-boot', id: `boot-${mine.playerId}`, playerId: mine.playerId, name: mine.name, goals: mine.goals, rank, rival: rival ? { name: rival.name, teamId: rival.teamId, goals: rival.goals } : null }
}

/**
 * The running storylines of a Season or a Dynasty season as it stands, strongest first. Empty before a ball is
 * kicked (save a milestone or a former club's visit) and once the board has sacked the manager.
 */
export function storylines(game: Game, u: LoadedUniverse): Storyline[] {
  const season = game.season
  if (!season || season.sacked || game.quickResult) return []
  const out: Storyline[] = []
  const mw = season.matchweek
  const toPlay = season.matchweeks - mw
  const results = userLeagueResults(season)
  const table = tableOf(season)
  const us = rowOf(table, USER_TEAM)
  const clubs = table.length
  const safe = clubs - 3
  if (us && results.length >= 3 && toPlay > 0) {
    const before = mw > 1 ? tableOf(season, mw - 1) : null
    const gapAt = (t: TableRow[], mine: TableRow, pos: number) => (pos === 1 ? mine.points - (t[1]?.points ?? mine.points) : mine.points - t[0].points)
    // A title race: in the top three and within RACE_GAP of the other side of the top
    const raceFrom = Math.max(10, Math.round(season.matchweeks * 0.4))
    if (mw >= raceFrom && us.pos <= 3) {
      const gap = gapAt(table, us.row, us.pos)
      if (Math.abs(gap) <= RACE_GAP) {
        const prev = before ? rowOf(before, USER_TEAM) : null
        out.push({ kind: 'title-race', id: 'title-race', position: us.pos, gap, before: prev ? gapAt(before!, prev.row, prev.pos) : null, rivalId: us.pos === 1 ? table[1].teamId : table[0].teamId, toPlay })
      }
    }
    // A relegation fight: in the bottom six and within RACE_GAP of the line, either side of it
    if (mw >= Math.max(8, Math.round(season.matchweeks * 0.3)) && us.pos > safe - 3) {
      const line = (t: TableRow[], mine: TableRow, pos: number) => (pos > safe ? mine.points - t[safe - 1].points : mine.points - t[safe].points)
      const gap = line(table, us.row, us.pos)
      if (gap <= RACE_GAP) {
        const prev = before ? rowOf(before, USER_TEAM) : null
        out.push({ kind: 'relegation', id: 'relegation', position: us.pos, gap, before: prev ? line(before!, prev.row, prev.pos) : null, toPlay })
      }
    }
    // The run-in
    if (toPlay <= RUN_IN_GAMES) {
      const gapSafety = us.pos > safe ? us.row.points - table[safe - 1].points : us.row.points - (table[safe]?.points ?? 0)
      out.push({ kind: 'run-in', id: `run-in-${toPlay}`, toPlay, position: us.pos, target: season.boardTarget, gapTop: gapAt(table, us.row, us.pos), gapSafety })
    }
  }
  // Runs: the strongest one the user is on
  const runs = currentRuns(results)
  for (const kind of ['winning-run', 'losing-run', 'unbeaten-run', 'winless-run'] as const) {
    if (runs[kind] < RUN_MIN[kind]) continue
    // An unbeaten run that is all wins is told as the winning run; a winless run that is all defeats as the losing one
    if (kind === 'unbeaten-run' && runs['winning-run'] >= RUN_MIN['winning-run']) continue
    if (kind === 'winless-run' && runs['losing-run'] >= RUN_MIN['losing-run']) continue
    out.push({ kind, id: `${kind}-${runs[kind]}`, length: runs[kind] })
  }
  const boot = bootStory(game, u)
  if (boot) out.push(boot)
  out.push(...milestonesOf(game, u).slice(0, 2))
  // A former club's visit: the next league game, or the midweek tie
  for (const f of [nextLeagueFixture(game), nextTieFixture(game)]) {
    if (!f) continue
    const boy = oldBoysOf(game, u, f.opponentId)[0]
    if (boy) out.push({ kind: 'old-club', id: `old-club-${f.comp}-${boy.playerId}`, playerId: boy.playerId, name: boy.name, clubId: f.opponentId, season: boy.season, comp: f.comp })
  }
  // The board's patience
  if (mw >= 6 && toPlay > 0 && season.confidence < PRESSURE_CONFIDENCE) out.push({ kind: 'pressure', id: 'pressure', confidence: Math.round(season.confidence), canSack: !!game.settings.jobSecurity, target: season.boardTarget, position: us?.pos ?? 0 })
  return out.sort((a, b) => STORY_WEIGHT[b.kind] - STORY_WEIGHT[a.kind] || a.id.localeCompare(b.id))
}

// ---------------------------------------------------------------------------------------------------------------
// A Dynasty summer

export type SummerHeadline = 'treble' | 'double' | 'perfect' | 'invincible' | 'champions' | 'relegated' | 'cup' | 'europe' | 'climb' | 'slide' | 'steady'

export interface SummerReview {
  record: SeasonRecord
  previous: SeasonRecord | null
  headline: SummerHeadline
  /** Places climbed since the season before, in the same league (negative: a slide); null without one. */
  climb: number | null
  /** League titles in the Dynasty so far, and seasons played. */
  titles: number
  seasons: number
  /** The side's all-time top scorer so far, from the legends list. */
  legend: { name: string; goals: number; apps: number; seasons: number } | null
}

/**
 * The review that opens a Dynasty summer (the summer wheel and the pre-season, before the first league game): the
 * season just finished from `game.history`, against the one before it. Null in every other mode and moment.
 */
export function summerReview(game: Game): SummerReview | null {
  if (game.settings.mode !== 'dynasty' || !game.history.length) return null
  if (game.phase !== 'draft' && game.phase !== 'preseason') return null
  if (game.season && game.season.matchweek > 0) return null
  const record = game.history[game.history.length - 1]
  if (record.year !== game.year - 1) return null
  const previous = game.history.length > 1 ? game.history[game.history.length - 2] : null
  const champions = record.position === 1 && record.tier !== 'RELEGATED'
  const climb = previous && previous.leagueId === record.leagueId ? previous.position - record.position : null
  let headline: SummerHeadline
  if (champions && record.cupWon && record.continentalWon) headline = 'treble'
  else if (record.tier === 'PERFECT') headline = 'perfect'
  else if (champions && (record.cupWon || record.continentalWon)) headline = 'double'
  else if (record.tier === 'INVINCIBLE') headline = 'invincible'
  else if (champions) headline = 'champions'
  else if (record.tier === 'RELEGATED') headline = 'relegated'
  else if (record.cupWon || record.continentalWon) headline = 'cup'
  else if (record.position <= 4) headline = 'europe'
  else if (climb !== null && climb >= 3) headline = 'climb'
  else if (climb !== null && climb <= -3) headline = 'slide'
  else headline = 'steady'
  const legends = Object.values(game.careerStats ?? {}).sort((a, b) => b.goals - a.goals || b.apps - a.apps || a.name.localeCompare(b.name))
  const top = legends[0]
  return {
    record,
    previous,
    headline,
    climb,
    titles: game.history.filter((h) => h.position === 1 && h.tier !== 'RELEGATED').length,
    seasons: game.history.length,
    legend: top && top.goals > 0 ? { name: top.name, goals: top.goals, apps: top.apps, seasons: top.seasons } : null,
  }
}
