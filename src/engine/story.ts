import type { Fixture } from './types'
import { computeTable, positionOf, type CarryRow } from './season'

/** The matchweek the title was sealed and the one relegation became certain, null when it never happened. */
export interface ClinchWeeks {
  clinchedAt: number | null
  doomedAt: number | null
}

/**
 * When the season was decided for the user, from fixtures that carry their
 * results. After matchweek `m`, a club's ceiling is its points plus three for
 * every fixture it still has after `m` (counting fixtures, not matchweeks, so
 * a bye week is no game). The title is sealed when the user's points beat
 * every other club's ceiling; the drop is certain when at least
 * `n - relegationPlaces` clubs already have more points than the user's
 * ceiling. Once every fixture is played the final table decides, so a title
 * won on goal difference still counts as sealed on the last day. A run-in
 * passes the fixtures it played and the table it carried in (`carryIn`). Pure:
 * one `computeTable` per matchweek and no random numbers.
 */
export function clinchMatchweeks(fixtures: Fixture[], teamIds: string[], userId: string, relegationPlaces = 3, carryIn?: Record<string, CarryRow>): ClinchWeeks {
  const out: ClinchWeeks = { clinchedAt: null, doomedAt: null }
  const weeks = [...new Set(fixtures.map((f) => f.matchweek))].sort((a, b) => a - b)
  const n = teamIds.length
  for (const m of weeks) {
    const upTo = fixtures.filter((f) => f.matchweek <= m)
    // A season cut short (a sacking) is only read up to the last fully played matchweek
    if (upTo.some((f) => !f.result)) break
    const left = new Map<string, number>(teamIds.map((t) => [t, 0]))
    for (const f of fixtures) {
      if (f.matchweek <= m) continue
      left.set(f.homeTeamId, (left.get(f.homeTeamId) ?? 0) + 1)
      left.set(f.awayTeamId, (left.get(f.awayTeamId) ?? 0) + 1)
    }
    const table = computeTable(upTo, teamIds, carryIn)
    const pts = new Map(table.map((r) => [r.teamId, r.points]))
    const mine = pts.get(userId) ?? 0
    const myCeiling = mine + 3 * (left.get(userId) ?? 0)
    const others = teamIds.filter((t) => t !== userId)
    const over = m === weeks[weeks.length - 1]
    const pos = over ? positionOf(table, userId) : 0
    if (out.clinchedAt === null) {
      const sealed = over ? pos === 1 : others.every((t) => mine > (pts.get(t) ?? 0) + 3 * (left.get(t) ?? 0))
      if (sealed) out.clinchedAt = m
    }
    if (out.doomedAt === null && n - relegationPlaces >= 1) {
      const doomed = over ? pos > n - relegationPlaces : others.filter((t) => (pts.get(t) ?? 0) > myCeiling).length >= n - relegationPlaces
      if (doomed) out.doomedAt = m
    }
    if (out.clinchedAt !== null || out.doomedAt !== null) break
  }
  return out
}
