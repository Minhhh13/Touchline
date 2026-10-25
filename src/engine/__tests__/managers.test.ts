import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { ARCHETYPES, MANAGER_EDGE, MANAGER_OPTIONS_MAX, MANAGER_OPTIONS_MIN, MANAGER_STYLES, YOUTH_AGE, managerBoost, managerOptions, managersOf, suitsStyle } from '../managers'
import { simulateMatch, pairingExpectation, type MatchTeamInput } from '../match'
import { aiRatingOffset, aiTeamInput, buildAiClubs } from '../season'
import { defaultTactics } from '../tactics'
import type { PlayerSeason, Tactics } from '../types'
import { CHALLENGE_TACTIC_VALUES } from '../challenge'

const u = loadTestUniverse(['england'])

describe('manager facts', () => {
  it('names the real head coach of a club-season, the longest in charge first', () => {
    expect(managersOf('arsenal', 2008).map((m) => m.name)).toEqual(['Arsène Wenger'])
    expect(managersOf('manchester-united', 2012)[0].name).toBe('Alex Ferguson')
    const m = managersOf('arsenal', 2008)[0]
    expect(m).toMatchObject({ clubId: 'arsenal', season: 2008 })
    expect(MANAGER_STYLES).toContain(m.style)
    expect(m.id).toMatch(/^Q\d+$/)
  })

  it('has nothing for a club-season it never recorded', () => {
    expect(managersOf('no-such-club', 2010)).toEqual([])
    expect(managersOf('arsenal', 1990)).toEqual([])
  })

  it('covers most club-seasons of the Premier League packs', () => {
    // The standard seasons: the manager facts predate the classic seasons, which fall back to archetypes
    const cs = u.clubSeasons.filter((c) => c.leagueId === 'england' && !c.classic)
    const covered = cs.filter((c) => managersOf(c.clubId, c.season).length > 0).length
    expect(covered / cs.length).toBeGreaterThan(0.5)
  })
})

describe('managerOptions', () => {
  it('offers the managers of the drafted club-seasons, most picks first, each man once', () => {
    const drafted = [
      { clubId: 'manchester-united', season: 2012 },
      { clubId: 'arsenal', season: 2008 },
      { clubId: 'arsenal', season: 2008 },
      { clubId: 'arsenal', season: 2009 },
    ]
    const opts = managerOptions(drafted)
    expect(opts[0].name).toBe('Arsène Wenger')
    expect(opts[0].season).toBe(2008)
    expect(opts.filter((m) => m.name === 'Arsène Wenger').length).toBe(1)
    expect(opts.some((m) => m.name === 'Alex Ferguson')).toBe(true)
    expect(opts.length).toBeGreaterThanOrEqual(MANAGER_OPTIONS_MIN)
    expect(opts.length).toBeLessThanOrEqual(MANAGER_OPTIONS_MAX)
  })

  it('makes up a short list with archetypes of styles not yet offered, the same way every time', () => {
    const none = managerOptions([{ clubId: 'no-such-club', season: 2010 }])
    expect(none.length).toBe(MANAGER_OPTIONS_MIN)
    expect(none.every((m) => m.archetype && m.id.startsWith('arch-'))).toBe(true)
    expect(new Set(none.map((m) => m.style)).size).toBe(none.length)
    expect(managerOptions([{ clubId: 'no-such-club', season: 2010 }])).toEqual(none)
    const one = managerOptions([{ clubId: 'arsenal', season: 2008 }])
    expect(one[0].name).toBe('Arsène Wenger')
    expect(one.slice(1).every((m) => m.archetype && m.style !== one[0].style)).toBe(true)
    expect(ARCHETYPES.map((a) => a.style).sort()).toEqual([...MANAGER_STYLES].sort())
  })

  it('every drafted Premier League club-season gives a full, valid list', () => {
    for (const cs of u.clubSeasons.filter((c) => c.leagueId === 'england')) {
      const opts = managerOptions([cs])
      expect(opts.length).toBeGreaterThanOrEqual(MANAGER_OPTIONS_MIN)
      for (const m of opts) expect(MANAGER_STYLES).toContain(m.style)
    }
  })
})

/** Every combination of the six team instructions, with and without a penalty taker. */
function allTactics(): Tactics[] {
  const out: Tactics[] = []
  const v = CHALLENGE_TACTIC_VALUES
  for (const mentality of v.mentality)
    for (const pressing of v.pressing)
      for (const defensiveLine of v.defensiveLine)
        for (const pens of [false, true]) out.push({ ...defaultTactics('4-3-3'), mentality, pressing, defensiveLine, ...(pens ? { setPieces: { penalties: 'x' } } : {}) })
  return out
}

describe('managerBoost', () => {
  const pool = u.clubSeasons.find((c) => c.clubId === 'arsenal' && c.season === 2015)!.squad
  const young = pool.filter((p) => p.age <= YOUTH_AGE)
  const old = pool.filter((p) => p.age > YOUTH_AGE)

  it('stays within the edge for every style, instruction and XI', () => {
    for (const style of MANAGER_STYLES) {
      for (const t of allTactics()) {
        for (const xi of [pool.slice(0, 11), young, old, [] as PlayerSeason[]]) {
          const b = managerBoost(style, t, xi)
          expect(b.attack).toBeGreaterThanOrEqual(1 - MANAGER_EDGE - 1e-12)
          expect(b.attack).toBeLessThanOrEqual(1 + MANAGER_EDGE + 1e-12)
          expect(b.defence).toBeGreaterThanOrEqual(1 - MANAGER_EDGE - 1e-12)
          expect(b.defence).toBeLessThanOrEqual(1 + MANAGER_EDGE + 1e-12)
          expect(managerBoost(style, t, xi)).toEqual(b)
        }
      }
    }
  })

  it('grows when the instructions suit the style, and with young legs for a youth manager', () => {
    const base = defaultTactics('4-3-3')
    const press = managerBoost('pressing', { ...base, pressing: 'high' }, [])
    const pressOff = managerBoost('pressing', { ...base, pressing: 'low' }, [])
    expect(suitsStyle('pressing', { ...base, pressing: 'high' })).toBe(true)
    expect(press.attack).toBeGreaterThan(pressOff.attack)
    expect(press.defence).toBeLessThan(pressOff.defence)
    expect(managerBoost('attacking', { ...base, mentality: 'attacking' }, []).attack).toBeGreaterThan(managerBoost('attacking', { ...base, mentality: 'defensive' }, []).attack)
    expect(managerBoost('defensive', { ...base, defensiveLine: 'deep' }, []).defence).toBeLessThan(managerBoost('defensive', { ...base, mentality: 'attacking' }, []).defence)
    if (young.length && old.length) expect(managerBoost('youth', base, young).attack).toBeGreaterThan(managerBoost('youth', base, old).attack)
  })
})

describe('the manager edge in the match engine', () => {
  const ai = buildAiClubs(u, 'england', 2015, 'burnley')
  const offset = aiRatingOffset(u, ai, 'calibrated')
  const ids = Object.keys(ai)
  const side = (i: number): MatchTeamInput => aiTeamInput(u, ai[ids[i]], offset)

  it('a side without a manager, or with a neutral one, plays exactly as before', () => {
    for (let i = 0; i < 12; i++) {
      const plain = simulateMatch({ rng: new Rng(`mgr-match-${i}`), home: side(i), away: side(i + 1), detail: 'summary' })
      const neutral = simulateMatch({ rng: new Rng(`mgr-match-${i}`), home: { ...side(i), managerBoost: { attack: 1, defence: 1 } }, away: side(i + 1), detail: 'summary' })
      expect(neutral.events).toEqual(plain.events)
      expect(neutral.homeGoals).toBe(plain.homeGoals)
      expect(neutral.awayGoals).toBe(plain.awayGoals)
    }
  })

  it('moves expected goals by exactly the boost, in the pre-match sums', () => {
    const plain = pairingExpectation(side(0), side(1))
    const boosted = pairingExpectation({ ...side(0), managerBoost: { attack: 1.03, defence: 0.98 } }, side(1))
    expect(boosted.lamH / plain.lamH).toBeCloseTo(1.03, 6)
    expect(boosted.lamA / plain.lamA).toBeCloseTo(0.98, 6)
  })

  it('an attacking edge scores more over many matches, and the same seed replays the same match', () => {
    let plainGoals = 0
    let boostedGoals = 0
    for (let i = 0; i < 300; i++) {
      const h = side(i % ids.length)
      const a = side((i + 3) % ids.length)
      plainGoals += simulateMatch({ rng: new Rng(`mgr-many-${i}`), home: h, away: a, detail: 'summary' }).homeGoals
      boostedGoals += simulateMatch({ rng: new Rng(`mgr-many-${i}`), home: { ...h, managerBoost: { attack: 1 + MANAGER_EDGE, defence: 1 } }, away: a, detail: 'summary' }).homeGoals
    }
    expect(boostedGoals).toBeGreaterThanOrEqual(plainGoals)
    const again = simulateMatch({ rng: new Rng('mgr-many-7'), home: { ...side(7), managerBoost: { attack: 1.02, defence: 0.99 } }, away: side(10), detail: 'summary' })
    const twice = simulateMatch({ rng: new Rng('mgr-many-7'), home: { ...side(7), managerBoost: { attack: 1.02, defence: 0.99 } }, away: side(10), detail: 'summary' })
    expect(twice.events).toEqual(again.events)
  })
})
