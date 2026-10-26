import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { canUse, eligibleSlots, isComplete, newDraft, pick, QUICK_RULES, respin, spin, wheelPool, type DraftState } from '@engine/draft'
import { h2hAutoPick, h2hComplete, h2hSpin, newH2HDraft } from '@engine/h2h'
import { getFormation } from '@engine/formations'
import type { ClubSeason } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { DRUM_LABELS, DRUM_LAND, dealReel, draftReelPool, drumSeasons, h2hReelPool, IDLE_CARDS, idleCards, REEL_CARDS, REEL_JITTER, REEL_LAND, reelLeagues, type ReelDeal } from '../logic/reel'
import { tierTable } from '../logic/rarity'

/** The injected random source: a seeded stream, so a deal replays exactly. */
function seeded(seed: string): () => number {
  const r = new Rng(seed)
  return () => r.next()
}
const key = (cs: { clubId: string; season: number }) => `${cs.clubId}@${cs.season}`

/** Every property a deal must have for a real spin of a draft over `leagues`. */
function checkDeal(u: LoadedUniverse, leagues: string[], pool: ClubSeason[], target: ClubSeason, deal: ReelDeal) {
  expect(deal.cards).toHaveLength(REEL_CARDS)
  expect(deal.land).toBe(REEL_LAND)
  expect(deal.cards[REEL_LAND].key).toBe(key(target))
  expect(deal.target.key).toBe(key(target))
  expect(deal.season).toBe(target.season)
  // Only club-seasons of the drawn season, from the draft's leagues
  const seasonKeys = new Set(u.clubSeasons.filter((cs) => cs.season === target.season && leagues.includes(cs.leagueId)).map(key))
  for (const c of deal.cards) expect(seasonKeys.has(c.key), c.key).toBe(true)
  // Lit exactly where the wheel could have stopped this spin
  const lit = new Set(pool.filter((cs) => cs.season === target.season).map(key))
  expect(lit.has(key(target))).toBe(true)
  for (const c of deal.cards) expect(c.lit, c.key).toBe(lit.has(c.key))
  // Never the same card twice in a row
  for (let i = 1; i < deal.cards.length; i++) expect(deal.cards[i].key).not.toBe(deal.cards[i - 1].key)
  // A near miss anywhere inside the card
  expect(Math.abs(deal.jitter)).toBeLessThanOrEqual(REEL_JITTER)
  // The drum rolls through seasons the wheel could land on and stops on the drawn one
  expect(deal.drum).toHaveLength(DRUM_LABELS)
  expect(deal.drum[DRUM_LAND]).toBe(target.season)
  const seasons = new Set(pool.map((cs) => cs.season))
  for (const s of deal.drum) expect(seasons.has(s)).toBe(true)
  // Tiers are the league set's
  const tiers = tierTable(u, leagues)
  for (const c of deal.cards) expect(c.tier).toBe(tiers[c.key])
}

/** Pick the best usable player the way the UI's "sort by rating" list offers him. */
function pickBest(u: LoadedUniverse, d: DraftState, cs: ClubSeason) {
  const p = cs.squad.filter((x) => canUse(d, x)).sort((a, b) => b.overall - a.overall)[0]
  const slot = eligibleSlots(d, p)[0]
  pick(u, d, p.id, slot ? slot.id : 'bench')
}

describe('the case reel deal', () => {
  const u = loadTestUniverse()

  it('lands on the drawn club-season, from that season only, lit where the wheel could stop, over real drafts with twists and re-spins', () => {
    const twists = new Map<string, number>()
    for (let s = 0; s < 20; s++) {
      const d = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues: ['england'] })
      const rng = new Rng(`reel-draft-${s}`)
      let spins = 0
      while (!isComplete(d) && spins++ < 30) {
        // The pool a spin draws from: the draft before the spin, with the twist that spin drew
        const before = structuredClone(d)
        const cs = d.current && d.respinsLeft > 0 && s % 3 === 0 ? respin(u, d, rng) : spin(u, d, rng)
        const pool = draftReelPool(u, d)
        before.twist = d.twist ?? null
        expect(new Set(wheelPool(u, before).map(key))).toEqual(new Set(pool.map(key)))
        twists.set(d.twist ?? 'plain', (twists.get(d.twist ?? 'plain') ?? 0) + 1)
        const deal = dealReel(u, { leagues: ['england'], pool, target: cs }, seeded(`deal-${s}-${spins}`))
        checkDeal(u, ['england'], pool, cs, deal)
        if (d.twist === 'golden') for (const c of deal.cards.filter((x) => x.lit)) expect(u.clubSeasonByKey[c.key].champions).toBe(true)
        // A golden or basement spin runs through the whole league that season with few cards lit
        if (d.twist === 'golden') expect(deal.cards.filter((x) => !x.lit).length).toBeGreaterThan(REEL_CARDS / 2)
        // Re-spin on spin 2 of every third draft, otherwise pick the best player
        if (s % 3 === 0 && d.respinsLeft > 0 && spins === 2) continue
        pickBest(u, d, cs)
      }
      expect(isComplete(d)).toBe(true)
    }
    for (const t of ['plain', 'golden', 'basement', 'blind', 'decade']) expect(twists.get(t) ?? 0, t).toBeGreaterThan(0)
  }, 60_000)

  it('shows every club of a one-league season and never shows a card twice in a row, even in a short season', () => {
    const cs = u.clubSeasonByKey['manchester-city@2017']
    const pool = u.clubSeasons.filter((x) => x.champions)
    for (let s = 0; s < 50; s++) {
      const deal = dealReel(u, { leagues: ['england'], pool, target: cs }, seeded(`full-${s}`))
      const shown = new Set(deal.cards.map((c) => c.key))
      expect(shown.size).toBe(20)
      expect(deal.cards.filter((c) => c.lit).every((c) => c.key === 'manchester-city@2017')).toBe(true)
      for (let i = 1; i < deal.cards.length; i++) expect(deal.cards[i].key).not.toBe(deal.cards[i - 1].key)
    }
    // A season of seven clubs, so the shuffled rounds do not line up with the landing: still no repeats
    const seven = ['manchester-city', 'arsenal', 'chelsea', 'liverpool', 'everton', 'burnley', 'stoke-city']
    const small = { ...u, clubSeasons: u.clubSeasons.filter((x) => x.season === 2017 && seven.includes(x.clubId)) }
    expect(small.clubSeasons.length).toBe(7)
    for (let s = 0; s < 50; s++) {
      const deal = dealReel(small, { leagues: ['england'], pool: [cs], target: cs }, seeded(`seven-${s}`))
      expect(new Set(deal.cards.map((c) => c.key)).size).toBe(7)
      for (let i = 1; i < deal.cards.length; i++) expect(deal.cards[i].key).not.toBe(deal.cards[i - 1].key)
    }
    // A season of two clubs still alternates, and the drawn one sits alone at the landing
    const two = { ...u, clubSeasons: u.clubSeasons.filter((x) => x.season === 2017 && ['manchester-city', 'arsenal'].includes(x.clubId)) }
    const deal = dealReel(two, { leagues: ['england'], pool: [cs], target: cs }, seeded('two'))
    for (let i = 1; i < deal.cards.length; i++) expect(deal.cards[i].key).not.toBe(deal.cards[i - 1].key)
    expect(deal.cards[REEL_LAND - 1].key).toBe('arsenal@2017')
    expect(deal.cards[REEL_LAND + 1].key).toBe('arsenal@2017')
  })

  it('is deterministic for a fixed random source and varies with it', () => {
    const cs = u.clubSeasonByKey['liverpool@2019']
    const pool = wheelPool(u, newDraft(getFormation('4-4-2'), { ...QUICK_RULES, leagues: ['england'] }))
    const a = dealReel(u, { leagues: ['england'], pool, target: cs }, seeded('same'))
    const b = dealReel(u, { leagues: ['england'], pool, target: cs }, seeded('same'))
    expect(b).toEqual(a)
    const others = ['x', 'y', 'z'].map((s) => dealReel(u, { leagues: ['england'], pool, target: cs }, seeded(s)))
    expect(others.some((o) => o.cards.map((c) => c.key).join() !== a.cards.map((c) => c.key).join())).toBe(true)
    expect(new Set([a, ...others].map((o) => o.jitter)).size).toBeGreaterThan(1)
    // A jitter source at its extremes stays inside the card
    expect(dealReel(u, { leagues: ['england'], pool, target: cs }, () => 0).jitter).toBeCloseTo(-REEL_JITTER, 9)
    expect(dealReel(u, { leagues: ['england'], pool, target: cs }, () => 0.999999).jitter).toBeLessThanOrEqual(REEL_JITTER)
  })

  it('counts the drum up through the pool seasons in order', () => {
    const pool = u.clubSeasons.filter((x) => x.season >= 2015 && x.season <= 2018)
    expect(drumSeasons(pool, 2017)).toEqual([2015, 2016, 2017, 2018])
    const deal = dealReel(u, { leagues: ['england'], pool, target: u.clubSeasonByKey['manchester-city@2017'] }, seeded('drum'))
    for (let i = 1; i < deal.drum.length; i++) expect(deal.drum[i] === deal.drum[i - 1] + 1 || (deal.drum[i] === 2015 && deal.drum[i - 1] === 2018)).toBe(true)
    // One season on the wheel: the drum shows only that season
    const one = dealReel(u, { leagues: ['england'], pool: [u.clubSeasonByKey['manchester-city@2017']], target: u.clubSeasonByKey['manchester-city@2017'] }, seeded('drum-1'))
    expect(new Set(one.drum)).toEqual(new Set([2017]))
  })

  it('across several leagues deals clubs from all of them, each card tagged with its league', () => {
    const two = loadTestUniverse(['england', 'spain'])
    const rules = { ...QUICK_RULES, leagues: ['england', 'spain'] }
    expect(reelLeagues(two, rules)).toEqual(['england', 'spain'])
    expect(new Set(reelLeagues(two, { leagues: undefined }))).toEqual(new Set(['england', 'spain']))
    const leaguesSeen = new Set<string>()
    for (let s = 0; s < 10; s++) {
      const d = newDraft(getFormation('4-3-3'), rules)
      const cs = spin(two, d, new Rng(`multi-${s}`))
      const pool = draftReelPool(two, d)
      const deal = dealReel(two, { leagues: rules.leagues, pool, target: cs }, seeded(`multi-deal-${s}`))
      checkDeal(two, rules.leagues, pool, cs, deal)
      for (const c of deal.cards) {
        expect(c.league).toBe(c.leagueId === 'england' ? 'ENG' : 'ESP')
        leaguesSeen.add(c.leagueId)
      }
      // Both leagues in one strip
      expect(new Set(deal.cards.map((c) => c.leagueId)).size).toBe(2)
    }
    expect(leaguesSeen).toEqual(new Set(['england', 'spain']))
    // With more leagues loaded than the rules use, the strip keeps to the rules' leagues
    const d = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues: ['spain'] })
    const cs = spin(two, d, new Rng('multi-one'))
    const only = dealReel(two, { leagues: ['spain'], pool: draftReelPool(two, d), target: cs }, seeded('multi-one'))
    checkDeal(two, ['spain'], draftReelPool(two, d), cs, only)
    expect(only.cards.every((c) => c.leagueId === 'spain' && c.league === null)).toBe(true)
    // A one-league strip carries no league tag
    const deal = dealReel(u, { leagues: ['england'], pool: u.clubSeasons, target: u.clubSeasonByKey['arsenal@2010'] }, seeded('tag'))
    expect(deal.cards.every((c) => c.league === null)).toBe(true)
  })

  it('reads the head-to-head pool the spin drew from, before and after the spin', () => {
    for (let s = 0; s < 12; s++) {
      const h = newH2HDraft([getFormation('4-3-3'), getFormation('4-4-2')], { ...QUICK_RULES, respins: 0, leagues: ['england'], twists: false })
      const rng = new Rng(`h2h-reel-${s}`)
      let guard = 0
      while (!h2hComplete(h) && guard++ < 40) {
        const before = h2hReelPool(u, h).map(key)
        // The h2hSpin pool: club-seasons useful to both managers still drafting, else the first picker's wheel
        const active = ([0, 1] as const).filter((i) => !isComplete(h.drafts[i]))
        const wheels = active.map((i) => new Set(wheelPool(u, h.drafts[i]).map(key)))
        const both = [...wheels[0]].filter((k) => wheels.every((w) => w.has(k)))
        const first = active.includes(h.first) ? h.first : active[0]
        expect(new Set(before)).toEqual(both.length ? new Set(both) : wheels[active.indexOf(first)])
        const cs = h2hSpin(u, h, rng)
        const after = h2hReelPool(u, h)
        expect(new Set(after.map(key))).toEqual(new Set(before))
        expect(before).toContain(key(cs))
        checkDeal(u, ['england'], after, cs, dealReel(u, { leagues: ['england'], pool: after, target: cs }, seeded(`h2h-deal-${s}-${guard}`)))
        for (let i = 0; h.picking !== null && i < 2; i++) h2hAutoPick(u, h)
        expect(h.picking).toBeNull()
      }
      expect(h2hComplete(h)).toBe(true)
    }
  }, 60_000)

  it('narrows a head-to-head reel to the clubs useful to both managers, as the spin does', () => {
    const h = newH2HDraft([getFormation('4-3-3'), getFormation('4-4-2')], { ...QUICK_RULES, respins: 0, leagues: ['england'], twists: false })
    // Manager 2 has every Arsenal player already, so no Arsenal season is any use to him
    h.drafts[1].takenPlayers.push(...new Set(u.clubSeasons.filter((cs) => cs.clubId === 'arsenal').flatMap((cs) => cs.squad.map((p) => p.playerId))))
    expect(wheelPool(u, h.drafts[0]).some((cs) => cs.clubId === 'arsenal')).toBe(true)
    const pool = h2hReelPool(u, h)
    expect(pool.some((cs) => cs.clubId === 'arsenal')).toBe(false)
    const keys = new Set(pool.map(key))
    for (let s = 0; s < 30; s++) {
      const copy = structuredClone(h)
      const cs = h2hSpin(u, copy, new Rng(`h2h-arsenal-${s}`))
      expect(cs.clubId).not.toBe('arsenal')
      expect(keys.has(key(cs))).toBe(true)
    }
  })

  it('shows a still strip between spins: each club once, from the pool, by code', () => {
    const d = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues: ['england'] })
    const pool = draftReelPool(u, d)
    const cards = idleCards(u, ['england'], pool)
    expect(cards.length).toBe(IDLE_CARDS)
    expect(new Set(cards.map((c) => c.clubId)).size).toBe(cards.length)
    const keys = new Set(pool.map(key))
    for (const c of cards) {
      expect(keys.has(c.key)).toBe(true)
      expect(c.lit).toBe(true)
    }
    expect(cards.map((c) => c.code)).toEqual([...cards.map((c) => c.code)].sort((a, b) => a.localeCompare(b)))
    expect(idleCards(u, ['england'], [])).toEqual([])
  })
})
