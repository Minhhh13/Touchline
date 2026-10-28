import { describe, expect, it } from 'vitest'
import { SHEET_CLOSE_MAX, SHEET_FLICK_MIN, sheetCloses, sheetOffset } from '../sheetDrag'

describe('a bottom sheet pulled down', () => {
  it('follows the finger down and only a little up', () => {
    expect(sheetOffset(0)).toBe(0)
    expect(sheetOffset(80)).toBe(80)
    for (const dy of [-1, -10, -100, -1000]) {
      expect(sheetOffset(dy)).toBeLessThan(0)
      expect(sheetOffset(dy)).toBeGreaterThanOrEqual(-12)
    }
    expect(sheetOffset(Number.NaN)).toBe(0)
  })

  it('closes when let go far enough, never when pulled up or left near its rest', () => {
    expect(sheetCloses(0, 400, 600)).toBe(false)
    expect(sheetCloses(-50, 100, 600)).toBe(false)
    // A slow pull: a third of a short sheet closes it, and never more than the cap is needed on a tall one
    expect(sheetCloses(90, 1000, 300)).toBe(true)
    expect(sheetCloses(80, 1000, 300)).toBe(false)
    expect(sheetCloses(SHEET_CLOSE_MAX, 2000, 2000)).toBe(true)
    expect(sheetCloses(SHEET_CLOSE_MAX - 1, 2000, 2000)).toBe(false)
  })

  it('closes on a flick, but a tiny twitch is never a flick', () => {
    expect(sheetCloses(60, 60, 800)).toBe(true)
    expect(sheetCloses(SHEET_FLICK_MIN - 1, 5, 800)).toBe(false)
    expect(sheetCloses(60, 400, 800)).toBe(false)
  })

  it('over many seeded drags, a longer pull at the same speed never closes less', () => {
    // A small seeded generator: the property holds for any height and time
    let x = 0x2f6b1d
    const next = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let i = 0; i < 500; i++) {
      const h = 100 + next() * 900
      const ms = 20 + next() * 900
      const dy = next() * 300
      if (sheetCloses(dy, ms, h)) expect(sheetCloses(dy + 10, ms, h)).toBe(true)
    }
  })
})
