import { describe, expect, it } from 'vitest'
import { QUICK_RULES } from '@engine/draft'
import { arenaFormatLabel, finishDraftLabel, isQuickLike, MODE_TITLE, modeLabel, shareCardFooter, yearLabel, type LabelledGame, type ModeLabelStyle } from '../logic/modes'
import { createGame } from '../logic/setup'
import type { Mode } from '../types'

const STYLES: ModeLabelStyle[] = ['short', 'heading', 'share']
const MODES = Object.keys(MODE_TITLE) as Mode[]

function game(mode: Mode, year = 1, seed = 'K7Q2-MX9A'): LabelledGame {
  return { year, settings: { mode, seed } }
}

describe('mode labels', () => {
  it('gives every mode a title, a label in every style and a finish button', () => {
    expect(MODES).toEqual(['quick', 'daily', 'season', 'dynasty', 'arena'])
    for (const mode of MODES) {
      expect(MODE_TITLE[mode].length, mode).toBeGreaterThan(0)
      for (const style of STYLES) expect(modeLabel(game(mode, 2), style).length, `${mode} ${style}`).toBeGreaterThan(0)
      expect(finishDraftLabel(game(mode)).length, mode).toBeGreaterThan(0)
      expect(typeof isQuickLike(mode)).toBe('boolean')
    }
  })

  it('keeps the four existing modes worded byte for byte as the screens had them', () => {
    expect(MODE_TITLE).toEqual({ quick: 'Quick Draft', daily: 'Daily Challenge', season: 'Season', dynasty: 'Dynasty', arena: 'Arena' })
    const daily = game('daily', 1, 'daily-2026-10-25')
    const dynasty = game('dynasty', 2)
    // Home's active and parked rows
    expect([game('quick'), daily, game('season'), dynasty].map((g) => modeLabel(g, 'short'))).toEqual(['Quick draft', 'Daily challenge', 'Season', 'Dynasty · Year 2'])
    // The Summary's line above the verdict
    expect([game('quick'), daily, game('season'), dynasty].map((g) => modeLabel(g, 'heading'))).toEqual(['Quick draft', 'Daily challenge', 'Season', 'Dynasty year 2'])
    // The share text
    expect([game('quick'), daily, game('season'), dynasty].map((g) => modeLabel(g, 'share'))).toEqual(['Quick Draft', 'Daily 2026-10-25', 'Season', 'Dynasty Y2'])
    // The share card's footer
    expect([game('quick'), daily, game('season'), dynasty].map(shareCardFooter)).toEqual(['Seed K7Q2-MX9A', 'Daily challenge 2026-10-25', 'Seed K7Q2-MX9A', 'Seed K7Q2-MX9A'])
    // The Dugout header's year
    expect([game('quick'), daily, game('season'), dynasty].map(yearLabel)).toEqual([null, null, null, 'Year 2'])
  })

  it('words the Draft finish buttons as before: the quick season, a dynasty summer, pre-season', () => {
    expect(finishDraftLabel(game('quick'))).toBe('Simulate the season')
    expect(finishDraftLabel(game('daily', 1, 'daily-2026-10-25'), 9)).toBe('Simulate the season')
    expect(finishDraftLabel(game('season'))).toBe('Go to pre-season')
    expect(finishDraftLabel(game('season'), 15)).toBe('Go to pre-season with 15')
    expect(finishDraftLabel(game('dynasty'))).toBe('Go to pre-season')
    expect(finishDraftLabel(game('dynasty', 2))).toBe('Into the new season')
    expect(finishDraftLabel(game('dynasty', 3), 12)).toBe('Into the new season')
  })

  it('names the arena by its format, in every style', () => {
    const final: LabelledGame = { year: 1, settings: { mode: 'arena', seed: 'K7Q2-MX9A', arena: { format: 'cup', size: 2, field: 'giants' } } }
    for (const style of STYLES) expect(modeLabel(final, style)).toBe('Cup Final')
    expect(arenaFormatLabel({ format: 'gauntlet' })).toBe('The Gauntlet')
    expect(arenaFormatLabel({ format: 'cup', size: 16 })).toBe('The Cup · 16 clubs')
    expect(finishDraftLabel(final)).toBe('On to the final')
    expect(shareCardFooter(final)).toBe('Seed K7Q2-MX9A')
    expect(yearLabel(final)).toBeNull()
  })

  it('treats quick and daily as quick-like and the managed modes as not', () => {
    expect(MODES.filter(isQuickLike)).toEqual(['quick', 'daily'])
  })

  it('reads a real game', () => {
    const g = createGame({ mode: 'dynasty', seed: 'modes-real', formationId: '4-3-3', teamName: 'Label XI', shortName: 'LAB', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
    expect(modeLabel(g, 'short')).toBe(`Dynasty · Year ${g.year}`)
    expect(shareCardFooter(g)).toBe('Seed modes-real')
  })
})
