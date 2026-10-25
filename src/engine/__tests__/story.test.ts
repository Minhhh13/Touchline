import { describe, expect, it } from 'vitest'
import { clinchMatchweeks } from '../story'
import { computeTable, generateFixtures, positionOf } from '../season'
import { Rng } from '../rng'
import type { Fixture, MatchResult } from '../types'

/** A fixture with a result: only the goals matter to the table. */
function fx(matchweek: number, homeTeamId: string, awayTeamId: string, homeGoals?: number, awayGoals?: number): Fixture {
  const f: Fixture = { matchweek, homeTeamId, awayTeamId }
  if (homeGoals !== undefined && awayGoals !== undefined) {
    const result: MatchResult = { homeTeamId, awayTeamId, homeGoals, awayGoals, events: [], homeStats: [], awayStats: [], xg: { home: 0, away: 0 } }
    f.result = result
  }
  return f
}

// Four clubs, a double round robin of six matchweeks: U-A B-C, U-B C-A, U-C A-B, then the same again
const FOUR = ['u', 'a', 'b', 'c']
function fourClubs(score: (mw: number, home: string, away: string) => [number, number]): Fixture[] {
  const rounds: Array<Array<[string, string]>> = [
    [['u', 'a'], ['b', 'c']],
    [['u', 'b'], ['c', 'a']],
    [['u', 'c'], ['a', 'b']],
  ]
  const out: Fixture[] = []
  for (let leg = 0; leg < 2; leg++)
    rounds.forEach((pairs, r) => {
      const mw = leg * 3 + r + 1
      for (const [h, a] of pairs) {
        const [home, away] = leg ? [a, h] : [h, a]
        const [hg, ag] = score(mw, home, away)
        out.push(fx(mw, home, away, hg, ag))
      }
    })
  return out
}

describe('clinchMatchweeks', () => {
  it('seals an early title the week no rival can reach the user any more', () => {
    // The user wins every game and the other three draw among themselves: after MW 3 the rivals have 2 points
    // and 3 games left (ceiling 11 against the user's 9); after MW 4 the best ceiling is 9 against 12
    const f = fourClubs((_, h, a) => (h === 'u' ? [2, 0] : a === 'u' ? [0, 2] : [1, 1]))
    expect(clinchMatchweeks(f, FOUR, 'u')).toEqual({ clinchedAt: 4, doomedAt: null })
  })

  it('a title level on points with the rival is sealed on the last day, by the final table', () => {
    // The user and A draw both meetings and win everything else; the user's wider margins win it on goal difference
    const f = fourClubs((_, h, a) => {
      if ((h === 'u' && a === 'a') || (h === 'a' && a === 'u')) return [1, 1]
      if (h === 'u') return [5, 0]
      if (a === 'u') return [0, 5]
      if (h === 'a') return [1, 0]
      if (a === 'a') return [0, 1]
      return [0, 0]
    })
    const table = computeTable(f, FOUR)
    expect(table.find((r) => r.teamId === 'u')!.points).toBe(table.find((r) => r.teamId === 'a')!.points)
    expect(positionOf(table, 'u')).toBe(1)
    expect(clinchMatchweeks(f, FOUR, 'u')).toEqual({ clinchedAt: 6, doomedAt: null })
  })

  it('a runner-up never clinches', () => {
    const f = fourClubs((_, h, a) => {
      if ((h === 'u' && a === 'a') || (h === 'a' && a === 'u')) return [1, 1]
      if (h === 'a') return [5, 0]
      if (a === 'a') return [0, 5]
      if (h === 'u') return [1, 0]
      if (a === 'u') return [0, 1]
      return [0, 0]
    })
    expect(positionOf(computeTable(f, FOUR), 'u')).toBe(2)
    // One relegation place: in a four-club league the default three would send the runner-up down
    expect(clinchMatchweeks(f, FOUR, 'u', 1)).toEqual({ clinchedAt: null, doomedAt: null })
  })

  it('dooms a club the week enough rivals are out of its reach', () => {
    // The user loses every game, the rest draw. Points after MW 4: A 8, B 5, C 6 against the user's ceiling of 6
    // (two games left): only A is out of reach. After MW 5: A 9, B 8, C 7 against 3: all three, so with one
    // relegation place the user is down at MW 5
    const f = fourClubs((_, h, a) => (h === 'u' ? [0, 1] : a === 'u' ? [1, 0] : [1, 1]))
    expect(clinchMatchweeks(f, FOUR, 'u', 1)).toEqual({ clinchedAt: null, doomedAt: 5 })
    // With the usual three places in a four-club league, one club out of reach is enough: MW 4
    expect(clinchMatchweeks(f, FOUR, 'u')).toEqual({ clinchedAt: null, doomedAt: 4 })
  })

  it('counts fixtures left, not matchweeks, so a bye is no game', () => {
    // Three clubs, one game a week, one club resting: the user wins everything, A beats B twice
    const f = [fx(1, 'u', 'a', 1, 0), fx(2, 'a', 'b', 1, 0), fx(3, 'b', 'u', 0, 1), fx(4, 'a', 'u', 0, 1), fx(5, 'b', 'a', 0, 1), fx(6, 'u', 'b', 1, 0)]
    // After MW 4 the user has 9; A has 3 and one game left (6), B none and two left (6). Counting two
    // matchweeks left for everyone would give A a ceiling of 9 and no clinch yet.
    expect(clinchMatchweeks(f, ['u', 'a', 'b'], 'u')).toEqual({ clinchedAt: 4, doomedAt: null })
  })

  it('reads a season cut short only up to the last week fully played', () => {
    const f = fourClubs((_, h, a) => (h === 'u' ? [2, 0] : a === 'u' ? [0, 2] : [1, 1])).map((x) => (x.matchweek >= 4 ? { ...x, result: undefined } : x))
    expect(clinchMatchweeks(f, FOUR, 'u')).toEqual({ clinchedAt: null, doomedAt: null })
  })

  it('agrees with the final table on 200 random seasons of 20 and 19 clubs', () => {
    let clinched = 0
    let doomed = 0
    for (let s = 0; s < 200; s++) {
      const n = s % 2 ? 19 : 20
      const ids = ['u', ...Array.from({ length: n - 1 }, (_, i) => `c${i}`)]
      const rng = new Rng(`story-table-${s}`)
      // The user's strength runs from much weaker than the field to much stronger, so titles and relegations both turn up
      const strength = (s % 5) - 2
      const f = generateFixtures(ids, rng).map((x) => {
        const edge = x.homeTeamId === 'u' ? strength : x.awayTeamId === 'u' ? -strength : 0
        const hg = Math.max(0, Math.round(rng.next() * 3 + edge * 0.6))
        const ag = Math.max(0, Math.round(rng.next() * 3 - edge * 0.6))
        return fx(x.matchweek, x.homeTeamId, x.awayTeamId, hg, ag)
      })
      const pos = positionOf(computeTable(f, ids), 'u')
      const c = clinchMatchweeks(f, ids, 'u')
      expect(c.clinchedAt !== null).toBe(pos === 1)
      expect(c.doomedAt !== null).toBe(pos > n - 3)
      if (c.clinchedAt !== null) {
        clinched++
        // At the clinch week the user is top of the table as it stood
        const then = computeTable(f.filter((x) => x.matchweek <= c.clinchedAt!), ids)
        expect(positionOf(then, 'u')).toBe(1)
      }
      if (c.doomedAt !== null) doomed++
    }
    expect(clinched).toBeGreaterThan(20)
    expect(doomed).toBeGreaterThan(20)
  })
})
