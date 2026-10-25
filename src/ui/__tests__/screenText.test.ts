import { describe, expect, it } from 'vitest'
import { modeLabel, shownGames, versusReal } from '../screenText'

describe('screen labels', () => {
  it('names every mode in sentence case', () => {
    expect(modeLabel('quick')).toBe('Quick draft')
    expect(modeLabel('daily')).toBe('Daily')
    expect(modeLabel('season')).toBe('Season')
    expect(modeLabel('dynasty')).toBe('Dynasty')
  })

  it('compares a finish with the real club in both directions, singular and plural', () => {
    expect(versusReal(3, 10)).toEqual({ delta: 7, label: '7 places higher' })
    expect(versusReal(4, 5)).toEqual({ delta: 1, label: '1 place higher' })
    expect(versusReal(6, 6)).toEqual({ delta: 0, label: 'Same place' })
    expect(versusReal(12, 10)).toEqual({ delta: -2, label: '2 places lower' })
    expect(versusReal(2, 1)).toEqual({ delta: -1, label: '1 place lower' })
  })

  it('folds the game-by-game list unless it is unfolded or the replay is running', () => {
    expect(shownGames(38, 8, false, false)).toBe(8)
    expect(shownGames(38, 8, true, false)).toBe(38)
    expect(shownGames(20, 8, false, true)).toBe(20)
    expect(shownGames(5, 8, false, false)).toBe(5)
    expect(shownGames(38, undefined, false, false)).toBe(38)
    // Every length from an empty list to a full season stays within what was revealed
    for (let revealed = 0; revealed <= 38; revealed++) {
      for (const expanded of [false, true]) {
        for (const playing of [false, true]) {
          const n = shownGames(revealed, 8, expanded, playing)
          expect(n).toBeLessThanOrEqual(revealed)
          expect(n).toBe(expanded || playing ? revealed : Math.min(8, revealed))
        }
      }
    }
  })
})
