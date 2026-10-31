/**
 * The achievements', badges' and milestones' words on screen, through `t()`. The engine's `ACHIEVEMENTS` and `BADGES`
 * and the game's `MILESTONE_BADGES` keep their English (the manager card, the share text, the edge verifier's bundle);
 * the `trophies` catalogue mirrors it by id and `i18n.test.ts` holds the two equal. An id the catalogue lacks shows
 * its own English.
 */
import { translator } from './index'
import { trophies } from './en/trophies'
import { countPhrase } from '../screenText'
import { ACHIEVEMENTS } from '@engine/awards'

const t = translator(trophies)
const pick = (key: string, english: string, vars?: Record<string, number>) => (t.has(key) ? t(key, vars) : english)

export const achievementTitle = (a: { id: string; title: string }) => pick(`ach_${a.id}_title`, a.title)
export const achievementText = (a: { id: string; description: string }) => pick(`ach_${a.id}_desc`, a.description)
export const badgeTitle = (b: { id: string; title: string }) => pick(`badge_${b.id}_title`, b.title)
/** "3 league titles" (`countPhrase(value, counts)`). */
export const badgeCount = (b: { id: string; counts: string }, n: number) => pick(`badge_${b.id}_count`, countPhrase(n, b.counts), { n })
export const milestoneTitle = (m: { id: string; title: string }) => pick(`milestone_${m.id}_title`, m.title)
/** "2 Trebles", or a stamp's what-earns-it line. */
export const milestoneCount = (m: { id: string; counts: string; tiers: readonly number[] }, n: number) => pick(`milestone_${m.id}_count`, m.tiers.length === 1 ? m.counts : countPhrase(n, m.counts), { n })

const TIERS = ['bronze', 'silver', 'gold'] as const
/** "3 of 5 for silver", "Gold", and a stamp's "Not yet" (`badgeProgress`, `milestoneProgress`). */
export function progressText(tiers: readonly number[], value: number, stamp = false): string {
  const next = tiers.findIndex((x) => value < x)
  if (next === -1) return t('gold')
  if (stamp) return t('notYet')
  return t('progress', { value, target: tiers[next], tier: t(`tier_${TIERS[next]}`) })
}

/** A game's unlocked achievement ids as names on screen (the Dugout's Club tab), in unlock order; an unknown or internal id is left out. */
export function unlockedNames(ids: readonly string[]): Array<{ id: string; title: string; text: string }> {
  return ids.flatMap((id) => {
    const a = ACHIEVEMENTS.find((x) => x.id === id)
    return a ? [{ id, title: achievementTitle(a), text: achievementText(a) }] : []
  })
}
