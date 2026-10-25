/**
 * TouchLine's estimated ratings for classic seasons (no official ratings exist
 * before 2007-08). Pure functions; the coefficients are in ratings-coef.json.
 *
 *   ovr = c0 + c1 share + c2 share^2 + c3 ln(min(startRank, 30)) + c4 GD/g + c5 rankFrac + c6 share PPG
 *         + c7 G/g + c8 (age-27) + c9 (age-27)^2 + c10 ln(1+sitelinks) + c11 notMatched + c12 ln(1+caps) + c13 intl
 *
 * fitted per position group on the European Soccer Database's England
 * 2008-09 to 2013-14 EA ratings (PW). A player with a later EA rating (an ESD
 * snapshot within MAX_GAP seasons) uses PWB, which adds that rating projected
 * back season by season with the ESD-fitted age curve.
 *
 * Then, per season (CALIBRATION below):
 *  1. Champions' dominance (the prototype gave 9 of 1992-93's top 15 to
 *     Manchester United): the star adjustment. The team terms (c4, c5, c6)
 *     place a club's three best men, who carry its results; below them they
 *     fade out over a few rating points, so a champion's regulars no longer
 *     outrank everyone else's stars. A weak club's negative team terms work
 *     the other way: its stars are spared them. The order inside a club never
 *     changes. (A capped prominence term from caps and sitelinks is available
 *     and switched off: it cost held-out accuracy and pushed champions above 89.)
 *  2. Spread: the predictions are stretched around the mean of each season
 *     and position group (the model, like any regression, pulls towards the
 *     mean), so the best player reads 86-90 and a relegated club's best the
 *     low to high 70s, as in the 2008-13 EA packs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { HISTORIC_DIR } from './config.mjs'

export const COEF = JSON.parse(fs.readFileSync(path.join(HISTORIC_DIR, 'ratings-coef.json'), 'utf8'))
export const GROUP = { GK: 'GK', DF: 'DEF', MF: 'MID', FW: 'FWD' }
/** A later EA rating further away than this many seasons is not used. */
export const MAX_GAP = 6

/**
 * The calibration settled by the feel check (validate-ratings.mjs, and the
 * distribution test over the shipped pack):
 *   teamScale     share of the team terms kept below a club's stars (0: none)
 *   starRank      a club's stars: its best this many by the raw model keep the team terms
 *   dampRamp      rating points below the stars over which the team terms fade out
 *   prominence    null, or { links, caps, centre, cap }: + links (ln(1+sitelinks) - centre) + caps ln(1+caps), clamped to 0..cap
 *   stretch       spread around each season and position group's mean, for rows rated by the model alone
 *   laterStretch  the same for rows rated through a later EA rating (they already have EA's spread)
 *   shift         added to the model-only rows after the stretch (the 1999-2000 long-gap check put them 1.5 high)
 */
export const CALIBRATION = { teamScale: 0, starRank: 3, dampRamp: 2, prominence: null, stretch: 1.2, laterStretch: 0.95, shift: -0.3 }

const TEAM_TERMS = ['gdpg', 'rankFrac', 'shareXppg']

/** One season backwards: x(age - 1) from x(age), with the ESD-fitted curve. */
export function backProject(x, ageThen, gap) {
  for (let j = gap - 1; j >= 0; j--) {
    const c = COEF.curve[Math.max(16, Math.min(40, Math.round(ageThen + j)))] ?? { a: 0, b: 0 }
    x += c.a + c.b * (x - 65)
  }
  return x
}

/**
 * Model features of one player-season.
 *   p     { share, startRank, goals, age, links, caps, intl, matched }
 *   team  { games, gf, ga, pts, position, clubs }
 *   later { ovr, gap } or null
 */
export function features(p, team, later) {
  const share = p.share
  const ppg = team.pts / team.games
  const f = {
    share,
    share2: share * share,
    logRank: Math.log(Math.min(p.startRank, 30)),
    gdpg: (team.gf - team.ga) / team.games,
    rankFrac: (team.position - 1) / (team.clubs - 1),
    shareXppg: share * ppg,
    goals: p.goals / team.games,
    age: p.age - 27,
    age2: (p.age - 27) ** 2,
    logLinks: p.matched === false ? 0 : Math.log1p(p.links ?? 0),
    wdMissing: p.matched === false ? 1 : 0,
    logCaps: p.caps != null ? Math.log1p(p.caps) : 0,
    intlActive: p.intl ? 1 : 0,
  }
  if (later) {
    const v = backProject(later.ovr, p.age, later.gap) - 65
    Object.assign(f, { bp: v, bpXgap: v * later.gap, bpMissing: 0, bpGap: later.gap })
  }
  return f
}

/** Linear prediction, split into the team part (c4..c6) and the rest. */
export function predict(group, f, coef = f.bp !== undefined ? COEF.PWB : COEF.PW) {
  const c = coef[group]
  let y = c.intercept
  let team = 0
  for (const [k, v] of Object.entries(f)) {
    const t = (c[k] ?? 0) * v
    y += t
    if (TEAM_TERMS.includes(k)) team += t
  }
  return { y, team }
}

export function prominence(p, cal = CALIBRATION) {
  const pr = cal.prominence
  if (!pr) return 0
  const v = pr.links * (Math.log1p(p.links ?? 0) - pr.centre) + pr.caps * (p.caps != null ? Math.log1p(p.caps) : 0)
  return Math.min(pr.cap, Math.max(0, v))
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  const n = s.length
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0
}

/**
 * The star adjustment, over the rows of one club-season: rows carry
 * { raw, team, p } (from `predict`) and get `adj`, the calibrated
 * (unstretched) value. A club's stars (its `starRank` best by the raw model)
 * keep the team terms in full; below them the team terms fade to `teamScale`
 * of their value over `dampRamp` rating points. The removed part grows with
 * the distance below the stars, so adj rises with raw and the order inside a
 * club does not change (the team terms are the club's, apart from the small
 * share x PPG part). Then the capped prominence term.
 */
export function adjustClub(rows, cal = CALIBRATION) {
  const sorted = rows.map((r) => r.raw).sort((x, y) => y - x)
  const ref = sorted[Math.min(sorted.length - 1, (cal.starRank ?? 3) - 1)] ?? 0
  for (const r of rows) {
    const below = Math.min(1, Math.max(0, (ref - r.raw) / cal.dampRamp))
    // a strong club's context lifts its stars only; a weak club's drags down only those below its stars
    const w = r.team > 0 ? below : 1 - below
    r.adj = r.raw - (1 - cal.teamScale) * w * r.team + prominence(r.p, cal)
  }
  return rows
}

/**
 * The spread, for the rows of one season and position group: the calibrated
 * values are stretched around their mean and moved back to the raw model's
 * mean (damping and prominence change the shape, not the level), then rounded.
 */
export function stretchGroup(rows, cal = CALIBRATION, { lo = 40, hi = 95 } = {}) {
  const m = (k) => rows.reduce((s, r) => s + r[k], 0) / Math.max(1, rows.length)
  const rawMean = m('raw')
  const adjMean = m('adj')
  // a row rated through a later EA rating already has EA's spread and level (`r.later`): it takes `laterStretch` and no shift
  for (const r of rows) r.ovr = Math.min(hi, Math.max(lo, Math.round(rawMean + (r.later ? cal.laterStretch ?? cal.stretch : cal.stretch) * (r.adj - adjMean) + (r.later ? 0 : cal.shift))))
  return rows
}
