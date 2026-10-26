import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, isComplete, QUICK_RULES } from '@engine/draft'
import { decodeChallenge, encodeChallenge, isChallengeSeason, type QuickChallengePayload } from '@engine/challenge'
import { getFormation } from '@engine/formations'
import { canCover } from '@engine/positions'
import { UPGRADE_BOOSTS, upgradeChance, upgradeGain, upgradeLoss } from '@engine/upgrader'
import { ENGINE_VERSION } from '@engine/version'
import { closeJanuary, closeJanuarySpin, kickOff, openSpinChoices, replayUserMatch, rollJanuarySpin, rollJanuaryUpgrade, toKickoff, januaryGambleProblem, quickSquadAt } from '../logic/quick'
import { drawJanuarySpin, drawJanuaryUpgrade, JANUARY_SPIN_WEIGHTS, januaryGambleLine, januaryGambleOn, januarySpinFillers, januarySpinOdds, januarySpinPool, seasonEndLookup, type JanuarySpinPool } from '../logic/januaryGamble'
import { challengeFromGame, replayChallenge } from '../logic/challenge'
import { createGame, dailyGameSettings } from '../logic/setup'
import { playerLookup } from '../logic/players'
import { normaliseGame } from '../logic/save'
import { TIERS } from '../logic/rarity'
import { nonStandardRun } from '../../online/server/dailyVerify'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return { mode: 'quick', seed: 'jg-1', formationId: '4-3-3', teamName: 'Gamble XI', shortName: 'GAM', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: true, ...partial }
}

/** A quick game drafted by the assistant, kicked off and paused at its January window. */
function atJanuary(partial: Partial<GameSettings> = {}): Game {
  const g = createGame(settings(partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  expect(isComplete(g.draft!)).toBe(true)
  toKickoff(g, u)
  kickOff(g, u)
  expect(g.phase).toBe('january')
  return g
}

const clone = (g: Game): Game => JSON.parse(JSON.stringify(g)) as Game
const SEEDS = ['jg-1', 'jg-2', 'jg-3']

describe('the January spin', { timeout: 180_000 }, () => {
  it('lands on the same wheel player every time, never one of the squad, one who can cover a slot, and moves no stream', () => {
    for (const seed of SEEDS) {
      const g = atJanuary({ seed })
      const before = clone(g)
      rollJanuarySpin(g, u)
      const spin = g.quickJanuary!.spin!
      expect(g.rngState).toEqual(before.rngState)
      const again = clone(before)
      rollJanuarySpin(again, u)
      expect(again.quickJanuary!.spin).toEqual(spin)
      const get = playerLookup(g, u)
      const p = get(spin.playerSeasonId)!
      const squad = new Set([...Object.values(g.lineup), ...g.bench].map((id) => get(id)!.playerId))
      expect(squad.has(p.playerId)).toBe(false)
      expect(getFormation(g.tactics.formationId).slots.some((s) => canCover(p, s.position, g.settings.rules.minFit))).toBe(true)
      expect(TIERS).toContain(spin.tier)
      // One deal per window: the Upgrader and the listings are gone once the case is open
      expect(januaryGambleProblem(g)).toMatch(/deal is made/)
      expect(() => rollJanuaryUpgrade(g, u, Object.values(g.lineup)[0], 2)).toThrow(/deal is made/)
      expect(() => closeJanuary(clone(g), u, 0)).toThrow(/deal is made/)
    }
  })

  it('keeping the XI after the spin plays the season a pass plays, figure for figure', () => {
    for (const seed of SEEDS) {
      const passed = atJanuary({ seed })
      const kept = clone(passed)
      closeJanuary(passed, u, null)
      rollJanuarySpin(kept, u)
      closeJanuarySpin(kept, u, null)
      const { januaryGamble, ...rest } = kept.quickResult!
      expect(rest).toEqual(passed.quickResult)
      expect(januaryGamble).toMatchObject({ kind: 'spin', inId: kept.quickJanuary!.spin!.playerSeasonId })
      expect(kept.rngState).toEqual(passed.rngState)
    }
  })

  it('brings the spun player into a slot he can cover for the second half only, and a link replays it', () => {
    for (const seed of SEEDS) {
      const passed = atJanuary({ seed })
      const g = clone(passed)
      closeJanuary(passed, u, null)
      rollJanuarySpin(g, u)
      const choices = openSpinChoices(g, u)
      expect(choices.length).toBeGreaterThan(0)
      const pick = choices[0]
      const id = g.quickJanuary!.spin!.playerSeasonId
      closeJanuarySpin(g, u, pick.slotId)
      expect(g.phase).toBe('summary')
      expect(g.lineup[pick.slotId]).toBe(id)
      expect(g.quickJanuary!.spin).toMatchObject({ slotId: pick.slotId, outId: pick.outId })
      // The first half is the same games
      expect(g.quickResult!.results!.slice(0, 19)).toEqual(passed.quickResult!.results!.slice(0, 19))
      expect(g.quickResult!.januaryGamble).toMatchObject({ kind: 'spin', inId: id, outId: pick.outId, slotId: pick.slotId })
      expect(januaryGambleLine(g.quickResult!.januaryGamble)).toMatch(/January spin: .+ in for /)
      // The bench panel's view and the highlights both play the second half with him in
      expect(quickSquadAt(g, u, g.quickResult!.results!, 30).lineup[pick.slotId]).toBe(id)
      const late = g.quickResult!.results![30]
      const m = replayUserMatch(g, u, late.matchweek)!
      expect(Object.values(m.home.teamId === 'user' ? m.home.lineup : m.away.lineup)).toContain(id)
      expect([m.result.homeGoals, m.result.awayGoals]).toEqual(m.home.teamId === 'user' ? [late.gf, late.ga] : [late.ga, late.gf])
      // The challenge link carries the spin's slot; the replay opens the same case and verifies
      const c = challengeFromGame(g, u, 'Gambler')!
      expect(c.x?.jg).toEqual(['s', pick.slotId])
      const decoded = decodeChallenge(encodeChallenge(c)) as QuickChallengePayload
      expect(replayChallenge(u, decoded).verified).toBe('yes')
    }
  })

  it('refuses a spin that did not land there', () => {
    const g = atJanuary({ seed: 'jg-2' })
    rollJanuarySpin(g, u)
    const forged = clone(g)
    const pool = januarySpinPool(forged, u, forged.lineup, forged.bench, playerLookup(forged, u))
    const other = TIERS.flatMap((t) => pool[t]).find((c) => c.p.id !== forged.quickJanuary!.spin!.playerSeasonId)!
    forged.quickJanuary!.spin = { playerSeasonId: other.p.id, tier: other.tier }
    expect(() => closeJanuarySpin(forged, u, null)).toThrow(/did not land/)
  })

  it('lands on each tier as often as the odds it shows, over thousands of opened cases', () => {
    const g = atJanuary({ seed: 'jg-1' })
    const pool = januarySpinPool(g, u, g.lineup, g.bench, playerLookup(g, u))
    for (const t of TIERS) expect(pool[t].length).toBeGreaterThan(0)
    const odds = januarySpinOdds(pool)
    expect(odds.reduce((s, o) => s + o.p, 0)).toBeCloseTo(1, 10)
    for (const o of odds) expect(o.p).toBeCloseTo(JANUARY_SPIN_WEIGHTS[o.tier] / 100, 10)
    const n = 8000
    const seen: Record<string, number> = {}
    for (let i = 0; i < n; i++) {
      const c = drawJanuarySpin(pool, new Rng(`jg-odds-${i}`))!
      expect(pool[c.tier]).toContain(c)
      seen[c.tier] = (seen[c.tier] ?? 0) + 1
    }
    for (const o of odds) {
      // Within five standard errors of the binomial
      const sd = Math.sqrt(n * o.p * (1 - o.p))
      expect(Math.abs((seen[o.tier] ?? 0) - n * o.p)).toBeLessThan(5 * sd + 1)
    }
    // Every tier is ranked by rating: the worst gold is no worse than the best blue
    expect(Math.min(...pool.gold.map((c) => c.rating))).toBeGreaterThanOrEqual(Math.max(...pool.blue.map((c) => c.rating)))
    // The reel's strip shows the tiers roughly as often as the odds, every live tier at least once
    const fillers = januarySpinFillers(pool)
    for (const t of TIERS) expect(fillers.some((c) => c.tier === t)).toBe(true)
  })

  it('shares an empty tier among the others, so the odds shown are still exact', () => {
    const g = atJanuary({ seed: 'jg-1' })
    const full = januarySpinPool(g, u, g.lineup, g.bench, playerLookup(g, u))
    const pool: JanuarySpinPool = { ...full, gold: [] }
    const odds = januarySpinOdds(pool)
    expect(odds.find((o) => o.tier === 'gold')!.p).toBe(0)
    expect(odds.find((o) => o.tier === 'blue')!.p).toBeCloseTo(38 / 97, 10)
    for (let i = 0; i < 500; i++) expect(drawJanuarySpin(pool, new Rng(`jg-empty-${i}`))!.tier).not.toBe('gold')
    expect(drawJanuarySpin({ gold: [], red: [], pink: [], purple: [], blue: [] }, new Rng('x'))).toBeNull()
  })
})

describe('the January Upgrader', { timeout: 180_000 }, () => {
  it('rolls one gamble on one of the XI, the same every time, at the chance the Upgrader shows', () => {
    for (const seed of SEEDS) {
      const g = atJanuary({ seed })
      const id = Object.values(g.lineup)[3]
      const get = playerLookup(g, u)
      const rating = get(id)!.overall
      const before = g.rngState
      const up = rollJanuaryUpgrade(g, u, id, 5)
      expect(g.rngState).toEqual(before)
      expect(up.chance).toBe(upgradeChance(rating, 5))
      expect(up.won).toBe(up.roll < up.chance)
      expect(up.delta).toBe(up.won ? upgradeGain(rating, 5) : -upgradeLoss(5))
      const twin = atJanuary({ seed })
      expect(rollJanuaryUpgrade(twin, u, id, 5)).toEqual(up)
      expect(() => rollJanuaryUpgrade(g, u, id, 2)).toThrow(/deal is made/)
    }
    const g = atJanuary({ seed: 'jg-1' })
    expect(() => rollJanuaryUpgrade(g, u, g.bench[0] ?? 'nobody', 5)).toThrow(/one of your XI/)
    expect(() => rollJanuaryUpgrade(g, u, Object.values(g.lineup)[0], 7)).toThrow(/boost/)
  })

  it('wins as often as its chance says, for every boost, over thousands of rolls', () => {
    for (const boost of UPGRADE_BOOSTS) {
      for (const rating of [55, 72, 88]) {
        const n = 3000
        let wins = 0
        for (let i = 0; i < n; i++) {
          const r = drawJanuaryUpgrade(new Rng(`jg-up-${boost}-${rating}-${i}`), 'p', rating, boost)
          if (r.won) wins++
        }
        const p = upgradeChance(rating, boost) / 100
        expect(Math.abs(wins - n * p)).toBeLessThan(5 * Math.sqrt(n * p * (1 - p)) + 1)
      }
    }
    // A bigger boost is a worse chance, and so is a better player
    expect(upgradeChance(70, 10)).toBeLessThan(upgradeChance(70, 5))
    expect(upgradeChance(70, 5)).toBeLessThan(upgradeChance(70, 2))
    expect(upgradeChance(90, 5)).toBeLessThan(upgradeChance(65, 5))
  })

  it('moves his rating for the second half only, carries into the cups, and a link replays it', () => {
    let won = 0
    let lost = 0
    for (const seed of ['jg-1', 'jg-2', 'jg-3', 'jg-4', 'jg-5', 'jg-6']) {
      const passed = atJanuary({ seed })
      const g = clone(passed)
      closeJanuary(passed, u, null)
      const id = Object.values(g.lineup)[9]
      const up = rollJanuaryUpgrade(g, u, id, 10)
      if (up.won) won++
      else lost++
      closeJanuary(g, u, null)
      expect(g.phase).toBe('summary')
      expect(g.quickResult!.results!.slice(0, 19)).toEqual(passed.quickResult!.results!.slice(0, 19))
      expect(g.quickResult!.januaryGamble).toEqual({ kind: 'upgrade', id, name: playerLookup(g, u)(id)!.name, boost: 10, chance: up.chance, won: up.won, delta: up.delta })
      // The game's own lookup is untouched (the first half replays as played); after the season it carries the change
      const base = playerLookup(g, u)(id)!.overall
      expect(seasonEndLookup(g, u)(id)!.overall).toBe(Math.min(99, Math.max(1, base + up.delta)))
      // The second half's games play with him changed: a highlight replays to the score the season recorded
      const late = g.quickResult!.results![25]
      const m = replayUserMatch(g, u, late.matchweek)!
      const user = m.home.teamId === 'user' ? m.home : m.away
      expect(user.getPlayer(id)!.overall).toBe(Math.min(99, Math.max(1, base + up.delta)))
      expect([m.result.homeGoals, m.result.awayGoals]).toEqual(m.home.teamId === 'user' ? [late.gf, late.ga] : [late.ga, late.gf])
      const c = challengeFromGame(g, u, 'Gambler')!
      expect(c.x?.jg).toEqual(['u', id, 10])
      expect(replayChallenge(u, decodeChallenge(encodeChallenge(c))).verified).toBe('yes')
      // A forged roll does not replay
      const forged = clone(g)
      forged.phase = 'january'
      forged.quickJanuary!.move = undefined
      forged.quickJanuary!.upgrade = { ...up, roll: up.won ? 99 : 0, won: !up.won, delta: up.won ? -5 : 10 }
      expect(() => closeJanuary(forged, u, null)).toThrow(/does not roll the same/)
    }
    // Both ways happen across these seeds (+10 on the tenth man: jg-2, jg-4 and jg-6 win, jg-1, jg-3 and jg-5 lose)
    expect(won).toBeGreaterThan(0)
    expect(lost).toBeGreaterThan(0)
  })
})

describe('the January gamble and the rest of the game', { timeout: 180_000 }, () => {
  it('is a Quick Draft thing: the Daily and the weekly keep the plain window', () => {
    expect(januaryGambleOn({ settings: settings() })).toBe(true)
    expect(januaryGambleOn({ settings: settings({ seed: 'weekly-2026-W44' }) })).toBe(false)
    const daily = createGame(dailyGameSettings(u, 'daily-2026-10-25', 'Anyone'))
    expect(januaryGambleOn(daily)).toBe(false)
    const rng = Rng.fromState(daily.rngState)
    autoDraft(u, daily.draft!, rng)
    daily.rngState = rng.getState()
    toKickoff(daily, u)
    kickOff(daily, u)
    expect(daily.phase).toBe('january')
    expect(januaryGambleProblem(daily)).toMatch(/no spin or Upgrader/)
    expect(() => rollJanuarySpin(daily, u)).toThrow()
  })

  it('a link with the gamble is non-standard for the ranked boards; old links and the x block still read', () => {
    const base = { v: 1, data: u.generatedAt, engine: ENGINE_VERSION, name: 'A', s: { seed: 's', f: '4-3-3', l: 'england', wl: ['england'], h: 'burnley', ls: 2025, d: 'calibrated', r: {} }, p: [], c: { pts: 1, w: 0, d: 1, l: 0, t: 'RELEGATED' }, k: '' } as unknown as QuickChallengePayload
    expect(nonStandardRun({ ...base, x: { jg: ['s', 'ST'] as ['s', string] } }, QUICK_RULES)).toMatch(/January/)
    expect(nonStandardRun({ ...base, x: { j: ['a', 'ST'] as [string, string] } }, QUICK_RULES)).toBeNull()
    expect(isChallengeSeason({ jg: ['s'] })).toBe(true)
    expect(isChallengeSeason({ jg: ['s', 'LW'] })).toBe(true)
    expect(isChallengeSeason({ jg: ['u', 'x@2020@y', 5] })).toBe(true)
    expect(isChallengeSeason({ jg: ['u', 'x@2020@y', 7] })).toBe(false)
    expect(isChallengeSeason({ jg: ['z'] })).toBe(false)
    expect(isChallengeSeason({ jg: ['s', 'ST'], j: ['a', 'ST'] })).toBe(false)
    expect(isChallengeSeason({ j: ['a', 'ST'] })).toBe(true)
  })

  it('a save from before the gamble opens in January and plays on; a malformed gamble is dropped', () => {
    const g = atJanuary({ seed: 'jg-3' })
    const old = clone(g)
    const n = normaliseGame(old)!
    expect(n.quickJanuary).toEqual(g.quickJanuary)
    expect(n.quickJanuary!.spin).toBeUndefined()
    expect(n.quickJanuary!.upgrade).toBeUndefined()
    closeJanuary(n, u, null)
    expect(n.phase).toBe('summary')
    const bad = clone(g)
    ;(bad.quickJanuary as unknown as Record<string, unknown>).spin = { playerSeasonId: 3 }
    ;(bad.quickJanuary as unknown as Record<string, unknown>).upgrade = { id: 'x', boost: 4 }
    const fixed = normaliseGame(bad)!
    expect(fixed.quickJanuary!.spin).toBeUndefined()
    expect(fixed.quickJanuary!.upgrade).toBeUndefined()
  })
})
