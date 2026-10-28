/**
 * Display helpers for the casual modes' screens (the arena, its report and the head-to-head), pure and tested in
 * `src/ui/__tests__/arenaText.test.ts`. Presentation only: nothing here decides a result.
 */
import { GAUNTLET_BANDS, rungBandLabel } from '@engine/gauntlet'
import type { Outcome } from './format'
import { translator } from './i18n'
import { arena } from './i18n/en/arena'

const t = translator(arena)

/** An arena run as the personal-best check reads it: `profile.arenaRuns`' entries carry these. */
export interface RunMark {
  id: string
  format: 'cup' | 'gauntlet'
  size?: number
  score: number
}

/**
 * How a finished run stands against the manager's own earlier runs of the same kind (the Gauntlet, or a Cup of the
 * same size): `best` when it beats every one of them, `equal` when it ties the best, null when it falls short, when
 * there is no earlier run to beat, or when it scored nothing. The run itself (`id`) is left out of the earlier runs.
 */
export function personalBest(runs: readonly RunMark[], run: RunMark): { kind: 'best' | 'equal'; was: number } | null {
  const same = runs.filter((r) => r.id !== run.id && r.format === run.format && (run.format === 'gauntlet' || (r.size ?? 2) === (run.size ?? 2)))
  if (same.length === 0 || run.score === 0) return null
  const was = Math.max(...same.map((r) => r.score))
  return run.score > was ? { kind: 'best', was } : run.score === was ? { kind: 'equal', was } : null
}

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

/**
 * The shoot-out's line for a screen reader as each kick shows (`ShootoutPanel`'s live region): whose kick, who took
 * it, scored or missed, and the score so far; the verdict once the last kick is in. The chips beside it are a picture
 * (ticks, crosses and a colour), so the words carry it.
 */
export function kickLine(k: { us: boolean; scored: boolean }, n: number, taker: string, us: number, them: number, verdict: string | null): string {
  const line = `Kick ${n}, ${k.us ? 'ours' : 'theirs'}: ${taker} ${k.scored ? 'scores' : 'misses'}. ${us}-${them}.`
  return verdict ? `${line} ${verdict}.` : line
}

/** A taker's place after a move in the penalty order, for the live region: "Kane takes kick 2". */
export function takerMoved(name: string, at: number): string {
  return `${name} takes kick ${at + 1}.`
}
