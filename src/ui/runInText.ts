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
