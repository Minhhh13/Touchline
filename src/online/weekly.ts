/**
 * The weekly fixed-seed challenge (the world leaderboard's other board): one puzzle per ISO week, Monday 00:00 UTC
 * to the next Monday, seed `weekly-YYYY-Www`. Everyone plays the same Quick Draft that week; the Edge Function pins
 * the settings at the first ranked request and verifies every post by replay, exactly as for the Daily.
 *
 * The mapping below decides the puzzle: changing it changes the current week's puzzle for everyone, so treat it like
 * the Daily mapping (CLAUDE.md invariant 4) and never edit it mid-week. Pure.
 */
import { hashString } from '@engine/rng'
import type { LoadedUniverse } from '@engine/universe'
import type { GameSettings } from '@game/types'
import { DAILY_FORMATIONS, shortNameFor } from '@game/logic/setup'
import { DAILY_RULES, DAILY_SEASON } from '@game/logic/daily'

const DAY = 86400000

/** The ISO week of a date (UTC) as `YYYY-Www`, the same as Postgres' `to_char(d, 'IYYY-"W"IW')`. */
export function weekKeyOf(date: Date): string {
  const d = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  const dow = (new Date(d).getUTCDay() + 6) % 7
  const thursday = new Date(d + (3 - dow) * DAY)
  const year = thursday.getUTCFullYear()
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** The Monday (UTC) a week key starts on, or null for anything that is not one. */
export function weekStartOf(key: string): Date | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(key)
  if (!m) return null
  const year = Number(m[1])
  const week = Number(m[2])
  if (week < 1 || week > 53) return null
  const jan4 = Date.UTC(year, 0, 4)
  const monday1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY
  const start = new Date(monday1 + (week - 1) * 7 * DAY)
  return weekKeyOf(start) === key ? start : null
}

export const weeklySeed = (key: string) => `weekly-${key}`

/** The week key of a weekly seed, or null for any other seed. */
export function weekKeyOfSeed(seed: string): string | null {
  const m = /^weekly-(\d{4}-W\d{2})$/.exec(seed)
  return m && weekStartOf(m[1]) ? m[1] : null
}

/** Posts are accepted from the Monday until 00:00 UTC on the Tuesday after the week (one day of grace). */
export function weeklyIsOpen(key: string, now: Date): boolean {
  const start = weekStartOf(key)
  if (!start) return false
  return now.getTime() >= start.getTime() && now.getTime() < start.getTime() + 8 * DAY
}

/**
 * The week's fixed settings: an England wheel, a complete English season, a host club and a shape, each chosen by
 * the week key's hash (the Daily's date digits would make neighbouring weeks too alike), the Daily's rules and season
 * options (one re-spin, twists, the January window, no Continental Cup run), calibrated. Only the team name is the player's.
 */
export function weeklyGameSettings(u: LoadedUniverse, key: string, teamName = 'Touchline XI'): GameSettings {
  const n = hashString(weeklySeed(key))
  const complete = u.clubSeasons.filter((cs) => cs.complete && cs.leagueId === 'england')
  const seasons = [...new Set(complete.map((cs) => cs.season))].sort()
  const season = seasons[n % seasons.length]
  const clubs = complete.filter((cs) => cs.season === season).map((cs) => cs.clubId).sort()
  const host = clubs[Math.floor(n / 64) % clubs.length]
  const formationId = DAILY_FORMATIONS[Math.floor(n / 4096) % DAILY_FORMATIONS.length]
  const name = teamName.trim() || 'Touchline XI'
  return {
    mode: 'quick',
    seed: weeklySeed(key),
    formationId,
    teamName: name,
    shortName: shortNameFor(name),
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: host,
    leagueSeason: season,
    // The Daily's own rules and season options, written out in full there (DAILY_RULES, DAILY_SEASON), never the quick
    // defaults: a later change to Quick Draft can never move a week's puzzle under the players
    rules: { ...DAILY_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    continental: DAILY_SEASON.continental,
    january: DAILY_SEASON.january,
  }
}
