import { describe, expect, it } from 'vitest'
import { knockoutOutcome, splitSeason } from '../arenaText'

describe('arena display text', () => {
  it('names a knockout settled on penalties by its shoot-out, everything else by the score', () => {
    expect(knockoutOutcome(1, 1, { us: 7, them: 6 })).toEqual({ word: 'Won on pens', outcome: 'W' })
    expect(knockoutOutcome(0, 0, { us: 3, them: 5 })).toEqual({ word: 'Lost on pens', outcome: 'L' })
    expect(knockoutOutcome(2, 1)).toEqual({ word: 'Win', outcome: 'W' })
    expect(knockoutOutcome(0, 3, null)).toEqual({ word: 'Defeat', outcome: 'L' })
    expect(knockoutOutcome(2, 2)).toEqual({ word: 'Draw', outcome: 'D' })
    // Penalties only count on a level score, and a level shoot-out (never stored) is still a draw
    expect(knockoutOutcome(2, 1, { us: 3, them: 4 })).toEqual({ word: 'Win', outcome: 'W' })
    expect(knockoutOutcome(1, 1, { us: 4, them: 4 })).toEqual({ word: 'Draw', outcome: 'D' })
  })

  it('splits a club-season name before its season so the season stays on one line', () => {
    expect(splitSeason('Luton Town 2023-24')).toEqual({ club: 'Luton Town', season: '2023-24' })
    expect(splitSeason('West Bromwich Albion 2010-11')).toEqual({ club: 'West Bromwich Albion', season: '2010-11' })
    expect(splitSeason('Touchline XI')).toEqual({ club: 'Touchline XI', season: null })
    expect(splitSeason('1. FC Köln 2008-09')).toEqual({ club: '1. FC Köln', season: '2008-09' })
    expect(splitSeason('2023-24')).toEqual({ club: '2023-24', season: null })
  })
})
