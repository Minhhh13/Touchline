/**
 * Merging the synced profile document across devices: `mergeProfileDoc(base, local, remote)`, where `base` is what
 * this device last agreed with the cloud. Records only grow (achievements, tips, the leaderboard, Daily results and
 * the counters merge as unions and maxima, so it does not matter which device played what), preferences merge
 * three ways (a change since the base wins over no change; the local change wins when both changed), and when only
 * one side changed since the base, that side is taken whole, so a device that is the only one playing never sees
 * its own profile altered by a sync. Pure.
 */
import type { LeaderboardEntry, Profile } from '@game/types'
import { canonicalJson } from './canonical'

export interface ProfileDoc {
  v: 1
  profile: Profile
  shortlist: string[]
}

/** The store keeps the 60 most recent shortlist ids and the best 50 results; the merge keeps the same caps. */
export const SHORTLIST_CAP = 60
export const LEADERBOARD_CAP = 50

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)

/** Union of two id-to-date maps, keeping the earlier date for an id both hold. */
function earliest(a: Record<string, string> | undefined, b: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = { ...(a ?? {}) }
  for (const [k, v] of Object.entries(b ?? {})) if (!(k in out) || v < out[k]) out[k] = v
  return sortKeys(out)
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const k of Object.keys(o).sort()) out[k] = o[k]
  return out
}

/** The store's order (points, then fewer defeats), made total by date and id so both devices sort alike. */
function leaderboardOrder(a: LeaderboardEntry, b: LeaderboardEntry): number {
  return b.points - a.points || a.lost - b.lost || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

function mergeLeaderboard(a: LeaderboardEntry[], b: LeaderboardEntry[]): LeaderboardEntry[] {
  const byId = new Map<string, LeaderboardEntry>()
  for (const e of [...a, ...b]) {
    const have = byId.get(e.id)
    // The same game filed twice is the same entry; keep one deterministically
    if (!have || canonicalJson(e) < canonicalJson(have)) byId.set(e.id, e)
  }
  return [...byId.values()].sort(leaderboardOrder).slice(0, LEADERBOARD_CAP)
}

type DailyResults = Profile['dailyResults']

function mergeDailyResults(a: DailyResults, b: DailyResults): DailyResults {
  const out: DailyResults = { ...a }
  for (const [day, r] of Object.entries(b)) {
    const have = out[day]
    if (!have || r.points > have.points || (r.points === have.points && r.tier < have.tier)) out[day] = r
  }
  return sortKeys(out)
}

/** The day before a `daily-YYYY-MM-DD` key, or null for anything else. */
export function previousDailyKey(key: string): string | null {
  const m = /^daily-(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 86400000
  return `daily-${new Date(t).toISOString().slice(0, 10)}`
}

/** Consecutive Daily keys in `results` ending at `last` (0 when `last` is not in it). */
export function streakOf(results: DailyResults, last: string | null): number {
  let n = 0
  for (let k: string | null = last; k && results[k]; k = previousDailyKey(k)) n++
  return n
}

const laterKey = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b)

function maxTrophies(a: Profile['trophies'], b: Profile['trophies']): Profile['trophies'] {
  if (!a) return b
  if (!b) return a
  return { league: Math.max(a.league, b.league), cup: Math.max(a.cup, b.cup), continental: Math.max(a.continental, b.continental), doubles: Math.max(a.doubles, b.doubles), trebles: Math.max(a.trebles, b.trebles) }
}

/** Three-way merge of one value: the side that changed since the base; local when both did. */
function threeWay<T>(base: T | undefined, local: T, remote: T): T {
  if (base !== undefined && same(local, base)) return remote
  return local
}

/** Three-way set merge of the shortlist: adds and removes made on either device since the base, local order first. */
export function mergeShortlist(base: string[] | null, local: string[], remote: string[]): string[] {
  const b = new Set(base ?? [])
  const l = new Set(local)
  const r = new Set(remote)
  const removed = new Set([...b].filter((x) => !l.has(x) || !r.has(x)))
  const out: string[] = []
  for (const x of [...local, ...remote]) if (!removed.has(x) && !out.includes(x)) out.push(x)
  return out.slice(-SHORTLIST_CAP)
}

const KNOWN_KEYS = new Set(['achievements', 'seenTips', 'leaderboard', 'dailyResults', 'lastDailyDate', 'dailyStreak', 'gamesPlayed', 'seasonsSimulated', 'trophies', 'theme', 'managerName'])

/** Merge two devices' profiles against the last agreed one. */
export function mergeProfile(base: Profile | null, local: Profile, remote: Profile): Profile {
  const dailyResults = mergeDailyResults(local.dailyResults ?? {}, remote.dailyResults ?? {})
  const lastDailyDate = laterKey(local.lastDailyDate ?? null, remote.lastDailyDate ?? null)
  const dailyStreak = Math.max(local.lastDailyDate === lastDailyDate ? local.dailyStreak : 0, remote.lastDailyDate === lastDailyDate ? remote.dailyStreak : 0, streakOf(dailyResults, lastDailyDate))
  const out: Profile = {
    ...local,
    achievements: earliest(local.achievements, remote.achievements),
    leaderboard: mergeLeaderboard(local.leaderboard ?? [], remote.leaderboard ?? []),
    dailyStreak,
    lastDailyDate,
    dailyResults,
    gamesPlayed: Math.max(local.gamesPlayed ?? 0, remote.gamesPlayed ?? 0),
    seasonsSimulated: Math.max(local.seasonsSimulated ?? 0, remote.seasonsSimulated ?? 0),
    theme: threeWay(base?.theme, local.theme, remote.theme),
    managerName: threeWay(base?.managerName, local.managerName, remote.managerName),
  }
  const trophies = maxTrophies(local.trophies, remote.trophies)
  if (trophies) out.trophies = trophies
  if (local.seenTips || remote.seenTips) out.seenTips = earliest(local.seenTips, remote.seenTips)
  // Keys a later build adds: three-way, so a newer device's field survives an older device's sync
  const l = local as unknown as Record<string, unknown>
  const r = remote as unknown as Record<string, unknown>
  const b = (base ?? {}) as unknown as Record<string, unknown>
  const o = out as unknown as Record<string, unknown>
  for (const key of new Set([...Object.keys(l), ...Object.keys(r)])) {
    if (KNOWN_KEYS.has(key)) continue
    if (!(key in l)) o[key] = r[key]
    else if (key in r) o[key] = threeWay(key in b ? b[key] : undefined, l[key], r[key])
  }
  return out
}

/** Merge the synced document: one side whole when only it changed since the base, otherwise field by field. */
export function mergeProfileDoc(base: ProfileDoc | null, local: ProfileDoc, remote: ProfileDoc | null): ProfileDoc {
  if (!remote || same(local, remote)) return local
  if (base && same(remote, base)) return local
  if (base && same(local, base)) return remote
  return { v: 1, profile: mergeProfile(base?.profile ?? null, local.profile, remote.profile), shortlist: mergeShortlist(base?.shortlist ?? null, local.shortlist, remote.shortlist) }
}
