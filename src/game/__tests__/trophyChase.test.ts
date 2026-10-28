import { describe, expect, it } from 'vitest'
import { badgeStates } from '@engine/badges'
import { emptyCabinet } from '../logic/cabinet'
import { emptyFeats } from '../logic/feats'
import { arenaDaysWon, milestoneStates, runInWeeksMet, weeklyTitles, type MilestoneInput } from '../logic/milestoneBadges'
import { countLine, earnedKeys, freshUnlocks, nextToChase, REVEAL_BASELINE, trophyItems, unlockShareText } from '../logic/trophyChase'
import type { Cabinet, LeaderboardEntry, Profile, RunInEntry } from '../types'

const profile = (o: Partial<Profile> = {}): MilestoneInput['profile'] => ({ achievements: {}, leaderboard: [], seasonsSimulated: 0, dailyResults: {}, ...o })
const entry = (o: Partial<LeaderboardEntry>): LeaderboardEntry => ({ id: 'x', date: '2026-10-28', mode: 'quick', teamName: 'T', points: 80, won: 25, drawn: 5, lost: 8, position: 1, tier: 'CHAMPIONS', seed: 's', leagueSeason: 2020, hostClubId: 'arsenal', xi: [], ...o })
const states = (cabinet: Cabinet, p = profile()) => milestoneStates({ cabinet, profile: p })
const of = (s: ReturnType<typeof states>, id: string) => s.find((x) => x.badge.id === id)!
const items = (cabinet: Cabinet, p = profile()) => trophyItems(badgeStates(cabinet, { leaguesWon: 0 }), milestoneStates({ cabinet, profile: p }))

describe('r8 milestones', () => {
  it('read the cabinet’s feats', () => {
    const cabinet: Cabinet = { ...emptyCabinet(), h2hOnline: { played: 12, won: 10 }, feats: { ...emptyFeats(), groupsWon: 5, groupsPerfect: 1, comebacks: 3, dynastyBest: 10, graduates: 1, classicTitles: 2, cappedTitles: 3, thriftyTitles: 1, seasonsTitled: [1992, 2010, 2015], perfectDrafts: ['a'] } }
    const s = states(cabinet)
    expect(of(s, 'group-winners').tier).toBe('silver')
    expect(of(s, 'six-from-six').tier).toBe('gold')
    expect(of(s, 'comeback-kings').tier).toBe('silver')
    expect(of(s, 'dynasty-builder').tier).toBe('silver')
    expect(of(s, 'academy').tier).toBe('bronze')
    expect(of(s, 'through-the-ages').tier).toBe('bronze')
    expect(of(s, 'class-of-92').tier).toBe('gold')
    expect(of(s, 'bargain-hunter').tier).toBe('bronze')
    expect(of(s, 'perfect-draft').tier).toBe('bronze')
    expect(of(s, 'online-victor').tier).toBe('silver')
    // Old School and Moneyball: the cabinet's count beats a board that has lost them
    expect(of(s, 'old-school').value).toBe(2)
    expect(of(s, 'moneyball').value).toBe(3)
  })

  it('keep the board’s count as a floor for a cabinet before the feats', () => {
    const p = profile({ leaderboard: [entry({ leagueSeason: 1995 }), entry({ leagueSeason: 1992, id: 'b' }), entry({ budget: 200, spent: 190, id: 'c' })] })
    const s = states(emptyCabinet(), p)
    expect(of(s, 'old-school').value).toBe(2)
    expect(of(s, 'moneyball').value).toBe(1)
    expect(of(s, 'class-of-92').tier).toBe('gold')
  })

  it('count the Daily Arena, the Weekly and the Run-in of the week from the local results, one per day or week', () => {
    const p = profile({
      arenaDaily: { streak: 2, last: 'arena-2026-10-27', results: { 'arena-2026-10-26': { format: 'cup', score: 4, label: 'Winners' }, 'arena-2026-10-27': { format: 'cup', score: 3, label: 'Final' }, 'arena-2026-10-28': { format: 'gauntlet', score: 15, label: '15 rungs' }, 'arena-2026-10-25': { format: 'gauntlet', score: 9, label: '9 rungs' } } },
      weekly: { streak: 1, last: 'weekly-2026-W43', results: { 'weekly-2026-W42': { points: 90, tier: 'CHAMPIONS' }, 'weekly-2026-W43': { points: 70, tier: 'TITLE_RACE' }, 'weekly-2026-W44': { points: 114, tier: 'PERFECT' } } },
      runIns: [{ seed: 'runin-2026-W43', met: true }, { seed: 'runin-2026-W43', met: true }, { seed: 'runin-2026-W44', met: false }, { seed: 'own', met: true }] as RunInEntry[],
    })
    const input = { cabinet: { ...emptyCabinet(), feats: { ...emptyFeats(), runInWeeks: ['2026-W40', '2026-W43'] } }, profile: p }
    expect(arenaDaysWon(input)).toBe(2)
    expect(weeklyTitles(input)).toBe(2)
    expect(runInWeeksMet(input)).toBe(2)
  })
})

describe('the unlock moment', () => {
  it('reveals a new badge or tier once, best tier first', () => {
    const before = items(emptyCabinet())
    expect(freshUnlocks([], before).fresh).toEqual([])
    const after = items({ ...emptyCabinet(), league: 5, invincible: 1 })
    const plan = freshUnlocks(earnedKeys(before), after)
    expect(plan.baseline).toBe(false)
    expect(plan.fresh.map((i) => i.key)).toEqual(['serial-winner:silver', 'invincibles:bronze'])
    expect(freshUnlocks(earnedKeys(after), after).fresh).toEqual([])
    // Silver earned after bronze was seen: only the new tier
    const bronze = items({ ...emptyCabinet(), league: 1 })
    expect(freshUnlocks(earnedKeys(bronze), items({ ...emptyCabinet(), league: 5 })).fresh.map((i) => i.key)).toEqual(['serial-winner:silver'])
  })

  it('takes an older career as the baseline on a viewer’s first look, but shows a new player their first', () => {
    const career = items({ ...emptyCabinet(), league: 20, cup: 5, perfect: 3, invincible: 3 })
    expect(earnedKeys(career).length).toBeGreaterThan(REVEAL_BASELINE)
    expect(freshUnlocks(null, career)).toEqual({ fresh: [], baseline: true })
    const first = items({ ...emptyCabinet(), league: 1 })
    expect(freshUnlocks(null, first).fresh.map((i) => i.key)).toEqual(['serial-winner:bronze'])
  })

  it('points at the nearest next tiers, never a gold or a stamp', () => {
    const c: Cabinet = { ...emptyCabinet(), league: 4, centurions: 15, cup: 1 }
    const next = nextToChase(items(c), 3)
    expect(next.map((i) => i.id)).toEqual(['serial-winner', 'cup-collector', 'perfectionist'])
    for (const i of nextToChase(items(c), 50)) {
      expect(i.tier).not.toBe('gold')
      expect(i.stamp).toBe(false)
    }
  })

  it('words a share in English, one or many', () => {
    const [serial] = items({ ...emptyCabinet(), league: 1 })
    expect(unlockShareText(serial, 'Pep')).toBe('🏅 Pep unlocked Serial Winner (Bronze) in the TouchLine Trophy Room: 1 league title.')
    expect(unlockShareText({ ...serial, value: 5, tier: 'silver' }, '  ')).toContain('The Gaffer unlocked Serial Winner (Silver)')
    expect(countLine(1, 'two-legged ties won after losing the first leg')).toBe('1 two-legged tie won after losing the first leg')
    const stamp = items({ ...emptyCabinet(), feats: { ...emptyFeats(), groupsPerfect: 1 } }).find((i) => i.id === 'six-from-six')!
    expect(unlockShareText(stamp, 'Pep')).toBe('🏅 Pep unlocked Six from Six in the TouchLine Trophy Room: a Continental Cup group stage with every match won.')
  })
})
