import type { LoadedUniverse } from '@engine/universe'
import type { DraftRules } from '@engine/draft'
import { dailyDateOf } from '@engine/rng'

/** Shapes the Daily rotates through, one a day. */
export const DAILY_FORMATIONS: readonly string[] = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '4-4-2-diamond']

/**
 * The Daily's draft rules, written out in full (nothing spread from `QUICK_RULES` or the difficulty
 * table) so a later change to the quick defaults can never make two players' Dailies differ. They are
 * the Daily's original rules, from before the 38-0 options: 2 re-spins (the owner kept 2 when Normal
 * went to 1), ratings shown, Squad First, season ratings, no manager, twists on, all-time, every club and
 * nationality, the Premier League wheel, and no modes. `difficulty: 'normal'` only labels the
 * draft; the re-spin budget is the 2 written here, not the difficulty's. A new rule must be added
 * here; a test checks that every key of `QUICK_RULES` is, and a pinned test replays the Daily
 * against the pre-38-0 rules for several dates.
 */
export const DAILY_RULES: DraftRules = {
  squadSize: 11,
  respins: 2,
  difficulty: 'normal',
  hardMode: false,
  minFit: 'accomplished',
  uniqueClubSeasons: true,
  twists: true,
  showRatings: true,
  draftMode: 'squad',
  ratings: 'season',
  managers: false,
  fromSeason: undefined,
  toSeason: undefined,
  onlyClub: undefined,
  onlyNation: undefined,
  leagues: ['england'],
  modes: undefined,
  // The casual modes' rules: never on the Daily (written out, so a later default cannot reach it)
  budget: undefined,
  chain: undefined,
  superEase: undefined,
}

export interface DailySettings {
  season: number
  host: string
  formationId: string
  leagueId: string
  wheelLeagues: string[]
  difficulty: 'calibrated' | 'realistic'
  rules: DraftRules
  seed: string
  /** The January window at the halfway pause: on for everyone, whatever the quick default becomes. */
  january: boolean
  /** The Continental Cup run after a top-four finish: off for everyone (it needs every league loaded). */
  continental: boolean
}

/** The Daily's season options, pinned beside `DAILY_RULES`: the January window on, no Continental Cup run. */
export const DAILY_SEASON = { january: true, continental: false } as const

/**
 * The leagues the Daily is drawn from, in dated epochs like the Weekly's themes (`WEEKLY_EPOCHS`): from an epoch's
 * first day on, the day's league is `leagues[days since that day mod leagues.length]`, one league a day in this order,
 * starting again after the last. The first epoch is the original Daily, the Premier League every day, and covers every
 * date before the next one (and any seed that names no date), so no Daily before 2026-10-30 changes. Append-only: a new
 * rotation (a league added to the data, a new order) opens a new epoch from a future day; never edit a shipped one.
 * The lists are literal, never read from the data index, so a league added to `leagues.json` never moves a day.
 */
export const DAILY_EPOCHS: ReadonlyArray<{ from: string | null; leagues: readonly string[] }> = [
  { from: null, leagues: ['england'] },
  // Engine 7's rotation: the seven leagues in `leagues.json` order, the Premier League on the first day (a Friday)
  { from: 'daily-2026-10-30', leagues: ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal'] },
]

const DAY_MS = 86400000

/** The league a daily seed's puzzle is drawn from: the epoch in force that day, then one league a day in its order. Pure, from the seed alone. */
export function dailyLeagueOf(seed: string): string {
  const day = dailyDateOf(seed)
  let epoch = DAILY_EPOCHS[0]
  let start: number | null = null
  if (day) {
    for (const e of DAILY_EPOCHS) {
      const from = e.from ? dailyDateOf(e.from) : null
      if (from && from.getTime() <= day.getTime()) {
        epoch = e
        start = from.getTime()
      }
    }
  }
  const n = epoch.leagues.length
  const days = day && start !== null ? Math.round((day.getTime() - start) / DAY_MS) : 0
  return epoch.leagues[((days % n) + n) % n]
}

/** What a day's Daily is before any pack is loaded (Home's card, the leagues Setup and the server load): its league and shape. */
export interface DailyPlan {
  seed: string
  leagueId: string
  wheelLeagues: string[]
  formationId: string
}

export function dailyPlan(seed: string): DailyPlan {
  const n = Number(seed.split('-').slice(1).join('')) || 0
  const leagueId = dailyLeagueOf(seed)
  return { seed, leagueId, wheelLeagues: [leagueId], formationId: DAILY_FORMATIONS[(n * 3) % DAILY_FORMATIONS.length] }
}

/** Whether a day's Daily can be built on a universe holding `loaded` leagues: its league's pack is in. */
export function dailyLoaded(loaded: readonly string[], seed: string): boolean {
  const p = dailyPlan(seed)
  return [p.leagueId, ...p.wheelLeagues].every((id) => loaded.includes(id))
}

/**
 * Everything the Daily fixes for a daily seed (`daily-YYYY-MM-DD`): the day's league (`dailyLeagueOf`: the Premier
 * League before 2026-10-30, then the rotation), its season and the host club (rotating through the league's complete
 * seasons and their clubs by the date), the formation, calibrated difficulty, `DAILY_RULES` with the day's league as the
 * wheel, and `DAILY_SEASON` (January window on, no Continental Cup run). Pure: the same seed and data give the same
 * settings on every device. A Premier League day is exactly the original mapping. Throws when the day's league is not
 * in `u` (check `dailyLoaded` first): a Daily is never built on another league's data. `leagueId` is for the tests that
 * pin the original Premier League mapping on dates the rotation gives another league (`dailyPin.test.ts`); the game
 * never passes it.
 */
export function dailySettings(u: LoadedUniverse, seed: string, leagueId = dailyLeagueOf(seed)): DailySettings {
  const n = Number(seed.split('-').slice(1).join('')) || 0
  const complete = u.clubSeasons.filter((cs) => cs.complete && cs.leagueId === leagueId && !cs.classic)
  const seasons = [...new Set(complete.map((cs) => cs.season))].sort()
  if (!seasons.length) throw new Error(`The Daily of ${seed.replace('daily-', '')} needs the ${leagueId} pack, which is not loaded`)
  const season = seasons[n % seasons.length]
  const clubs = complete.filter((cs) => cs.season === season).map((cs) => cs.clubId).sort()
  const host = clubs[(n * 7) % clubs.length]
  return { season, host, formationId: DAILY_FORMATIONS[(n * 3) % DAILY_FORMATIONS.length], leagueId, wheelLeagues: [leagueId], difficulty: 'calibrated', rules: { ...DAILY_RULES, leagues: [leagueId] }, seed, january: DAILY_SEASON.january, continental: DAILY_SEASON.continental }
}
