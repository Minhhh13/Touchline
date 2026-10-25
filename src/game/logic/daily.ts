import type { LoadedUniverse } from '@engine/universe'
import { QUICK_RULES, withDifficulty, type DraftRules } from '@engine/draft'

/** Shapes the Daily rotates through, one a day. */
export const DAILY_FORMATIONS: readonly string[] = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '4-4-2-diamond']

/**
 * The Daily's draft rules, pinned in full so a later change to `QUICK_RULES` or a new option can
 * never make two players' Dailies differ: normal difficulty (1 re-spin), ratings shown, Squad First,
 * season ratings, twists on, all-time, every club and nationality, the Premier League wheel.
 */
export const DAILY_RULES: DraftRules = {
  ...withDifficulty(QUICK_RULES, 'normal'),
  squadSize: 11,
  minFit: 'accomplished',
  uniqueClubSeasons: true,
  twists: true,
  showRatings: true,
  draftMode: 'squad',
  ratings: 'season',
  fromSeason: undefined,
  toSeason: undefined,
  onlyClub: undefined,
  onlyNation: undefined,
  leagues: ['england'],
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
}

/**
 * Everything the Daily fixes for a daily seed (`daily-YYYY-MM-DD`): the Premier League season and the
 * host club (rotating through complete seasons and their clubs by the date), the formation, calibrated
 * difficulty and `DAILY_RULES`. Pure: the same seed and data give the same settings on every device.
 */
export function dailySettings(u: LoadedUniverse, seed: string): DailySettings {
  const n = Number(seed.split('-').slice(1).join('')) || 0
  const complete = u.clubSeasons.filter((cs) => cs.complete && cs.leagueId === 'england')
  const seasons = [...new Set(complete.map((cs) => cs.season))].sort()
  const season = seasons[n % seasons.length]
  const clubs = complete.filter((cs) => cs.season === season).map((cs) => cs.clubId).sort()
  const host = clubs[(n * 7) % clubs.length]
  return { season, host, formationId: DAILY_FORMATIONS[(n * 3) % DAILY_FORMATIONS.length], leagueId: 'england', wheelLeagues: ['england'], difficulty: 'calibrated', rules: { ...DAILY_RULES, leagues: ['england'] }, seed }
}
