import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { arenaClub, arenaPool, clubIdOfKey, clubSeasonKey, defaultTakers, finalOpponent, giantsOf, kickChance, knockoutOffset, KO_FIELD_TARGET, penaltyShootout, teamStrengthOf, type Shootout, type Taker } from '../knockout'
import type { PlayerSeason } from '../types'

const u = loadTestUniverse(['england'])

const taker = (id: string, shooting: number, mentality: number): Taker => ({ id, shooting, mentality })
const plain = (side: string) => Array.from({ length: 5 }, (_, i) => taker(`${side}${i}`, 75, 70))

/** Replays a shoot-out kick by kick and checks it never went on past the point one side could no longer be caught. */
function stoppedInTime(so: Shootout): boolean {
  let h = 0
  let a = 0
  let th = 0
  let ta = 0
  const decided = () => (th <= 5 && ta <= 5 ? h > a + (5 - ta) || a > h + (5 - th) : th === ta && h !== a)
  for (let i = 0; i < so.kicks.length; i++) {
    if (decided()) return false
    const k = so.kicks[i]
    if (k.side === 'home') {
      th++
      if (k.scored) h++
    } else {
      ta++
      if (k.scored) a++
    }
  }
  return decided() && h === so.home && a === so.away
}

describe('penaltyShootout', () => {
  it('always ends decided, kicking ABAB, and stops as soon as a side cannot be caught', () => {
    for (let i = 0; i < 2000; i++) {
      const so = penaltyShootout(new Rng(`so-${i}`), { home: plain('h'), away: plain('a') }, { home: 75, away: 75 })
      expect(so.home).not.toBe(so.away)
      so.kicks.forEach((k, j) => expect(k.side).toBe(j % 2 === 0 ? 'home' : 'away'))
      expect(stoppedInTime(so), `seed so-${i}`).toBe(true)
    }
  })

  it('3-0 after three kicks each ends after six kicks', () => {
    let seen = 0
    for (let i = 0; i < 3000 && seen < 5; i++) {
      const so = penaltyShootout(new Rng(`three-nil-${i}`), { home: plain('h').map((t) => ({ ...t, shooting: 99, mentality: 99 })), away: plain('a').map((t) => ({ ...t, shooting: 40, mentality: 40 })) }, { home: 90, away: 50 })
      const firstSix = so.kicks.slice(0, 6)
      if (firstSix.length === 6 && firstSix.every((k) => k.scored === (k.side === 'home'))) {
        seen++
        expect(so.kicks).toHaveLength(6)
        expect([so.home, so.away]).toEqual([3, 0])
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('keeps every chance within 0.50 and 0.92', () => {
    for (const s of [0, 40, 70, 99]) for (const m of [0, 40, 70, 99]) for (const gk of [0, 50, 75, 99]) for (let k = 1; k <= 8; k++) {
      const p = kickChance({ shooting: s, mentality: m }, gk, k)
      expect(p).toBeGreaterThanOrEqual(0.5)
      expect(p).toBeLessThanOrEqual(0.92)
    }
    const so = penaltyShootout(new Rng('so-range'), { home: [taker('x', 99, 99)], away: [taker('y', 0, 0)] }, { home: 0, away: 99 })
    for (const k of so.kicks) expect(k.p >= 0.5 && k.p <= 0.92).toBe(true)
  })

  it('rewards composure on kicks four and five: that order beats its reverse over 4,000 shoot-outs', () => {
    // Three nervy men and two composed ones, equally good strikers
    const calmLast = [taker('n1', 75, 50), taker('n2', 75, 50), taker('n3', 75, 50), taker('c1', 75, 92), taker('c2', 75, 92)]
    const calmFirst = [...calmLast].reverse()
    const wins = (order: Taker[]) => {
      let w = 0
      for (let i = 0; i < 4000; i++) {
        const so = penaltyShootout(new Rng(`order-${i}`), { home: order, away: plain('a') }, { home: 75, away: 75 })
        if (so.home > so.away) w++
      }
      return w
    }
    const late = wins(calmLast)
    const early = wins(calmFirst)
    expect(late).toBeGreaterThan(early)
  })

  it('cycles the order through every taker before anyone goes again', () => {
    for (let i = 0; i < 400; i++) {
      const so = penaltyShootout(new Rng(`cycle-${i}`), { home: [taker('a', 70, 70), taker('b', 70, 70), taker('c', 70, 70)], away: plain('z') }, { home: 75, away: 75 })
      const home = so.kicks.filter((k) => k.side === 'home').map((k) => k.takerId)
      home.forEach((id, j) => expect(id).toBe(['a', 'b', 'c'][j % 3]))
    }
  })

  it('plays out identically after a JSON round trip of the Rng state', () => {
    for (let i = 0; i < 50; i++) {
      const rng = new Rng(`json-${i}`)
      rng.next()
      const copy = Rng.fromState(JSON.parse(JSON.stringify(rng.getState())))
      const a = penaltyShootout(rng, { home: plain('h'), away: plain('a') }, { home: 70, away: 80 })
      const b = penaltyShootout(copy, { home: plain('h'), away: plain('a') }, { home: 70, away: 80 })
      expect(b).toEqual(a)
    }
  })
})

describe('defaultTakers', () => {
  it('puts the named taker first, then by shooting and mentality, the goalkeeper last', () => {
    const cs = u.clubSeasons.find((c) => c.squad.filter((p) => p.positions[0] === 'GK').length >= 1 && c.squad.length >= 18)!
    const keeper = cs.squad.find((p) => p.positions[0] === 'GK')!
    const outfield = cs.squad.filter((p) => p.positions[0] !== 'GK').slice(0, 10)
    const ids = [keeper.id, ...outfield.map((p) => p.id)]
    const get = (id: string) => u.index[id]
    const score = (p: PlayerSeason) => (p.attributes.shooting + p.attributes.mentality) / 2
    const order = defaultTakers(ids, get)
    expect(order).toHaveLength(11)
    expect(order[10]).toBe(keeper.id)
    for (let i = 1; i < 10; i++) expect(score(get(order[i - 1])!)).toBeGreaterThanOrEqual(score(get(order[i])!))
    const named = outfield[outfield.length - 1].id
    const withTaker = defaultTakers(ids, get, named)
    expect(withTaker[0]).toBe(named)
    expect(withTaker[10]).toBe(keeper.id)
  })
})

describe('the arena field', () => {
  const all = { leagues: ['england'] }

  it('keys club-seasons as clubId@season and reads the club back', () => {
    const cs = u.clubSeasons[0]
    expect(clubSeasonKey(cs)).toBe(`${cs.clubId}@${cs.season}`)
    expect(clubIdOfKey(clubSeasonKey(cs))).toBe(cs.clubId)
    const club = arenaClub(u, cs)
    expect(club.id).toBe(clubSeasonKey(cs))
    expect(club.name).toMatch(/ \d{4}-\d{2}$/)
    expect(Object.values(club.state).every((s) => s.familiarity === 70 && s.sharpness === 85)).toBe(true)
  })

  it('respects the field and the era over 100 seeds', () => {
    const era = { ...all, fromSeason: 2014, toSeason: 2019 }
    const giants = new Set(giantsOf(u, arenaPool(u, era)).map(clubSeasonKey))
    const pool = new Set(arenaPool(u, era).map(clubSeasonKey))
    const wheelSeasons = new Set<number>()
    for (let i = 0; i < 100; i++) {
      const champ = finalOpponent(u, new Rng(`field-${i}`), { ...era, field: 'champions' })
      expect(champ.champions).toBe(true)
      expect(champ.season >= 2014 && champ.season <= 2019).toBe(true)
      expect(giants.has(clubSeasonKey(finalOpponent(u, new Rng(`field-${i}`), { ...era, field: 'giants' })))).toBe(true)
      const wheel = finalOpponent(u, new Rng(`field-${i}`), { ...era, field: 'wheel' })
      expect(pool.has(clubSeasonKey(wheel))).toBe(true)
      wheelSeasons.add(wheel.season)
    }
    // The wheel spreads over the era's seasons; the giants are a narrow, strong band
    expect(wheelSeasons.size).toBeGreaterThanOrEqual(5)
    const strengths = [...giants].map((k) => teamStrengthOf(u, u.clubSeasonByKey[k]))
    const poolMedian = [...pool].map((k) => teamStrengthOf(u, u.clubSeasonByKey[k])).sort((a, b) => a - b)[Math.floor(pool.size / 2)]
    expect(Math.min(...strengths)).toBeGreaterThan(poolMedian)
  })

  it('draws the same opponent from the same stream, and the pool order never depends on load order', () => {
    const a = finalOpponent(u, new Rng('same#field'), { ...all, field: 'giants' })
    const b = finalOpponent(u, new Rng('same#field'), { ...all, field: 'giants' })
    expect(clubSeasonKey(b)).toBe(clubSeasonKey(a))
    const keys = arenaPool(u, all).map(clubSeasonKey)
    expect(keys).toEqual([...keys].sort())
  })

  it('calibrates to the field target on Calibrated and leaves Realistic alone', () => {
    expect(knockoutOffset([86.4], 'giants', 'calibrated')).toBe(8.4)
    expect(knockoutOffset([70], 'giants', 'calibrated')).toBe(0)
    expect(knockoutOffset([86.4], 'giants', 'realistic')).toBe(0)
    expect(knockoutOffset([80, 76], 'wheel', 'calibrated')).toBe(78 - KO_FIELD_TARGET.wheel)
  })
})
