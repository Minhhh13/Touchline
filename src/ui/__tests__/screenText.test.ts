import { describe, expect, it } from 'vitest'
import { countPhrase, developmentLists, distinctLabels, modeLabel, runsSummary, shownGames, versusReal } from '../screenText'

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

describe('development report lists', () => {
  it('splits the report into improving and fading players, names with initials included', () => {
    expect(developmentLists('Improving: V. van Dijk 80→81, Rodri 85→86. Fading: J. Milner 74→73.')).toEqual({ improving: ['V. van Dijk 80→81', 'Rodri 85→86'], fading: ['J. Milner 74→73'] })
    expect(developmentLists('Fading: A. B. Cole 70→69.')).toEqual({ improving: [], fading: ['A. B. Cole 70→69'] })
    expect(developmentLists('Something else entirely.')).toBeNull()
  })

  it('makes a badge count singular for one, the first plural word only', () => {
    expect(countPhrase(0, 'league titles')).toBe('0 league titles')
    expect(countPhrase(1, 'league titles')).toBe('1 league title')
    expect(countPhrase(1, 'leagues won in')).toBe('1 league won in')
    expect(countPhrase(1, 'cups, season and arena')).toBe('1 cup, season and arena')
    expect(countPhrase(1, 'different clubs titled')).toBe('1 different club titled')
    expect(countPhrase(1, 'arena wins on Realistic over 85+ sides')).toBe('1 arena win on Realistic over 85+ sides')
    expect(countPhrase(1, 'run-in briefs met')).toBe('1 run-in brief met')
    expect(countPhrase(1, '100-point seasons')).toBe('1 100-point season')
    expect(countPhrase(2, 'rungs in your best Gauntlet')).toBe('2 rungs in your best Gauntlet')
  })
})

describe('distinctLabels', () => {
  it("says the arena hub's step once, in sentence case", () => {
    expect(distinctLabels(['Cup Final', 'Cup final'])).toEqual(['Cup final'])
    expect(distinctLabels(['Cup final', 'Cup Final'])).toEqual(['Cup final'])
    expect(distinctLabels(['The Cup · 16 clubs', 'Round of 16'])).toEqual(['The Cup · 16 clubs', 'Round of 16'])
    expect(distinctLabels(['The Gauntlet', 'Rung 3', ''])).toEqual(['The Gauntlet', 'Rung 3'])
  })
})


describe('runsSummary', () => {
  it('names the best as a perfect start, from two games, beside the season runs', () => {
    expect(runsSummary('Unbeaten for the first 2 games', 1)).toBe('Unbeaten for the first 2 games')
    expect(runsSummary('Unbeaten for the first 2 games', 6)).toBe('Unbeaten for the first 2 games · best perfect start 6-0')
    expect(runsSummary(null, 6)).toBe('Best perfect start 6-0')
    expect(runsSummary(null, 1)).toBeNull()
    expect(runsSummary(null, undefined)).toBeNull()
  })
})
