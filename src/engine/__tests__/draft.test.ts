import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { autoDraft, canSpin, isComplete, newDraft, nextSpinTwisted, pick, QUICK_RULES, respin, SEASON_RULES, spin, TWIST_EVERY, twistDecade, wheelPool, canUse, eligibleSlots, type DraftState, type Twist } from '../draft'
import { h2hAutoPick, h2hComplete, h2hSpin, newH2HDraft } from '../h2h'
import type { ClubSeason } from '../types'
import type { LoadedUniverse } from '../universe'
import { getFormation } from '../formations'
import { canCover } from '../positions'
import { affordable, BUDGET_FLOOR, capForSquad, capPrice, capRoom, chainBreakDue, chainBroken, picksMade, xiCapOf } from '../draft'
import { formerTeammates, sharedClubSeasons, teammateIndex } from '../teammates'

describe('draft', () => {
  const u = loadTestUniverse()
  it('never spins a dead club-season and completes a quick XI', () => {
    const rng = new Rng('draft-1')
    const d = newDraft(getFormation('4-3-3'), QUICK_RULES)
    while (!isComplete(d)) {
      const cs = spin(u, d, rng)
      const usable = cs.squad.filter((p) => canUse(d, p))
      expect(usable.length).toBeGreaterThan(0)
      const p = usable.sort((a, b) => b.overall - a.overall)[0]
      const slot = eligibleSlots(d, p)[0]
      pick(u, d, p.id, slot.id)
    }
    expect(Object.keys(d.lineup).length).toBe(11)
    expect(new Set(d.takenPlayers).size).toBe(11)
    expect(new Set(d.usedClubSeasons).size).toBe(11)
  })
  it('auto-drafts a full season squad deterministically', () => {
    const a = newDraft(getFormation('4-2-3-1'), SEASON_RULES)
    const b = newDraft(getFormation('4-2-3-1'), SEASON_RULES)
    autoDraft(u, a, new Rng('auto'))
    autoDraft(u, b, new Rng('auto'))
    expect(isComplete(a)).toBe(true)
    expect(a.bench.length).toBe(7)
    expect(a.lineup).toEqual(b.lineup)
    expect(a.bench).toEqual(b.bench)
  })
  it('respects era and one-club filters', () => {
    const d = newDraft(getFormation('4-4-2'), { ...QUICK_RULES, fromSeason: 2016, onlyClub: 'liverpool' })
    const pool = wheelPool(u, d)
    expect(pool.length).toBeGreaterThan(5)
    for (const cs of pool) {
      expect(cs.clubId).toBe('liverpool')
      expect(cs.season).toBeGreaterThanOrEqual(2016)
    }
  })
})

describe('one-nation draft', () => {
  const u = loadTestUniverse(['england', 'spain'])
  const rules = { ...QUICK_RULES, onlyNation: 'BRA' }

  it('drafts only Brazilians, keeps the wheel alive and completes a 4-3-3 across 20 seeds', () => {
    for (let i = 0; i < 20; i++) {
      const d = newDraft(getFormation('4-3-3'), rules)
      const rng = new Rng(`one-nation-${i}`)
      while (!isComplete(d)) {
        expect(canSpin(u, d)).toBe(true)
        const cs = spin(u, d, rng)
        const usable = cs.squad.filter((p) => canUse(d, p))
        expect(usable.length).toBeGreaterThan(0)
        for (const p of cs.squad) if (p.nationality !== 'BRA') expect(canUse(d, p)).toBe(false)
        const p = usable.sort((a, b) => b.overall - a.overall)[0]
        pick(u, d, p.id, eligibleSlots(d, p)[0].id)
      }
      expect(isComplete(d)).toBe(true)
      for (const id of Object.values(d.lineup)) expect(u.index[id].nationality).toBe('BRA')
      // The assistant reaches the same conclusion on its own
      const auto = newDraft(getFormation('4-3-3'), rules)
      autoDraft(u, auto, new Rng(`one-nation-auto-${i}`))
      expect(isComplete(auto)).toBe(true)
      for (const id of Object.values(auto.lineup)) expect(u.index[id].nationality).toBe('BRA')
    }
  }, 30000) // 40 drafts, about 4 s alone: a sweep that hit the 5 s default on a loaded machine

  it('refuses a pick of another nationality and reports the nation by name', () => {
    const d = newDraft(getFormation('4-3-3'), rules)
    const rng = new Rng('one-nation-refuse')
    const cs = spin(u, d, rng)
    const foreigner = cs.squad.find((p) => p.nationality !== 'BRA')!
    expect(eligibleSlots(d, foreigner)).toEqual([])
    const slot = d.formation.slots.find((s) => canCover(foreigner, s.position, 'accomplished'))
    if (slot) expect(() => pick(u, d, foreigner.id, slot.id)).toThrow(`${foreigner.name} is not Brazil`)
    // Every club-season on a one-nation wheel holds at least one undrafted player of that nation
    for (const pool of wheelPool(u, d)) expect(pool.squad.some((p) => p.nationality === 'BRA')).toBe(true)
  })

  it('runs dry instead of throwing: autoDraft stops short and canSpin says so', () => {
    // A nation with players but no keeper at all cannot start a 4-3-3
    const keepersByNation = new Map<string, number>()
    for (const p of Object.values(u.index)) if (canCover(p, 'GK', 'accomplished')) keepersByNation.set(p.nationality, (keepersByNation.get(p.nationality) ?? 0) + 1)
    const nations = [...new Set(Object.values(u.index).map((p) => p.nationality))].filter((n) => n !== 'UNK' && !keepersByNation.has(n))
    expect(nations.length).toBeGreaterThan(0)
    const d = newDraft(getFormation('4-3-3'), { ...rules, onlyNation: nations[0] })
    const rng = new Rng('one-nation-dry')
    autoDraft(u, d, rng)
    expect(isComplete(d)).toBe(false)
    expect(canSpin(u, d)).toBe(false)
    expect(d.lineup['gk']).toBeUndefined()
    expect(() => spin(u, d, rng)).toThrow('Nothing left on the wheel')
  })
})

describe('wheel twists', () => {
  const u = loadTestUniverse()
  const rules = { ...QUICK_RULES, leagues: ['england'] }

  /** Whether a landed club-season obeys the twist of its spin, given the pick before it. */
  function obeys(uni: LoadedUniverse, twist: Twist, cs: ClubSeason, lastPickedSeason: number | null): boolean {
    switch (twist) {
      case 'golden':
        return cs.champions
      case 'basement': {
        const n = uni.tables[cs.leagueId]?.[cs.season]?.length ?? 0
        return n > 0 && cs.position >= n - 2
      }
      case 'decade':
        return lastPickedSeason !== null && Math.floor(cs.season / 10) === Math.floor(lastPickedSeason / 10)
      default:
        return true
    }
  }

  /** Walks the history: every spin numbered a multiple of TWIST_EVERY carries a twist the landing obeys; the others carry none. */
  function checkHistory(uni: LoadedUniverse, d: DraftState): Record<Twist, number> {
    const seen: Record<Twist, number> = { golden: 0, basement: 0, blind: 0, decade: 0 }
    let lastPicked: number | null = null
    d.history.forEach((h, i) => {
      const spinNo = i + 1
      if (spinNo % TWIST_EVERY === 0) {
        expect(h.twist, `spin ${spinNo} should carry a twist`).toBeDefined()
        const cs = uni.clubSeasonByKey[`${h.clubId}@${h.season}`]
        expect(obeys(uni, h.twist!, cs, lastPicked), `spin ${spinNo} (${h.twist}) landed on ${h.clubId}@${h.season}`).toBe(true)
        seen[h.twist!]++
      } else {
        expect(h.twist).toBeUndefined()
      }
      if (h.pickedId) lastPicked = h.season
    })
    return seen
  }

  it('completes 200 seeded quick drafts with a twist every third spin and never an empty wheel', () => {
    const seen: Record<Twist, number> = { golden: 0, basement: 0, blind: 0, decade: 0 }
    for (let i = 0; i < 200; i++) {
      const d = newDraft(getFormation('4-3-3'), rules)
      autoDraft(u, d, new Rng(`twist-${i}`))
      expect(isComplete(d)).toBe(true)
      expect(d.spins).toBe(d.history.length)
      expect(d.twist).toBeNull()
      const s = checkHistory(u, d)
      for (const t of Object.keys(s) as Twist[]) seen[t] += s[t]
    }
    // Eleven spins without re-spins means spins 3, 6 and 9 twist: 600 twist spins, all four kinds among them
    expect(seen.golden + seen.basement + seen.blind + seen.decade).toBe(600)
    for (const t of Object.keys(seen) as Twist[]) expect(seen[t], t).toBeGreaterThan(50)
  }, 30000) // 2,200 spins, each a pass over every club-season: a deliberate sweep, not a 5-second unit test

  it('keeps the pool non-empty before every spin when drafted by hand, twists included', () => {
    for (let i = 0; i < 20; i++) {
      const d = newDraft(getFormation('4-2-3-1'), rules)
      const rng = new Rng(`twist-hand-${i}`)
      while (!isComplete(d)) {
        expect(canSpin(u, d)).toBe(true)
        const twisted = nextSpinTwisted(d)
        const cs = spin(u, d, rng)
        expect(!!d.twist).toBe(twisted)
        // The pool shown while the pick is pending is the twisted one, and the landing is inside it
        const pool = wheelPool(u, d)
        expect(pool.length).toBeGreaterThan(0)
        expect(pool.some((x) => x.clubId === cs.clubId && x.season === cs.season)).toBe(true)
        const usable = cs.squad.filter((p) => canUse(d, p))
        expect(usable.length).toBeGreaterThan(0)
        const p = usable.sort((a, b) => b.overall - a.overall)[0]
        pick(u, d, p.id, eligibleSlots(d, p)[0]?.id ?? 'bench')
        expect(d.twist).toBeNull()
      }
      checkHistory(u, d)
    }
  })

  it('a golden spin lands on champions and shows only champions on the wheel', () => {
    let goldens = 0
    for (let i = 0; i < 60 && goldens < 5; i++) {
      const d = newDraft(getFormation('4-3-3'), rules)
      const rng = new Rng(`golden-${i}`)
      while (!isComplete(d)) {
        const cs = spin(u, d, rng)
        if (d.twist === 'golden') {
          goldens++
          expect(cs.champions).toBe(true)
          const pool = wheelPool(u, d)
          expect(pool.length).toBeGreaterThan(0)
          expect(pool.every((x) => x.champions)).toBe(true)
        }
        if (d.twist === 'basement') {
          const n = u.tables[cs.leagueId][cs.season].length
          expect(cs.position).toBeGreaterThanOrEqual(n - 2)
        }
        if (d.twist === 'decade') {
          expect(twistDecade(d)).toBe(Math.floor(cs.season / 10) * 10)
        }
        const p = cs.squad.filter((x) => canUse(d, x)).sort((a, b) => b.overall - a.overall)[0]
        pick(u, d, p.id, eligibleSlots(d, p)[0]?.id ?? 'bench')
      }
    }
    expect(goldens).toBeGreaterThanOrEqual(5)
  })

  it('a blind spin leaves the pool identical to a plain spin', () => {
    const d = newDraft(getFormation('4-3-3'), rules)
    const rng = new Rng('blind')
    spin(u, d, rng)
    const cs = u.clubSeasonByKey[`${d.current!.clubId}@${d.current!.season}`]
    const p = cs.squad.filter((x) => canUse(d, x))[0]
    pick(u, d, p.id, eligibleSlots(d, p)[0].id)
    const plain = wheelPool(u, { ...d, twist: null }).map((x) => `${x.clubId}@${x.season}`)
    const blind = wheelPool(u, { ...d, twist: 'blind' }).map((x) => `${x.clubId}@${x.season}`)
    expect(blind).toEqual(plain)
    expect(wheelPool(u, { ...d, twist: 'golden' }).every((x) => x.champions)).toBe(true)
    expect(wheelPool(u, { ...d, twist: 'golden' }).length).toBeLessThan(plain.length)
  })

  it('a re-spin on a twist spin logs the twist and the next spin is a plain one', () => {
    const d = newDraft(getFormation('4-3-3'), rules)
    const rng = new Rng('respin-twist')
    for (let i = 0; i < 2; i++) {
      const cs = spin(u, d, rng)
      const p = cs.squad.filter((x) => canUse(d, x))[0]
      pick(u, d, p.id, eligibleSlots(d, p)[0].id)
    }
    expect(nextSpinTwisted(d)).toBe(true)
    spin(u, d, rng)
    const twist = d.twist
    expect(twist).toBeTruthy()
    respin(u, d, rng)
    expect(d.history[2].pickedId).toBeNull()
    expect(d.history[2].twist).toBe(twist)
    expect(d.spins).toBe(4)
    expect(d.twist).toBeNull()
  })

  it('never twists when the rule is off, and the same seed drafts the same side', () => {
    const a = newDraft(getFormation('4-3-3'), { ...rules, twists: false })
    const b = newDraft(getFormation('4-3-3'), { ...rules, twists: false })
    autoDraft(u, a, new Rng('no-twist'))
    autoDraft(u, b, new Rng('no-twist'))
    expect(a.history.every((h) => h.twist === undefined)).toBe(true)
    expect(a.lineup).toEqual(b.lineup)
    expect(SEASON_RULES.twists).toBe(false)
    expect(QUICK_RULES.twists).toBe(true)
    // The twist draw is part of the seed: the twisted draft of the same seed is a different side
    const c = newDraft(getFormation('4-3-3'), rules)
    autoDraft(u, c, new Rng('no-twist'))
    expect(c.history.slice(0, 2)).toEqual(a.history.slice(0, 2))
    expect(c.lineup).not.toEqual(a.lineup)
  })

  it('falls back to blind and decade spins in a league without tables', () => {
    const fr = loadTestUniverse(['france'])
    expect(fr.clubSeasons.every((cs) => cs.position === 0 && !cs.champions)).toBe(true)
    const seen: Record<Twist, number> = { golden: 0, basement: 0, blind: 0, decade: 0 }
    for (let i = 0; i < 30; i++) {
      const d = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues: ['france'] })
      autoDraft(fr, d, new Rng(`france-${i}`))
      expect(isComplete(d)).toBe(true)
      expect(d.spins).toBe(d.history.length)
      const s = checkHistory(fr, d)
      for (const t of Object.keys(s) as Twist[]) seen[t] += s[t]
    }
    expect(seen.golden).toBe(0)
    expect(seen.basement).toBe(0)
    expect(seen.blind + seen.decade).toBe(90)
    expect(seen.blind).toBeGreaterThan(0)
    expect(seen.decade).toBeGreaterThan(0)
  })

  it('the head-to-head draft never sets a twist', () => {
    const h = newH2HDraft([getFormation('4-3-3'), getFormation('4-4-2')], { ...QUICK_RULES, respins: 0, leagues: ['england'], twists: false })
    const rng = new Rng('h2h-twist')
    let guard = 0
    while (!h2hComplete(h) && guard++ < 60) {
      h2hSpin(u, h, rng)
      while (h.picking !== null) h2hAutoPick(u, h)
    }
    expect(h2hComplete(h)).toBe(true)
    for (const d of h.drafts) {
      expect(d.twist ?? null).toBeNull()
      expect(d.history.every((x) => x.twist === undefined)).toBe(true)
    }
  })
})

describe('salary cap (the Moneyball wheel)', () => {
  const u = loadTestUniverse()
  const capped = (budget: number): typeof QUICK_RULES => ({ ...QUICK_RULES, leagues: ['england'], budget })

  it('prices by rating and first position on the model value at peak age', () => {
    const cm = (rating: number) => capPrice({ overall: rating, positions: ['CM'] })
    expect([70, 75, 80, 85, 88, 90, 92].map(cm)).toEqual([1.7, 4.4, 11.3, 29.3, 52, 76.1, 111.4])
    expect(capPrice({ overall: 80, positions: ['ST'] })).toBe(13)
    expect(capPrice({ overall: 80, positions: ['GK'] })).toBe(8.5)
    // Nobody is free
    expect(capPrice({ overall: 40, positions: ['GK'] })).toBe(0.3)
    expect(capForSquad(180, 11)).toBe(180)
    expect(capForSquad(180, 16)).toBe(252)
    expect(capForSquad(180, 18)).toBe(281)
    expect(xiCapOf(252, 16)).toBeCloseTo(180, 6)
  })

  it('ignores age: the same rating and position cost the same at 22 and 34', () => {
    const young = { overall: 84, positions: ['CB' as const], age: 22 }
    const old = { overall: 84, positions: ['CB' as const], age: 34 }
    expect(capPrice(young)).toBe(capPrice(old))
    // And on the real data: every rating and first position has one price, whatever the age of the men holding it
    const byKey = new Map<string, Set<number>>()
    const ages = new Map<string, Set<number>>()
    for (const cs of u.clubSeasons)
      for (const p of cs.squad) {
        const key = `${p.overall}:${p.positions[0]}`
        byKey.set(key, (byKey.get(key) ?? new Set()).add(capPrice(p)))
        ages.set(key, (ages.get(key) ?? new Set()).add(p.age))
      }
    for (const [key, prices] of byKey) expect(prices.size, key).toBe(1)
    expect([...ages.values()].some((a) => Math.min(...a) <= 22 && Math.max(...a) >= 34)).toBe(true)
  })

  it('100 seeded drafts on £120M complete under the cap, with the wheel alive before every spin', () => {
    for (let i = 0; i < 100; i++) {
      const d = newDraft(getFormation('4-3-3'), capped(120))
      autoDraft(u, d, new Rng(`cap-${i}`))
      expect(isComplete(d), `cap-${i}`).toBe(true)
      expect(d.spent!).toBeLessThanOrEqual(120)
      const ids = [...Object.values(d.lineup), ...d.bench]
      expect(d.spent!).toBeCloseTo(ids.reduce((t, id) => t + capPrice(u.index[id]), 0), 6)
    }
    // By hand, the greediest way: the dearest player the cap allows on every spin, so the reserve is what saves the draft
    for (let i = 0; i < 30; i++) {
      const d = newDraft(getFormation('4-3-3'), capped(120))
      const rng = new Rng(`cap-hand-${i}`)
      while (!isComplete(d)) {
        expect(canSpin(u, d), `cap-hand-${i} pick ${picksMade(d) + 1}`).toBe(true)
        const cs = spin(u, d, rng)
        const usable = cs.squad.filter((p) => canUse(d, p))
        expect(usable.length).toBeGreaterThan(0)
        for (const p of usable) expect(capPrice(p)).toBeLessThanOrEqual(capRoom(d) + 1e-9)
        const p = usable.sort((a, b) => capPrice(b) - capPrice(a))[0]
        pick(u, d, p.id, eligibleSlots(d, p)[0].id)
        // The cap always keeps the floor for every pick still to make
        expect(120 - d.spent! + 1e-9).toBeGreaterThanOrEqual(BUDGET_FLOOR * (d.rules.squadSize - picksMade(d)))
      }
      expect(d.spent!).toBeLessThanOrEqual(120)
    }
  }, 120000) // 1,500 capped spins, each pricing every player of every club-season: a sweep, not a unit test

  it('refuses an over-cap pick with the price and the overshoot', () => {
    const rng = new Rng('cap-throw')
    for (let tries = 0; tries < 50; tries++) {
      const d = newDraft(getFormation('4-3-3'), capped(50))
      const cs = spin(u, d, rng)
      // The dearest man in the squad who can fill a slot but costs more than the room left
      const dear = cs.squad.filter((p) => d.formation.slots.some((s) => canCover(p, s.position, d.rules.minFit)) && !affordable(d, p)).sort((a, b) => capPrice(b) - capPrice(a))[0]
      if (!dear) continue
      const slot = d.formation.slots.find((s) => canCover(dear, s.position, d.rules.minFit))!
      const room = capRoom(d)
      expect(room).toBe(45)
      const over = Math.round((capPrice(dear) - room) * 10) / 10
      const reserve = capPrice(dear) <= 50 ? `, keeping £0.5M for each of the 10 picks still to make` : ''
      expect(() => pick(u, d, dear.id, slot.id)).toThrow(`${dear.name} (£${capPrice(dear).toFixed(1)}M) would take you £${over.toFixed(1)}M over the cap${reserve}`)
      expect(canUse(d, dear)).toBe(false)
      expect(eligibleSlots(d, dear)).toEqual([])
      expect(d.spent).toBeUndefined()
      expect(picksMade(d)).toBe(0)
      return
    }
    throw new Error('no over-cap player found in 50 spins')
  })

  it('a draft without a cap spends nothing and spins exactly as one whose rules leave the cap undefined', () => {
    for (let i = 0; i < 10; i++) {
      const a = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues: ['england'] })
      const b = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues: ['england'], budget: undefined })
      autoDraft(u, a, new Rng(`nocap-${i}`))
      autoDraft(u, b, new Rng(`nocap-${i}`))
      expect(b.history).toEqual(a.history)
      expect(a.spent).toBeUndefined()
      expect(b.spent).toBeUndefined()
    }
  }, 30000)

  it('a cap no draft can reach draws the same wheel as no cap at all', () => {
    // Eleven of the dearest player in England cost well under £5,000M, so every check passes and the weights match
    const dearest = Math.max(...u.clubSeasons.flatMap((cs) => cs.squad.map((p) => capPrice(p))))
    expect(dearest * 11).toBeLessThan(5000 - BUDGET_FLOOR * 10)
    for (let i = 0; i < 10; i++) {
      const a = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues: ['england'] })
      const b = newDraft(getFormation('4-3-3'), capped(5000))
      autoDraft(u, a, new Rng(`bigcap-${i}`))
      autoDraft(u, b, new Rng(`bigcap-${i}`))
      expect(b.history).toEqual(a.history)
      expect(b.spent).toBeGreaterThan(0)
    }
  }, 30000)
})

describe('teammate chain', () => {
  const u = loadTestUniverse()
  const chained = (partial: Partial<typeof QUICK_RULES> = {}): typeof QUICK_RULES => ({ ...QUICK_RULES, leagues: ['england'], chain: true, ...partial })
  const playerOf = (uu: LoadedUniverse, id: string) => uu.index[id].playerId
  const shareAClubSeason = (uu: LoadedUniverse, a: string, b: string) => sharedClubSeasons(uu, ['england'], playerOf(uu, a), playerOf(uu, b)).length > 0
  /** Every pick after the first shares a club-season with the pick before, unless its row logs a break. */
  const checkLinks = (uu: LoadedUniverse, d: DraftState, label: string) => {
    const picks = d.history.filter((h) => h.pickedId)
    expect(picks[0].chainLink, label).toBeUndefined()
    expect(picks[0].chainBroken, label).toBeUndefined()
    for (let i = 1; i < picks.length; i++) {
      const [prev, next] = [picks[i - 1].pickedId!, picks[i].pickedId!]
      if (picks[i].chainBroken) {
        expect(picks[i].chainLink, label).toBeUndefined()
        continue
      }
      expect(shareAClubSeason(uu, prev, next), `${label} pick ${i + 1}`).toBe(true)
      // The row names a club-season both men were in
      const link = uu.clubSeasonByKey[picks[i].chainLink!]
      expect(link.leagueId).toBe('england')
      expect(link.squad.some((p) => p.playerId === playerOf(uu, prev)) && link.squad.some((p) => p.playerId === playerOf(uu, next)), `${label} pick ${i + 1}`).toBe(true)
    }
    return picks.filter((h) => h.chainBroken).length
  }

  it('100 seeded England chain drafts complete, every pick a former teammate of the one before', () => {
    let breaks = 0
    for (let i = 0; i < 100; i++) {
      const d = newDraft(getFormation('4-3-3'), chained())
      autoDraft(u, d, new Rng(`chain-${i}`))
      expect(isComplete(d), `chain-${i}`).toBe(true)
      breaks += checkLinks(u, d, `chain-${i}`)
    }
    // An England wheel has a teammate of almost anyone somewhere: 0 breaks in these 100 drafts when measured
    expect(breaks).toBeLessThanOrEqual(5)
  }, 120000) // 100 chained drafts, each spin checking every player of every club-season against the teammates: a sweep

  it('by hand: the wheel lands only where a teammate is usable, and only teammates may be drafted', () => {
    for (let i = 0; i < 20; i++) {
      const d = newDraft(getFormation('4-3-3'), chained())
      const rng = new Rng(`chain-hand-${i}`)
      while (!isComplete(d)) {
        expect(canSpin(u, d)).toBe(true)
        const before = d.chainFrom
        const cs = spin(u, d, rng)
        const usable = cs.squad.filter((p) => canUse(d, p))
        expect(usable.length).toBeGreaterThan(0)
        if (before && !chainBroken(d)) {
          const mates = new Set(formerTeammates(u, ['england'], playerOf(u, before)))
          for (const p of usable) expect(mates.has(p.playerId)).toBe(true)
          // A man who can fill a slot but never played beside the last pick is dimmed and refused
          const stranger = cs.squad.find((p) => !mates.has(p.playerId) && !d.takenPlayers.includes(p.playerId) && d.formation.slots.some((s) => !d.lineup[s.id] && canCover(p, s.position, d.rules.minFit)))
          if (stranger) {
            expect(canUse(d, stranger)).toBe(false)
            expect(eligibleSlots(d, stranger)).toEqual([])
            const slot = d.formation.slots.find((s) => !d.lineup[s.id] && canCover(stranger, s.position, d.rules.minFit))!
            expect(() => pick(u, d, stranger.id, slot.id)).toThrow(`${stranger.name} is not a former teammate of ${u.index[before].name}`)
          }
        }
        // The lowest-rated usable man, so the chain wanders rather than following the stars
        const p = usable.sort((a, b) => a.overall - b.overall)[0]
        pick(u, d, p.id, eligibleSlots(d, p)[0]?.id ?? 'bench')
      }
      checkLinks(u, d, `chain-hand-${i}`)
    }
  }, 60000)

  it('breaks when no teammate is left on the wheel: the next spin is free, logged, and the chain restarts from that pick', () => {
    // One nation narrows the teammates until the chain cannot always go on
    let breaks = 0
    for (let i = 0; i < 20; i++) {
      const d = newDraft(getFormation('4-3-3'), chained({ onlyNation: 'BRA' }))
      const rng = new Rng(`chain-bra-${i}`)
      while (!isComplete(d) && canSpin(u, d)) {
        const prev = d.chainFrom
        const due = !!prev && chainBreakDue(u, d)
        if (due) {
          // Nobody on the wheel is a usable teammate of the last pick: the chain-bound wheel would be empty
          const mates = new Set(formerTeammates(u, ['england'], playerOf(u, prev!)))
          expect(wheelPool(u, d).every((cs) => !cs.squad.some((p) => mates.has(p.playerId) && canUse(d, p)))).toBe(true)
        }
        const cs = spin(u, d, rng)
        expect(chainBroken(d)).toBe(due)
        const usable = cs.squad.filter((p) => canUse(d, p))
        expect(usable.length).toBeGreaterThan(0)
        const p = usable.sort((a, b) => b.overall - a.overall)[0]
        pick(u, d, p.id, eligibleSlots(d, p)[0]?.id ?? 'bench')
        expect(!!d.history.at(-1)!.chainBroken).toBe(due)
        // Whatever happened, the chain now follows from this pick
        expect(d.chainFrom).toBe(p.id)
        expect(d.chainMates).toEqual(formerTeammates(u, ['england'], p.playerId))
        if (due) breaks++
      }
      checkLinks(u, d, `chain-bra-${i}`)
    }
    expect(breaks).toBeGreaterThan(5)
  }, 60000)

  it('an England-only chain draws the same wheel with one pack loaded or three', () => {
    const u3 = loadTestUniverse(['england', 'spain', 'italy'])
    // Ids are shared across packs, so an index over every loaded pack would give some men more teammates
    const moved = [...teammateIndex(u, ['england']).keys()].find((id) => formerTeammates(u3, undefined, id).length > formerTeammates(u3, ['england'], id).length)
    expect(moved).toBeDefined()
    for (let i = 0; i < 10; i++) {
      const a = newDraft(getFormation('4-3-3'), chained())
      const b = newDraft(getFormation('4-3-3'), chained())
      autoDraft(u, a, new Rng(`chain-packs-${i}`))
      autoDraft(u3, b, new Rng(`chain-packs-${i}`))
      expect(b.history).toEqual(a.history)
      expect(b.chainMates).toEqual(a.chainMates)
    }
  }, 60000)

  it('the index holds no club-season outside the wheel leagues', () => {
    const u3 = loadTestUniverse(['england', 'spain', 'italy'])
    for (const leagues of [['england'], ['spain', 'italy']]) {
      const index = teammateIndex(u3, leagues)
      let n = 0
      for (const keys of index.values())
        for (const key of keys) {
          expect(leagues).toContain(u3.clubSeasonByKey[key].leagueId)
          n++
        }
      expect(n).toBe(u3.clubSeasons.filter((cs) => leagues.includes(cs.leagueId)).reduce((t, cs) => t + cs.squad.length, 0))
      // Memoised by universe and leagues, whatever their order
      expect(teammateIndex(u3, [...leagues].reverse())).toBe(index)
    }
  })

  it('a draft without the chain spins exactly as one whose rules leave it off', () => {
    for (let i = 0; i < 10; i++) {
      const a = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues: ['england'] })
      const b = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues: ['england'], chain: false })
      autoDraft(u, a, new Rng(`nochain-${i}`))
      autoDraft(u, b, new Rng(`nochain-${i}`))
      expect(b.history).toEqual(a.history)
      expect(a.chainFrom).toBeUndefined()
      expect(b.chainMates).toBeUndefined()
    }
  }, 30000)
})
