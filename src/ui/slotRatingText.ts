/**
 * `slotRatingLine` and `costLabel` (`@game/logic/slotRating`) in the viewer's language: the same words in English
 * (held equal by `src/ui/__tests__/copyMirror.test.ts`), through `t()` everywhere else. Display only, pure.
 */
import type { SlotRating } from '@game/logic/slotRating'
import { translator } from './i18n'
import { common } from './i18n/en/common'

const t = translator(common)

/** "−5 out of position", or "natural position". */
export function costText(r: Pick<SlotRating, 'cost'>): string {
  return r.cost > 0 ? t('slotOutOfPosition', { cost: r.cost }) : t('slotNatural')
}

/** "84 at RW (89 overall, −5 out of position)", with ". Attributes for RW: 75" when asked. */
export function slotRatingText(r: SlotRating, at: string, opts: { attributes?: boolean } = {}): string {
  const head = r.cost > 0 ? t('slotAtCost', { n: r.inSlot, at, overall: r.overall, cost: costText(r) }) : t('slotAtNatural', { n: r.inSlot, at })
  return opts.attributes ? t('slotWithAttributes', { head, at, n: r.attributes }) : head
}

/** A slot chip's fit, 'fits' or 'can cover', in words. */
export function fitText(fit: 'fits' | 'can cover'): string {
  return fit === 'fits' ? t('fitFits') : t('fitCovers')
}
