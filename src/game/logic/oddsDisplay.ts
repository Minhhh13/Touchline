/**
 * How an odds panel prints a distribution (the reel's tier odds, the manager spin's, the January case's): every share
 * to one decimal place, apportioned by largest remainder so the printed figures always add up to exactly 100.0%, and a
 * share that can come up never printed as 0 (it takes the smallest unit, 0.1%, from the largest share). The panel says
 * "exact odds" only when the printed figures are the exact chances (every share a whole number of tenths of a per
 * cent); otherwise it says "odds (rounded)". Pure: display only, nothing here feeds the engine.
 */

/** Tenths of a per cent in the whole. */
const UNITS = 1000
const EPS = 1e-9

/**
 * The shares in whole tenths of a per cent, summing to exactly 1000 when any share is above zero (all zeros when none
 * is). Largest remainder: each share's floor, then the leftover tenths to the largest remainders (ties to the earlier
 * share); a share above zero that floors to nothing then gets one tenth, taken from the largest.
 */
export function apportionTenths(ps: readonly number[]): number[] {
  const clean = ps.map((p) => (Number.isFinite(p) && p > 0 ? p : 0))
  const total = clean.reduce((s, p) => s + p, 0)
  if (total <= 0) return clean.map(() => 0)
  const raw = clean.map((p) => (p / total) * UNITS)
  // A share a hair under a whole tenth from float error counts as that tenth
  const floors = raw.map((r) => Math.floor(r + EPS))
  let left = UNITS - floors.reduce((s, f) => s + f, 0)
  const order = raw.map((r, i) => ({ i, rem: r - floors[i] })).sort((a, b) => b.rem - a.rem || a.i - b.i)
  for (const o of order) {
    if (left <= 0) break
    floors[o.i]++
    left--
  }
  // Never print a possible share as 0
  for (let i = 0; i < floors.length; i++) {
    if (clean[i] > 0 && floors[i] === 0) {
      const big = floors.reduce((b, f, j) => (f > floors[b] ? j : b), 0)
      if (floors[big] > 1) {
        floors[big]--
        floors[i] = 1
      }
    }
  }
  return floors
}

/** Whether the printed tenths are the exact chances: every share is a whole number of tenths of a per cent. */
export function oddsExact(ps: readonly number[]): boolean {
  const total = ps.reduce((s, p) => s + (p > 0 ? p : 0), 0)
  if (total <= 0) return true
  return ps.every((p) => {
    const t = ((p > 0 ? p : 0) / total) * UNITS
    return Math.abs(t - Math.round(t)) < 1e-6 && (p <= 0 || Math.round(t) > 0)
  })
}

/** One printed share: "7.8%", "15.0%"; an impossible one reads "0%". */
export function tenthsLabel(tenths: number): string {
  return tenths <= 0 ? '0%' : `${(tenths / 10).toFixed(1)}%`
}

export interface ShownOdds {
  /** Each share as printed, in the order given. */
  labels: string[]
  /** The same in tenths of a per cent; they sum to 1000 whenever any share is above zero. */
  tenths: number[]
  exact: boolean
  /** The panel's note: "exact odds" or "odds (rounded)". */
  note: string
}

/** A distribution as an odds panel prints it. */
export function shownOdds(ps: readonly number[]): ShownOdds {
  const tenths = apportionTenths(ps)
  const exact = oddsExact(ps)
  return { labels: tenths.map(tenthsLabel), tenths, exact, note: exact ? 'exact odds' : 'odds (rounded)' }
}
