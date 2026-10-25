import { describe, expect, it } from 'vitest'
import { describeFit } from '@engine/positions'
import type { Position } from '@engine/types'
import { FIT_AMBER, FIT_RED, fitRingColour } from '@ui/format'

const calm = { warn: false, highlighted: false }

describe('the pitch key rings', () => {
  it('a natural keeps the disc border; accomplished is amber (acc.), awkward or unsuited red (awk.)', () => {
    const cb = { positions: ['CB'] as Position[] }
    expect(describeFit(cb, 'CB')).toBe('natural')
    expect(fitRingColour(describeFit(cb, 'CB'), calm)).toBeUndefined()
    // CB at full back is 0.86: the accomplished band starts exactly there
    expect(describeFit(cb, 'LB')).toBe('accomplished')
    expect(fitRingColour(describeFit(cb, 'LB'), calm)).toBe(FIT_AMBER)
    // CB up front has no relation: unsuited, the same red ring as awkward
    expect(describeFit(cb, 'ST')).toBe('unsuited')
    expect(fitRingColour(describeFit(cb, 'ST'), calm)).toBe(FIT_RED)
    // LB at left wing is 0.84, just under the line: awkward
    expect(describeFit({ positions: ['LB'] }, 'LW')).toBe('awkward')
    expect(fitRingColour('awkward', calm)).toBe(FIT_RED)
  })

  it('an injured or suspended player keeps the red warning ring wherever he plays', () => {
    for (const fit of ['natural', 'accomplished', 'awkward', 'unsuited'] as const) {
      expect(fitRingColour(fit, { warn: true, highlighted: false })).toBeUndefined()
    }
  })

  it('a selected or eligible slot keeps its highlight over the fit colour', () => {
    expect(fitRingColour('accomplished', { warn: false, highlighted: true })).toBeUndefined()
    expect(fitRingColour('awkward', { warn: false, highlighted: true })).toBeUndefined()
  })
})
