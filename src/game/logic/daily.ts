import type { LoadedUniverse } from '@engine/universe'
import type { DraftRules } from '@engine/draft'

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
 * Everything the Daily fixes for a daily seed (`daily-YYYY-MM-DD`): the Premier League season and the
 * host club (rotating through complete seasons and their clubs by the date), the formation, calibrated
 * difficulty, `DAILY_RULES` and `DAILY_SEASON` (January window on, no Continental Cup run). Pure: the same seed and data give the same settings on every device.
 */
export function dailySettings(u: LoadedUniverse, seed: string): DailySettings {
  const n = Number(seed.split('-').slice(1).join('')) || 0
  const complete = u.clubSeasons.filter((cs) => cs.complete && cs.leagueId === 'england' && !cs.classic)
  const seasons = [...new Set(complete.map((cs) => cs.season))].sort()
  const season = seasons[n % seasons.length]
  const clubs = complete.filter((cs) => cs.season === season).map((cs) => cs.clubId).sort()
  const host = clubs[(n * 7) % clubs.length]
  return { season, host, formationId: DAILY_FORMATIONS[(n * 3) % DAILY_FORMATIONS.length], leagueId: 'england', wheelLeagues: ['england'], difficulty: 'calibrated', rules: { ...DAILY_RULES, leagues: ['england'] }, seed, january: DAILY_SEASON.january, continental: DAILY_SEASON.continental }
}
