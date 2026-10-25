import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { assistantChoice, autoDraft, iconsUsed, isComplete, newDraft, pick, QUICK_RULES, spin, spinClubSeason, spinOdds, upgraderOn, type DraftRules, type DraftState, type QuickMode } from '@engine/draft'
import { ICONS_CHANCE, ICONS_CLUB, ICONS_SIZE, iconsCollection, isIcons } from '@engine/icons'
import { primeOf } from '@engine/prime'
import { boostedPlayer, canUpgrade, upgradeCandidates, upgradeChance, upgradeLoss, upgradePlayer, UPGRADE_BOOSTS } from '@engine/upgrader'
import { decodeChallenge, encodeChallenge, isRulesDiff } from '@engine/challenge'
import { activeModeCards, withModes } from '@engine/modes'
import { getFormation } from '@engine/formations'
import { h2hSpin, h2hSpinOdds, newH2HDraft } from '@engine/h2h'
import { createGame } from '../logic/setup'
import { challengeFromGame, replayChallenge } from '../logic/challenge'
import { kickOff, toKickoff } from '../logic/quick'
import { playerLookup } from '../logic/players'
import { tierOdds, formatOdds } from '../logic/odds'
import { tierTable } from '../logic/rarity'
import { dealReel, REEL_LAND } from '../logic/reel'
import type { GameSettings } from '../types'

const u = loadTestUniverse(['england'])
const LEAGUES = ['england']

function rules(modes: QuickMode[], extra: Partial<DraftRules> = {}): DraftRules {
  return { ...QUICK_RULES, leagues: LEAGUES, ...(modes.length ? { modes } : {}), ...extra }
}

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return { mode: 'quick', seed: 'GAMBLE-1', formationId: '4-3-3', teamName: 'Gamble XI', shortName: 'GXI', leagueId: 'england', wheelLeagues: LEAGUES, hostClubId: 'burnley', leagueSeason: 2025, rules: rules(['gamble']), jobSecurity: false, difficulty: 'calibrated', january: false, ...partial }
}

/** A seed whose first Icons roll hits: the first spin of a Gamble draft on it is an Icons spin. */
function iconsSeed(): string {
  for (let i = 0; ; i++) {
    const seed = `ICONS-${i}`
    if (new Rng(`${seed}:gamble-icons`).chance(ICONS_CHANCE)) return seed
  }
}

/** Copy a draft and its stream, so one state can be spun many ways. */
const clone = (d: DraftState): DraftState => JSON.parse(JSON.stringify(d)) as DraftState

/** Spin `n` times from the same state with different streams and count each landing tier. */
function sampleTiers(d: DraftState, n: number, label: string): Record<string, number> {
  const tiers = tierTable(u, LEAGUES)
  const counts: Record<string, number> = {}
  for (let i = 0; i < n; i++) {
    const c = clone(d)
    // A fresh Icons stream per sample too, so the Icons roll is sampled as well
    if (c.gambleRng) c.gambleRng = new Rng(`${label}-icons-${i}`).getState()
    spin(u, c, new Rng(`${label}-${i}`))
    const t = isIcons(c.current) ? 'icons' : tiers[`${c.current!.clubId}@${c.current!.season}`]
    counts[t] = (counts[t] ?? 0) + 1
  }
  return counts
}

/** Draft `picks` players by the assistant from a fresh draft, so the state has history (and a twist spin next when picks = 2). */
function draftAfter(r: DraftRules, picks: number, seed: string): { d: DraftState; rng: Rng } {
  const d = newDraft(getFormation('4-3-3'), r, seed)
  const rng = new Rng(seed)
  for (let i = 0; i < picks; i++) {
    const cs = spin(u, d, rng)
    const best = assistantChoice(u, d, cs)!
    pick(u, d, best.id, best.slot)
  }
  return { d, rng }
}

describe('the spin odds', () => {
  it('sum to 100% over every state of many drafts, plain, twisted, Crazy and Gamble', () => {
    for (const [i, r] of [rules([]), rules(['crazy']), rules(['gamble']), rules(['underdog']), rules([], { draftMode: 'position' })].entries()) {
      for (let s = 0; s < 4; s++) {
        const seed = `ODDS-SUM-${i}-${s}`
        const d = newDraft(getFormation('4-4-2'), r, seed)
        const rng = new Rng(seed)
        let guard = 0
        while (!isComplete(d) && guard++ < 30) {
          if (r.draftMode === 'position' && !d.target) d.target = d.formation.slots.find((x) => !d.lineup[x.id])!.id
          const odds = spinOdds(u, d)
          const total = odds.icons + odds.outcomes.reduce((a, o) => a + o.p, 0)
          expect(total).toBeCloseTo(1, 9)
          const byTier = tierOdds(u, d, LEAGUES)
          expect(byTier.reduce((a, o) => a + o.p, 0)).toBeCloseTo(1, 9)
          const cs = spin(u, d, rng)
          // The spin always lands on something the odds gave a chance
          expect(isIcons(d.current) ? odds.icons : odds.outcomes.find((o) => o.cs.clubId === cs.clubId && o.cs.season === cs.season)?.p ?? 0).toBeGreaterThan(0)
          const best = assistantChoice(u, d, cs)
          if (!best) break
          pick(u, d, best.id, best.slot)
        }
      }
    }
  })

  it('match the engine’s weighted pick over many seeds, on a plain spin and on a twist spin', () => {
    const n = 2500
    for (const picks of [0, 2]) {
      const { d } = draftAfter(rules([]), picks, `ODDS-MATCH-${picks}`)
      const odds = tierOdds(u, d, LEAGUES)
      const counts = sampleTiers(d, n, `ODDS-MATCH-${picks}`)
      for (const o of odds) {
        const seen = (counts[o.tier] ?? 0) / n
        // Four standard errors of a binomial share, at least one point
        const tol = Math.max(0.01, 4 * Math.sqrt((o.p * (1 - o.p)) / n))
        expect(Math.abs(seen - o.p)).toBeLessThan(tol)
      }
    }
  })

  it('give the Icons chance in a Gamble draft until the Icons spin has come, and its share of spins matches it', () => {
    const d = newDraft(getFormation('4-3-3'), rules(['gamble']), 'ODDS-ICONS')
    const odds = tierOdds(u, d, LEAGUES)
    expect(odds[0]).toEqual({ tier: 'icons', p: ICONS_CHANCE })
    const n = 6000
    const counts = sampleTiers(d, n, 'ODDS-ICONS')
    expect(Math.abs((counts.icons ?? 0) / n - ICONS_CHANCE)).toBeLessThan(4 * Math.sqrt((ICONS_CHANCE * (1 - ICONS_CHANCE)) / n))
    // No Icons row without Gamble
    expect(tierOdds(u, newDraft(getFormation('4-3-3'), rules([]), 'ODDS-NO-ICONS'), LEAGUES).some((o) => o.tier === 'icons')).toBe(false)
  })

  it('match head-to-head spins too', () => {
    const h = newH2HDraft([getFormation('4-3-3'), getFormation('4-4-2')], { ...QUICK_RULES, leagues: LEAGUES })
    const odds = h2hSpinOdds(u, h)
    expect(odds.reduce((a, o) => a + o.p, 0)).toBeCloseTo(1, 9)
    const n = 1500
    const tiers = tierTable(u, LEAGUES)
    const byTier: Record<string, number> = {}
    for (const o of odds) byTier[tiers[`${o.cs.clubId}@${o.cs.season}`]] = (byTier[tiers[`${o.cs.clubId}@${o.cs.season}`]] ?? 0) + o.p
    const counts: Record<string, number> = {}
    for (let i = 0; i < n; i++) {
      const c = JSON.parse(JSON.stringify(h)) as typeof h
      const cs = h2hSpin(u, c, new Rng(`H2H-ODDS-${i}`))
      const t = tiers[`${cs.clubId}@${cs.season}`]
      counts[t] = (counts[t] ?? 0) + 1
    }
    for (const [t, p] of Object.entries(byTier)) expect(Math.abs((counts[t] ?? 0) / n - p)).toBeLessThan(Math.max(0.012, 4 * Math.sqrt((p * (1 - p)) / n)))
  })

  it('print one decimal under 10%, whole above, and never 0% for a chance that can come up', () => {
    expect(formatOdds(0.01)).toBe('1.0%')
    expect(formatOdds(0.234)).toBe('23%')
    expect(formatOdds(0.0001)).toBe('<0.1%')
    expect(formatOdds(0)).toBe('0%')
  })
})

describe('Gamble mode: the Icons spin', () => {
  it('builds a collection of the best players of all time, one season each, by Prime rating', () => {
    const icons = iconsCollection(u, LEAGUES)
    expect(icons.clubId).toBe(ICONS_CLUB)
    expect(icons.squad).toHaveLength(ICONS_SIZE)
    expect(new Set(icons.squad.map((p) => p.playerId)).size).toBe(ICONS_SIZE)
    for (let i = 1; i < icons.squad.length; i++) expect(icons.squad[i - 1].overall).toBeGreaterThanOrEqual(icons.squad[i].overall)
    // Each icon is at his prime, and nobody left out rates above the last icon
    for (const p of icons.squad) expect(primeOf(u, p.playerId, LEAGUES)!.id).toBe(p.id)
    const floor = icons.squad[icons.squad.length - 1].overall
    const inside = new Set(icons.squad.map((p) => p.playerId))
    // Over the standard seasons: classic ones (estimated ratings) are never in the collection
    for (const cs of u.clubSeasons) if (!cs.classic) for (const p of cs.squad) if (!inside.has(p.playerId)) expect(p.overall).toBeLessThanOrEqual(floor)
    // The same object on a second call, and the universe untouched
    expect(iconsCollection(u, LEAGUES)).toBe(icons)
    expect(u.clubSeasonByKey[`${ICONS_CLUB}@0`]).toBeUndefined()
  })

  it('lands on the Icons collection when its roll hits, from its own stream, at most once per draft', () => {
    const seed = iconsSeed()
    const d = newDraft(getFormation('4-3-3'), rules(['gamble']), seed)
    const rng = new Rng(seed)
    const before = rng.getState()
    const cs = spin(u, d, rng)
    expect(isIcons(d.current)).toBe(true)
    expect(cs).toBe(iconsCollection(u, LEAGUES))
    expect(spinClubSeason(u, d)).toBe(cs)
    // The game's stream did not move on the Icons spin
    expect(rng.getState()).toEqual(before)
    const best = assistantChoice(u, d, cs)!
    pick(u, d, best.id, best.slot)
    expect(d.lineup[best.slot]).toBe(best.id)
    expect(iconsUsed(d)).toBe(true)
    expect(spinOdds(u, d).icons).toBe(0)
    // Never again in this draft
    autoDraft(u, d, rng)
    expect(d.history.filter((h) => isIcons(h))).toHaveLength(1)
  })

  it('leaves the main stream exactly as a draft without Gamble would use it while no Icons spin comes', () => {
    for (let s = 0; s < 20; s++) {
      const seed = `GAMBLE-SAME-${s}`
      const a = newDraft(getFormation('4-3-3'), rules([]), seed)
      const b = newDraft(getFormation('4-3-3'), rules(['gamble']), seed)
      const ra = new Rng(seed)
      const rb = new Rng(seed)
      for (let i = 0; i < 11 && !isComplete(a); i++) {
        const csa = spin(u, a, ra)
        const csb = spin(u, b, rb)
        if (isIcons(b.current)) break
        expect(`${csb.clubId}@${csb.season}`).toBe(`${csa.clubId}@${csa.season}`)
        const pa = assistantChoice(u, a, csa)!
        pick(u, a, pa.id, pa.slot)
        pick(u, b, pa.id, pa.slot)
      }
    }
  })

  it('deals an Icons card at the landing of the reel', () => {
    const seed = iconsSeed()
    const d = newDraft(getFormation('4-3-3'), rules(['gamble']), seed)
    const pool = spinOdds(u, d).outcomes.map((o) => o.cs)
    spin(u, d, new Rng(seed))
    const deal = dealReel(u, { leagues: LEAGUES, pool, target: d.current! }, new Rng('reel').next.bind(new Rng('reel')))
    expect(deal.cards[REEL_LAND].tier).toBe('icons')
    expect(deal.cards.filter((c) => c.tier === 'icons')).toHaveLength(1)
  })

  it('replays an Icons pick in a challenge link', () => {
    const g = createGame(settings({ seed: iconsSeed() }))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    expect(g.draft!.history.some((h) => isIcons(h))).toBe(true)
    toKickoff(g, u)
    kickOff(g, u, true)
    const c = challengeFromGame(g, u, 'Gambler')!
    const out = replayChallenge(u, decodeChallenge(encodeChallenge(c)))
    expect(out.reason).toBeUndefined()
    expect(out.verified).toBe('yes')
  })
})

describe('the Player Upgrader', () => {
  it('shows worse odds for a bigger boost and for a higher-rated player, always 1 to 95%', () => {
    for (let r = 40; r <= 99; r++) {
      const [a, b, c] = UPGRADE_BOOSTS.map((x) => upgradeChance(r, x))
      expect(a).toBeGreaterThan(b)
      expect(b).toBeGreaterThan(c)
      for (const x of [a, b, c]) expect(x >= 1 && x <= 95).toBe(true)
      if (r > 40) for (const x of UPGRADE_BOOSTS) expect(upgradeChance(r, x)).toBeLessThanOrEqual(upgradeChance(r - 1, x))
    }
    expect(upgradeChance(92, 10)).toBeLessThan(upgradeChance(70, 10))
    expect(UPGRADE_BOOSTS.map(upgradeLoss)).toEqual([1, 3, 5])
  })

  it('wins exactly as often as the chance shown, over many seeds', () => {
    const n = 1500
    let wins = 0
    let chance = 0
    for (let i = 0; i < n; i++) {
      const { d } = draftAfter(rules([], { upgrader: true }), 1, `UPG-RATE-${i}`)
      const id = upgradeCandidates(d)[0]
      const up = upgradePlayer(u, d, id, 5)
      chance += up.chance / 100
      if (up.won) wins++
      expect(up.won).toBe(up.roll < up.chance)
      expect(up.delta).toBe(up.won ? Math.min(5, 99 - u.index[id].overall) : -3)
    }
    const expected = chance / n
    expect(Math.abs(wins / n - expected)).toBeLessThan(4 * Math.sqrt((expected * (1 - expected)) / n))
  })

  it('rolls for the player and boost chosen: the same choice replays, another choice on the same seed is a fresh roll', () => {
    let differ = 0
    for (let i = 0; i < 60; i++) {
      const seed = `UPG-KEY-${i}`
      const a = draftAfter(rules([], { upgrader: true }), 2, seed).d
      const b = clone(a)
      const c = clone(a)
      const [x, y] = upgradeCandidates(a)
      const ra = upgradePlayer(u, a, x, 10).roll
      expect(upgradePlayer(u, b, x, 10).roll).toBe(ra)
      if (upgradePlayer(u, c, y, 2).roll !== ra) differ++
    }
    // Two independent rolls of 0-99 agree about once in a hundred
    expect(differ).toBeGreaterThan(50)
  })

  it('is once per draft, needs a drafted player, and never touches the universe', () => {
    const { d } = draftAfter(rules(['gamble']), 2, 'UPG-ONCE')
    expect(upgraderOn(d.rules)).toBe(true)
    expect(canUpgrade(d)).toBe(true)
    expect(() => upgradePlayer(u, d, 'nobody@2020@x', 5)).toThrow()
    expect(() => upgradePlayer(u, d, upgradeCandidates(d)[0], 7)).toThrow()
    const id = upgradeCandidates(d)[0]
    const before = JSON.stringify(u.index[id])
    const up = upgradePlayer(u, d, id, 10)
    expect(() => upgradePlayer(u, d, id, 2)).toThrow()
    expect(canUpgrade(d)).toBe(false)
    expect(JSON.stringify(u.index[id])).toBe(before)
    const boosted = boostedPlayer(u.index[id], up.delta)
    expect(boosted.overall).toBe(Math.min(99, Math.max(1, u.index[id].overall + up.delta)))
    expect(boosted).not.toBe(u.index[id])
    // Without the power-up there is nothing to use
    const plain = draftAfter(rules([]), 1, 'UPG-NONE').d
    expect(canUpgrade(plain)).toBe(false)
    expect(() => upgradePlayer(u, plain, upgradeCandidates(plain)[0], 2)).toThrow()
  })

  it('rates the upgraded player through the game lookup and replays in a challenge link', () => {
    for (const seed of ['UPG-LINK-1', 'UPG-LINK-2', 'UPG-LINK-3']) {
      const g = createGame(settings({ seed, rules: rules([], { upgrader: true }) }))
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      const id = upgradeCandidates(g.draft!)[3]
      const up = upgradePlayer(u, g.draft!, id, 10)
      expect(playerLookup(g, u)(id)!.overall).toBe(Math.min(99, u.index[id].overall + up.delta))
      toKickoff(g, u)
      kickOff(g, u, true)
      const c = challengeFromGame(g, u, 'Upgrader')!
      expect(c.g).toEqual([g.draft!.history.findIndex((h) => h.pickedId === id), 10])
      const out = replayChallenge(u, decodeChallenge(encodeChallenge(c)))
      expect(out.reason).toBeUndefined()
      expect(out.verified).toBe('yes')
      // A link with the upgrade stripped plays a different season or at least is checked without it
      expect(() => decodeChallenge(encodeChallenge({ ...c, g: [99, 10] }))).toThrow()
      expect(() => decodeChallenge(encodeChallenge({ ...c, g: [0, 3] }))).toThrow()
    }
  })
})

describe('the Gamble and Upgrader cards', () => {
  it('travel as rules a challenge link accepts, and the cards read back', () => {
    const r = withModes(QUICK_RULES, ['gamble', 'upgrader'])
    expect(r.modes).toEqual(['gamble'])
    expect(r.upgrader).toBe(true)
    expect(activeModeCards(r)).toEqual(['gamble', 'upgrader'])
    expect(isRulesDiff({ modes: ['gamble'], upgrader: true })).toBe(true)
    expect(isRulesDiff({ upgrader: 'yes' })).toBe(false)
    expect(withModes(r, []).upgrader).toBeUndefined()
  })
})
