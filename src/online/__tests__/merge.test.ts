import { describe, expect, it } from 'vitest'
import { Rng } from '@engine/rng'
import type { LeaderboardEntry, Profile } from '@game/types'
import type { SeasonTier } from '@engine/types'
import { mergeProfile, mergeProfileDoc, mergeShortlist, previousDailyKey, streakOf, LEADERBOARD_CAP, type ProfileDoc } from '../core/merge'
import { canonicalJson } from '../core/canonical'

const TIERS: SeasonTier[] = ['CHAMPIONS', 'TITLE_RACE', 'EUROPEAN', 'MID_TABLE']

function emptyProfile(): Profile {
  return { achievements: {}, leaderboard: [], dailyStreak: 0, lastDailyDate: null, dailyResults: {}, gamesPlayed: 0, seasonsSimulated: 0, theme: 'auto', managerName: '' }
}

const day = (n: number) => `daily-${new Date(Date.UTC(2026, 9, 1) + n * 86400000).toISOString().slice(0, 10)}`

function entry(rng: Rng, id: string): LeaderboardEntry {
  return { id, date: `2026-10-${String(rng.int(1, 28)).padStart(2, '0')}`, mode: 'quick', teamName: 'XI', points: rng.int(40, 100), won: 20, drawn: 5, lost: rng.int(0, 15), position: rng.int(1, 20), tier: rng.pick(TIERS), seed: id, leagueSeason: 2020, hostClubId: 'arsenal', xi: [] }
}

/** A device playing on from `p`: it only adds records and raises counters, and may change a preference. */
function grow(rng: Rng, p: Profile, tag: string): Profile {
  const out: Profile = structuredClone(p)
  for (let i = rng.int(0, 3); i > 0; i--) out.achievements[`ach-${rng.int(1, 12)}`] ??= `2026-10-${String(rng.int(1, 28)).padStart(2, '0')}`
  for (let i = rng.int(0, 6); i > 0; i--) out.leaderboard.push(entry(rng, `${tag}-${rng.int(1, 1e6)}`))
  out.leaderboard.sort((a, b) => b.points - a.points || a.lost - b.lost)
  out.leaderboard = out.leaderboard.slice(0, LEADERBOARD_CAP)
  for (let i = rng.int(0, 3); i > 0; i--) {
    const k = day(rng.int(0, 20))
    if (!out.dailyResults[k]) {
      out.dailyResults[k] = { points: rng.int(40, 100), tier: rng.pick(TIERS) }
      if (!out.lastDailyDate || k > out.lastDailyDate) {
        out.dailyStreak = out.lastDailyDate === previousDailyKey(k) ? out.dailyStreak + 1 : 1
        out.lastDailyDate = k
      }
    }
  }
  out.gamesPlayed += rng.int(0, 4)
  out.seasonsSimulated += rng.int(0, 2)
  if (rng.next() < 0.3) out.theme = rng.pick(['auto', 'dark', 'light'] as const)
  if (rng.next() < 0.3) out.managerName = `Boss ${tag}${rng.int(1, 9)}`
  if (rng.next() < 0.5) out.seenTips = { ...(out.seenTips ?? {}), [`tip-${rng.int(1, 7)}`]: `2026-10-${String(rng.int(1, 28)).padStart(2, '0')}` }
  if (rng.next() < 0.4) {
    const t = out.trophies ?? { league: 0, cup: 0, continental: 0, doubles: 0, trebles: 0 }
    out.trophies = { ...t, league: t.league + rng.int(0, 2), cup: t.cup + rng.int(0, 1) }
  }
  return out
}

function doc(p: Profile, shortlist: string[] = []): ProfileDoc {
  return { v: 1, profile: p, shortlist }
}

const GROW_ONLY = ['achievements', 'seenTips', 'leaderboard', 'dailyResults', 'lastDailyDate', 'dailyStreak', 'gamesPlayed', 'seasonsSimulated', 'trophies'] as const
const growOnly = (p: Profile) => canonicalJson(Object.fromEntries(GROW_ONLY.map((k) => [k, p[k]])))

describe('profile merge', () => {
  const triples = Array.from({ length: 200 }, (_, i) => {
    const rng = new Rng(`merge-${i}`)
    const base = grow(rng, emptyProfile(), 'b')
    return { base, x: grow(rng, base, 'x'), y: grow(rng, base, 'y') }
  })

  it('merges records commutatively and keeps every record either side had (200 seeded triples)', () => {
    for (const { base, x, y } of triples) {
      const xy = mergeProfile(base, x, y)
      const yx = mergeProfile(base, y, x)
      expect(growOnly(xy)).toBe(growOnly(yx))
      for (const p of [x, y]) {
        for (const k of Object.keys(p.achievements)) expect(xy.achievements[k] <= p.achievements[k]).toBe(true)
        for (const k of Object.keys(p.dailyResults)) expect(xy.dailyResults[k].points).toBeGreaterThanOrEqual(p.dailyResults[k].points)
        expect(xy.gamesPlayed).toBeGreaterThanOrEqual(p.gamesPlayed)
        expect(xy.dailyStreak).toBeGreaterThanOrEqual(p.lastDailyDate === xy.lastDailyDate ? p.dailyStreak : 0)
      }
      expect(xy.leaderboard.length).toBeLessThanOrEqual(LEADERBOARD_CAP)
      for (let i = 1; i < xy.leaderboard.length; i++) {
        const a = xy.leaderboard[i - 1]
        const b = xy.leaderboard[i]
        expect(a.points > b.points || (a.points === b.points && a.lost <= b.lost)).toBe(true)
      }
    }
  })

  it('is idempotent: merging a merge again with either side changes no record', () => {
    for (const { base, x, y } of triples) {
      const m = mergeProfile(base, x, y)
      expect(growOnly(mergeProfile(base, m, y))).toBe(growOnly(m))
      expect(growOnly(mergeProfile(base, x, m))).toBe(growOnly(m))
    }
  })

  it('returns a side whole when the other has not moved: merge(base, x, x) is x, and a lone device never sees its profile change', () => {
    for (const { base, x, y } of triples) {
      expect(mergeProfileDoc(doc(base), doc(x), doc(x))).toEqual(doc(x))
      expect(mergeProfileDoc(doc(base), doc(x), doc(base))).toEqual(doc(x))
      expect(mergeProfileDoc(doc(base), doc(base), doc(y))).toEqual(doc(y))
      expect(mergeProfileDoc(null, doc(x), null)).toEqual(doc(x))
    }
  })

  it('counts a streak across devices: Monday and Tuesday on one, Wednesday on the other is three', () => {
    const a: Profile = { ...emptyProfile(), dailyResults: { [day(0)]: { points: 70, tier: 'EUROPEAN' }, [day(1)]: { points: 75, tier: 'EUROPEAN' } }, lastDailyDate: day(1), dailyStreak: 2 }
    const b: Profile = { ...emptyProfile(), dailyResults: { [day(2)]: { points: 60, tier: 'MID_TABLE' } }, lastDailyDate: day(2), dailyStreak: 1 }
    const m = mergeProfile(emptyProfile(), a, b)
    expect(m.lastDailyDate).toBe(day(2))
    expect(m.dailyStreak).toBe(3)
    expect(streakOf(m.dailyResults, day(2))).toBe(3)
    expect(streakOf(m.dailyResults, null)).toBe(0)
    // A gap breaks it; a longer streak on the side that holds the last day survives
    const c: Profile = { ...emptyProfile(), dailyResults: { [day(5)]: { points: 60, tier: 'MID_TABLE' } }, lastDailyDate: day(5), dailyStreak: 9 }
    expect(mergeProfile(emptyProfile(), a, c).dailyStreak).toBe(9)
    expect(previousDailyKey('daily-2026-03-01')).toBe('daily-2026-02-28')
    expect(previousDailyKey('garbage')).toBeNull()
  })

  it('keeps the higher score for a day both devices played, the earliest date per achievement and tip, and the best 50 results', () => {
    const rng = new Rng('merge-cap')
    const a: Profile = { ...emptyProfile(), achievements: { first: '2026-10-05' }, seenTips: { reel: '2026-10-09' }, dailyResults: { [day(3)]: { points: 70, tier: 'EUROPEAN' } }, leaderboard: Array.from({ length: 40 }, (_, i) => entry(rng, `a${i}`)) }
    const b: Profile = { ...emptyProfile(), achievements: { first: '2026-10-02', other: '2026-10-20' }, seenTips: { reel: '2026-10-12', key: '2026-10-01' }, dailyResults: { [day(3)]: { points: 82, tier: 'TITLE_RACE' } }, leaderboard: Array.from({ length: 40 }, (_, i) => entry(rng, `b${i}`)) }
    const m = mergeProfile(emptyProfile(), a, b)
    expect(m.achievements).toEqual({ first: '2026-10-02', other: '2026-10-20' })
    expect(m.seenTips).toEqual({ key: '2026-10-01', reel: '2026-10-09' })
    expect(m.dailyResults[day(3)].points).toBe(82)
    expect(m.leaderboard).toHaveLength(50)
    const best = [...a.leaderboard, ...b.leaderboard].sort((p, q) => q.points - p.points || p.lost - q.lost)[0]
    expect(m.leaderboard[0].points).toBe(best.points)
  })

  it('merges preferences three ways and keeps keys a later build added', () => {
    const base: Profile = { ...emptyProfile(), theme: 'auto', managerName: 'Minh' }
    const local: Profile = { ...base, theme: 'light' }
    const remote: Profile = { ...base, managerName: 'Minh H' }
    const m = mergeProfile(base, local, remote)
    expect(m.theme).toBe('light')
    expect(m.managerName).toBe('Minh H')
    expect(mergeProfile(base, { ...base, theme: 'dark' }, { ...base, theme: 'light' }).theme).toBe('dark')
    const newer = { ...remote, futureFlag: { on: true } } as Profile
    expect((mergeProfile(base, local, newer) as unknown as Record<string, unknown>).futureFlag).toEqual({ on: true })
    const baseWith = { ...base, futureFlag: 1 } as Profile
    const changed = mergeProfile(baseWith, { ...baseWith, futureFlag: 1 } as Profile, { ...baseWith, futureFlag: 2 } as Profile)
    expect((changed as unknown as Record<string, unknown>).futureFlag).toBe(2)
  })
})

describe('shortlist merge', () => {
  it('applies adds and removes made on either device since the base, and keeps the last 60', () => {
    expect(mergeShortlist(['a', 'b', 'c'], ['a', 'c', 'd'], ['a', 'b', 'c', 'e'])).toEqual(['a', 'c', 'd', 'e'])
    expect(mergeShortlist(['a', 'b'], ['a', 'b'], ['b'])).toEqual(['b'])
    expect(mergeShortlist(null, ['a'], ['b'])).toEqual(['a', 'b'])
    const many = Array.from({ length: 50 }, (_, i) => `l${i}`)
    const more = Array.from({ length: 50 }, (_, i) => `r${i}`)
    const m = mergeShortlist([], many, more)
    expect(m).toHaveLength(60)
    expect(m.at(-1)).toBe('r49')
  })
})
