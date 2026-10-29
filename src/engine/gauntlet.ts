/**
 * The Gauntlet's ladder: fifteen rungs of real club-seasons, each from a
 * stronger slice of the wheel than the last, drawn once from the arena's
 * field stream so everyone on a seed climbs the same ladder whatever they
 * drafted. Pure: every random draw comes from the `Rng` passed in.
 */
import type { ClubSeason } from './types'
import type { LoadedUniverse } from './universe'
import type { Rng } from './rng'
import { clubSeasonKey, giantsOf, teamStrengthOf } from './knockout'

/** Rungs on the ladder. */
export const GAUNTLET_RUNGS = 15
/** Percentile bands the pool is cut into: rung r (1 to 10) draws from band r. */
export const GAUNTLET_BANDS = 10

/**
 * The calibrated opponent's ceiling at rung r: `start + step × (r − 1)` team
 * overall, never above its real self. Tuned for venues that alternate (away
 * at rung 1) so the assistant's mean climb stays near five rungs; the
 * measurements are in GAME_DESIGN section 17.
 */
export const GAUNTLET_CEILING: { readonly start: number; readonly step: number } = { start: 66, step: 1.5 }

export function gauntletCeiling(rung: number): number {
  return GAUNTLET_CEILING.start + GAUNTLET_CEILING.step * (rung - 1)
}

/** Rating points the calibration takes off a rung's opponent: 0 on Realistic, otherwise whatever it has above the ceiling. */
export function gauntletOffset(real: number, rung: number, difficulty: 'calibrated' | 'realistic'): number {
  if (difficulty === 'realistic') return 0
  return Math.max(0, Math.round((real - gauntletCeiling(rung)) * 10) / 10)
}

/** How much a rung weighs: 1 at the foot, 0.03 more a rung, at most a final's 1.4. */
export function gauntletImportance(rung: number): number {
  return Math.min(1.4, Math.round((1 + 0.03 * (rung - 1)) * 100) / 100)
}

/** The venue alternates by rung: away at rung 1, at home at rung 2, and so on (even rungs at home). */
export function gauntletHome(rung: number): boolean {
  return rung % 2 === 0
}

/** The real team strength that makes a rung a giant killing. */
export const GIANT_KILLING = 85

/** `Rung 7`, and the night's billing: a giant killing against a real 85+, a Gauntlet night from rung 5. */
export function rungLabels(rung: number, realStrength: number): { label: string; billing?: string } {
  const billing = realStrength >= GIANT_KILLING ? 'Giant killing' : rung >= 5 ? 'Gauntlet night' : undefined
  return { label: `Rung ${rung}`, ...(billing ? { billing } : {}) }
}

/** Mains and alternates, by rung (index 0 is rung 1), as club-season keys. */
export interface GauntletLadder {
  mains: string[]
  alternates: string[]
}

/** The pool cut into ten bands by real strength (weakest first, ties by key), and the strongest 5% for rungs 11 to 15. */
export function gauntletBands(u: LoadedUniverse, pool: ClubSeason[]): { bands: ClubSeason[][]; top: ClubSeason[] } {
  const ranked = [...pool].sort((a, b) => teamStrengthOf(u, a) - teamStrengthOf(u, b) || (clubSeasonKey(a) < clubSeasonKey(b) ? -1 : 1))
  const n = ranked.length
  const bands = Array.from({ length: GAUNTLET_BANDS }, (_, k) => ranked.slice(Math.floor((k * n) / GAUNTLET_BANDS), Math.floor(((k + 1) * n) / GAUNTLET_BANDS)))
  return { bands, top: giantsOf(u, pool) }
}

/** The slice of the pool rung r draws from. */
export function rungBand(b: { bands: ClubSeason[][]; top: ClubSeason[] }, rung: number): ClubSeason[] {
  return rung <= GAUNTLET_BANDS ? b.bands[rung - 1] : b.top
}

/** `rung 8 · top 30% of the wheel`: where a rung's band sits. */
export function rungBandLabel(rung: number): string {
  if (rung > GAUNTLET_BANDS) return 'the strongest 5% of the wheel'
  if (rung === 1) return 'the weakest 10% of the wheel'
  return `top ${100 - 10 * (rung - 1)}% of the wheel`
}

/**
 * The slice the top rungs (11 to 15) draw their main from: the strongest 5%
 * of the pool, widened 5 points at a time (top 10%, top 15%...) until it holds
 * a club not yet on the ladder. One league's strongest 5% can be as few as
 * four clubs (England's: Liverpool, Manchester City, Arsenal, Chelsea), and a
 * club appears once among the mains.
 */
function topSlice(u: LoadedUniverse, pool: ClubSeason[], ok: (cs: ClubSeason) => boolean): ClubSeason[] {
  const ranked = [...pool].sort((a, b) => teamStrengthOf(u, b) - teamStrengthOf(u, a) || (clubSeasonKey(a) < clubSeasonKey(b) ? -1 : 1))
  for (let pct = 5; pct <= 100; pct += 5) {
    const slice = ranked.slice(0, Math.max(1, Math.ceil((ranked.length * pct) / 100))).filter(ok)
    if (slice.length) return slice.sort((a, b) => (clubSeasonKey(a) < clubSeasonKey(b) ? -1 : 1))
  }
  return []
}

/**
 * The club-seasons of the bands nearest band r (one band below and one above,
 * then two, and so on) that pass `ok`, the first distance with any; empty when
 * no band has one.
 */
function nearestFresh(bands: ClubSeason[][], rung: number, ok: (cs: ClubSeason) => boolean): ClubSeason[] {
  for (let d = 1; d < bands.length; d++) {
    const near = [bands[rung - 1 - d], bands[rung - 1 + d]].filter((x): x is ClubSeason[] => !!x).flat().filter(ok)
    if (near.length) return near.sort((a, b) => (clubSeasonKey(a) < clubSeasonKey(b) ? -1 : 1))
  }
  return []
}

/**
 * Build the ladder from the field stream (the pool must be in key order, as
 * `arenaPool` returns it). Mains first, from the top down (rung 15 to 1), so
 * the strongest clubs are kept for the top of the ladder; one draw each:
 * - rungs 11 to 15: uniform over the strongest 5% of the pool less every club
 *   (by club id) already on the ladder, widened when none is left (`topSlice`);
 * - rungs 1 to 10: uniform over band r less every club already on the ladder;
 *   when a small pool (an era) leaves no new club in the band, over the
 *   nearest bands' new clubs (`nearestFresh`, engine 7), and only when the
 *   whole pool has none left, any unused club-season of the band.
 * Then the alternates, rung 1 to 15: uniform over the same band (the strongest
 * 5% for rungs 11 to 15) less every club on a main or an earlier alternate;
 * when the band has no such club, its club-seasons less every main and
 * earlier alternate, then the pool's, then the band (or the pool) less the
 * rung's own main. An alternate never leaves its band to find a new club: the
 * rung's strength comes first (engine 8; engine 7 kept only the club-season
 * unique, so an alternate was often a club already on the ladder, and on a
 * small wheel the rung's own main).
 * The user's draft never enters it.
 */
export function buildLadder(u: LoadedUniverse, rng: Rng, pool: ClubSeason[]): GauntletLadder {
  if (!pool.length) throw new Error('No club-seasons for the Gauntlet')
  const b = gauntletBands(u, pool)
  const usedKeys = new Set<string>()
  const usedClubs = new Set<string>()
  const unusedKey = (cs: ClubSeason) => !usedKeys.has(clubSeasonKey(cs))
  const fresh = (cs: ClubSeason) => unusedKey(cs) && !usedClubs.has(cs.clubId)
  const mains: string[] = Array.from({ length: GAUNTLET_RUNGS }, () => '')
  for (let r = GAUNTLET_RUNGS; r >= 1; r--) {
    const band = rungBand(b, r)
    let from = r > GAUNTLET_BANDS ? topSlice(u, pool, fresh) : band.filter(fresh)
    // An era's smaller pool can run out of new clubs in a band: the nearest bands with one come first (engine 7)
    if (!from.length && r <= GAUNTLET_BANDS) from = nearestFresh(b.bands, r, fresh)
    if (!from.length) from = band.filter(unusedKey)
    if (!from.length) from = pool.filter(unusedKey)
    const cs = rng.pick(from.length ? from : band)
    mains[r - 1] = clubSeasonKey(cs)
    usedKeys.add(clubSeasonKey(cs))
    usedClubs.add(cs.clubId)
  }
  const alternates: string[] = []
  for (let r = 1; r <= GAUNTLET_RUNGS; r++) {
    const band = rungBand(b, r)
    // A club already on the ladder is its alternate only when its band has no other (engine 8)
    let from = band.filter(fresh)
    if (!from.length) from = band.filter(unusedKey)
    if (!from.length) from = pool.filter(unusedKey)
    // A wheel too small for thirty club-seasons: the band again, but never the rung's own main
    const notOwn = (cs: ClubSeason) => clubSeasonKey(cs) !== mains[r - 1]
    if (!from.length) from = band.filter(notOwn)
    if (!from.length) from = pool.filter(notOwn)
    const cs = rng.pick(from.length ? from : band)
    alternates.push(clubSeasonKey(cs))
    usedKeys.add(clubSeasonKey(cs))
    usedClubs.add(cs.clubId)
  }
  return { mains, alternates }
}
