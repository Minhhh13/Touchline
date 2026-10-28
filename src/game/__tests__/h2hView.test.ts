import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { getFormation } from '@engine/formations'
import { autoDraft, isComplete } from '@engine/draft'
import { h2hAutoPick, h2hComplete, h2hSpin, newH2HDraft } from '@engine/h2h'
import { h2hRules } from '../logic/h2h'
import { nextFirstPicker } from '../logic/h2hView'

const u = loadTestUniverse()

describe('head-to-head screen helpers', () => {
  it('nextFirstPicker names the manager the next spin lets pick first, over whole seeded drafts', () => {
    for (let i = 0; i < 40; i++) {
      const rng = new Rng(`h2h-view-${i}`)
      const h = newH2HDraft([getFormation('4-3-3'), getFormation('3-5-2')], h2hRules(['england'], false))
      while (!h2hComplete(h)) {
        if (h.picking === null) {
          const said = nextFirstPicker(h)
          h2hSpin(u, h, rng)
          // The spin's own log line names who picks first
          expect(h.log.find((l) => l.startsWith(`Spin ${h.spins}: `))).toContain(`Manager ${said! + 1} picks first`)
        } else h2hAutoPick(u, h)
      }
      expect(nextFirstPicker(h)).toBe(null)
    }
  }, 60_000)

  it('once the snake\'s first picker is complete, the other manager is named (the screen used to name the finished one)', () => {
    const h = newH2HDraft([getFormation('4-3-3'), getFormation('4-4-2')], h2hRules(['england'], false))
    autoDraft(u, h.drafts[0], new Rng('h2h-view-full'))
    expect(isComplete(h.drafts[0])).toBe(true)
    h.first = 0
    expect(nextFirstPicker(h)).toBe(1)
    h2hSpin(u, h, new Rng('h2h-view-spin'))
    expect(h.log.at(-1)).toContain('Manager 2 picks first')
  })
})
