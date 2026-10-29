import { describe, expect, it, vi } from 'vitest'
import { TIP_AFTER, TIP_IDS, tipDue, tipInTurn, tipSeen, tipsSeenCount, withAllTipsSeen, withTipSeen } from '../logic/tips'
import type { Profile } from '../types'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
const mem = vi.hoisted(() => {
  const m = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) },
    configurable: true,
  })
  return m
})
import { SAVE_KEY, saveStorage, useStore } from '../store'
import { parseSave } from '../saveStorage'

const oldProfile: Profile = {
  achievements: {},
  leaderboard: [],
  dailyStreak: 0,
  lastDailyDate: null,
  dailyResults: {},
  gamesPlayed: 3,
  seasonsSimulated: 2,
  theme: 'auto',
  managerName: 'Old Save',
}

describe('coach marks', () => {
  it('has fourteen distinct tips: the eight core ones first, the recap\'s after the bench\'s, then the feature tips', () => {
    expect(TIP_IDS).toHaveLength(14)
    expect(new Set(TIP_IDS).size).toBe(14)
    expect(TIP_IDS.indexOf('draft-recap')).toBe(TIP_IDS.indexOf('draft-bench') + 1)
    expect(TIP_IDS.slice(0, 8)).toEqual(['draft-first-reveal', 'draft-bench', 'draft-recap', 'dugout-first', 'tactics-first', 'halftime-first', 'report-first', 'market-first'])
    // Every gate names a tip that exists
    for (const id of Object.keys(TIP_AFTER)) expect(TIP_IDS).toContain(id)
  })

  it('a feature tip waits for its moment: the core tips from the start, share and feats from the second result', () => {
    for (const id of TIP_IDS.slice(0, 8)) expect(tipDue(id, 0)).toBe(true)
    expect(tipDue('daily-rotation', 0)).toBe(true)
    expect(tipDue('office-first', 0)).toBe(true)
    expect(tipDue('explore-first', 0)).toBe(false)
    expect(tipDue('explore-first', 1)).toBe(true)
    expect(tipDue('dock-first', 1)).toBe(true)
    expect(tipDue('share-first', 1)).toBe(false)
    expect(tipDue('feats-first', 1)).toBe(false)
    expect(tipDue('share-first', 2)).toBe(true)
    expect(tipDue('feats-first', 2)).toBe(true)
    // Not yet due: it neither shows nor holds back the next one on screen
    expect(tipInTurn(oldProfile, ['share-first', 'feats-first'], 1)).toBeNull()
    expect(tipInTurn(oldProfile, ['share-first', 'explore-first'], 1)).toBe('explore-first')
    expect(tipInTurn(oldProfile, ['share-first', 'explore-first'], 2)).toBe('share-first')
    // A core tip on screen goes first whatever the count
    expect(tipInTurn(oldProfile, ['dock-first', 'draft-recap'], 3)).toBe('draft-recap')
    // Called without a count (an older caller), every tip is due
    expect(tipInTurn(oldProfile, ['share-first'])).toBe('share-first')
  })

  it('an older profile without seenTips has every tip unseen', () => {
    for (const id of TIP_IDS) expect(tipSeen(oldProfile, id)).toBe(false)
    expect(tipsSeenCount(oldProfile)).toBe(0)
  })

  it('marking a tip seen records the date once and leaves the others alone', () => {
    const a = withTipSeen(oldProfile, 'draft-first-reveal', '2026-10-01')
    expect(a.seenTips).toEqual({ 'draft-first-reveal': '2026-10-01' })
    expect(tipSeen(a, 'draft-first-reveal')).toBe(true)
    expect(tipSeen(a, 'draft-bench')).toBe(false)
    // The original is not changed, and a second dismissal keeps the first date (same object back)
    expect(oldProfile.seenTips).toBeUndefined()
    expect(withTipSeen(a, 'draft-first-reveal', '2026-10-09')).toBe(a)
    const b = withTipSeen(a, 'market-first', '2026-10-09')
    expect(b.seenTips).toEqual({ 'draft-first-reveal': '2026-10-01', 'market-first': '2026-10-09' })
    expect(tipsSeenCount(b)).toBe(2)
    // Unrelated profile fields are carried over untouched
    expect(b.managerName).toBe('Old Save')
    expect(b.gamesPlayed).toBe(3)
  })

  it('the store dismisses a tip with an ISO date, keeps it across a second tap, and resets them all', () => {
    useStore.setState({ profile: { ...oldProfile } })
    useStore.getState().dismissTip('dugout-first')
    const date = useStore.getState().profile.seenTips?.['dugout-first']
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const before = useStore.getState().profile
    useStore.getState().dismissTip('dugout-first')
    expect(useStore.getState().profile).toBe(before)
    useStore.getState().dismissTip('halftime-first')
    expect(tipsSeenCount(useStore.getState().profile)).toBe(2)
    useStore.getState().resetTips()
    const after = useStore.getState().profile
    expect(tipsSeenCount(after)).toBe(0)
    for (const id of TIP_IDS) expect(tipSeen(after, id)).toBe(false)
    expect(after.managerName).toBe('Old Save')
  })

  it('dismissed tips are saved with the profile and come back on reload; an older save loads with none dismissed', async () => {
    useStore.setState({ profile: { ...oldProfile } })
    useStore.getState().dismissTip('report-first')
    // Writes are coalesced and compressed: flush the pending one, then read the stored save back
    saveStorage.flush()
    const saved = parseSave<{ profile?: Profile }>(mem.get(SAVE_KEY) ?? '')
    expect(saved.state.profile?.seenTips?.['report-first']).toBeTruthy()

    // An older save: the same shape, without the field
    mem.set(SAVE_KEY, JSON.stringify({ state: { game: null, parked: {}, shortlist: [], h2h: null, profile: oldProfile, screen: 'home' }, version: 1 }))
    await useStore.persist.rehydrate()
    const p = useStore.getState().profile
    expect(p.managerName).toBe('Old Save')
    expect(p.seenTips).toBeUndefined()
    expect(tipsSeenCount(p)).toBe(0)
    useStore.getState().dismissTip('tactics-first')
    expect(tipSeen(useStore.getState().profile, 'tactics-first')).toBe(true)
  })

  it('shows one tip at a time: the first on screen in TIP_IDS order that is not dismissed', () => {
    expect(tipInTurn(oldProfile, [])).toBeNull()
    expect(tipInTurn(oldProfile, ['draft-recap', 'draft-bench'])).toBe('draft-bench')
    const benchSeen = withTipSeen(oldProfile, 'draft-bench', '2026-10-28')
    expect(tipInTurn(benchSeen, ['draft-recap', 'draft-bench'])).toBe('draft-recap')
    expect(tipInTurn(withTipSeen(benchSeen, 'draft-recap', '2026-10-28'), ['draft-recap', 'draft-bench'])).toBeNull()
  })

  it("'No more tips' dismisses every tip, keeps a first date, and the store's reset brings them back", () => {
    const one = withTipSeen(oldProfile, 'dugout-first', '2026-10-01')
    const all = withAllTipsSeen(one, '2026-10-28')
    expect(tipsSeenCount(all)).toBe(TIP_IDS.length)
    expect(all.seenTips?.['dugout-first']).toBe('2026-10-01')
    expect(tipInTurn(all, [...TIP_IDS])).toBeNull()
    useStore.setState({ profile: { ...oldProfile } })
    useStore.getState().dismissAllTips()
    expect(tipsSeenCount(useStore.getState().profile)).toBe(TIP_IDS.length)
    const before = useStore.getState().profile
    useStore.getState().dismissAllTips()
    expect(useStore.getState().profile).toBe(before)
    useStore.getState().resetTips()
    expect(tipsSeenCount(useStore.getState().profile)).toBe(0)
  })
})
