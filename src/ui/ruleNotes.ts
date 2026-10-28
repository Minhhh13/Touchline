import { MODE_INFO } from '@engine/modes'
import type { RuleChip } from '@game/logic/setup'
import { translator } from './i18n'
import { setup } from './i18n/en/setup'

const tr = translator(setup)

/**
 * A plain-words note for a fixed rules chip (the Daily's and the Weekly's setup), shown as its tip: "Squad First",
 * "Season ratings" and "All-time" said nothing to a new player. Keyed on the chip's own words (`describeRuleChips`
 * in setup.ts, which the edge verifier bundles, so the notes live here). Pure.
 */
export function ruleChipNote(chip: RuleChip): string | undefined {
  const t = chip.text
  if (chip.icon && chip.icon in MODE_INFO) return MODE_INFO[chip.icon as keyof typeof MODE_INFO].line
  if (/re-spins?$/.test(t)) return /^No re-spins$|: no re-spins$/.test(t) ? tr('noteNoRespins') : tr('noteRespins')
  if (t === 'Ratings on') return tr('noteRatingsOn')
  if (t === 'Ratings hidden') return tr('noteRatingsHidden')
  if (t === 'Squad First') return tr('noteSquadFirst')
  if (t === 'Position First') return tr('notePositionFirst')
  if (t === 'Season ratings') return tr('noteSeasonRatings')
  if (t === 'Prime ratings') return tr('notePrimeRatings')
  if (t === 'All-time') return tr('noteAllTime')
  if (/^\d{4}-\d{2} to \d{4}-\d{2}$/.test(t)) return tr('noteRange', { range: t })
  if (t === 'Twists on') return tr('noteTwistsOn')
  if (t === 'No twists') return tr('noteNoTwists')
  if (chip.icon === 'manager-spin') return tr('noteManagerSpin')
  if (chip.icon === 'manager-pick') return tr('noteManagerPick')
  if (chip.icon === 'end-case') return tr('noteEndCase')
  if (chip.icon === 'power-ups') return tr('notePowerUps')
  if (/^Bench of \d+$/.test(t)) return tr('noteBench')
  return undefined
}
