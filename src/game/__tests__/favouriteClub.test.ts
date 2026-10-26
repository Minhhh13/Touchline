import { describe, expect, it, vi } from 'vitest'
import { mergeProfile } from '../../online/core/merge'
import type { Profile } from '../types'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const m = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) },
    configurable: true,
  })
})
import { useStore } from '../store'

// A profile saved before the field existed
const oldProfile: Profile = { achievements: {}, leaderboard: [], dailyStreak: 0, lastDailyDate: null, dailyResults: {}, gamesPlayed: 3, seasonsSimulated: 2, theme: 'auto', managerName: 'Old Save' }

describe('the favourite club on the profile (account setup step)', () => {
  it('is optional: an old profile has none, setting and clearing it leaves the rest alone', () => {
    useStore.setState({ profile: oldProfile })
    expect(useStore.getState().profile.favouriteClub).toBeUndefined()
    useStore.getState().setFavouriteClub('arsenal')
    expect(useStore.getState().profile).toEqual({ ...oldProfile, favouriteClub: 'arsenal' })
    useStore.getState().setFavouriteClub(null)
    expect(useStore.getState().profile).toEqual(oldProfile)
    expect('favouriteClub' in useStore.getState().profile).toBe(false)
  })

  it('syncs like any later key: a change on one device wins, a newer device keeps it against an older one', () => {
    const base = { ...oldProfile }
    expect(mergeProfile(base, { ...base, favouriteClub: 'arsenal' }, base).favouriteClub).toBe('arsenal')
    expect(mergeProfile(base, base, { ...base, favouriteClub: 'fulham' }).favouriteClub).toBe('fulham')
    expect(mergeProfile({ ...base, favouriteClub: 'arsenal' }, { ...base, favouriteClub: 'arsenal' }, { ...base, favouriteClub: 'fulham' }).favouriteClub).toBe('fulham')
  })
})
