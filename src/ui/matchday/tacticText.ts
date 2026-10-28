/**
 * The engine's tactics words on the match day, through `t()`: each instruction's help line and the touchline shouts'
 * names and hints. The engine keeps its English (`@engine/tactics`, `SHOUTS` in `@engine/match`) for the logic and the
 * commentary; `matchday.test.ts` holds these messages equal to it. Pure.
 */
import type { Shout } from '@engine/match'
import type { DefensiveLine, Mentality, PassingStyle, Pressing, Tempo, Width } from '@engine/types'
import { translator } from '../i18n'
import { match } from '../i18n/en/match'

const t = translator(match)

export const mentalityHelp = (v: Mentality) => t(`helpMentality_${v}`)
export const pressingHelp = (v: Pressing) => t(`helpPressing_${v}`)
export const tempoHelp = (v: Tempo) => t(`helpTempo_${v}`)
export const widthHelp = (v: Width) => t(`helpWidth_${v}`)
export const lineHelp = (v: DefensiveLine) => t(`helpLine_${v}`)
export const passingHelp = (v: PassingStyle) => t(`helpPassing_${v}`)
export const shoutLabel = (k: Shout) => t(`shout_${k}`)
export const shoutHint = (k: Shout) => t(`shoutHint_${k}`)
