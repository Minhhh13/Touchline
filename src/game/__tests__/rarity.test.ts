import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, newDraft, QUICK_RULES, spin, wheelPool } from '@engine/draft'
import { getFormation } from '@engine/formations'
import type { LoadedUniverse } from '@engine/universe'
import { clubSeasonStrength, clubSeasonTier, TIER_SHARE, TIERS, tierName, tierTable, type RatingOf, type Tier, type TierTable } from '../logic/rarity'
import { dealReel } from '../logic/reel'

const ALL = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
/** The cut-offs the design asks for, written out rather than read from the module under test. */
const WANT: Record<Tier, number> = { gold: 0.05, red: 0.1, pink: 0.2, purple: 0.3, blue: 0.35 }

function shares(table: TierTable): Record<Tier, number> {
  const n = Object.keys(table).length
  const out = { gold: 0, red: 0, pink: 0, purple: 0, blue: 0 }
  for (const t of Object.values(table)) out[t]++
  for (const t of TIERS) out[t] /= n
  return out
}

/** Strengths per tier, to check the order: every gold at least as strong as every red, and so on down. */
/** Classic club-seasons (estimated ratings) are ranked apart from the standard ones, so each group is checked on its own. */
function monotone(u: LoadedUniverse, table: TierTable): boolean {
  const ranked = u.clubSeasons.filter((cs) => table[`${cs.clubId}@${cs.season}`])
  return [false, true].every((classic) => !ranked.some((cs) => !!cs.classic === classic) || monotoneIn(ranked.filter((cs) => !!cs.classic === classic), table))
}

function monotoneIn(clubSeasons: LoadedUniverse['clubSeasons'], table: TierTable): boolean {
  const byTier = new Map<Tier, number[]>(TIERS.map((t) => [t, []]))
  for (const cs of clubSeasons) {
    const t = table[`${cs.clubId}@${cs.season}`]
    if (t) byTier.get(t)!.push(clubSeasonStrength(cs))
  }
  for (let i = 0; i + 1 < TIERS.length; i++) {
    const upper = byTier.get(TIERS[i])!
    const lower = byTier.get(TIERS[i + 1])!
    if (!upper.length || !lower.length) return false
    if (Math.min(...upper) < Math.max(...lower)) return false
  }
  return true
}

describe('rarity tiers', () => {
  const u = loadTestUniverse()
  const all = loadTestUniverse(ALL)

  it('shares are 5 / 10 / 20 / 30 / 35 per cent, within a point, for England and for all seven leagues', () => {
    expect(TIER_SHARE).toEqual(WANT)
    expect(TIERS).toEqual(['gold', 'red', 'pink', 'purple', 'blue'])
    const cases: Array<[LoadedUniverse, string[]]> = [
      [u, ['england']],
      [all, ALL],
    ]
    for (const [uni, leagues] of cases) {
      const table = tierTable(uni, leagues)
      const expected = uni.clubSeasons.filter((cs) => leagues.includes(cs.leagueId)).length
      expect(Object.keys(table).length).toBe(expected)
      const got = shares(table)
      for (const t of TIERS) expect(Math.abs(got[t] - WANT[t])).toBeLessThanOrEqual(0.01)
    }
    // Each league of the seven, ranked on its own, keeps the same shares
    for (const id of ALL) {
      const got = shares(tierTable(all, [id]))
      for (const t of TIERS) expect(Math.abs(got[t] - WANT[t]), `${id} ${t}`).toBeLessThanOrEqual(0.01)
    }
  })

  it('is monotone in strength: every gold squad is at least as strong as every red one, and so on down', () => {
    expect(monotone(u, tierTable(u, ['england']))).toBe(true)
    expect(monotone(all, tierTable(all, ALL))).toBe(true)
    for (const id of ['spain', 'france']) expect(monotone(all, tierTable(all, [id]))).toBe(true)
  })

  it('puts most title winners in gold or red, and Manchester City 2017-18 in gold', () => {
    const table = tierTable(u, ['england'])
    const champions = u.clubSeasons.filter((cs) => cs.champions)
    expect(champions.length).toBeGreaterThanOrEqual(15)
    const top = champions.filter((cs) => ['gold', 'red'].includes(table[`${cs.clubId}@${cs.season}`]))
    expect(top.length / champions.length).toBeGreaterThanOrEqual(0.7)
    expect(clubSeasonTier(u, ['england'], 'manchester-city', 2017)).toBe('gold')
    expect(tierName('gold')).toBe('Gold · Elite')
  })

  it('ranks across leagues for a multi-league draft and within the league for a single one', () => {
    const one = tierTable(all, ['england'])
    const many = tierTable(all, ALL)
    // The same England rows, but their tiers now come from a ranking of all seven leagues
    expect(Object.keys(one).every((k) => k in many)).toBe(true)
    expect(Object.keys(one).some((k) => one[k] !== many[k])).toBe(true)
    // The league order of the argument does not matter, nor do duplicates
    expect(tierTable(all, [...ALL].reverse())).toBe(many)
    expect(tierTable(all, ['england', 'england'])).toBe(one)
    // An England-only universe gives England the same table as the seven-league one does
    expect(tierTable(u, ['england'])).toEqual(one)
  })

  it('depends only on the data: a draft, its spins, picks and twists never change a tier', () => {
    const before = { ...tierTable(u, ['england']) }
    // A fresh rating accessor with the same values bypasses the memo, so this recomputes from scratch
    const fresh: RatingOf = (p) => p.overall
    for (const seed of ['tier-a', 'tier-b', 'tier-c']) {
      const d = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues: ['england'] })
      const rng = new Rng(seed)
      autoDraft(u, d, rng)
      expect(d.usedClubSeasons.length).toBe(11)
      expect(tierTable(u, ['england'], fresh)).toEqual(before)
    }
    // On a golden spin the reel's cards carry the same tiers as the table, whatever the twist narrowed
    const d = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues: ['england'] })
    const rng = new Rng('tier-golden')
    let goldenSeen = 0
    for (let i = 0; i < 40 && goldenSeen < 3; i++) {
      d.current = null
      d.twist = null
      d.spins = 2 + i * 3
      const cs = spin(u, d, rng)
      if (d.twist !== 'golden') continue
      goldenSeen++
      const r = new Rng(`deal-${i}`)
      const deal = dealReel(u, { leagues: ['england'], pool: wheelPool(u, d), target: cs }, () => r.next())
      for (const c of deal.cards) expect(c.tier).toBe(before[c.key])
    }
    expect(goldenSeen).toBeGreaterThan(0)
  })

  it('measures strength as the mean of the best eleven, with an optional rating accessor', () => {
    const cs = u.clubSeasonByKey['manchester-city@2017']
    const best = cs.squad.map((p) => p.overall).sort((a, b) => b - a).slice(0, 11)
    expect(clubSeasonStrength(cs)).toBeCloseTo(best.reduce((s, v) => s + v, 0) / 11, 9)
    expect(clubSeasonStrength(cs, () => 50)).toBe(50)
    expect(clubSeasonStrength({ ...cs, squad: [] })).toBe(0)
    expect(clubSeasonStrength({ ...cs, squad: cs.squad.slice(0, 3) })).toBeCloseTo(cs.squad.slice(0, 3).reduce((s, p) => s + p.overall, 0) / 3, 9)
    // A different accessor gives its own table, without disturbing the default one
    const flat = tierTable(u, ['england'], () => 70)
    expect(Object.keys(flat).length).toBe(Object.keys(tierTable(u, ['england'])).length)
    expect(tierTable(u, ['england'])).toBe(tierTable(u, ['england']))
  })

  it('breaks ties by the club-season key, whatever order the data comes in', () => {
    // Every squad equally strong: the ranking is the key order alone, so gold is the first 5% of the sorted keys
    const flat: RatingOf = () => 70
    const table = tierTable(u, ['england'], flat)
    const keys = Object.keys(table).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const golds = Math.round(keys.length * 0.05)
    expect(keys.slice(0, golds).every((k) => table[k] === 'gold')).toBe(true)
    expect(table[keys[golds]]).toBe('red')
    // The same rows in reverse order (a new universe object, so no memo) give the same table, real ratings included
    const reversed = { ...u, clubSeasons: [...u.clubSeasons].reverse() }
    expect(tierTable(reversed, ['england'], flat)).toEqual(table)
    expect(tierTable(reversed, ['england'])).toEqual(tierTable(u, ['england']))
  })
})
