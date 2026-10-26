import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { advanceDay, closedWindowLine } from '../logic/marketOps'
import { playMatchweek } from '../logic/week'
import { seasonGame } from './seasonGame'

const u = loadTestUniverse(['england'])

describe('Season polish', () => {
  it('the closed market says January before the halfway point, then the summer or nothing', () => {
    const g = seasonGame(u, 'polish-window')
    expect(closedWindowLine(g)).toContain('January opens')
    for (let i = 0; i < 19; i++) {
      playMatchweek(g, u, true)
      if (g.phase === 'match') g.phase = 'week'
    }
    expect(g.window?.kind).toBe('january')
    while (g.window) advanceDay(g, u)
    expect(closedWindowLine(g)).toBe('Window closed: no more windows this season.')
    g.settings.mode = 'dynasty'
    expect(closedWindowLine(g)).toContain('summer window opens after the last matchweek')
  })
})
