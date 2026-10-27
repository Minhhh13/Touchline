import { MODE_INFO } from '@engine/modes'
import type { RuleChip } from '@game/logic/setup'

/**
 * A plain-words note for a fixed rules chip (the Daily's and the Weekly's setup), shown as its tip: "Squad First",
 * "Season ratings" and "All-time" said nothing to a new player. Keyed on the chip's own words (`describeRuleChips`
 * in setup.ts, which the edge verifier bundles, so the notes live here). Pure.
 */
export function ruleChipNote(chip: RuleChip): string | undefined {
  const t = chip.text
  if (chip.icon && chip.icon in MODE_INFO) return MODE_INFO[chip.icon as keyof typeof MODE_INFO].line
  if (/re-spins?$/.test(t)) return /^No re-spins$|: no re-spins$/.test(t) ? 'No re-spins: every spin stands.' : 'A re-spin swaps the club on the wheel for another; your re-spins last the whole draft.'
  if (t === 'Ratings on') return 'Every player’s rating shows while you choose.'
  if (t === 'Ratings hidden') return 'Names only while you choose; ratings show once a player is yours.'
  if (t === 'Squad First') return 'Spin first, then pick any player from the squad and put him in an open slot.'
  if (t === 'Position First') return 'Choose the open slot first, then spin for a club with someone who plays there.'
  if (t === 'Season ratings') return 'A player is rated as he was in the season the wheel lands on.'
  if (t === 'Prime ratings') return 'A player is rated at his career best, whichever season the wheel lands on.'
  if (t === 'All-time') return 'The wheel can land on any season in the database.'
  if (/^\d{4}-\d{2} to \d{4}-\d{2}$/.test(t)) return `The wheel only lands on seasons from ${t}.`
  if (t === 'Twists on') return 'Every third spin changes the rules for one pick: a golden spin, a blind one and the like.'
  if (t === 'No twists') return 'Every spin plays by the same rules.'
  if (chip.icon === 'manager-spin') return 'After the draft, three reels of real managers: you pick one for the season.'
  if (chip.icon === 'manager-pick') return 'After the draft, pick a real manager from the clubs you drafted.'
  if (chip.icon === 'end-case') return 'After the draft, one case: a power-up for your locker, or with luck an Icon.'
  if (chip.icon === 'power-ups') return 'Six one-use boosts in a tray under the reel.'
  if (/^Bench of \d+$/.test(t)) return 'After the XI, more spins for substitutes you can bring on between games.'
  return undefined
}
