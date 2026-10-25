import type { Fixture } from '@engine/types'
import type { QuickGameResult, QuickRounds } from '../types'

/**
 * The live league table of a quick season's playback: every club's results by matchweek, packed small enough to keep
 * on the saved result (`QuickResult.rounds`), and the table, the position chart, the gaps and the moments read from
 * them. Built from fixtures already played, so nothing here draws a random number. Pure.
 */

/** Pack the played fixtures of a season: for each matchweek, `[home, away, homeGoals, awayGoals]` per fixture, by index into `ids`. */
export function packRounds(fixtures: Fixture[], ids: string[]): QuickRounds {
  const at = new Map(ids.map((id, i) => [id, i]))
  const weeks: number[][] = []
  for (const f of fixtures) {
    if (!f.result) continue
    const w = (weeks[f.matchweek - 1] ??= [])
    w.push(at.get(f.homeTeamId)!, at.get(f.awayTeamId)!, f.result.homeGoals, f.result.awayGoals)
  }
  for (let i = 0; i < weeks.length; i++) weeks[i] ??= []
  return { ids: [...ids], weeks }
}

/** One row of the live table. */
export interface LiveRow {
  teamId: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  points: number
}

/** The table order `computeTable` uses: points, goal difference, goals scored, then the club id. */
function order(x: LiveRow, y: LiveRow): number {
  return y.points - x.points || y.goalsFor - y.goalsAgainst - (x.goalsFor - x.goalsAgainst) || y.goalsFor - x.goalsFor || x.teamId.localeCompare(y.teamId)
}

/** The table after every matchweek: `tables[k]` is the table after matchweek k + 1. */
export function weeklyTables(rounds: QuickRounds): LiveRow[][] {
  const rows: LiveRow[] = rounds.ids.map((teamId) => ({ teamId, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 }))
  const out: LiveRow[][] = []
  for (const w of rounds.weeks) {
    for (let i = 0; i + 3 < w.length; i += 4) {
      const h = rows[w[i]]
      const a = rows[w[i + 1]]
      const hg = w[i + 2]
      const ag = w[i + 3]
      h.played++
      a.played++
      h.goalsFor += hg
      h.goalsAgainst += ag
      a.goalsFor += ag
      a.goalsAgainst += hg
      if (hg > ag) {
        h.won++
        a.lost++
        h.points += 3
      } else if (hg < ag) {
        a.won++
        h.lost++
        a.points += 3
      } else {
        h.drawn++
        a.drawn++
        h.points++
        a.points++
      }
    }
    out.push(rows.map((r) => ({ ...r })).sort(order))
  }
  return out
}

/**
 * The table after the user's `upTo`th game (0 before the first): the matchweek of that game, so a bye week shows
 * with the next game. Empty when the rounds are missing (a save from before the live table).
 */
export function tableAfterGame(tables: LiveRow[][], results: Array<Pick<QuickGameResult, 'matchweek'>>, upTo: number): LiveRow[] {
  if (!tables.length) return []
  if (upTo <= 0) return [...tables[0]].map((r) => ({ ...r, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 })).sort((x, y) => x.teamId.localeCompare(y.teamId))
  const mw = results[Math.min(upTo, results.length) - 1]?.matchweek ?? tables.length
  return tables[Math.min(mw, tables.length) - 1]
}

/** Places moved since the game before: positive is up the table. Zero when there is no game before. */
export function movement(before: LiveRow[], now: LiveRow[], teamId: string): number {
  const b = before.findIndex((r) => r.teamId === teamId)
  const n = now.findIndex((r) => r.teamId === teamId)
  if (b < 0 || n < 0 || !before.some((r) => r.played)) return 0
  return b - n
}

/** Where a table's zones start and end, by place: champions, top four, top six and the bottom three. */
export function zoneOf(place: number, teams: number): 'title' | 'top4' | 'top6' | 'releg' | null {
  if (place === 1) return 'title'
  if (place <= 4) return 'top4'
  if (place <= 6) return 'top6'
  if (place > teams - 3) return 'releg'
  return null
}

/** The points gap the playback prints: to 1st when chasing it, the lead when top, else to the place above. */
export function gapLine(table: LiveRow[], teamId: string): string | null {
  const i = table.findIndex((r) => r.teamId === teamId)
  if (i < 0 || !table[i].played) return null
  const me = table[i]
  const pts = (n: number) => `${n} pt${n === 1 ? '' : 's'}`
  if (i === 0) {
    const lead = me.points - (table[1]?.points ?? me.points)
    return lead > 0 ? `Top by ${pts(lead)}` : 'Top on goal difference'
  }
  const top = table[0].points - me.points
  if (i <= 3) return top === 0 ? 'Level on points with 1st' : `${pts(top)} off top`
  const above = table[i - 1].points - me.points
  return above === 0 ? `Level with ${ordinalPlace(i)}` : `${pts(above)} off ${ordinalPlace(i)}`
}

function ordinalPlace(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** League position by game for the chart: the user's, and any other club's, after each of the user's games. */
export function positionSeries(tables: LiveRow[][], results: Array<Pick<QuickGameResult, 'matchweek'>>, teamId: string, upTo = results.length): number[] {
  const out: number[] = []
  for (let k = 1; k <= Math.min(upTo, results.length); k++) {
    const t = tableAfterGame(tables, results, k)
    out.push(t.findIndex((r) => r.teamId === teamId) + 1)
  }
  return out
}

/** The rivals the chart draws faintly: the best `n` other clubs in the table shown. */
export function rivalsOf(table: LiveRow[], teamId: string, n = 3): string[] {
  return table.filter((r) => r.teamId !== teamId).slice(0, n).map((r) => r.teamId)
}

export type MomentKind = 'top' | 'top4' | 'perfect' | 'broke'

/**
 * What the game just shown did worth marking: went top, came into the top four, kept the perfect run going (from the
 * fifth win, then every fifth) or ended it. At most one: going top beats the top four, the run's end beats all.
 */
export function momentAt(tables: LiveRow[][], results: Array<Pick<QuickGameResult, 'matchweek' | 'gf' | 'ga'>>, k: number, teamId: string): MomentKind | null {
  if (k <= 0 || k > results.length) return null
  const perfectBefore = results.slice(0, k - 1).every((r) => r.gf > r.ga)
  const r = results[k - 1]
  if (perfectBefore && r.gf <= r.ga) return 'broke'
  const now = tableAfterGame(tables, results, k)
  const before = tableAfterGame(tables, results, k - 1)
  const p = now.findIndex((x) => x.teamId === teamId) + 1
  const q = k > 1 ? before.findIndex((x) => x.teamId === teamId) + 1 : 99
  if (p === 1 && q !== 1 && now.length) return 'top'
  if (p >= 2 && p <= 4 && q > 4 && now.length) return 'top4'
  if (perfectBefore && r.gf > r.ga && k >= 5 && k % 5 === 0) return 'perfect'
  return null
}
