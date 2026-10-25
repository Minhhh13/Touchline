import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES, type DraftRules } from '@engine/draft'
import { decodeChallenge, encodeChallenge, isRulesDiff, rulesDiff } from '@engine/challenge'
import { MANAGER_EDGE } from '@engine/managers'
import { closeJanuary, kickOff, quickUserInput, quickXI, toKickoff } from '../logic/quick'
import { playQuickCup } from '../logic/quickCups'
import { canPickManager, managerLine, managersOn, pickManager, quickManagerBoost, quickManagerOptions, setManager } from '../logic/managers'
import { challengeFromGame, replayChallenge } from '../logic/challenge'
import { createGame, DAILY_RULES, dailyGameSettings, describeRules, setupRules, summariseSetup } from '../logic/setup'
import { normaliseGame } from '../logic/save'
import { playerLookup } from '../logic/players'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function settings(seed: string, rules: Partial<DraftRules> = {}, january = false): GameSettings {
  return { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Pin XI', shortName: 'PIN', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'], ...rules }, jobSecurity: false, difficulty: 'calibrated', january }
}

/** A quick game auto-drafted and standing at the kick-off step. */
function drafted(seed: string, rules: Partial<DraftRules> = {}, january = false): Game {
  const g = createGame(settings(seed, rules, january))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  return g
}

/** Kick off, pass on any January window and hand back the game at the summary. */
function play(g: Game): Game {
  toKickoff(g, u)
  kickOff(g, u)
  if (g.phase === 'january') closeJanuary(g, u, null)
  expect(g.phase).toBe('summary')
  return g
}

const withoutManagers = (r: DraftRules): DraftRules => {
  const { managers: _drop, ...rest } = r
  void _drop
  return rest
}

describe('Quick Draft managers: when a game has them', () => {
  it('on in a Quick Draft by default, off in the Daily and in a managed season', () => {
    expect(QUICK_RULES.managers).toBe(true)
    expect(DAILY_RULES.managers).toBe(false)
    expect(managersOn(drafted('mgr-on-1'))).toBe(true)
    expect(managersOn(createGame(dailyGameSettings(u, 'daily-2026-10-25')))).toBe(false)
    expect(managersOn(createGame({ ...settings('mgr-on-2'), mode: 'season' }))).toBe(false)
    // An older save's rules, with no field at all, have none
    expect(managersOn({ settings: { ...settings('mgr-on-3'), rules: withoutManagers(settings('mgr-on-3').rules) } })).toBe(false)
  })

  it('the Daily kicks off with no manager', () => {
    const g = createGame(dailyGameSettings(u, 'daily-2026-10-25'))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    toKickoff(g, u)
    expect(g.manager).toBeUndefined()
    expect(quickManagerOptions(g)).toEqual([])
  })

  it('the setup cards and the rules lines carry the toggle', () => {
    const c = { difficulty: 'normal' as const, showRatings: true, draftMode: 'squad' as const, ratings: 'season' as const, eraFrom: 2008, eraTo: 2026, first: 2008, last: 2026, twists: true, leagues: ['england'] }
    expect(setupRules(QUICK_RULES, c).managers).toBe(true)
    expect(setupRules(QUICK_RULES, { ...c, managers: false }).managers).toBe(false)
    expect(describeRules(u, setupRules(QUICK_RULES, c))).toContain('Manager pick')
    expect(describeRules(u, dailyGameSettings(u, 'daily-2026-10-25').rules)).not.toContain('Manager pick')
    expect(summariseSetup(u, settings('mgr-sum', { managers: false }))).toContain('no manager')
    expect(summariseSetup(u, settings('mgr-sum'))).not.toContain('manager')
  })
})

describe('picking the manager', () => {
  it('offers the managers of the club-seasons drafted and settles on the first at kick-off', () => {
    const g = drafted('mgr-pick-1')
    const opts = quickManagerOptions(g)
    expect(opts.length).toBeGreaterThanOrEqual(3)
    const drafted_ = new Set(g.draft!.history.filter((h) => h.pickedId).map((h) => `${h.clubId}@${h.season}`))
    for (const m of opts.filter((x) => !x.archetype)) expect(drafted_.has(`${m.clubId}@${m.season}`)).toBe(true)
    expect(canPickManager(g, u)).toBe(true)
    toKickoff(g, u)
    expect(g.manager).toEqual(opts[0])
  })

  it('keeps a pick made on the draft screen, changes at kick-off, and stops once the season is under way', () => {
    const g = drafted('mgr-pick-2')
    const opts = quickManagerOptions(g)
    const last = opts[opts.length - 1]
    pickManager(g, u, last.id)
    toKickoff(g, u)
    expect(g.manager?.id).toBe(last.id)
    pickManager(g, u, opts[0].id)
    expect(g.manager?.id).toBe(opts[0].id)
    expect(() => pickManager(g, u, 'Q1')).toThrow(/not on offer/)
    kickOff(g, u)
    pickManager(g, u, last.id)
    expect(g.manager?.id).toBe(opts[0].id)
  })

  it('a draft still spinning cannot pick yet', () => {
    const g = createGame(settings('mgr-pick-3'))
    expect(canPickManager(g, u)).toBe(false)
  })
})

/** The parent commit's quick seasons for these seeds (before managers existed): points, W, D, L, GF, GA, Cup reach, Cup scores. */
const PINNED: Array<[string, boolean, number, number, number, number, number, number, string, string]> = [
  ['mgr-pin-1', false, 58, 16, 10, 12, 64, 44, 'QF', '1-0 1-3'],
  ['mgr-pin-1', true, 58, 16, 10, 12, 64, 44, 'QF', '1-0 1-3'],
  ['mgr-pin-2', false, 81, 24, 9, 5, 91, 36, 'R16', '0-0'],
  ['mgr-pin-2', true, 81, 24, 9, 5, 91, 36, 'R16', '0-0'],
  ['mgr-pin-3', false, 76, 22, 10, 6, 83, 31, 'R16', '0-1'],
  ['mgr-pin-3', true, 76, 22, 10, 6, 83, 31, 'R16', '0-1'],
  ['mgr-pin-4', false, 49, 15, 4, 19, 53, 48, 'QF', '3-0 1-2'],
  ['mgr-pin-4', true, 49, 15, 4, 19, 53, 48, 'QF', '3-0 1-2'],
]

describe('no manager leaves every seed as it was', () => {
  it('managers off replays the seasons and cups of the build before managers, game for game', () => {
    for (const [seed, january, ...want] of PINNED) {
      const g = play(drafted(seed, { managers: false, ...(seed === 'mgr-pin-4' ? { benchPicks: 3 } : {}) }, january))
      expect(g.manager).toBeUndefined()
      g.quickOpen = false
      const q = g.quickResult!
      playQuickCup(g, u, 'cup')
      const cup = g.quickResult!.cup!
      expect([q.points, q.won, q.drawn, q.lost, q.goalsFor, q.goalsAgainst, cup.reached, cup.ties.map((t) => `${t.gf}-${t.ga}`).join(' ')]).toEqual(want)
    }
  })

  it('rules with no managers field play exactly as managers off', () => {
    for (const seed of ['mgr-same-1', 'mgr-same-2']) {
      const a = play(drafted(seed, { managers: false }))
      const b = createGame({ ...settings(seed), rules: withoutManagers(settings(seed).rules) })
      const rng = Rng.fromState(b.rngState)
      autoDraft(u, b.draft!, rng)
      b.rngState = rng.getState()
      play(b)
      expect(b.quickResult!.results).toEqual(a.quickResult!.results)
      expect(b.rngState).toEqual(a.rngState)
    }
  })

  it('a manager draws nothing: the draft and the end-of-season RNG state are the same with or without one', () => {
    const on = play(drafted('mgr-rng-1'))
    const off = play(drafted('mgr-rng-1', { managers: false }))
    expect(on.manager).toBeDefined()
    expect(on.draft!.history).toEqual(off.draft!.history)
    expect(on.rngState).toEqual(off.rngState)
  })
})

describe('the manager edge in a quick season', () => {
  it('is bounded, rides on the user side only, and replays the same season every time', () => {
    for (const seed of ['mgr-edge-1', 'mgr-edge-2', 'mgr-edge-3']) {
      const g = drafted(seed)
      toKickoff(g, u)
      const get = playerLookup(g, u)
      const { lineup, bench } = quickXI(g, u)
      for (const m of quickManagerOptions(g)) {
        setManager(g, m.id)
        const b = quickManagerBoost(g, lineup, g.tactics, get)!
        expect(Math.abs(b.attack - 1)).toBeLessThanOrEqual(MANAGER_EDGE + 1e-12)
        expect(Math.abs(b.defence - 1)).toBeLessThanOrEqual(MANAGER_EDGE + 1e-12)
        expect(quickUserInput(g, lineup, bench, g.tactics, undefined, get).managerBoost).toEqual(b)
      }
      const a = play(JSON.parse(JSON.stringify(g)) as Game)
      const b = play(JSON.parse(JSON.stringify(g)) as Game)
      expect(a.quickResult!.results).toEqual(b.quickResult!.results)
    }
  })

  it('moves a season by a little: never more than a handful of points over many seeds', () => {
    let diff = 0
    let n = 0
    for (let i = 0; i < 8; i++) {
      const on = play(drafted(`mgr-small-${i}`))
      const off = play(drafted(`mgr-small-${i}`, { managers: false }))
      diff += on.quickResult!.points - off.quickResult!.points
      n++
    }
    // A 4% edge at most on each end: well under ten points a season on average
    expect(Math.abs(diff / n)).toBeLessThan(10)
  })
})

describe('the manager in links, saves and the share text', () => {
  it('a challenge link carries the manager and replays to the same claim; a different manager does not', () => {
    const g = drafted('mgr-link-1')
    const opts = quickManagerOptions(g)
    pickManager(g, u, opts[opts.length - 1].id)
    play(g)
    const c = challengeFromGame(g, u, 'Tester')!
    expect(c.x?.m).toBe(g.manager!.id)
    expect(isRulesDiff(rulesDiff(g.settings.rules))).toBe(true)
    const back = decodeChallenge(encodeChallenge(c))
    expect(back.x?.m).toBe(g.manager!.id)
    expect(replayChallenge(u, back).verified).toBe('yes')
    const bogus = { ...back, x: { ...back.x, m: 'Q999999999' } }
    expect(replayChallenge(u, decodeChallenge(encodeChallenge(bogus))).verified).toBe('no')
    expect(() => decodeChallenge(encodeChallenge({ ...back, x: { ...back.x, m: 'no spaces allowed' } }))).toThrow()
    // Managers switched off travel in the rules, and a link with them off replays with none
    const off = play(drafted('mgr-link-2', { managers: false }))
    const c2 = challengeFromGame(off, u, 'Tester')!
    expect(c2.s.r.managers).toBe(false)
    expect(c2.x?.m).toBeUndefined()
    expect(replayChallenge(u, decodeChallenge(encodeChallenge(c2))).verified).toBe('yes')
  })

  it('a link with no manager (made before managers) replays with none', () => {
    const g = play(drafted('mgr-link-3'))
    const c = challengeFromGame(g, u, 'Tester')!
    const { m: _m, ...x } = c.x ?? {}
    void _m
    const old = { ...c, x: Object.keys(x).length ? x : undefined }
    // Without its manager the claim is a different season, unless the manager changed nothing
    const out = replayChallenge(u, old)
    expect(['yes', 'no']).toContain(out.verified)
    const plain = play(drafted('mgr-link-3', { managers: false }))
    expect(out.result?.pts).toBe(plain.quickResult!.points)
  })

  it('an older save without the field loads and plays with no manager', () => {
    const g = drafted('mgr-save-1')
    const old = JSON.parse(JSON.stringify({ ...g, settings: { ...g.settings, rules: withoutManagers(g.settings.rules) }, draft: { ...g.draft!, rules: withoutManagers(g.draft!.rules) } })) as Game
    const n = normaliseGame(old)!
    expect(n.manager).toBeUndefined()
    play(n)
    expect(n.manager).toBeUndefined()
    // A saved manager survives a save round trip
    const withMgr = play(drafted('mgr-save-2'))
    expect(normaliseGame(JSON.parse(JSON.stringify(withMgr)) as Game)!.manager).toEqual(withMgr.manager)
  })

  it('reads in the share text by name and style', () => {
    expect(managerLine(undefined)).toBeNull()
    expect(managerLine({ id: 'Q47576', name: 'Arsène Wenger', style: 'youth', clubId: 'arsenal', season: 2008 })).toBe('👔 Arsène Wenger · Youth')
    expect(managerLine({ id: 'arch-attacking', name: 'The Showman', style: 'attacking', archetype: true })).toBe('👔 The Showman (invented) · Attacking')
  })
})
