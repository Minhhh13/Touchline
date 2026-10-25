/**
 * The Quick Draft's mix-and-match modes: cards that toggle on the setup screen, several at once.
 *
 * Five are rule flags (`DraftRules.modes`): Crazy, Underdog, Legends, Speedrun and Gamble. Hard is the existing difficulty,
 * shown as a card too, so toggling either the card or the Difficulty option changes the other. The Upgrader card is the
 * Player Upgrader power-up on its own (`DraftRules.upgrader`); Gamble includes it. Underdog and Legends
 * exclude each other (a bottom-half side with an 85+ player is too rare to fill a draft). Pure: no RNG here except
 * `crazyFormation`, which seeds its own stream from the game seed and never touches the game's stream.
 */
import { CRAZY_SURPRISE_CHANCE, DIFFICULTY_RESPINS, LEGENDS_RATING, QUICK_MODES, difficultyOf, modesOf, withDifficulty, type DraftRules, type QuickMode } from './draft'
import { FORMATIONS } from './formations'
import { ICONS_CHANCE } from './icons'
import { Rng } from './rng'

/** A card in the Modes row: a rule flag or Hard (the difficulty). */
export type ModeCard = QuickMode | 'hard' | 'upgrader'
/** The cards in the order the row shows them. */
export const MODE_CARDS: readonly ModeCard[] = ['crazy', 'hard', 'underdog', 'legends', 'speedrun', 'gamble', 'upgrader']

/** Seconds on the Speedrun clock for each pick (the UI's timer; the auto-pick itself is the assistant's deterministic choice). */
export const SPEEDRUN_SECONDS = 20

export const MODE_INFO: Record<ModeCard, { icon: string; title: string; line: string }> = {
  crazy: { icon: '🌀', title: 'Crazy', line: `A twist every spin, a random formation, a ${Math.round(CRAZY_SURPRISE_CHANCE * 100)}% surprise after each pick` },
  hard: { icon: '💀', title: 'Hard', line: `${DIFFICULTY_RESPINS.hard} re-spins, ratings hidden` },
  underdog: { icon: '🐶', title: 'Underdog', line: 'Only bottom-half sides' },
  legends: { icon: '👑', title: 'Legends', line: `Only sides with an ${LEGENDS_RATING}+ player` },
  speedrun: { icon: '⏱️', title: 'Speedrun', line: `${SPEEDRUN_SECONDS}s a pick or the assistant picks` },
  gamble: { icon: '🎲', title: 'Gamble', line: `A ${Math.round(ICONS_CHANCE * 100)}% Icons spin, plus the Player Upgrader` },
  upgrader: { icon: '⬆️', title: 'Upgrader', line: 'One +2, +5 or +10 gamble on a drafted player' },
}

/** Pairs of cards that cannot be on together: switching one on switches the other off. */
const EXCLUSIVE: ReadonlyArray<[ModeCard, ModeCard]> = [['underdog', 'legends']]

/** The cards a set of rules has on: Hard when the difficulty is hard, then each mode flag, in `MODE_CARDS` order. */
export function activeModeCards(rules: DraftRules): ModeCard[] {
  const flags = modesOf(rules)
  return MODE_CARDS.filter((c) => (c === 'hard' ? difficultyOf(rules) === 'hard' : c === 'upgrader' ? !!rules.upgrader : flags.includes(c)))
}

/** The cards after tapping one: on becomes off, off becomes on and switches off anything it excludes. */
export function toggleModeCard(cards: readonly ModeCard[], card: ModeCard): ModeCard[] {
  if (cards.includes(card)) return cards.filter((c) => c !== card)
  const off = new Set(EXCLUSIVE.flatMap(([a, b]) => (a === card ? [b] : b === card ? [a] : [])))
  return MODE_CARDS.filter((c) => c === card || (cards.includes(c) && !off.has(c)))
}

/**
 * The rules with a set of mode cards: Hard sets the hard difficulty (and leaving Hard turns a hard draft back to normal),
 * the flags go into `modes` (left out when none are on, so a draft without modes is the draft it always was), and Crazy
 * turns twists on, since every spin carries one.
 */
export function withModes(rules: DraftRules, cards: readonly ModeCard[]): DraftRules {
  const hard = cards.includes('hard')
  const diff = difficultyOf(rules)
  const base = hard && diff !== 'hard' ? withDifficulty(rules, 'hard') : !hard && diff === 'hard' ? withDifficulty({ ...rules, showRatings: true }, 'normal') : rules
  const flags = QUICK_MODES.filter((m) => cards.includes(m))
  const rest: DraftRules = { ...base }
  delete rest.modes
  delete rest.upgrader
  return { ...rest, ...(flags.length ? { modes: flags } : {}), ...(flags.includes('crazy') ? { twists: true } : {}), ...(cards.includes('upgrader') ? { upgrader: true } : {}) }
}

/** "🌀 Crazy · 💀 Hard" for the draft header, the summary and the share text; empty with no mode on. */
export function modesLine(rules: DraftRules): string {
  return activeModeCards(rules)
    .map((c) => `${MODE_INFO[c].icon} ${MODE_INFO[c].title}`)
    .join(' · ')
}

/**
 * Crazy: the formation drawn for a seed, from a stream seeded apart from the game's (`seed:crazy-formation`), so the same
 * seed always gets the same shape and nothing of the draft or the season moves. The shape then travels in the settings
 * (and a challenge link's `f`), so a replay never draws it again.
 */
export function crazyFormation(seed: string): string {
  return new Rng(`${seed}:crazy-formation`).pick(FORMATIONS).id
}
