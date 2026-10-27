import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { assistantTurn, autoDraft, QUICK_RULES, spin, type DraftRules } from '@engine/draft'
import { decodeChallenge, encodeChallenge, isRulesDiff, rulesDiff, rulesFromPayload } from '@engine/challenge'
import { CASE_ITEMS, caseRarityOdds, rollCase, type CaseItem } from '@engine/endCase'
import { MANAGER_SPIN_REELS, spinManagers } from '@engine/managers'
import { iconsCollection } from '@engine/icons'
import { canReroll, giveArmband, hasPowerUp, rerollSeason, unpackPowerUp } from '@engine/powerups'
import { closeJanuary, kickOff, quickXI, toKickoff } from '../logic/quick'
import { gameManagerWheel, managerSpinOn, managerSpinOdds, managerTier, pickManager, quickManagerOptions } from '../logic/managers'
import { addToLocker, caseIconChoices, caseIconIn, caseLine, cleanLocker, endCaseOn, finishEndCase, kickoffStep, lockerCount, lockerOn, openEndCase, subCaseIcon, takeFromLocker, unpackFromLocker, canUnpackFromLocker } from '../logic/endCase'
import { challengeFromGame, challengeSettings, replayChallenge, settingsFromChallenge } from '../logic/challenge'
import { createGame, dailyGameSettings, describeRules, setupRules } from '../logic/setup'
import { normaliseGame, normaliseProfile } from '../logic/save'
import { playerLookup } from '../logic/players'
import { reelLeagues } from '../logic/reel'
import { dealItems, ITEM_REEL_CARDS, ITEM_REEL_LAND, caseFillers, caseItemCard, initials } from '../logic/itemReel'
import type { Game, GameSettings, Profile } from '../types'

const u = loadTestUniverse(['england'])

/** The rules a default Quick Draft from the Setup screen starts with: the manager spin and the end case on. */
const SETUP = setupRules(QUICK_RULES, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: 0, eraTo: 9999, first: 0, last: 9999, twists: true, leagues: ['england'], benchPicks: 5, managers: true, managerSpin: true, endCase: true })

function settings(seed: string, rules: Partial<DraftRules> = {}): GameSettings {
  return { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Case XI', shortName: 'CAS', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...SETUP, ...rules }, jobSecurity: false, difficulty: 'calibrated', january: false }
}

/** A quick game auto-drafted (the store's Auto-complete) and standing at the end of the draft. */
function drafted(seed: string, rules: Partial<DraftRules> = {}): Game {
  const g = createGame(settings(seed, rules))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  return g
}

function play(g: Game): Game {
  kickOff(g, u)
  if (g.phase === 'january') closeJanuary(g, u, null)
  expect(g.phase).toBe('summary')
  g.quickOpen = false
  return g
}

/** The first seeds (of this prefix) whose end case drops an Icon. */
function iconSeeds(prefix: string, n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < 400 && out.length < n; i++) {
    const g = drafted(`${prefix}-${i}`)
    toKickoff(g, u)
    if (g.endCase?.drop.kind === 'icon') out.push(`${prefix}-${i}`)
  }
  return out
}

describe('the rules', () => {
  it('both are on from the Setup screen, off in QUICK_RULES, the Daily and older links', () => {
    expect(SETUP.managerSpin).toBe(true)
    expect(SETUP.endCase).toBe(true)
    expect(QUICK_RULES.managerSpin).toBeUndefined()
    expect(QUICK_RULES.endCase).toBeUndefined()
    const daily = dailyGameSettings(u, 'daily-2026-10-25')
    expect(daily.rules.managerSpin).toBeUndefined()
    expect(daily.rules.endCase).toBeUndefined()
    // The spin needs managers: switched off, there is nothing to spin
    const base = { difficulty: 'normal' as const, showRatings: true, draftMode: 'squad' as const, ratings: 'season' as const, eraFrom: 0, eraTo: 9999, first: 0, last: 9999, twists: true, leagues: ['england'] }
    expect(setupRules(QUICK_RULES, { ...base, managers: false, managerSpin: true }).managerSpin).toBeUndefined()
    expect(setupRules(QUICK_RULES, { ...base, managerSpin: false, endCase: false }).endCase).toBeUndefined()
    expect(describeRules(u, SETUP)).toEqual(expect.arrayContaining(['Manager spin', 'End case']))
    expect(describeRules(u, QUICK_RULES)).toContain('Manager pick')
  })

  it('travel in a link and are checked there; a link made before them reads them as off', () => {
    const diff = rulesDiff(SETUP)
    expect(diff.managerSpin).toBe(true)
    expect(diff.endCase).toBe(true)
    expect(isRulesDiff(diff)).toBe(true)
    expect(isRulesDiff({ managerSpin: 'yes' })).toBe(false)
    expect(isRulesDiff({ endCase: 1 })).toBe(false)
    const g = play((() => {
      const x = drafted('rules-link-1')
      toKickoff(x, u)
      x.managerSpin!.picked = true
      openEndCase(x)
      finishEndCase(x)
      return x
    })())
    const c = challengeFromGame(g, u, 'Tester')!
    expect(rulesFromPayload(c).managerSpin).toBe(true)
    const old = { ...c, s: { ...c.s, r: Object.fromEntries(Object.entries(c.s.r).filter(([k]) => k !== 'managerSpin' && k !== 'endCase')) } }
    expect(rulesFromPayload(old).managerSpin).toBeUndefined()
    expect(rulesFromPayload(old).endCase).toBeUndefined()
  })
})

describe('the manager spin', () => {
  it('lands three different managers from the wheel, the same on every replay of a seed, without moving the game stream', () => {
    const wheel = new Set(gameManagerWheel(drafted('ms-wheel'), u).map((m) => `${m.id}@${m.clubId}@${m.season}`))
    for (let i = 0; i < 30; i++) {
      const a = drafted(`ms-det-${i}`)
      const b = drafted(`ms-det-${i}`)
      const before = { ...a.rngState }
      toKickoff(a, u)
      toKickoff(b, u)
      expect(a.rngState).toEqual(before)
      const opts = a.managerSpin!.options
      expect(opts).toHaveLength(MANAGER_SPIN_REELS)
      expect(b.managerSpin!.options).toEqual(opts)
      expect(new Set(opts.map((m) => m.id)).size).toBe(MANAGER_SPIN_REELS)
      for (const m of opts) expect(wheel.has(`${m.id}@${m.clubId}@${m.season}`)).toBe(true)
      // The default before the pick is the first reel's; the spin step comes first
      expect(a.manager).toEqual(opts[0])
      expect(kickoffStep(a)).toBe('managers')
      expect(quickManagerOptions(a)).toEqual(opts)
    }
  }, 60_000)

  it('picks one of the three only, then moves on; nothing during the draft', () => {
    const g = drafted('ms-pick-1')
    expect(managerSpinOn(g)).toBe(true)
    expect(quickManagerOptions(g)).toEqual([])
    const opts = (toKickoff(g, u), g.managerSpin!.options)
    expect(() => pickManager(g, u, 'Q1')).toThrow(/not on offer/)
    pickManager(g, u, opts[2].id)
    expect(g.manager?.id).toBe(opts[2].id)
    expect(g.managerSpin!.picked).toBe(true)
    expect(kickoffStep(g)).toBe('case')
  })

  it('a reel lands in each tier as often as the odds shown say', () => {
    const g = drafted('ms-odds')
    const wheel = gameManagerWheel(g, u)
    const leagues = reelLeagues(u, g.settings.rules)
    const odds = managerSpinOdds(u, g)
    expect(odds.reduce((s, o) => s + o.p, 0)).toBeCloseTo(1, 9)
    const N = 4000
    const seen: Record<string, number> = {}
    for (let i = 0; i < N; i++) {
      const first = spinManagers(wheel, new Rng(`ms-odds-${i}`))[0]
      const t = managerTier(u, leagues, first)
      seen[t] = (seen[t] ?? 0) + 1
    }
    for (const o of odds) {
      const sd = Math.sqrt((o.p * (1 - o.p)) / N)
      expect(Math.abs((seen[o.tier] ?? 0) / N - o.p)).toBeLessThan(4 * sd + 1e-9)
    }
  })

  it('consumes no draw: the season with a spun manager is the season with that manager set by hand', () => {
    for (const seed of ['ms-same-1', 'ms-same-2', 'ms-same-3']) {
      const a = drafted(seed, { endCase: false })
      toKickoff(a, u)
      pickManager(a, u, a.managerSpin!.options[1].id)
      const b = drafted(seed, { managerSpin: false, endCase: false })
      toKickoff(b, u)
      b.manager = { ...a.manager! }
      play(a)
      play(b)
      expect(a.quickResult!.results).toEqual(b.quickResult!.results)
      expect(a.rngState).toEqual(b.rngState)
    }
  }, 60_000)

  it('a challenge link replays the same three and the pick; a manager the spin did not land is refused', () => {
    const g = drafted('ms-link-1')
    toKickoff(g, u)
    pickManager(g, u, g.managerSpin!.options[2].id)
    finishEndCase((openEndCase(g), g))
    play(g)
    const c = challengeFromGame(g, u, 'Tester')!
    expect(c.x?.m).toBe(g.managerSpin!.options[2].id)
    expect(replayChallenge(u, decodeChallenge(encodeChallenge(c))).verified).toBe('yes')
    const other = gameManagerWheel(g, u).find((m) => !g.managerSpin!.options.some((x) => x.id === m.id))!
    const bad = replayChallenge(u, decodeChallenge(encodeChallenge({ ...c, x: { ...c.x, m: other.id } })))
    expect(bad.verified).toBe('no')
    expect(bad.reason).toMatch(/not on offer/)
  })

  it('the Daily has no spin and no case, and plays as before', () => {
    const g = createGame(dailyGameSettings(u, 'daily-2026-10-25'))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    toKickoff(g, u)
    expect(g.managerSpin).toBeUndefined()
    expect(g.endCase).toBeUndefined()
    expect(kickoffStep(g)).toBe('tactics')
    expect(lockerOn({ ...g, phase: 'draft' })).toBe(false)
  })
})

describe('the end-of-draft case', () => {
  it('drops each item as often as the odds shown say (exact whole per cent)', () => {
    expect(CASE_ITEMS.reduce((s, x) => s + x.weight, 0)).toBe(100)
    expect(caseRarityOdds()).toEqual({ common: 54, rare: 28, epic: 13, icon: 5 })
    const g = drafted('case-odds')
    const leagues = reelLeagues(u, g.settings.rules)
    const N = 6000
    const seen: Partial<Record<CaseItem, number>> = {}
    for (let i = 0; i < N; i++) {
      const drop = rollCase(u, g.draft!, leagues, new Rng(`case-odds-${i}`))
      const item: CaseItem = drop.kind === 'icon' ? 'icon' : drop.powerUp
      seen[item] = (seen[item] ?? 0) + 1
    }
    for (const x of CASE_ITEMS) {
      const p = x.weight / 100
      expect(Math.abs((seen[x.item] ?? 0) / N - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / N))
    }
  })

  it('is the same case on every replay of a seed, and opening it moves nothing', () => {
    for (let i = 0; i < 30; i++) {
      const a = drafted(`case-det-${i}`)
      const b = drafted(`case-det-${i}`)
      const before = { ...a.rngState }
      toKickoff(a, u)
      toKickoff(b, u)
      expect(a.endCase!.drop).toEqual(b.endCase!.drop)
      expect(a.rngState).toEqual(before)
    }
  }, 60_000)

  it('an Icon drop is a best-of-all-time player not in the squad, who can cover a drafted starter', () => {
    const icons = new Set(iconsCollection(u, ['england']).squad.map((p) => p.id))
    for (const seed of iconSeeds('case-icon', 3)) {
      const g = drafted(seed)
      toKickoff(g, u)
      const drop = g.endCase!.drop
      if (drop.kind !== 'icon') throw new Error('expected an Icon')
      expect(icons.has(drop.id)).toBe(true)
      expect(g.draft!.takenPlayers).not.toContain(u.index[drop.id].playerId)
      expect(caseIconChoices(g, u).length).toBeGreaterThan(0)
    }
  }, 60_000)

  it('a power-up drop goes to the locker once; the season is the season without a case', () => {
    let checked = 0
    for (let i = 0; i < 12 && checked < 4; i++) {
      const seed = `case-pu-${i}`
      const a = drafted(seed, { managers: false })
      toKickoff(a, u)
      if (a.endCase!.drop.kind !== 'powerup') continue
      checked++
      expect(kickoffStep(a)).toBe('case')
      const drop = openEndCase(a)
      expect(drop).toBe(a.endCase!.drop.powerUp)
      expect(openEndCase(a)).toBeNull()
      finishEndCase(a)
      expect(kickoffStep(a)).toBe('tactics')
      expect(caseLine(a, (id) => id)).toMatch(/to the locker/)
      const b = drafted(seed, { managers: false, endCase: false })
      toKickoff(b, u)
      play(a)
      play(b)
      expect(a.quickResult!.results).toEqual(b.quickResult!.results)
      expect(a.rngState).toEqual(b.rngState)
    }
    expect(checked).toBe(4)
  }, 60_000)

  it('the Icon comes in for a starter, the season is non-standard, and a link replays him in the same slot', () => {
    const [seed] = iconSeeds('case-sub', 1)
    const g = drafted(seed)
    toKickoff(g, u)
    pickManager(g, u, g.managerSpin!.options[0].id)
    openEndCase(g)
    const drop = g.endCase!.drop
    if (drop.kind !== 'icon') throw new Error('expected an Icon')
    const [best, second] = caseIconChoices(g, u)
    // Change of mind before kick-off: only ever one slot
    subCaseIcon(g, u, best.slotId)
    if (second) {
      subCaseIcon(g, u, second.slotId)
      expect(g.draft!.lineup[best.slotId]).toBe(best.outId)
    }
    subCaseIcon(g, u, best.slotId)
    expect(Object.values(g.draft!.lineup).filter((id) => id === drop.id)).toHaveLength(1)
    expect(quickXI(g, u).lineup[best.slotId]).toBe(drop.id)
    expect(caseIconIn(g)).toBe(true)
    expect(kickoffStep(g)).toBe('tactics')
    play(g)
    expect(g.lineup[best.slotId]).toBe(drop.id)
    expect(g.unlocked).not.toContain('record-points')
    expect(caseLine(g, (id) => playerLookup(g, u)(id)?.name ?? id)).toMatch(/non-standard/)
    const c = challengeFromGame(g, u, 'Tester')!
    expect(c.x?.ic).toBe(best.slotId)
    expect(replayChallenge(u, decodeChallenge(encodeChallenge(c))).verified).toBe('yes')
    // Without the Icon the claim does not replay; a slot he cannot take is refused
    const without = { ...c, x: { ...c.x } }
    delete without.x.ic
    expect(replayChallenge(u, decodeChallenge(encodeChallenge(without))).verified).not.toBe('yes')
    const gk = g.draft!.formation.slots.find((s) => s.position === 'GK')!.id
    if (!caseIconChoices(g, u).some((x) => x.slotId === gk)) expect(replayChallenge(u, decodeChallenge(encodeChallenge({ ...c, x: { ...c.x, ic: gk } }))).verified).toBe('no')
  }, 60_000)

  it('is off in a game from a challenge link (the head-to-head compares drafts), and the locker is closed there', () => {
    const g = drafted('case-link-src')
    toKickoff(g, u)
    pickManager(g, u, g.managerSpin!.options[0].id)
    finishEndCase((openEndCase(g), g))
    play(g)
    const c = challengeFromGame(g, u, 'Tester')!
    const outcome = replayChallenge(u, c)
    const friend = createGame(settingsFromChallenge(c, 'Friend', 'FRI', challengeSettings(c, outcome)))
    expect(endCaseOn(friend)).toBe(false)
    expect(lockerOn(friend)).toBe(false)
    const rng = Rng.fromState(friend.rngState)
    autoDraft(u, friend.draft!, rng)
    friend.rngState = rng.getState()
    toKickoff(friend, u)
    expect(friend.endCase).toBeUndefined()
    // The manager spin still runs there: it is part of the draft both sides play
    expect(friend.managerSpin?.options).toHaveLength(3)
  })
})

describe('the locker', () => {
  const profile = (inventory: Profile['inventory']): Profile => ({ achievements: {}, leaderboard: [], dailyStreak: 0, lastDailyDate: null, dailyResults: {}, gamesPlayed: 0, seasonsSimulated: 0, theme: 'auto', managerName: '', inventory })

  it('counts in and out, never below none, and cleans what a save holds', () => {
    let p = profile(undefined)
    p = addToLocker(addToLocker(p, 'swap'), 'swap')
    expect(lockerCount(p, 'swap')).toBe(2)
    p = takeFromLocker(takeFromLocker(takeFromLocker(p, 'swap'), 'swap'), 'swap')
    expect(lockerCount(p, 'swap')).toBe(0)
    expect(cleanLocker({ swap: 2, peek: -1, lock: 1.5, bogus: 3, armband: '2' })).toEqual({ swap: 2 })
    expect(cleanLocker([1, 2])).toEqual({})
    const defaults = profile(undefined)
    expect(normaliseProfile({ ...defaults, inventory: { reroll: 1, x: 9 } as Profile['inventory'] }, defaults).inventory).toEqual({ reroll: 1 })
    expect(normaliseProfile({ ...defaults }, defaults).inventory).toEqual({})
  })

  it('unpacks into a draft without the tray only, with the tray’s own streams', () => {
    const g = createGame(settings('locker-1', { endCase: false }))
    const p = profile({ reroll: 1, upgrader: 1 })
    expect(canUnpackFromLocker(g, p, 'reroll')).toBe(true)
    expect(canUnpackFromLocker(g, p, 'swap')).toBe(false)
    unpackFromLocker(g, 'reroll')
    expect(hasPowerUp(g.draft!, 'reroll')).toBe(true)
    expect(hasPowerUp(g.draft!, 'swap')).toBe(false)
    expect(canUnpackFromLocker(g, p, 'reroll')).toBe(false)
    // The stream is the one a tray draft on this seed gets
    const tray = createGame(settings('locker-1', { endCase: false, powerUps: true }))
    expect(g.draft!.powerRng).toEqual(tray.draft!.powerRng)
    expect(canUnpackFromLocker(tray, p, 'upgrader')).toBe(false)
    expect(() => unpackPowerUp(tray.draft!, 'reroll', 'locker-1')).toThrow(/whole tray/)
    // A Gamble draft has the Upgrader already
    const gamble = createGame(settings('locker-2', { modes: ['gamble'] }))
    expect(canUnpackFromLocker(gamble, p, 'upgrader')).toBe(false)
  })

  it('a link from a draft that used locker power-ups replays them', () => {
    let done = 0
    for (let i = 0; i < 20 && done < 2; i++) {
      const g = createGame(settings(`locker-link-${i}`, { endCase: false }))
      unpackFromLocker(g, 'reroll')
      unpackFromLocker(g, 'armband')
      const d = g.draft!
      const rng = Rng.fromState(g.rngState)
      // The first spin re-rolled from the locker, the assistant's pick on it, the rest auto-drafted, then the armband
      spin(u, d, rng)
      if (!canReroll(u, d)) continue
      rerollSeason(u, d)
      assistantTurn(u, d, rng)
      if (d.current) continue
      autoDraft(u, d, rng)
      g.rngState = rng.getState()
      giveArmband(d, Object.values(d.lineup)[0])
      toKickoff(g, u)
      pickManager(g, u, g.managerSpin!.options[0].id)
      play(g)
      const c = challengeFromGame(g, u, 'Tester')!
      expect(c.i).toEqual(['reroll', 'armband'])
      expect(replayChallenge(u, decodeChallenge(encodeChallenge(c))).verified).toBe('yes')
      const noLocker = { ...c }
      delete noLocker.i
      expect(replayChallenge(u, decodeChallenge(encodeChallenge(noLocker))).verified).toBe('no')
      done++
    }
    expect(done).toBe(2)
  }, 60_000)
})

describe('saves and the reels', () => {
  it('a save from before the spin and the case loads and plays: no spin, no case, straight to the tactics', () => {
    const g = drafted('old-save-1', { managerSpin: undefined, endCase: undefined })
    toKickoff(g, u)
    const old = JSON.parse(JSON.stringify(g)) as Game
    delete old.managerSpin
    delete old.endCase
    const n = normaliseGame(old)!
    expect(kickoffStep(n)).toBe('tactics')
    expect(n.managerSpin).toBeUndefined()
    play(n)
  })

  it('deals a strip with the item at the landing and no card twice in a row', () => {
    let seed = 7
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const target = caseItemCard('icon')
    const deal = dealItems(target, caseFillers(), random)
    expect(deal.cards).toHaveLength(ITEM_REEL_CARDS)
    expect(deal.cards[ITEM_REEL_LAND]).toBe(target)
    for (let i = 1; i < deal.cards.length; i++) expect(deal.cards[i].key).not.toBe(deal.cards[i - 1].key)
    expect(Math.abs(deal.jitter)).toBeLessThan(0.5)
    expect(initials('Arsène Wenger')).toBe('AW')
    expect(initials('Pep')).toBe('PE')
  })
})
