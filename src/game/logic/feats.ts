/**
 * The r8 feats: what the Trophy Room's newer milestones count beyond the cabinet's first shelves. Engine 7's
 * Continental Cup (groups topped, a perfect group stage, a two-legged comeback), the Dynasty (its longest run, the
 * academy), titles by real season, in classic seasons and under a salary cap, perfect drafts and the Run-in of the week.
 * Every count is credited from a result already filed once (`creditGame`, `creditRunIn`, a quick post-season cup once
 * per `resultId:comp`); the lists hold distinct keys, so playing the same wheel again never counts twice. Pure: no
 * React, no store, no RNG, nothing written to a game.
 *
 * Kept out of `cabinet.ts` on purpose: the edge verifier's bundle reaches `cabinet.ts` (through `quickCups.ts`), and any
 * change to its symbols, even tree-shaken ones, renames the bundle. So the cabinet's own functions stay as they are and
 * the store wraps them here: `creditGameFeats` after `creditGame`, `creditRunInFeatsOn` after `creditRunIn`,
 * `withFeats` over `normaliseCabinet` and `rebuildCabinet` (`cabinetWithFeats`).
 */
import { USER_TEAM, type ContinentalState } from '@engine/season'
import { compareText } from '@engine/rng'
import type { Cabinet, CabinetFeats, Game, LeaderboardEntry, Profile, QuickCupRun, RunInEntry } from '../types'
import { countsAsLeagueSeason, finishedRecord, isTitle, normaliseCabinet, rebuildCabinet } from './cabinet'

/** The most keys a feat list keeps (well past every gold threshold). */
export const FEAT_LIST_CAP = 200
/** A thrifty title leaves at least this share of the salary cap unspent. */
export const THRIFT_SHARE = 0.25
/** The first season start year of the standard (EA-rated) packs: anything earlier is a classic season. */
export const FIRST_STANDARD_SEASON = 2008

export function emptyFeats(): CabinetFeats {
  return { groupsWon: 0, groupsPerfect: 0, comebacks: 0, dynastyBest: 0, graduates: 0, classicTitles: 0, cappedTitles: 0, thriftyTitles: 0, seasonsTitled: [], perfectDrafts: [], runInWeeks: [], seen: [] }
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)
const strings = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))].slice(-FEAT_LIST_CAP) : [])

/** Feats with every field present and sane (an imported or hand-edited save may lack some), or undefined when absent. */
export function normaliseFeats(f: Partial<CabinetFeats> | undefined): CabinetFeats | undefined {
  if (!f || typeof f !== 'object') return undefined
  const years = Array.isArray(f.seasonsTitled) ? [...new Set(f.seasonsTitled.filter((y): y is number => typeof y === 'number' && Number.isInteger(y)))].sort((a, b) => a - b) : []
  return {
    groupsWon: count(f.groupsWon),
    groupsPerfect: count(f.groupsPerfect),
    comebacks: count(f.comebacks),
    dynastyBest: count(f.dynastyBest),
    graduates: count(f.graduates),
    classicTitles: count(f.classicTitles),
    cappedTitles: count(f.cappedTitles),
    thriftyTitles: count(f.thriftyTitles),
    seasonsTitled: years,
    perfectDrafts: strings(f.perfectDrafts),
    runInWeeks: strings(f.runInWeeks),
    seen: strings(f.seen),
  }
}

/** The feats a cabinet holds, empty when it has none yet. */
export function featsOf(c: { feats?: CabinetFeats }): CabinetFeats {
  return c.feats ?? emptyFeats()
}

/** What a group stage made of the user's side: topped it, and won every match. Null when the user was not in a finished group. */
export interface GroupRead {
  topped: boolean
  perfect: boolean
}

type GroupMatchRow = { home: string; away: string; hg: number; ag: number }

/** The engine's group order (points, goal difference, goals, then id in English collation, as `computeTable`), read for the user's side. */
function readGroup(teams: string[], matches: GroupMatchRow[], played: boolean): GroupRead | null {
  if (!teams.includes(USER_TEAM) || !played || !matches.length) return null
  const rows = new Map(teams.map((id) => [id, { id, pts: 0, gf: 0, ga: 0 }]))
  let wins = 0
  let games = 0
  for (const m of matches) {
    const h = rows.get(m.home)
    const a = rows.get(m.away)
    if (!h || !a) continue
    h.gf += m.hg
    h.ga += m.ag
    a.gf += m.ag
    a.ga += m.hg
    if (m.hg > m.ag) h.pts += 3
    else if (m.hg < m.ag) a.pts += 3
    else {
      h.pts += 1
      a.pts += 1
    }
    if (m.home === USER_TEAM || m.away === USER_TEAM) {
      games++
      if ((m.home === USER_TEAM && m.hg > m.ag) || (m.away === USER_TEAM && m.ag > m.hg)) wins++
    }
  }
  const order = [...rows.values()].sort((x, y) => y.pts - x.pts || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf || compareText(x.id, y.id))
  return { topped: order[0]?.id === USER_TEAM, perfect: games > 0 && wins === games }
}

/** A Season or Dynasty Continental Cup's group stage (engine 7), once every match is played; null before engine 7 or without the user. */
export function seasonGroupRead(cont: ContinentalState | undefined): GroupRead | null {
  const g = cont?.groups?.find((x) => x.teams.includes(USER_TEAM))
  if (!g) return null
  const rows = g.matches.flatMap((m) => (m.result ? [{ home: m.homeTeamId, away: m.awayTeamId, hg: m.result.homeGoals, ag: m.result.awayGoals }] : []))
  return readGroup(g.teams, rows, rows.length === g.matches.length)
}

/** A quick season's post-season Continental Cup group stage; null on an older run or without the user. */
export function quickGroupRead(run: QuickCupRun | null | undefined): GroupRead | null {
  const g = run?.groups?.find((x) => x.teams.includes(USER_TEAM))
  if (!g) return null
  return readGroup(g.teams, g.matches.map(([, home, away, hg, ag]) => ({ home, away, hg, ag })), true)
}

/** Two-legged ties the user won after losing the first leg, in a Season or Dynasty Continental Cup. */
export function seasonComebacks(cont: ContinentalState | undefined): number {
  return (cont?.ties ?? []).filter((t) => {
    const l1 = t.firstLeg?.result
    if (!l1 || t.winnerId !== USER_TEAM) return false
    // The first leg is at the tie's home side's ground, its goals first
    if (t.homeTeamId === USER_TEAM) return l1.homeGoals < l1.awayGoals
    return t.awayTeamId === USER_TEAM && l1.awayGoals < l1.homeGoals
  }).length
}

/** Two-legged ties the user won after losing the first leg, in a quick season's post-season cup bracket. */
export function quickComebacks(run: QuickCupRun | null | undefined): number {
  return (run?.bracket ?? []).flat().filter((t) => {
    const l1 = t.legs?.[0]
    if (!l1 || t.winner !== USER_TEAM) return false
    if (t.home === USER_TEAM) return l1.hg < l1.ag
    return t.away === USER_TEAM && l1.ag < l1.hg
  }).length
}

function withYear(list: number[], year: number): number[] {
  return list.includes(year) ? list : [...list, year].sort((a, b) => a - b)
}

function withKey(list: string[], key: string): string[] {
  return list.includes(key) ? list : [...list, key].slice(-FEAT_LIST_CAP)
}

/** What a finished league season adds, beside the cabinet's own counts (`creditGame` calls it once per result). */
export interface SeasonFeatInput {
  title: boolean
  /** Every pick of the draft took an A (worked out where the universe is, in the store). */
  perfectDraft?: boolean
}

/** Credit one finished league season's feats. Pure: returns new feats. */
export function creditSeasonFeats(feats: CabinetFeats | undefined, game: Game, input: SeasonFeatInput): CabinetFeats {
  const f = normaliseFeats(feats) ?? emptyFeats()
  const mode = game.settings.mode
  const last = game.history.at(-1)
  const superLeague = mode === 'quick' && game.settings.rules.superLeague === true
  // Engine 7's Continental Cup in a Season or Dynasty (a quick season's post-season cup is credited when it is played)
  const group = seasonGroupRead(game.season?.continental)
  if (group?.topped) f.groupsWon += 1
  if (group?.perfect) f.groupsPerfect += 1
  f.comebacks += seasonComebacks(game.season?.continental)
  if (mode === 'dynasty') {
    f.dynastyBest = Math.max(f.dynastyBest, game.history.length)
    // The summer's prospect, promoted and still here at the end of his first season
    const chosen = game.youthIntake?.chosen
    if (chosen && game.squad[chosen]) f.graduates += 1
  }
  if (input.title && !superLeague) {
    const season = last?.leagueSeason ?? game.settings.leagueSeason
    f.seasonsTitled = withYear(f.seasonsTitled, season)
    if (season < FIRST_STANDARD_SEASON) f.classicTitles += 1
  }
  // The cap of the draft, only for the season it drafted (a Dynasty's later seasons are not capped)
  const budget = game.draft?.rules?.budget ?? game.settings.rules?.budget
  if (input.title && budget !== undefined && !(mode === 'dynasty' && game.year > 1)) {
    f.cappedTitles += 1
    const spent = game.draft?.spent ?? game.capSpent ?? 0
    if (spent <= budget * (1 - THRIFT_SHARE)) f.thriftyTitles += 1
  }
  if (input.perfectDraft) f.perfectDrafts = withKey(f.perfectDrafts, game.settings.seed)
  return f
}

/** The key a post-season cup is read under, once. */
export function cupFeatKey(game: Pick<Game, 'id' | 'year'>, comp: 'cup' | 'continental'): string {
  return `${game.id}-${game.year}:${comp}`
}

/** Credit a quick season's post-season cup run: its group stage and comebacks, once per season and cup. */
export function creditCupFeats(feats: CabinetFeats | undefined, game: Game, comp: 'cup' | 'continental'): CabinetFeats {
  const f = normaliseFeats(feats) ?? emptyFeats()
  const key = cupFeatKey(game, comp)
  const run = comp === 'cup' ? game.quickResult?.cup : game.quickResult?.continentalCup
  if (!run || f.seen.includes(key)) return f
  f.seen = withKey(f.seen, key)
  const group = quickGroupRead(run)
  if (group?.topped) f.groupsWon += 1
  if (group?.perfect) f.groupsPerfect += 1
  f.comebacks += quickComebacks(run)
  return f
}

const RUN_IN_WEEK = /^runin-(\d{4})-W(\d{2})$/

/** The Run-in of the week's key of a seed (`2026-W44`), or null for any other run-in. */
export function runInWeekOf(seed: string): string | null {
  const m = RUN_IN_WEEK.exec(seed)
  return m ? `${m[1]}-W${m[2]}` : null
}

/** Credit a finished run-in: a Run-in of the week with its brief met, once per week. */
export function creditRunInFeats(feats: CabinetFeats | undefined, seed: string, met: boolean): CabinetFeats {
  const f = normaliseFeats(feats) ?? emptyFeats()
  const week = runInWeekOf(seed)
  if (met && week) f.runInWeeks = withKey(f.runInWeeks, week)
  return f
}

/**
 * The feats of a profile written before them, counted from what it kept: titles by season, classic and capped titles
 * from the 50-entry leaderboard (a floor), the longest Dynasty from its entries (one seed per Dynasty), and the Run-in
 * of the week from the run-in log. Group stages, comebacks, the academy and perfect drafts start from zero.
 */
export function featsFromBoard(profile: Pick<Profile, 'leaderboard'> & { runIns?: RunInEntry[] }): CabinetFeats {
  const f = emptyFeats()
  const board: LeaderboardEntry[] = Array.isArray(profile.leaderboard) ? profile.leaderboard : []
  const dynasties = new Map<string, number>()
  for (const e of board) {
    if (e.mode === 'dynasty') dynasties.set(e.seed, (dynasties.get(e.seed) ?? 0) + 1)
    if (e.mode === 'arena' || e.mode === 'runin' || e.position !== 1 || e.tier === 'RELEGATED') continue
    if (!e.superLeague) {
      f.seasonsTitled = withYear(f.seasonsTitled, e.leagueSeason)
      if (e.leagueSeason < FIRST_STANDARD_SEASON) f.classicTitles += 1
    }
    if (e.budget !== undefined) {
      f.cappedTitles += 1
      if ((e.spent ?? 0) <= e.budget * (1 - THRIFT_SHARE)) f.thriftyTitles += 1
    }
  }
  f.dynastyBest = Math.max(0, ...dynasties.values())
  for (const r of Array.isArray(profile.runIns) ? profile.runIns : []) {
    const week = r.met ? runInWeekOf(r.seed) : null
    if (week) f.runInWeeks = withKey(f.runInWeeks, week)
  }
  return f
}

/** A cabinet with its feats normalised: an older one (none yet) counts them once from the leaderboard and the run-in log. */
export function withFeats(c: Cabinet, profile: Pick<Profile, 'leaderboard' | 'runIns'>): Cabinet {
  return { ...soundCounts(c), feats: normaliseFeats(c.feats) ?? featsFromBoard(profile) }
}

/**
 * The cabinet's counts as whole numbers of zero or more and its lists as lists of strings (r9): `normaliseCabinet`
 * fills in what is missing but keeps a count a damaged or hand-edited save bent ("NaN perfect seasons", "-3 of 1 for
 * bronze" in the Trophy Room). Kept here, not in `cabinet.ts`, which the edge verifier bundles. A sound cabinet reads
 * the same.
 */
export function soundCounts(c: Cabinet): Cabinet {
  const shelf = <T extends Record<string, number>>(v: unknown, keys: T): T => {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
    return Object.fromEntries(Object.keys(keys).map((k) => [k, count(o[k])])) as T
  }
  const keyed = (v: unknown): Record<string, number> => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, count(x)])) : {})
  const words = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const cups = c.cups && typeof c.cups === 'object' ? c.cups : { runs: 0, won: 0, bySize: {} }
  return {
    ...c,
    league: count(c.league),
    cup: count(c.cup),
    continental: count(c.continental),
    doubles: count(c.doubles),
    trebles: count(c.trebles),
    perfect: count(c.perfect),
    invincible: count(c.invincible),
    centurions: count(c.centurions),
    dailies: count(c.dailies),
    weeklies: count(c.weeklies),
    arenaDailies: count(c.arenaDailies),
    giantKills: count(c.giantKills),
    hostsTitled: words(c.hostsTitled),
    nationsTitled: words(c.nationsTitled),
    ...(c.recent !== undefined ? { recent: words(c.recent) } : {}),
    byMode: keyed(c.byMode),
    gauntlet: shelf(c.gauntlet, { runs: 0, best: 0, complete: 0 }),
    cups: { ...shelf(cups, { runs: 0, won: 0 }), bySize: keyed(cups.bySize) },
    h2h: shelf(c.h2h, { played: 0 }),
    ...(c.h2hOnline !== undefined ? { h2hOnline: shelf(c.h2hOnline, { played: 0, won: 0 }) } : {}),
    runIns: shelf(c.runIns, { played: 0, met: 0 }),
  }
}

/**
 * The profile's cabinet ready to credit: `normaliseCabinet` (or `rebuildCabinet` for a profile before the Trophy Room)
 * with its feats caught up (`withFeats`). The persist `merge` and every credit go through it.
 */
export function cabinetWithFeats(profile: Pick<Profile, 'cabinet' | 'trophies' | 'leaderboard' | 'dailyResults' | 'runIns'>): Cabinet {
  return withFeats(profile.cabinet ? normaliseCabinet(profile.cabinet) : rebuildCabinet(profile), profile)
}

/** A finished league season's feats, beside `creditGame` (the store calls both under the same once-per-result guard). */
export function creditGameFeats(cabinet: Cabinet, game: Game, opts: { perfectDraft?: boolean } = {}): Cabinet {
  const rec = finishedRecord(game)
  if (!rec || !countsAsLeagueSeason(game.settings.mode)) return cabinet
  return { ...cabinet, feats: creditSeasonFeats(cabinet.feats, game, { title: isTitle(rec.position, rec.tier), perfectDraft: opts.perfectDraft }) }
}

/** A finished run-in's feat, beside `creditRunIn`. */
export function creditRunInFeatsOn(cabinet: Cabinet, game: Game, met: boolean): Cabinet {
  return { ...cabinet, feats: creditRunInFeats(cabinet.feats, game.settings.seed, met) }
}
