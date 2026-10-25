import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { assistantChoice, autoDraft, chooseSlot, closeBench, fillingXI, isComplete, newDraft, pick, QUICK_RULES, spin, spinClubSeason, spinnableSlots, upgraderOn, type DraftRules, type DraftState, type QuickMode } from '@engine/draft'
import { ARMBAND_BOOST, armbandId, canLock, canPeek, canReroll, canSwap, draftBoost, giveArmband, lockPlayer, lockedId, peekedSeason, peekNext, powerUpUsed, rerollOptions, rerollSeason, swapSlots, swapTargets, usePeek } from '@engine/powerups'
import { canUpgrade, upgradeCandidates, upgradePlayer } from '@engine/upgrader'
import { decodeChallenge, encodeChallenge, isChallengePowerUps, isRulesDiff } from '@engine/challenge'
import { getFormation } from '@engine/formations'
import { canCover } from '@engine/positions'
import { createGame, dailyGameSettings, describeRules, setupRules, summariseSetup } from '../logic/setup'
import { challengeFromGame, replayChallenge } from '../logic/challenge'
import { kickOff, toKickoff } from '../logic/quick'
import { playerLookup } from '../logic/players'
import { powerUpLog, powerUpsShareLine } from '../logic/powerups'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])
const LEAGUES = ['england']

function rules(extra: Partial<DraftRules> = {}, modes: QuickMode[] = []): DraftRules {
  return { ...QUICK_RULES, leagues: LEAGUES, powerUps: true, ...(modes.length ? { modes } : {}), ...extra }
}

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return { mode: 'quick', seed: 'PU-1', formationId: '4-3-3', teamName: 'Power XI', shortName: 'PXI', leagueId: 'england', wheelLeagues: LEAGUES, hostClubId: 'burnley', leagueSeason: 2025, rules: rules(), jobSecurity: false, difficulty: 'calibrated', january: false, ...partial }
}

const clone = (d: DraftState): DraftState => JSON.parse(JSON.stringify(d)) as DraftState

/** The assistant's pick from the spin showing. */
function assistantPick(d: DraftState): void {
  const cs = spinClubSeason(u, d)!
  const best = assistantChoice(u, d, cs)!
  pick(u, d, best.id, best.slot)
}

/** Draft `picks` players by the assistant. */
function draftAfter(r: DraftRules, picks: number, seed: string): { d: DraftState; rng: Rng } {
  const d = newDraft(getFormation('4-3-3'), r, seed)
  const rng = new Rng(seed)
  for (let i = 0; i < picks; i++) {
    if (d.rules.draftMode === 'position' && !d.target) chooseSlot(u, d, spinnableSlots(u, d)[0].id)
    spin(u, d, rng)
    assistantPick(d)
  }
  return { d, rng }
}

/** A spin showing with another season of the same club on the wheel, so a re-roll is possible. */
function rerollable(seed: string): { d: DraftState; rng: Rng } {
  for (let i = 0; ; i++) {
    const { d, rng } = draftAfter(rules(), 1, `${seed}-${i}`)
    spin(u, d, rng)
    if (canReroll(u, d)) return { d, rng }
  }
}

/** Play a game with every power-up used once, the way a manager might, then the season. */
function playWithAll(seed: string): Game {
  const g = createGame(settings({ seed }))
  const d = g.draft!
  const rng = Rng.fromState(g.rngState)
  let guard = 0
  while (!isComplete(d) && guard++ < 60) {
    if (!powerUpUsed(d, 'peek') && canPeek(u, d)) usePeek(u, d, rng.getState())
    if (!powerUpUsed(d, 'swap') && Object.keys(d.lineup).length >= 4 && canSwap(u, d)) {
      const from = Object.keys(d.lineup).find((s) => swapTargets(u, d, s).length)!
      swapSlots(u, d, from, swapTargets(u, d, from)[0])
    }
    spin(u, d, rng)
    if (canReroll(u, d)) rerollSeason(u, d)
    assistantPick(d)
    if (Object.keys(d.lineup).length === 3 && canLock(d)) lockPlayer(d, upgradeCandidates(d)[1])
  }
  g.rngState = rng.getState()
  const ids = upgradeCandidates(d)
  giveArmband(d, ids[5])
  upgradePlayer(u, d, ids[1], 10)
  toKickoff(g, u)
  kickOff(g, u, true)
  return g
}

describe('power-ups: the rule', () => {
  it('is a Quick Draft rule that links carry, never on in the Daily, and named in the setup words', () => {
    expect(isRulesDiff({ powerUps: true })).toBe(true)
    expect(isRulesDiff({ powerUps: 1 })).toBe(false)
    const base = { difficulty: 'normal' as const, showRatings: true, draftMode: 'squad' as const, ratings: 'season' as const, eraFrom: 2008, eraTo: 2026, first: 2008, last: 2026, twists: true, leagues: LEAGUES }
    expect(setupRules(QUICK_RULES, { ...base, powerUps: true }).powerUps).toBe(true)
    expect(setupRules(QUICK_RULES, base).powerUps).toBeUndefined()
    expect(setupRules(QUICK_RULES, { ...base, powerUps: true, modes: ['crazy'] }).powerUps).toBe(true)
    for (const day of ['daily-2026-10-25', 'daily-2026-01-01', 'daily-2025-06-30']) expect(dailyGameSettings(u, day, 'Me').rules.powerUps).toBeUndefined()
    expect(describeRules(u, rules()).some((t) => t.includes('Power-ups'))).toBe(true)
    expect(summariseSetup(u, settings())).toContain('power-ups')
    expect(upgraderOn(rules())).toBe(true)
  })

  it('leaves every spin of a draft where the same draft without power-ups lands, while none is used', () => {
    for (let i = 0; i < 20; i++) {
      const seed = `PU-SAME-${i}`
      const a = newDraft(getFormation('4-3-3'), rules(), seed)
      const b = newDraft(getFormation('4-3-3'), { ...rules(), powerUps: undefined }, seed)
      const ra = new Rng(seed)
      const rb = new Rng(seed)
      autoDraft(u, a, ra)
      autoDraft(u, b, rb)
      expect(a.history).toEqual(b.history)
      expect(ra.getState()).toEqual(rb.getState())
      expect(a.powerRng).toBeDefined()
      expect(b.powerRng).toBeUndefined()
    }
  })
})

describe('Re-roll season', () => {
  it('keeps the club, lands on another of its seasons on the wheel, once, and never moves the game stream', () => {
    for (let i = 0; i < 15; i++) {
      const { d, rng } = rerollable(`RR-${i}`)
      const before = { ...d.current! }
      const options = rerollOptions(u, d).map((cs) => cs.season)
      const spins = d.spins
      const main = rng.getState()
      const cs = rerollSeason(u, d)
      expect(cs.clubId).toBe(before.clubId)
      expect(cs.season).not.toBe(before.season)
      expect(options).toContain(cs.season)
      expect(d.current).toEqual({ clubId: before.clubId, season: cs.season })
      expect(d.spins).toBe(spins)
      expect(rng.getState()).toEqual(main)
      expect(() => rerollSeason(u, d)).toThrow()
      expect(canReroll(u, d)).toBe(false)
      // The pick then comes from the new season's squad
      assistantPick(d)
      expect(d.history[d.history.length - 1].season).toBe(cs.season)
    }
  })

  it('draws each season shown equally often, and the same seed re-rolls the same way', () => {
    const { d } = rerollable('RR-ODDS')
    const options = rerollOptions(u, d).map((cs) => cs.season)
    const counts = new Map<number, number>()
    const n = 1200
    for (let i = 0; i < n; i++) {
      const c = clone(d)
      c.powerRng = new Rng(`RR-ODDS-${i}`).getState()
      const s = rerollSeason(u, c).season
      counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    const expected = n / options.length
    for (const s of options) expect(Math.abs((counts.get(s) ?? 0) - expected)).toBeLessThan(5 * Math.sqrt(expected))
    expect(rerollSeason(u, clone(d)).season).toBe(rerollSeason(u, clone(d)).season)
  })

  it('needs a spin showing and power-ups on', () => {
    const { d } = draftAfter(rules(), 1, 'RR-NONE')
    expect(canReroll(u, d)).toBe(false)
    expect(() => rerollSeason(u, d)).toThrow()
    const plain = draftAfter({ ...rules(), powerUps: undefined }, 1, 'RR-PLAIN')
    spin(u, plain.d, plain.rng)
    expect(canReroll(u, plain.d)).toBe(false)
    expect(() => rerollSeason(u, plain.d)).toThrow()
  })
})

describe('Peek', () => {
  it('shows the season the next spin lands on, in every draft mode, without drawing', () => {
    const variants: Array<[string, DraftRules]> = [
      ['plain', rules()],
      ['crazy', rules({ twists: true }, ['crazy'])],
      ['gamble', rules({}, ['gamble'])],
      ['position', rules({ draftMode: 'position' })],
      ['bench', rules({ benchPicks: 3 })],
    ]
    for (const [name, r] of variants) {
      for (let i = 0; i < 12; i++) {
        const { d, rng } = draftAfter(r, (i % 5) + 1, `PEEK-${name}-${i}`)
        if (isComplete(d)) continue
        if (r.draftMode === 'position' && !d.target) chooseSlot(u, d, spinnableSlots(u, d)[0].id)
        const main = rng.getState()
        const seen = usePeek(u, d, main)
        expect(rng.getState()).toEqual(main)
        expect(peekedSeason(d)).toBe(seen)
        const cs = spin(u, d, rng)
        expect(cs.season).toBe(seen)
        expect(peekedSeason(d)).toBeNull()
        expect(canPeek(u, d)).toBe(false)
      }
    }
  })

  it('pins the slot and the XI while it shows, and is once per draft', () => {
    const { d, rng } = draftAfter(rules({ draftMode: 'position' }), 4, 'PEEK-PIN')
    const slots = spinnableSlots(u, d)
    chooseSlot(u, d, slots[0].id)
    usePeek(u, d, rng.getState())
    expect(() => chooseSlot(u, d, slots[1].id)).toThrow()
    expect(canSwap(u, d)).toBe(false)
    expect(() => usePeek(u, d, rng.getState())).toThrow()
    expect(peekNext(u, d, rng.getState())!.season).toBe(peekedSeason(d))
    spin(u, d, rng)
    expect(peekNext(u, d, rng.getState())).toBeNull()
  })
})

describe('Swap', () => {
  it('moves a starter to a slot he can cover, or exchanges two who can cover each other, for free and once', () => {
    let moved = 0
    for (let i = 0; i < 30; i++) {
      const { d, rng } = draftAfter(rules(), 6, `SWAP-${i}`)
      if (!canSwap(u, d)) continue
      const from = Object.keys(d.lineup).find((s) => swapTargets(u, d, s).length)!
      const to = swapTargets(u, d, from)[0]
      const a = d.lineup[from]
      const b = d.lineup[to]
      const history = JSON.stringify(d.history)
      const respins = d.respinsLeft
      const main = rng.getState()
      swapSlots(u, d, from, to)
      expect(d.lineup[to]).toBe(a)
      expect(d.lineup[from]).toBe(b)
      const slotOf = (id: string) => d.formation.slots.find((s) => s.id === id)!.position
      expect(canCover(u.index[a], slotOf(to), d.rules.minFit)).toBe(true)
      if (b) expect(canCover(u.index[b], slotOf(from), d.rules.minFit)).toBe(true)
      expect(JSON.stringify(d.history)).toBe(history)
      expect(d.respinsLeft).toBe(respins)
      expect(rng.getState()).toEqual(main)
      expect(canSwap(u, d)).toBe(false)
      expect(() => swapSlots(u, d, to, from)).toThrow()
      moved++
    }
    expect(moved).toBeGreaterThan(10)
  })

  it('refuses a slot he cannot cover, an empty slot to move from, and a spin showing', () => {
    const { d, rng } = draftAfter(rules(), 5, 'SWAP-BAD')
    const from = Object.keys(d.lineup)[0]
    const bad = d.formation.slots.find((s) => s.id !== from && !swapTargets(u, d, from).includes(s.id))
    if (bad) expect(() => swapSlots(u, d, from, bad.id)).toThrow()
    const open = d.formation.slots.find((s) => !d.lineup[s.id])!
    expect(() => swapSlots(u, d, open.id, from)).toThrow()
    spin(u, d, rng)
    expect(canSwap(u, d)).toBe(false)
    expect(() => swapSlots(u, d, from, swapTargets(u, d, from)[0] ?? from)).toThrow()
  })
})

describe("Captain's armband and Lock", () => {
  it('the armband adds two to one drafted player through the game lookup, once, never touching the universe', () => {
    const g = createGame(settings({ seed: 'BAND-1' }))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    const id = upgradeCandidates(g.draft!)[2]
    const before = JSON.stringify(u.index[id])
    giveArmband(g.draft!, id)
    expect(armbandId(g.draft!)).toBe(id)
    expect(draftBoost(g.draft!, id)).toBe(ARMBAND_BOOST)
    expect(playerLookup(g, u)(id)!.overall).toBe(Math.min(99, u.index[id].overall + ARMBAND_BOOST))
    const other = upgradeCandidates(g.draft!)[3]
    expect(playerLookup(g, u)(other)).toBe(u.index[other])
    expect(JSON.stringify(u.index[id])).toBe(before)
    expect(() => giveArmband(g.draft!, other)).toThrow()
    expect(() => giveArmband(newDraft(getFormation('4-3-3'), rules(), 'X'), id)).toThrow()
  })

  it('the lock turns an Upgrader loss on him into no change, and must come first', () => {
    let losses = 0
    for (let i = 0; i < 80 && losses < 8; i++) {
      const { d } = draftAfter(rules(), 3, `LOCK-${i}`)
      const id = upgradeCandidates(d)[0]
      const free = clone(d)
      const plain = upgradePlayer(u, free, id, 10)
      if (plain.won) continue
      losses++
      lockPlayer(d, id)
      expect(lockedId(d)).toBe(id)
      const up = upgradePlayer(u, d, id, 10)
      expect(up.roll).toBe(plain.roll)
      expect(up.won).toBe(false)
      expect(up.locked).toBe(true)
      expect(up.delta).toBe(0)
      expect(draftBoost(d, id)).toBe(0)
      expect(canLock(d)).toBe(false)
    }
    expect(losses).toBeGreaterThan(3)
    // After the Upgrader the lock is gone; on a win it changes nothing
    const { d } = draftAfter(rules(), 2, 'LOCK-LATE')
    upgradePlayer(u, d, upgradeCandidates(d)[0], 2)
    expect(canUpgrade(d)).toBe(false)
    expect(() => lockPlayer(d, upgradeCandidates(d)[0])).toThrow()
  })
})

describe('power-ups in links, the log and the share text', () => {
  it('replay a draft that used all six, verified, and the link rows are checked', () => {
    for (const seed of ['PU-LINK-1', 'PU-LINK-2', 'PU-LINK-3', 'PU-LINK-4']) {
      const g = playWithAll(seed)
      const d = g.draft!
      expect(powerUpUsed(d, 'peek')).toBe(true)
      expect(powerUpUsed(d, 'armband')).toBe(true)
      expect(powerUpUsed(d, 'lock')).toBe(true)
      expect(powerUpUsed(d, 'upgrader')).toBe(true)
      const c = challengeFromGame(g, u, 'Power')!
      expect(c.w?.length).toBe(d.powerUps!.length)
      const out = replayChallenge(u, decodeChallenge(encodeChallenge(c)))
      expect(out.reason).toBeUndefined()
      expect(out.verified).toBe('yes')
      // Without the power-ups the same picks do not replay to the same draft or season
      const stripped = replayChallenge(u, decodeChallenge(encodeChallenge({ ...c, w: undefined })))
      if (d.powerUps!.some((x) => x.kind === 'reroll' || x.kind === 'swap')) expect(stripped.verified).toBe('no')
    }
  })

  it('make a working link when the bench closed while a peek showed (a peek no spin followed)', () => {
    for (const seed of ['PU-BENCH-1', 'PU-BENCH-2']) {
      const g = createGame(settings({ seed, rules: rules({ benchPicks: 3 }) }))
      const d = g.draft!
      const rng = Rng.fromState(g.rngState)
      while (fillingXI(d)) {
        spin(u, d, rng)
        assistantPick(d)
      }
      g.rngState = rng.getState()
      expect(canPeek(u, d)).toBe(true)
      usePeek(u, d, g.rngState)
      closeBench(d)
      toKickoff(g, u)
      kickOff(g, u, true)
      const c = challengeFromGame(g, u, 'Bench')!
      expect(c.w).toBeUndefined()
      const out = replayChallenge(u, decodeChallenge(encodeChallenge(c)))
      expect(out.reason).toBeUndefined()
      expect(out.verified).toBe('yes')
    }
  })

  it('reject malformed power-up rows', () => {
    expect(isChallengePowerUps([['r', 0], ['p', 1], ['s', 2, 'a', 'b'], ['a', 3], ['l', 4]], 11)).toBe(true)
    expect(isChallengePowerUps([['r', 0], ['r', 1]], 11)).toBe(false)
    expect(isChallengePowerUps([['r', 11]], 11)).toBe(false)
    expect(isChallengePowerUps([['s', 11, 'a', 'b']], 11)).toBe(true)
    expect(isChallengePowerUps([['x', 1]], 11)).toBe(false)
    expect(isChallengePowerUps([['s', 1, 'a']], 11)).toBe(false)
    expect(isChallengePowerUps('r', 11)).toBe(false)
    const c = challengeFromGame(playWithAll('PU-LINK-BAD'), u, 'Power')!
    expect(() => decodeChallenge(encodeChallenge({ ...c, w: [['r', 99]] }))).toThrow()
  })

  it('show one log line per power-up used and a share line of icons', () => {
    const g = playWithAll('PU-LOG')
    const d = g.draft!
    const lines = powerUpLog(d, (id) => u.index[id]?.name ?? id, (s) => String(s))
    expect(lines.length).toBe(d.powerUps!.length + 1)
    expect(lines.some((l) => l.text.startsWith('Upgrader +10'))).toBe(true)
    expect(lines.some((l) => l.text.startsWith('Armband to'))).toBe(true)
    const share = powerUpsShareLine(d)!
    expect(share).toContain('Power-ups')
    expect(share).toContain('©️')
    expect(share).toContain('🔒')
    expect(powerUpsShareLine(newDraft(getFormation('4-3-3'), rules(), 'NONE'))).toBe('🧰 Power-ups unused')
    expect(powerUpsShareLine(newDraft(getFormation('4-3-3'), { ...rules(), powerUps: undefined }, 'NONE'))).toBeNull()
  })
})
