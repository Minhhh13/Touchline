import { describe, expect, it } from 'vitest'
import { placeTip, tipWidth } from '../tipPlacement'

describe('tip placement', () => {
  it('opens at a readable width, inside the gutters on a phone', () => {
    expect(tipWidth(2000)).toBe(320)
    expect(tipWidth(1280)).toBe(320)
    expect(tipWidth(390)).toBe(320)
    expect(tipWidth(390, 360)).toBe(358)
    expect(tipWidth(300)).toBe(268)
    expect(tipWidth(1280, 200)).toBe(280)
  })

  it('hangs from the end of its anchor and slides back inside the window', () => {
    // The setup's modes "i" at the left edge of the rules box: the bubble may not hang off to the left
    const left = placeTip({ left: 1028, right: 1046, top: 220, bottom: 238 }, 320, 200, 2000, 870)
    expect(left).toEqual({ left: 726, top: 244, maxHeight: 610, below: true })
    const edge = placeTip({ left: 20, right: 38, top: 220, bottom: 238 }, 320, 200, 1280, 720)
    expect(edge.left).toBe(16)
    const right = placeTip({ left: 1270, right: 1288, top: 100, bottom: 118 }, 320, 120, 1280, 720)
    expect(right.left + 320).toBeLessThanOrEqual(1280 - 16)
  })

  it('centres on a chip', () => {
    const p = placeTip({ left: 100, right: 200, top: 200, bottom: 224 }, 160, 40, 1280, 720, 'center')
    expect(p.left).toBe(70)
    expect(p.below).toBe(true)
  })

  it('opens over the anchor when there is no room under it', () => {
    const p = placeTip({ left: 100, right: 118, top: 650, bottom: 668 }, 300, 150, 1280, 720)
    expect(p.below).toBe(false)
    expect(p.top).toBe(650 - 6 - 150)
    expect(p.top + 150).toBeLessThanOrEqual(650)
  })

  it('stays inside the window for anchors anywhere on it', () => {
    for (const [vw, vh] of [[2000, 870], [1280, 720], [390, 844]]) {
      for (let x = 0; x < vw; x += 37) {
        for (let y = 0; y < vh - 20; y += 41) {
          const w = tipWidth(vw)
          const h = 180
          const p = placeTip({ left: x, right: x + 18, top: y, bottom: y + 18 }, w, h, vw, vh)
          expect(p.left).toBeGreaterThanOrEqual(16)
          expect(p.left + w).toBeLessThanOrEqual(vw - 16)
          expect(p.top).toBeGreaterThanOrEqual(0)
          expect(p.top + Math.min(h, p.maxHeight)).toBeLessThanOrEqual(vh)
        }
      }
    }
  })
})
