/**
 * The Weekly Challenge: one quick-draft wheel per ISO week (UTC, Monday to
 * Sunday) for everyone, across all seven leagues and every wheel rule, a theme
 * a week. Pure and pinned like the Daily's mapping: the week's seed indexes the
 * league, the season, the host club and the shape, and `WEEKLY_EPOCHS` the
 * theme, so changing any of it changes everyone's puzzle with the deploy.
 */
import type { LoadedUniverse } from '@engine/universe'
import { QUICK_RULES, type DraftRules } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { nationCover, nationDepthFrom } from '@engine/nations'
import { weeklyDateOf } from '@engine/rng'
import type { GameSettings } from '../types'
import { DAILY_FORMATIONS, shortNameFor } from './setup'
import { WEEKLY_EPOCHS, WEEKLY_THEMES, type WeeklyThemeId } from './weeklyThemes'

/** The leagues a week's number indexes, in `leagues.json` order: the first seven, so a league added later never moves a week. */
export const WEEKLY_LEAGUE_COUNT = 7
/** The Moneyball theme's cap on the XI, £M. */
export const WEEKLY_CAP = 180
/** The early-years theme's seasons (2008-09 to 2013-14). */
export const EARLY_YEARS = { fromSeason: 2008, toSeason: 2013 } as const
/** The modern-game theme's first season (2020-21). */
export const MODERN_FROM = 2020
/** The park-the-bus theme's shape. */
export const BUS_FORMATION = '5-3-2'

const WEEK_MS = 7 * 86400000

/** `weekly-2026-W44` reads `2026-W44`. */
export function weekLabel(seed: string): string {
  return seed.replace('weekly-', '')
}

/** The week's number, `year × 100 + week` (202644), that indexes the mapping; 0 for a seed that names no week. */
export function weeklyNumber(seed: string): number {
  const m = /^weekly-(\d{4})-W(\d{2})$/.exec(seed)
  return m && weeklyDateOf(seed) ? Number(m[1]) * 100 + Number(m[2]) : 0
}

/** The week's theme: the epoch in force that week, then one theme a week in its order. */
export function weeklyTheme(seed: string): WeeklyThemeId {
  const first = WEEKLY_EPOCHS[0]
  const monday = weeklyDateOf(seed)
  if (!monday) return first.themes[0]
  let epoch = first
  for (const e of WEEKLY_EPOCHS) {
    const from = weeklyDateOf(e.from)
    if (from && from.getTime() <= monday.getTime()) epoch = e
  }
  const start = weeklyDateOf(epoch.from)?.getTime() ?? monday.getTime()
  const weeks = Math.round((monday.getTime() - start) / WEEK_MS)
  const n = epoch.themes.length
  return epoch.themes[((weeks % n) + n) % n]
}

/** What the week is from the data index alone, before any pack is loaded: Home's card and the leagues to load. */
export interface WeeklyPlan {
  seed: string
  week: string
  leagueId: string
  wheelLeagues: string[]
  theme: WeeklyThemeId
  formationId: string
}

export function weeklyPlan(u: Pick<LoadedUniverse, 'available'>, seed: string): WeeklyPlan {
  const n = weeklyNumber(seed)
  const leagues = u.available.slice(0, WEEKLY_LEAGUE_COUNT).map((l) => l.id)
  const leagueId = leagues[n % WEEKLY_LEAGUE_COUNT] ?? leagues[0] ?? 'england'
  const theme = weeklyTheme(seed)
  return {
    seed,
    week: weekLabel(seed),
    leagueId,
    wheelLeagues: theme === 'european-nights' ? leagues : [leagueId],
    theme,
    formationId: theme === 'park-the-bus' ? BUS_FORMATION : DAILY_FORMATIONS[(n * 11) % DAILY_FORMATIONS.length],
  }
}

/** Everything the Weekly fixes for everyone. */
export interface WeeklySettings extends WeeklyPlan {
  season: number
  host: string
  difficulty: 'calibrated' | 'realistic'
  /** The theme's wheel rules on top of the quick draft's. */
  rules: Partial<DraftRules>
}

/**
 * The one-nation theme's nation: the one with the most players among those deep enough for a one-nation XI of the
 * shape in the week's league (every season), other than the league country's own; ties by code.
 */
export function weeklyNation(u: LoadedUniverse, leagueId: string, formationId: string): string | undefined {
  // The scan reads every player-season of the league: once per universe, league and shape (Home and Setup ask on every render)
  const memo = nationMemo.get(u) ?? new Map<string, string | undefined>()
  nationMemo.set(u, memo)
  const key = `${leagueId}|${formationId}`
  if (!memo.has(key)) memo.set(key, scanNation(u, leagueId, formationId))
  return memo.get(key)
}

const nationMemo = new WeakMap<LoadedUniverse, Map<string, string | undefined>>()

function scanNation(u: LoadedUniverse, leagueId: string, formationId: string): string | undefined {
  const country = u.available.find((l) => l.id === leagueId)?.country
  const own = Object.entries(u.nations).find(([, v]) => v.name === country)?.[0]
  const deep = nationDepthFrom(nationCover(u, [leagueId], {}, getFormation(formationId)), QUICK_RULES.squadSize).filter((n) => n.nation !== own)
  return deep.sort((a, b) => b.players - a.players || (a.nation < b.nation ? -1 : a.nation > b.nation ? 1 : 0))[0]?.nation
}

/**
 * The Weekly's fixed settings for a `weekly-YYYY-Www` seed, or null while a pack it needs is not loaded. With
 * `n = year × 100 + week`: the league at `n % 7` in `leagues.json` order, its seasons with complete squads ascending at
 * `(n × 7) % count`, that season's club ids sorted at `(n × 3) % count`, `DAILY_FORMATIONS[(n × 11) % 5]` (a 5-3-2
 * when the bus is parked) and the week's theme.
 */
export function weeklySettings(u: LoadedUniverse, seed: string): WeeklySettings | null {
  const plan = weeklyPlan(u, seed)
  const loaded = new Set(u.leagues.map((l) => l.id))
  if (!loaded.has(plan.leagueId) || !plan.wheelLeagues.every((l) => loaded.has(l))) return null
  const n = weeklyNumber(seed)
  // Never a classic season: the Weekly's mapping was frozen before the classic packs and has no opt-in
  const complete = u.clubSeasons.filter((cs) => cs.complete && !cs.classic && cs.leagueId === plan.leagueId)
  const seasons = [...new Set(complete.map((cs) => cs.season))].sort((a, b) => a - b)
  if (!seasons.length) return null
  const season = seasons[(n * 7) % seasons.length]
  const clubs = complete.filter((cs) => cs.season === season).map((cs) => cs.clubId).sort()
  const host = clubs[(n * 3) % clubs.length]
  const rules: Partial<DraftRules> = {}
  if (plan.theme === 'early') Object.assign(rules, EARLY_YEARS)
  if (plan.theme === 'modern') rules.fromSeason = MODERN_FROM
  if (plan.theme === 'hard') rules.hardMode = true
  if (plan.theme === 'moneyball') rules.budget = WEEKLY_CAP
  if (plan.theme === 'teammate-chain') rules.chain = true
  if (plan.theme === 'one-nation') {
    const nation = weeklyNation(u, plan.leagueId, plan.formationId)
    if (nation) rules.onlyNation = nation
  }
  return { ...plan, season, host, difficulty: plan.theme === 'realistic' || plan.theme === 'park-the-bus' ? 'realistic' : 'calibrated', rules }
}

/** The complete settings of a week's challenge, ready for `startGame` (only the team name is the player's); null while its packs load. */
export function weeklyGameSettings(u: LoadedUniverse, seed: string, teamName = 'Touchline XI'): GameSettings | null {
  const w = weeklySettings(u, seed)
  if (!w) return null
  const name = teamName.trim() || 'Touchline XI'
  return {
    mode: 'weekly',
    seed: w.seed,
    formationId: w.formationId,
    teamName: name,
    shortName: shortNameFor(name),
    leagueId: w.leagueId,
    wheelLeagues: w.wheelLeagues,
    hostClubId: w.host,
    leagueSeason: w.season,
    rules: { ...QUICK_RULES, twists: true, leagues: w.wheelLeagues, ...w.rules },
    jobSecurity: false,
    difficulty: w.difficulty,
    continental: false,
    weekly: { theme: w.theme },
  }
}

/** The theme in a line for Home and the Setup banner: `Teammate chain: every pick a former teammate of the one before`, with the nation named. */
export function weeklyThemeLine(u: Pick<LoadedUniverse, 'nations'>, w: Pick<WeeklySettings, 'theme' | 'rules'>): string {
  const t = WEEKLY_THEMES[w.theme]
  if (w.theme === 'one-nation' && w.rules.onlyNation) return `${t.name}: every pick from ${u.nations[w.rules.onlyNation]?.name ?? w.rules.onlyNation}`
  return `${t.name}: ${t.blurb}`
}
