import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { autoDraft, canSpin, isComplete, newDraft, nextSpinTwisted, pick, QUICK_RULES, respin, SEASON_RULES, spin, TWIST_EVERY, twistDecade, wheelPool, canUse, eligibleSlots, type DraftState, type Twist } from '../draft'
import { h2hAutoPick, h2hComplete, h2hSpin, newH2HDraft } from '../h2h'
import type { ClubSeason } from '../types'
import type { LoadedUniverse } from '../universe'
import { getFormation } from '../formations'
import { canCover } from '../positions'

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
  })

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
