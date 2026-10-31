/**
 * A Weekly theme on screen, through `t()`: its name (`weeklyThemeName` in `weeklyThemes.ts`, which the share text and
 * the mode labels keep in English) and the Setup banner's line (`weeklyThemeLine` in `weekly.ts`, verifier-bundled).
 * `copyMirror.test.ts` holds them equal in English. Small on purpose: Home reads it in the first download.
 */
import type { LoadedUniverse } from '@engine/universe'
import type { DraftRules } from '@engine/draft'
import { WEEKLY_THEMES, type WeeklyThemeId } from '@game/logic/weeklyThemes'
import { translator } from './index'
import { common } from './en/common'

const t = translator(common)
const read = (key: string, english: string) => (t.has(key) ? t(key) : english)

/** A theme's name: the id itself for a theme this build does not know (a newer save). */
export function weeklyThemeText(id: string | undefined): string {
  if (!id) return ''
  return id in WEEKLY_THEMES ? read(`weeklyTheme_${id}`, WEEKLY_THEMES[id as WeeklyThemeId].name) : id
}

/** "European Nights: the wheel draws from all seven leagues", the one-nation week naming its nation. */
export function weeklyThemeLineText(u: Pick<LoadedUniverse, 'nations'>, w: { theme: WeeklyThemeId; rules: Pick<DraftRules, 'onlyNation'> }): string {
  const blurb = w.theme === 'one-nation' && w.rules.onlyNation ? t('weeklyNationBlurb', { nation: u.nations[w.rules.onlyNation]?.name ?? w.rules.onlyNation }) : read(`weeklyBlurb_${w.theme}`, WEEKLY_THEMES[w.theme].blurb)
  return t('weeklyThemeLine', { name: weeklyThemeText(w.theme), blurb })
}
