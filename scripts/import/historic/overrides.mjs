/**
 * Hand-written corrections to league tables built from results files: points
 * deductions, clubs the league placed last whatever their points, and titles
 * that were stripped and never (or differently) awarded. A results file only
 * knows the matches, so without these the computed table differs from the
 * official one.
 *
 * Every entry is a fact checked against the cited English Wikipedia season
 * article (its league table template: `adjust_points_*`, `note_*`). An entry
 * for a season the packs have no table for (Serie A, Ligue 1 and Primeira Liga
 * before 2008-09) is kept for the later classic phases and simply not applied.
 *
 *   season      start year (1996 = 1996-97)
 *   deductions  clubId -> points taken off; the table's `pts` is net of it
 *   placedLast  clubs ranked below everyone else (in this order), points untouched
 *   titleVoid   the title was stripped and not re-awarded: no champion that season
 */
export const TABLE_OVERRIDES = [
  {
    league: 'england',
    season: 1996,
    deductions: { middlesbrough: 3 },
    note: 'Middlesbrough were deducted 3 points for failing to fulfil the fixture at Blackburn Rovers in December 1996; they finished 19th on 39 points and were relegated.',
    cite: 'https://en.wikipedia.org/wiki/1996%E2%80%9397_FA_Premier_League',
  },
  // Seasons the packs already ship with players and a table (2008-09 onwards)
  {
    league: 'england',
    season: 2009,
    deductions: { portsmouth: 9 },
    note: 'Portsmouth were deducted 9 points for entering administration; they finished 20th on 19 points.',
    cite: 'https://en.wikipedia.org/wiki/2009%E2%80%9310_Premier_League',
  },
  {
    league: 'england',
    season: 2023,
    deductions: { everton: 8, 'nottingham-forest': 4 },
    note: 'Profit and sustainability breaches: Everton 10 points (reduced to 6 on appeal) and a further 2, Nottingham Forest 4. Everton finished 15th on 40 points, Forest 17th on 32.',
    cite: 'https://en.wikipedia.org/wiki/2023%E2%80%9324_Premier_League',
  },
  {
    league: 'spain',
    season: 2014,
    deductions: { almeria: 3 },
    note: 'Almería were docked 3 points over an unpaid transfer; they finished 19th on 29 points.',
    cite: 'https://en.wikipedia.org/wiki/2014%E2%80%9315_La_Liga',
  },
  {
    league: 'italy',
    season: 2014,
    deductions: { parma: 7 },
    note: 'Parma were docked 7 points in all for failing to pay players\' wages; they finished 20th on 19 points.',
    cite: 'https://en.wikipedia.org/wiki/2014%E2%80%9315_Serie_A',
  },
  {
    league: 'italy',
    season: 2018,
    deductions: { chievo: 3 },
    note: 'Chievo were deducted 3 points for false accounting; they finished 20th on 17 points.',
    cite: 'https://en.wikipedia.org/wiki/2018%E2%80%9319_Serie_A',
  },
  {
    league: 'italy',
    season: 2022,
    deductions: { juventus: 10 },
    note: 'Juventus were deducted 10 points (15 at first) over capital gain violations; they finished 7th on 62 points.',
    cite: 'https://en.wikipedia.org/wiki/2022%E2%80%9323_Serie_A',
  },
  {
    league: 'france',
    season: 1992,
    deductions: { marseille: 1, valenciennes: 1 },
    titleVoid: true,
    note: 'Marseille were stripped of the title over the bribery scandal and it was not re-awarded; Marseille and Valenciennes were each deducted one point.',
    cite: 'https://en.wikipedia.org/wiki/1992%E2%80%9393_French_Division_1',
  },
  {
    league: 'italy',
    season: 2004,
    titleVoid: true,
    note: 'Juventus were stripped of the 2004-05 title after Calciopoli; there is no winner for that season.',
    cite: 'https://en.wikipedia.org/wiki/2004%E2%80%9305_Serie_A',
  },
  {
    league: 'italy',
    season: 2005,
    deductions: { milan: 30, fiorentina: 30, lazio: 30 },
    placedLast: ['juventus'],
    note: 'Calciopoli: Juventus were placed at the bottom (points not deducted) and the title went to Inter; Milan, Fiorentina and Lazio were deducted 30 points each.',
    cite: 'https://en.wikipedia.org/wiki/2005%E2%80%9306_Serie_A',
  },
  {
    league: 'italy',
    season: 2006,
    deductions: { milan: 8, fiorentina: 15, lazio: 3, reggina: 11, siena: 1 },
    note: 'Calciopoli deductions carried into 2006-07 (Milan 8, Fiorentina 15, Lazio 3, Reggina 11) and Siena 1 for late social-security payments.',
    cite: 'https://en.wikipedia.org/wiki/2006%E2%80%9307_Serie_A',
  },
  {
    league: 'portugal',
    season: 2007,
    deductions: { 'fc-porto': 6, belenenses: 3 },
    note: 'Porto were docked 6 points (attempted bribery of referees in 2003-04, Apito Dourado) and Belenenses 3 for fielding an ineligible player.',
    cite: 'https://en.wikipedia.org/wiki/2007%E2%80%9308_Primeira_Liga',
  },
]

/** The overrides for one league-season, or null. */
export function tableOverride(leagueId, season) {
  return TABLE_OVERRIDES.find((o) => o.league === leagueId && o.season === season) ?? null
}

/**
 * Apply a league-season's overrides to a table from `buildTable` (rows with
 * clubId, played, won, drawn, lost, gf, ga, pts, position). Returns a new table,
 * re-ranked by the same order as `buildTable` (points, goal difference, goals
 * scored, club id) with `placedLast` clubs at the bottom, plus `titleVoid` and
 * the club ids the override names but the table lacks (a typo or a wrong season).
 */
export function applyTableOverrides(leagueId, season, table) {
  const o = tableOverride(leagueId, season)
  if (!o) return { table, titleVoid: false, missing: [], applied: false }
  const ids = new Set(table.map((r) => r.clubId))
  const named = [...Object.keys(o.deductions ?? {}), ...(o.placedLast ?? [])]
  const missing = named.filter((id) => !ids.has(id))
  const rows = table.map((r) => {
    const d = o.deductions?.[r.clubId] ?? 0
    return d ? { ...r, pts: r.pts - d, deduction: d } : { ...r }
  })
  const last = o.placedLast ?? []
  const rank = (r) => (last.includes(r.clubId) ? 1 + last.indexOf(r.clubId) : 0)
  rows.sort((x, y) => rank(x) - rank(y) || y.pts - x.pts || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf || x.clubId.localeCompare(y.clubId))
  rows.forEach((r, i) => (r.position = i + 1))
  return { table: rows, titleVoid: !!o.titleVoid, missing, applied: true }
}
