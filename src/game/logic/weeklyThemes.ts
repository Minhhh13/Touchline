/**
 * The Weekly Challenge's themes and the order the weeks rotate through them.
 * No imports, so the mode labels can read a theme's name without pulling in
 * the setup code. Append-only: a theme id, once shipped, keeps its meaning.
 */

/** Every theme a week can carry. */
export type WeeklyThemeId = 'european-nights' | 'early' | 'modern' | 'hard' | 'realistic' | 'park-the-bus' | 'one-nation' | 'moneyball' | 'teammate-chain'

/** A theme's name on Home, the Setup banner and the share text, and the line saying what it changes. */
export const WEEKLY_THEMES: Record<WeeklyThemeId, { name: string; blurb: string }> = {
  'european-nights': { name: 'European Nights', blurb: 'the wheel draws from all seven leagues' },
  early: { name: 'The early years', blurb: 'only club-seasons from 2008-09 to 2013-14' },
  modern: { name: 'The modern game', blurb: 'only club-seasons from 2020-21 onwards' },
  hard: { name: 'Hard mode', blurb: 'ratings hidden while you draft' },
  realistic: { name: 'Realistic', blurb: 'no calibration: the league plays at its real strength' },
  'park-the-bus': { name: 'Park the bus', blurb: 'a 5-3-2 against the league at its real strength' },
  'one-nation': { name: 'One nation', blurb: 'every pick from one nation' },
  moneyball: { name: 'Moneyball', blurb: 'a £180M salary cap on the XI' },
  'teammate-chain': { name: 'Teammate chain', blurb: 'every pick a former teammate of the one before' },
}

/**
 * The themes in force from a week on, one per week in this order, starting
 * again after the last. A new theme opens a new epoch from a future week, so
 * no past week ever changes. `position-first` joins once the replica setup has
 * merged, in an epoch of its own.
 */
export const WEEKLY_EPOCHS: ReadonlyArray<{ from: string; themes: readonly WeeklyThemeId[] }> = [
  { from: 'weekly-2026-W43', themes: ['teammate-chain', 'european-nights', 'early', 'moneyball', 'hard', 'one-nation', 'modern', 'park-the-bus', 'realistic'] },
]

/** A theme's name, or the id itself for a theme this build does not know (a newer save). */
export function weeklyThemeName(id: string | undefined): string {
  return id && id in WEEKLY_THEMES ? WEEKLY_THEMES[id as WeeklyThemeId].name : (id ?? '')
}
