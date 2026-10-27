/**
 * Display helpers for the casual modes' screens (the arena, its report and the head-to-head), pure and tested in
 * `src/ui/__tests__/arenaText.test.ts`. Presentation only: nothing here decides a result.
 */
import { GAUNTLET_BANDS, rungBandLabel } from '@engine/gauntlet'
import type { Outcome } from './format'
import { translator } from './i18n'
import { arena } from './i18n/en/arena'

const t = translator(arena)

/**
 * A knockout match's word on the report's scoreboard and its W/D/L colour: a tie settled on penalties reads "Won on
 * pens" or "Lost on pens" (a "Draw" under a Cup final the side has just won or lost read as a mistake); without
 * penalties it is the plain Win, Draw or Defeat.
 */
export function knockoutOutcome(gf: number, ga: number, pens?: { us: number; them: number } | null): { word: string; outcome: Outcome } {
  if (gf === ga && pens && pens.us !== pens.them) return pens.us > pens.them ? { word: t('wonOnPens'), outcome: 'W' } : { word: t('lostOnPens'), outcome: 'L' }
  return gf > ga ? { word: t('win'), outcome: 'W' } : gf < ga ? { word: t('defeat'), outcome: 'L' } : { word: t('draw'), outcome: 'D' }
}

/**
 * A club-season's name split before its season (`Luton Town 2023-24` into `Luton Town` and `2023-24`), so a screen can
 * keep the season on one line: a narrow box broke it at the hyphen ("2023-" over "24"). A name without a trailing
 * season comes back whole.
 */
export function splitSeason(name: string): { club: string; season: string | null } {
  const m = /^(.*\S)\s+(\d{4}-\d{2})$/.exec(name)
  return m ? { club: m[1], season: m[2] } : { club: name, season: null }
}

/**
 * A Gauntlet rung's band for the arena hub's line "Rung N · ...": rungs 2 to 10 read "stronger than 10(N-1)% of the
 * wheel" ("top 90% of the wheel" for the second-weakest tenth sounded like nearly everyone). The engine's
 * `rungBandLabel` (`src/engine/gauntlet.ts`, bundled by the verifier) keeps its words; rung 1 and the top rungs read
 * as it says.
 */
export function gauntletBandText(rung: number): string {
  const label = rungBandLabel(rung)
  const top = /^top (\d+)% of the wheel$/.exec(label)
  return top && rung >= 2 && rung <= GAUNTLET_BANDS ? t('strongerThan', { n: 100 - Number(top[1]) }) : label
}
