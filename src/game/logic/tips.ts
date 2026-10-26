import type { Profile } from '../types'

/**
 * The coach marks: one short callout the first time each screen or mechanic is
 * met. Eight is the ceiling (the draft recap's grades made the eighth); more and
 * they become the nagging they replace.
 */
export const TIP_IDS = ['draft-first-reveal', 'draft-bench', 'draft-recap', 'dugout-first', 'tactics-first', 'halftime-first', 'report-first', 'market-first'] as const

export type TipId = (typeof TIP_IDS)[number]

/** Whether this tip has been dismissed on this profile (an older save has none dismissed). */
export function tipSeen(profile: Pick<Profile, 'seenTips'>, id: TipId): boolean {
  return !!profile.seenTips?.[id]
}

/** The profile with this tip marked seen on `date`; a tip already dismissed keeps its first date. */
export function withTipSeen<P extends Pick<Profile, 'seenTips'>>(profile: P, id: TipId, date: string): P {
  if (tipSeen(profile, id)) return profile
  return { ...profile, seenTips: { ...(profile.seenTips ?? {}), [id]: date } }
}

/** How many of the eight tips this profile has dismissed. */
export function tipsSeenCount(profile: Pick<Profile, 'seenTips'>): number {
  return TIP_IDS.filter((id) => tipSeen(profile, id)).length
}
