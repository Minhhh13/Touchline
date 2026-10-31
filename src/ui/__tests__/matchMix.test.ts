import { describe, expect, it } from 'vitest'
import { matchPath } from '../match/epochs'
import { FAST_SPEED, MIX, MOOD, admit, bedLevel, createMix, crowdMood, ducked, type MixKind } from '../sound/mix'
import { ballCues, ALWAYS } from '../sound/ball'
import { resultFeed } from './feeds'

const feeds = Array.from({ length: 6 }, (_, i) => resultFeed(i))
const paths = feeds.map((f) => matchPath(f).path)

describe('the match day’s mix', () => {
  it('rouses the crowd after a goal and a shot, and lets it fall back in a quiet spell', () => {
    let goals = 0
    for (const path of paths) {
      for (let t = 0; t <= 94; t += 0.25) {
        const m = crowdMood(path, t)
        expect(m).toBeGreaterThanOrEqual(0.1)
        expect(m).toBeLessThanOrEqual(1)
        expect(Math.round(m * 10)).toBeCloseTo(m * 10, 6)
      }
      for (const g of path.filter((k) => k.kind === 'goal')) {
        goals++
        const right = crowdMood(path, g.t + 0.01)
        const later = crowdMood(path, g.t + 8)
        expect(right).toBeGreaterThanOrEqual(MOOD.floor + MOOD.goal - 0.15)
        expect(right).toBeGreaterThan(later - 1e-9)
      }
    }
    expect(goals).toBeGreaterThan(0)
    // Over a match the bed moves: quiet spells and roused ones
    const moods = paths.flatMap((p) => Array.from({ length: 90 }, (_, t) => crowdMood(p, t)))
    expect(Math.min(...moods)).toBeLessThanOrEqual(0.4)
    expect(Math.max(...moods)).toBeGreaterThanOrEqual(0.8)
  })

  it('grows tense in a close finish', () => {
    // With no goal, no shot near either moment and the ball in the same place, 89' sits above 60'
    const still = [{ t: 0, x: 50, y: 50, kind: 'kickoff' as const, side: 'home' as const }]
    expect(crowdMood(still, 89)).toBeGreaterThan(crowdMood(still, 60))
    // Three goals clear by 89': no tension
    const won = [...still, ...[10, 20, 30].map((t) => ({ t, x: 100, y: 50, kind: 'goal' as const, side: 'home' as const })), { t: 31, x: 50, y: 50, kind: 'kickoff' as const, side: 'away' as const }]
    expect(crowdMood(won, 89)).toBe(crowdMood(won, 60))
  })

  it('sets the bed’s level from the mood, a little under at speed', () => {
    expect(bedLevel(1, 1, 1)).toBe(1)
    expect(bedLevel(1, 0.1, 1)).toBeLessThanOrEqual(0.5)
    expect(bedLevel(1, 1, FAST_SPEED)).toBeLessThan(bedLevel(1, 1, 1))
    expect(bedLevel(0.6, 1, 1)).toBeLessThanOrEqual(0.6)
    expect(bedLevel(0, 1, 1)).toBe(0)
  })

  it('a goal ducks everything but the whistle for its roar', () => {
    const mix = createMix()
    expect(admit(mix, 'goal', 1000, 1)).toBe(true)
    expect(ducked(mix, 1000 + MIX.goalDuck - 1)).toBe(true)
    for (const k of ['crowd', 'swell', 'ball', 'strike', 'chime'] as MixKind[]) expect(admit(mix, k, 1500, 1)).toBe(false)
    expect(admit(mix, 'whistle', 1500, 1)).toBe(true)
    expect(ducked(mix, 1000 + MIX.goalDuck)).toBe(false)
    expect(admit(mix, 'ball', 1000 + MIX.goalDuck, 1)).toBe(true)
  })

  it('never stacks at 4x: a real second never holds more than the budget of background sounds', () => {
    for (const speed of [1, 2, 4]) {
      for (const path of paths) {
        const mix = createMix()
        const cues = ballCues(path)
        // The cues played back at this speed against a real clock (4500 ms a minute at 1x)
        const heard: number[] = []
        for (const c of cues) {
          const now = (c.t * 4500) / speed
          const kind: MixKind = ALWAYS.has(c.touch) ? 'strike' : 'ball'
          if (admit(mix, kind, now, speed) && kind === 'ball') heard.push(now)
        }
        const cap = speed >= FAST_SPEED ? MIX.budgetFast : MIX.budget
        for (let i = 0; i < heard.length; i++) {
          const inWindow = heard.filter((h) => h >= heard[i] && h - heard[i] < MIX.window).length
          expect(inWindow).toBeLessThanOrEqual(cap)
        }
        if (speed === 1) expect(heard.length).toBeGreaterThan(50)
      }
    }
  })

  it('keeps a swell clear of the crowd’s reactions and off at speed', () => {
    const mix = createMix()
    expect(admit(mix, 'crowd', 0, 1)).toBe(true)
    expect(admit(mix, 'swell', MIX.swellQuiet - 1, 1)).toBe(false)
    expect(admit(mix, 'swell', MIX.swellQuiet, 1)).toBe(true)
    expect(admit(createMix(), 'swell', 0, FAST_SPEED)).toBe(false)
  })
})
