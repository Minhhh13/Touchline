import type { Profile } from '../types'

/**
 * The coach marks: one short callout the first time each screen or mechanic is met. The first eight teach the core
 * loop (the draft, the Dugout, the match); the rest introduce round 8's features (the Daily's rotating league, the
 * Office, sharing a result to be beaten, the Trophy Room's feats, Explore and the phone's dock), each only once the
 * player has finished enough to need it (`TIP_AFTER`), so the first draft carries the core tips alone.
 */
export const TIP_IDS = ['draft-first-reveal', 'draft-bench', 'draft-recap', 'dugout-first', 'tactics-first', 'halftime-first', 'report-first', 'market-first', 'daily-rotation', 'office-first', 'share-first', 'feats-first', 'explore-first', 'dock-first'] as const

export type TipId = (typeof TIP_IDS)[number]

/**
 * Results a profile must have finished before a tip may show (`resultsFinished` in onboarding.ts); a tip not listed
 * shows from the start. The share tip and the feats tip wait for a second result: the first one's summary already
 * carries its celebration, its first badges and the next steps, and one more callout there is the nagging tips replace.
 */
export const TIP_AFTER: Partial<Record<TipId, number>> = { 'share-first': 2, 'feats-first': 2, 'explore-first': 1, 'dock-first': 1 }

/** Whether this tip has been dismissed on this profile (an older save has none dismissed). */
export function tipSeen(profile: Pick<Profile, 'seenTips'>, id: TipId): boolean {
  return !!profile.seenTips?.[id]
}

/** Whether a profile with `finished` results has met this tip's moment (`TIP_AFTER`). */
export function tipDue(id: TipId, finished: number): boolean {
  return finished >= (TIP_AFTER[id] ?? 0)
}

/** The profile with this tip marked seen on `date`; a tip already dismissed keeps its first date. */
export function withTipSeen<P extends Pick<Profile, 'seenTips'>>(profile: P, id: TipId, date: string): P {
  if (tipSeen(profile, id)) return profile
  return { ...profile, seenTips: { ...(profile.seenTips ?? {}), [id]: date } }
}

/** How many of the tips this profile has dismissed. */
export function tipsSeenCount(profile: Pick<Profile, 'seenTips'>): number {
  return TIP_IDS.filter((id) => tipSeen(profile, id)).length
}

/**
 * Which of the tips on screen right now gets shown: one at a time, the first in `TIP_IDS` order that is not yet
 * dismissed and is due for a profile with `finished` results; the rest wait their turn (each comes up once the one
 * before it is dismissed or leaves the screen). `finished` defaults to every tip being due.
 */
export function tipInTurn(profile: Pick<Profile, 'seenTips'>, mounted: readonly TipId[], finished = Infinity): TipId | null {
  return TIP_IDS.find((id) => mounted.includes(id) && !tipSeen(profile, id) && tipDue(id, finished)) ?? null
}

/** The profile with every tip dismissed on `date` ('No more tips'); tips already dismissed keep their first date. */
export function withAllTipsSeen<P extends Pick<Profile, 'seenTips'>>(profile: P, date: string): P {
  return TIP_IDS.reduce((p, id) => withTipSeen(p, id, date), profile)
}
