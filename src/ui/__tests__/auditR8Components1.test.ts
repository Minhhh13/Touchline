import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildBracket, revealCount, revealSteps, type BracketTie } from '@game/logic/bracket'
import { GROUP_STEP_MS, nightStepDelay, revealDelay } from '../cupReveal'

const t = (home: string, away: string, hg: number, ag: number): BracketTie => ({ home, away, hg, ag, winner: hg > ag ? home : away })
// Eight clubs through the groups and the user among them: quarter-finals, semi-finals, the final
const qf = [t('user', 'b', 2, 0), t('c', 'd', 1, 0), t('e', 'f', 0, 1), t('g', 'h', 3, 1)]
const sf = [t('user', 'c', 1, 0), t('f', 'g', 2, 2)]
const view = buildBracket(['Quarter-final', 'Semi-final', 'Final'], [qf, [sf[0], { ...sf[1], winner: 'f' }], [t('user', 'f', 2, 1)]])
const steps = revealSteps(view)
const source = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8')

describe('the cup night reveal (CupNight)', () => {
  it('walks every group step and every tie one at a time, then stops', () => {
    const groupSteps = 7
    const delays: number[] = []
    for (let all = 0; ; all++) {
      const d = nightStepDelay(view, steps, all, groupSteps)
      if (d === null) break
      delays.push(d)
      expect(delays.length).toBeLessThan(100)
    }
    expect(delays.length).toBe(groupSteps + revealCount(view))
    expect(delays.slice(0, groupSteps)).toEqual(Array(groupSteps).fill(GROUP_STEP_MS))
    delays.slice(groupSteps).forEach((d, k) => expect(d).toBe(revealDelay(view, steps, k)))
  })

  it('without groups is the plain bracket reveal', () => {
    for (let n = 0; n < revealCount(view); n++) expect(nightStepDelay(view, steps, n, 0)).toBe(revealDelay(view, steps, n))
    expect(nightStepDelay(view, steps, revealCount(view), 0)).toBeNull()
  })

  it('re-arms its timer on every step: the effect is keyed on the step count, not on the knockout index alone', () => {
    // Through the seven group steps the knockout index stays 0, so an effect keyed on it fired once and stalled on matchday 1
    const src = source('components/CupNight.tsx')
    const effect = src.slice(src.indexOf('nightStepDelay(view, steps, all, groupSteps)'))
    expect(effect).toMatch(/setTimeout\(\(\) => setShownAll\(\(n\) => n \+ 1\), delay\)/)
    expect(effect).toMatch(/\}, \[all, delay\]\)/)
  })
})

describe('the Boxes checklist (BoxesMenu)', () => {
  it('focuses its first box only once it is placed (a hidden checklist cannot take the focus)', () => {
    const src = source('components/Boxes.tsx')
    expect(src).toContain('const placed = place !== null')
    expect(src).toMatch(/if \(open && placed\) pop\.current\?\.querySelector<HTMLInputElement>\('input:not\(:disabled\)'\)\?\.focus\(\)\n {2}\}, \[open, placed\]\)/)
  })
})
