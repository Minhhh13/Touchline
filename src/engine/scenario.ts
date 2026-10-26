/**
 * The Run-in: take over a real club late in a real season. The catalogue of
 * jobs, the takeover week and the table projected to it all come from the
 * real final tables (`u.tables`): the data keeps no matchday standings, so the
 * table at the takeover is the final one scaled back, and is always labelled
 * as a projection. Pure: no game state, and no random numbers except
 * `suggestRunIns`' own stream of the setup seed.
 */
import type { LeagueSeasonRow } from './types'
import { isClassicSeason, type LoadedUniverse } from './universe'
import { Rng } from './rng'
import { computeTable, positionOf, USER_TEAM, type CarryRow } from './season'

export type RunInTemplate = 'title' | 'europe' | 'survival'

export const RUN_IN_TEMPLATES: RunInTemplate[] = ['title', 'europe', 'survival']

/** The leagues whose packs carry complete real tables, so the only ones with run-in jobs (the setup offers these; a test keeps the list true to the data). */
export const RUN_IN_LEAGUES = ['england', 'spain', 'italy', 'germany'] as const

/**
 * Leagues whose third-from-bottom club plays a relegation play-off (the
 * Bundesliga's 16th, in every season the packs hold) whose result the data
 * does not keep: only the two below it went down for certain. The game itself
 * still relegates the bottom three.
 */
export const PLAYOFF_LEAGUES: readonly string[] = ['germany']

/** How many clubs at the foot of a real final table went straight down: two in a play-off league, three elsewhere. */
export function relegatedDirectly(leagueId: string): number {
  return PLAYOFF_LEAGUES.includes(leagueId) ? 2 : 3
}

/** A club-season this many players short of a matchday squad cannot be a league side in a run-in. */
export const RUN_IN_MIN_SQUAD = 16

/** The matchweek the manager takes over after: 28 of 38, 25 of 34 (ten or nine to play). */
export function takeoverWeek(matchweeks: number): number {
  return Math.round((matchweeks * 28) / 38)
}

/**
 * A real final row scaled back to `n` of its `played` matches. Won, drawn and
 * lost are scaled by `n / played`, floored, and the matches still missing go
 * to the largest remainders (ties to won, then drawn, then lost), so they add
 * up to exactly `n`; goals are rounded. Points are `3w + d` wherever the row is read.
 */
export function scaleRow(row: Pick<LeagueSeasonRow, 'won' | 'drawn' | 'lost' | 'goalsFor' | 'goalsAgainst'>, played: number, n: number): CarryRow {
  const parts = [row.won, row.drawn, row.lost].map((x) => (x * n) / played)
  const counts = parts.map(Math.floor)
  let left = n - counts.reduce((a, b) => a + b, 0)
  const order = parts.map((p, i) => ({ i, r: p - Math.floor(p) })).sort((a, b) => b.r - a.r || a.i - b.i)
  for (const o of order) {
    if (left <= 0) break
    counts[o.i]++
    left--
  }
  return { won: counts[0], drawn: counts[1], lost: counts[2], goalsFor: Math.round((row.goalsFor * n) / played), goalsAgainst: Math.round((row.goalsAgainst * n) / played) }
}

/** The place a brief asks for: 1 for the title, 4 for Europe, the last safe place (`clubs − 3`) for survival. */
export function briefTarget(template: RunInTemplate, clubs: number): number {
  return template === 'title' ? 1 : template === 'europe' ? 4 : clubs - 3
}

/** One job in the catalogue: a real club-season, the brief, the real finish and the projected table at the takeover. */
export interface RunInJob {
  template: RunInTemplate
  leagueId: string
  season: number
  clubId: string
  clubs: number
  /** Matches each club plays (38 for twenty clubs). */
  matchweeks: number
  /** The takeover week: the projection covers matchweeks 1 to this. */
  takeover: number
  /** The place the brief asks for. */
  target: number
  /** How the real club finished. */
  real: { position: number; points: number }
  /** Where the projection puts the club at the takeover. */
  projected: { position: number; points: number }
  /** Points from the brief's line at the takeover, signed from the club's side: negative is behind it, otherwise the cushion over the first place outside it. */
  gap: number
}

/** A league season's real final table when it is complete (every club played the full programme) and every club has a squad to field. */
function completeTable(u: LoadedUniverse, leagueId: string, season: number): LeagueSeasonRow[] | null {
  const rows = u.tables[leagueId]?.[season]
  if (!rows?.length) return null
  const n = rows.length
  if (!rows.every((r) => r.won + r.drawn + r.lost === 2 * (n - 1))) return null
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === season)
  if (clubs.length !== n || !rows.every((r) => clubs.some((cs) => cs.clubId === r.clubId && cs.complete && cs.squad.length >= RUN_IN_MIN_SQUAD))) return null
  return [...rows].sort((a, b) => a.position - b.position)
}

/** The projected table at the takeover, keyed as a season keys its teams: every club by its id, the host under `USER_TEAM`. */
export function projectedCarryIn(u: LoadedUniverse, leagueId: string, season: number, hostClubId: string): Record<string, CarryRow> | null {
  const rows = completeTable(u, leagueId, season)
  if (!rows) return null
  const played = 2 * (rows.length - 1)
  const n = takeoverWeek(played)
  return Object.fromEntries(rows.map((r) => [r.clubId === hostClubId ? USER_TEAM : r.clubId, scaleRow(r, played, n)]))
}

function jobOf(template: RunInTemplate, leagueId: string, season: number, rows: LeagueSeasonRow[], row: LeagueSeasonRow): RunInJob {
  const clubs = rows.length
  const matchweeks = 2 * (clubs - 1)
  const takeover = takeoverWeek(matchweeks)
  const carry = Object.fromEntries(rows.map((r) => [r.clubId === row.clubId ? USER_TEAM : r.clubId, scaleRow(r, matchweeks, takeover)]))
  const table = computeTable([], Object.keys(carry), carry)
  const position = positionOf(table, USER_TEAM)
  const points = table[position - 1].points
  const target = briefTarget(template, clubs)
  // Behind the line: the gap to the club in the target place; inside it: the cushion over the first club outside
  const gap = position > target ? points - table[target - 1].points : points - (table[target]?.points ?? points)
  return { template, leagueId, season, clubId: row.clubId, clubs, matchweeks, takeover, target, real: { position: row.position, points: row.points }, projected: { position, points }, gap }
}

/** Does this real final row make a job of the template? Title: 2nd or 3rd within 6 of the champions; Europe: 5th to 8th within 5 of 4th; survival: in the bottom three within 6 of safety. */
function fits(template: RunInTemplate, rows: LeagueSeasonRow[], r: LeagueSeasonRow): boolean {
  const n = rows.length
  if (template === 'title') return (r.position === 2 || r.position === 3) && rows[0].points - r.points <= 6
  if (template === 'europe') return r.position >= 5 && r.position <= 8 && rows[3].points - r.points <= 5
  return r.position >= n - 2 && rows[n - 4].points - r.points <= 6
}

/**
 * Every run-in job of a template in the loaded leagues: league seasons with a
 * complete real table and a full squad for every club (France, the
 * Netherlands and Portugal have no tables, so none). Newest season first,
 * then by league in the universe's order, then by the real finish.
 */
export function runInCatalogue(u: LoadedUniverse, template: RunInTemplate): RunInJob[] {
  const jobs: RunInJob[] = []
  for (const league of u.leagues) {
    for (const season of Object.keys(u.tables[league.id] ?? {}).map(Number)) {
      // The classic seasons (estimated ratings) are opt-in elsewhere and the run-in has no opt-in: never a job
      if (isClassicSeason(u, league.id, season)) continue
      const rows = completeTable(u, league.id, season)
      if (!rows) continue
      for (const r of rows) if (fits(template, rows, r)) jobs.push(jobOf(template, league.id, season, rows, r))
    }
  }
  const order = u.leagues.map((l) => l.id)
  return jobs.sort((a, b) => b.season - a.season || order.indexOf(a.leagueId) - order.indexOf(b.leagueId) || a.real.position - b.real.position)
}

/** The job for one club-season, or null when it is not in that template's catalogue. */
export function runInJob(u: LoadedUniverse, template: RunInTemplate, leagueId: string, season: number, clubId: string): RunInJob | null {
  const rows = completeTable(u, leagueId, season)
  const row = rows?.find((r) => r.clubId === clubId)
  return rows && row && fits(template, rows, row) ? jobOf(template, leagueId, season, rows, row) : null
}

/** Three jobs (or as many as there are) drawn by the setup seed from its own stream, so a seed always suggests the same ones. */
export function suggestRunIns(jobs: RunInJob[], seed: string, k = 3): RunInJob[] {
  const rng = new Rng(`${seed}#runin`)
  return rng.shuffle(jobs.map((_, i) => i)).slice(0, k).map((i) => jobs[i])
}
