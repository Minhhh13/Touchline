import { describe, expect, it } from 'vitest'
import { gauntletBandText, knockoutOutcome, longWord, personalBest, splitSeason, kickLine, takerMoved } from '../arenaText'
import { GAUNTLET_RUNGS, rungBandLabel } from '@engine/gauntlet'

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

  it('reads a Gauntlet rung from 2 to 10 as the share of the wheel it is stronger than, the rest as the engine says', () => {
    expect(gauntletBandText(1)).toBe('the weakest 10% of the wheel')
    expect(gauntletBandText(2)).toBe('stronger than 10% of the wheel')
    expect(gauntletBandText(8)).toBe('stronger than 70% of the wheel')
    expect(gauntletBandText(10)).toBe('stronger than 90% of the wheel')
    for (let rung = 2; rung <= 10; rung++) expect(gauntletBandText(rung)).toBe(`stronger than ${10 * (rung - 1)}% of the wheel`)
    for (let rung = 11; rung <= GAUNTLET_RUNGS; rung++) expect(gauntletBandText(rung)).toBe(rungBandLabel(rung))
    // The engine's words are untouched (the verifier bundles gauntlet.ts)
    expect(rungBandLabel(2)).toBe('top 90% of the wheel')
  })
})

describe('the shoot-out in words (accessibility round 3)', () => {
  it('says each kick with the score, and the verdict on the last', () => {
    expect(kickLine({ us: true, scored: true }, 1, 'H. Kane', 1, 0, null)).toBe('Kick 1, ours: H. Kane scores. 1-0.')
    expect(kickLine({ us: false, scored: false }, 2, 'Salah', 1, 0, null)).toBe('Kick 2, theirs: Salah misses. 1-0.')
    expect(kickLine({ us: false, scored: true }, 10, 'Salah', 4, 5, 'Lost 4-5 on penalties')).toBe('Kick 10, theirs: Salah scores. 4-5. Lost 4-5 on penalties.')
  })
  it('says where a moved taker now kicks', () => {
    expect(takerMoved('H. Kane', 0)).toBe('H. Kane takes kick 1.')
  })

  it('marks a run that beats or ties the best of its own kind, never the first run or a scoreless one', () => {
    const runs = [
      { id: 'a', format: 'gauntlet' as const, score: 5 },
      { id: 'b', format: 'gauntlet' as const, score: 3 },
      { id: 'c', format: 'cup' as const, size: 8, score: 3 },
      { id: 'd', format: 'cup' as const, size: 16, score: 1 },
      { id: 'e', format: 'cup' as const, score: 1 },
    ]
    expect(personalBest(runs, { id: 'x', format: 'gauntlet', score: 7 })).toEqual({ kind: 'best', was: 5 })
    expect(personalBest(runs, { id: 'x', format: 'gauntlet', score: 5 })).toEqual({ kind: 'equal', was: 5 })
    expect(personalBest(runs, { id: 'x', format: 'gauntlet', score: 4 })).toBeNull()
    // A Cup is measured against Cups of its own size; a final (no size) against finals
    expect(personalBest(runs, { id: 'x', format: 'cup', size: 16, score: 2 })).toEqual({ kind: 'best', was: 1 })
    expect(personalBest(runs, { id: 'x', format: 'cup', size: 32, score: 2 })).toBeNull()
    expect(personalBest(runs, { id: 'x', format: 'cup', score: 1 })).toEqual({ kind: 'equal', was: 1 })
    // The run itself is not one of the earlier runs; nothing to beat, or nothing won, is no mark
    expect(personalBest([{ id: 'x', format: 'gauntlet', score: 9 }], { id: 'x', format: 'gauntlet', score: 9 })).toBeNull()
    expect(personalBest(runs, { id: 'x', format: 'gauntlet', score: 0 })).toBeNull()
  })
})

describe('longWord: a summary banner a size down on a phone (r9)', () => {
  it('marks the knockout words that broke at their hyphen, never a short banner', () => {
    expect(longWord('Semi-finalists')).toBe(true)
    expect(longWord('Quarter-finalists')).toBe(true)
    expect(longWord('Out in the round of 16')).toBe(false)
    expect(longWord('8 rungs')).toBe(false)
    expect(longWord('Cup winners')).toBe(false)
    expect(longWord('Runners-up')).toBe(false)
  })
})
