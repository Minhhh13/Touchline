/**
 * What this viewer has seen unlock in the Trophy Room: its own localStorage key (`touchline-trophies-revealed`), per
 * device, never the save. The summaries reveal what is new (`components/BadgeUnlocks.tsx`); the Trophy Room marks it
 * new once, then seen. Presentation only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { badgeStates } from '@engine/badges'
import type { LoadedUniverse } from '@engine/universe'
import { leaguesWon, normaliseCabinet } from '@game/logic/cabinet'
import { milestoneStates } from '@game/logic/milestoneBadges'
import { earnedKeys, freshUnlocks, trophyItems, type TrophyItem } from '@game/logic/trophyChase'
import type { Profile } from '@game/types'

export const TROPHIES_REVEALED_KEY = 'touchline-trophies-revealed'

export function readRevealed(): string[] | null {
  try {
    const raw = localStorage.getItem(TROPHIES_REVEALED_KEY)
    const v: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null
  } catch {
    return null
  }
}

export function writeRevealed(keys: readonly string[]): void {
  try {
    localStorage.setItem(TROPHIES_REVEALED_KEY, JSON.stringify([...new Set(keys)]))
  } catch {
    // Storage blocked: the same unlock shows again next time
  }
}

/** Every badge and milestone of a profile, leagues won in from the loaded clubs (`extraLeague` places the rest). */
export function profileTrophyItems(profile: Profile, u: LoadedUniverse | null, extraLeague?: (clubId: string) => string | undefined): TrophyItem[] {
  const cabinet = normaliseCabinet(profile.cabinet ?? {})
  const won = leaguesWon(cabinet, profile.leaderboard, (id) => u?.clubById[id]?.leagueId ?? extraLeague?.(id))
  return trophyItems(badgeStates(cabinet, { leaguesWon: won.leagues.length }), milestoneStates({ cabinet, profile }))
}

/**
 * The unlocks this viewer has not seen yet, read once per change of what is earned, and `markSeen` to file every
 * earned key as seen. A viewer with no record and an older career takes it as its baseline, silently.
 */
export function useTrophyReveal(items: readonly TrophyItem[]): { fresh: TrophyItem[]; markSeen: () => void } {
  const earned = earnedKeys(items)
  const sig = earned.join('|')
  const [seenSig, setSeenSig] = useState<string | null>(null)
  const fresh = useMemo(() => {
    const plan = freshUnlocks(readRevealed(), items)
    if (plan.baseline) writeRevealed(earned)
    return plan.fresh
    // Read again only when what is earned changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])
  const markSeen = useCallback(() => {
    writeRevealed([...(readRevealed() ?? []), ...earned])
    setSeenSig(sig)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])
  return { fresh: seenSig === sig ? [] : fresh, markSeen }
}

/** The leave-filing behind `useSeenOnLeave`, apart from React so it can be tested: mount, unmount, the Trophy Room. */
export function makeLeaveFiler(file: () => void): { mount: () => void; unmount: () => void; toRoom: () => void } {
  let alive = false
  let room = false
  return {
    mount: () => void (alive = true),
    unmount: () => {
      alive = false
      // A remount in the same commit (React's StrictMode) comes back before the microtask: nothing is filed then
      queueMicrotask(() => {
        if (!alive && !room) file()
      })
    },
    toRoom: () => void (room = true),
  }
}

/**
 * An unlock card shown on one result is filed as seen when the viewer leaves that result, Got it or not: closed
 * without it, the same badge used to come back as new on the next result, even a runner-up season (playtest round 2,
 * P10). `toRoom` is called before opening the Trophy Room, which marks the new tiles New and files them itself.
 */
export function useSeenOnLeave(shown: boolean, earned: readonly string[]): { toRoom: () => void } {
  const keys = useRef(earned)
  keys.current = earned
  const [filer] = useState(() => makeLeaveFiler(() => writeRevealed([...(readRevealed() ?? []), ...keys.current])))
  useEffect(() => {
    if (!shown) return
    filer.mount()
    return filer.unmount
  }, [shown, filer])
  return { toRoom: filer.toRoom }
}
