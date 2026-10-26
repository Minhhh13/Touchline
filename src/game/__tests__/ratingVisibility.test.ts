import { describe, expect, it } from 'vitest'
import { QUICK_RULES, SEASON_RULES, ratingsHidden, withDifficulty, type DraftRules, type Twist } from '@engine/draft'
import { DAILY_RULES } from '../logic/daily'
import { createGame } from '../logic/setup'
import { ratingHidden, ratingShown, revealsOnPick, type RatingPlace } from '../logic/ratingVisibility'
import type { GameSettings } from '../types'

const PLACES: RatingPlace[] = ['squad', 'offer', 'market', 'ghost', 'grades']
const TWISTS: Array<Twist | null> = [null, 'golden', 'basement', 'blind', 'decade']

const blind: DraftRules = { ...QUICK_RULES, showRatings: false }
const hard = withDifficulty(QUICK_RULES, 'hard')
const oldHard: DraftRules = { ...SEASON_RULES, hardMode: true, difficulty: undefined, showRatings: undefined }

describe('rating visibility', () => {
  it('shows every rating with ratings on and no blind twist, as before', () => {
    for (const rules of [QUICK_RULES, SEASON_RULES, DAILY_RULES])
      for (const place of PLACES) for (const twist of TWISTS) if (twist !== 'blind' || place !== 'offer') expect(ratingShown(rules, place, { twist, complete: place === 'grades' })).toBe(true)
  })

  it('hides only the offer on a blind twist with ratings on', () => {
    expect(ratingShown(QUICK_RULES, 'offer', { twist: 'blind' })).toBe(false)
    expect(ratingShown(QUICK_RULES, 'squad', { twist: 'blind' })).toBe(true)
    expect(ratingShown(QUICK_RULES, 'ghost', { twist: 'blind' })).toBe(true)
    expect(ratingShown(QUICK_RULES, 'market', { twist: 'blind' })).toBe(true)
    expect(revealsOnPick(QUICK_RULES, 'blind')).toBe(true)
    expect(revealsOnPick(QUICK_RULES, 'golden')).toBe(false)
    expect(revealsOnPick(QUICK_RULES)).toBe(false)
  })

  it('in blind mode hides what is being chosen and shows the user squad', () => {
    for (const rules of [blind, hard, oldHard]) {
      expect(ratingsHidden(rules)).toBe(true)
      for (const twist of TWISTS) {
        expect(ratingShown(rules, 'squad', { twist })).toBe(true)
        expect(ratingShown(rules, 'offer', { twist })).toBe(false)
        expect(ratingShown(rules, 'market', { twist })).toBe(false)
        expect(ratingShown(rules, 'ghost', { twist })).toBe(false)
        expect(revealsOnPick(rules, twist)).toBe(true)
      }
    }
  })

  it('shows the pick grades only once the draft is complete', () => {
    for (const rules of [QUICK_RULES, blind, hard]) {
      expect(ratingShown(rules, 'grades', { complete: false })).toBe(false)
      expect(ratingShown(rules, 'grades')).toBe(false)
      expect(ratingShown(rules, 'grades', { complete: true })).toBe(true)
    }
  })

  it('ratingHidden is the inverse everywhere', () => {
    for (const rules of [QUICK_RULES, blind, hard]) for (const place of PLACES) for (const twist of TWISTS) for (const complete of [false, true]) expect(ratingHidden(rules, place, { twist, complete })).toBe(!ratingShown(rules, place, { twist, complete }))
  })

  it('reads the rules a real blind or hard quick draft is created with', () => {
    for (const seed of ['blind-reveal-1', 'blind-reveal-2', 'blind-reveal-3']) {
      const base: GameSettings = { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Blind XI', shortName: 'BLD', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'wolves', leagueSeason: 2020, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' }
      for (const rules of [{ ...base.rules, showRatings: false }, withDifficulty(base.rules, 'hard'), base.rules]) {
        const g = createGame({ ...base, rules })
        const r = g.draft!.rules
        expect(ratingShown(r, 'squad')).toBe(true)
        expect(ratingShown(r, 'offer')).toBe(!ratingsHidden(rules))
      }
    }
  })
})
