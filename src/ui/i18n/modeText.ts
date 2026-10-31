/**
 * The modes' names on screen, through `t()`. `src/game/logic/modes.ts` keeps the English labels the game logic and
 * the share text use (the share text stays English, so a link reads the same to everyone); every screen calls these
 * instead. Each mirrors its namesake there, case for case: `modeText.test` in `i18n.test.ts` holds them equal in English.
 */
import type { ArenaSettings, Mode } from '@game/types'
import { isQuickLike, type LabelledGame } from '@game/logic/modes'
import { weeklyThemeText as weeklyThemeName } from './weeklyThemeText'
import { translator } from './index'
import { common } from './en/common'

const t = translator(common)

/** The mode's title: Setup's heading, the Record page's mode column (`MODE_TITLE`). */
export function modeTitle(mode: Mode): string {
  return t(`title_${mode}`)
}

/** A mode in a table cell or a chip ("Daily", "Weekly"; `screenText.ts`'s `modeLabel`). */
export function modeShort(mode: Mode): string {
  return t(`short_${mode}`)
}

/** An arena format's name: `Cup Final`, `The Gauntlet`, `The Cup · 16 clubs` (`arenaFormatLabel`). */
export function arenaFormatText(a: (Pick<ArenaSettings, 'format'> & { size?: number }) | undefined): string {
  if (a?.format === 'gauntlet') return t('gauntlet')
  const size = a?.size ?? 2
  return size === 2 ? t('cupFinal') : t('cupSized', { size })
}

/** The game's mode in words for a screen (`modeLabel` with 'short' or 'heading'; the share text keeps the English one). */
export function modeText(game: LabelledGame, style: 'short' | 'heading'): string {
  const mode = game.settings.mode
  switch (mode) {
    case 'dynasty':
      return t(style === 'heading' ? 'dynastyHeading' : 'dynastyShort', { year: game.year })
    case 'arena':
      return game.settings.arena?.daily ? t('dailyArena', { format: arenaFormatText(game.settings.arena) }) : arenaFormatText(game.settings.arena)
    case 'weekly': {
      const theme = weeklyThemeName(game.settings.weekly?.theme)
      const suffix = theme ? t('themeSuffix', { theme }) : ''
      return style === 'short' ? t('weeklyShort', { theme: suffix }) : t('weeklyHeading', { week: game.settings.seed.replace('weekly-', ''), theme: suffix })
    }
    default:
      return t(`title_${mode}`)
  }
}

/** `Year 2` in a dynasty, nothing in a mode that plays one season (`yearLabel`). */
export function yearText(game: LabelledGame): string | null {
  return game.settings.mode === 'dynasty' ? t('year', { year: game.year }) : null
}

/** The Draft screen's finish button (`finishDraftLabel`). */
export function finishDraftText(game: LabelledGame, made?: number): string {
  if (isQuickLike(game.settings.mode)) return t(game.settings.rules?.managers && game.settings.rules.managerSpin ? 'toManager' : 'toKickOff')
  if (game.settings.mode === 'arena') return game.arena && game.arena.step > 0 ? t('backToLadder') : game.settings.arena?.format !== 'gauntlet' && (game.settings.arena?.size ?? 2) === 2 ? t('toFinal') : game.settings.arena?.format === 'gauntlet' ? t('ontoLadder') : t('toDraw')
  if (game.settings.mode === 'dynasty' && game.year > 1) return t('newSeason')
  if (game.settings.mode === 'runin') return t('takeJob')
  return made === undefined ? t('preseason') : t('preseasonWith', { n: made })
}
