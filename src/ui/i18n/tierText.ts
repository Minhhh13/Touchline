/**
 * A season tier on screen, through `t()`: the headline ("Champions", "Top 4", "Super League champions") and the line
 * under it ("2nd of 20, …"). `format.ts`'s `tierName` and the engine's `tierBlurb` keep the English the share text and
 * the share card use; `copyMirror.test.ts` holds these equal to them in English, tier for tier.
 */
import type { SeasonTier } from '@engine/types'
import { SUPER_LEAGUE_NAME } from '@engine/superLeague'
import { translator } from './index'
import { common } from './en/common'

const t = translator(common)

/** A season tier's headline (`tierName` in `format.ts`). */
export function tierText(tier: SeasonTier, position?: number, superLeague?: boolean): string {
  if (superLeague && (tier === 'PERFECT' || tier === 'INVINCIBLE' || tier === 'CHAMPIONS' || tier === 'RELEGATED')) return t(`superTier_${tier}`, { name: SUPER_LEAGUE_NAME })
  if (tier === 'EUROPEAN' && position !== undefined && position >= 1 && position <= 4) return t('tierTop4')
  return t(`tier_${tier}`)
}

/** The line under the tier (`tierBlurb`, or the Super League's `superTierBlurb`). */
export function tierBlurbText(tier: SeasonTier, position: number, teams = 20, opts: { sacked?: boolean; superLeague?: boolean } = {}): string {
  if (opts.sacked) return t('blurbSacked', { pos: position, teams })
  if (opts.superLeague && tier === 'RELEGATED') return t('blurbSuperBottom', { pos: position, teams })
  if (tier === 'EUROPEAN') return t(position <= 4 ? 'blurbTopFour' : 'blurbTopSix', { pos: position, teams })
  return t(`blurb_${tier}`, { pos: position, teams })
}
