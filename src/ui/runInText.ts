/**
 * The Run-in's setup words through `t()`: a template's name (`RUN_IN_TEMPLATE_LABEL`) and a job's line (`jobLine` and
 * `gapLine` in `src/game/logic/runin.ts`, whose English the share text and the board keep). `copyMirror.test.ts`
 * holds them equal in English. Display only, pure.
 */
import type { RunInJob, RunInTemplate } from '@engine/scenario'
import { translator } from './i18n'
import { runin } from './i18n/en/runin'

const t = translator(runin)

export const templateText = (k: RunInTemplate) => t(`template_${k}`)

/** A brief in two or three words for a job's chip: `Stay up` (`RUN_IN_BRIEF_SHORT`). */
export const briefShortText = (k: RunInTemplate) => t(`briefShort_${k}`)

/** How far the side is from its target: `2 points behind safety`, `top by 3 points` (`gapLine`). */
export function gapText(template: RunInTemplate, target: number, position: number, gap: number): string {
  const pts = (n: number) => t('gapPts', { n })
  if (position > target) {
    if (gap === 0) return template === 'survival' ? t('gapLevelSafety') : t('gapLevelPlace', { target })
    return t(template === 'title' ? 'gapOffTop' : template === 'europe' ? 'gapBehindFour' : 'gapBehindSafety', { pts: pts(-gap) })
  }
  if (template === 'title') return gap === 0 ? t('gapTopGd') : t('gapTopBy', { pts: pts(gap) })
  if (template === 'europe') return gap === 0 ? t('gapFourGd') : t('gapFourClear', { pts: pts(gap) })
  return gap === 0 ? t('gapSafeGd') : t('gapSafeClear', { pts: pts(gap) })
}

/** A job in one line: `18th, 28 points after matchweek 28 (projected), 1 point behind safety` (`jobLine`). */
export function jobText(job: RunInJob): string {
  return t('jobLine', { pos: job.projected.position, points: job.projected.points, week: job.takeover, gap: gapText(job.template, job.target, job.projected.position, job.gap) })
}

/**
 * How close a finished run-in came, against the club on the other side of the brief's line (r9): `3 points clear of
 * Fulham in 18th`, `Level on points with QPR in 17th: out on goal difference`. Null for a sacked manager, a German
 * 16th's play-off (its own line says it), or a table with no club across the line.
 */
export function marginText(rows: ReadonlyArray<{ teamId: string; points: number }>, userId: string, target: number, opts: { sacked: boolean; playOff: boolean; name: (id: string) => string }): string | null {
  if (opts.sacked || opts.playOff) return null
  const at = rows.findIndex((r) => r.teamId === userId)
  if (at < 0) return null
  const met = at + 1 <= target
  // The rival: the first club below the line when the brief is met, the last one above it when missed
  const rival = met ? rows[target] : rows[target - 1]
  if (!rival || rival.teamId === userId) return null
  const n = Math.abs(rows[at].points - rival.points)
  const pos = met ? target + 1 : target
  return t(met ? (n === 0 ? 'marginGdMet' : 'marginClear') : n === 0 ? 'marginGdMissed' : 'marginShort', { n, club: opts.name(rival.teamId), pos })
}
