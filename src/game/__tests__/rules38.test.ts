import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { QUICK_RULES, autoDraft, difficultyOf, ratingsHidden, chooseSlot, isComplete, pick, respin, spin, canUse, eligibleSlots, withDifficulty, type DraftRules } from '@engine/draft'
import { primed } from '@engine/prime'
import { LEGACY_QUICK_RESPINS, decodeChallenge, encodeChallenge, rulesFromPayload } from '@engine/challenge'
import { challengeFromGame, replayChallenge } from '../logic/challenge'
import { createGame } from '../logic/setup'
import { runQuickSeason } from '../logic/quick'
import { playerLookup } from '../logic/players'
import { normaliseGame, normaliseRules } from '../logic/save'
import { DAILY_RULES, dailySettings } from '../logic/daily'
import type { Game, GameSettings } from '../types'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { useStore } from '../store'

const u = loadTestUniverse()

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'quick',
    seed: 'RULES-38',
    formationId: '4-3-3',
    teamName: 'Rules XI',
    shortName: 'RUL',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'burnley',
    leagueSeason: 2025,
    rules: { ...QUICK_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

function autoGame(rules: DraftRules, seed = 'RULES-38'): Game {
  const g = createGame(settings({ seed, rules: { ...rules, leagues: ['england'] } }))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  runQuickSeason(g, u)
  return g
}

describe('older saves', () => {
  it('read hard mode as hard and fill in every 38-0 option', () => {
    const legacy = { squadSize: 11, respins: 2, minFit: 'accomplished', hardMode: true, uniqueClubSeasons: true, twists: true } as DraftRules
    expect(normaliseRules(legacy)).toEqual({ ...legacy, difficulty: 'hard', hardMode: true, showRatings: false, draftMode: 'squad', ratings: 'season' })
    // The re-spin budget is left as it was saved; three or more reads as easy, anything else as normal
    expect(normaliseRules({ ...legacy, hardMode: false }).difficulty).toBe('normal')
    expect(normaliseRules({ ...legacy, hardMode: false }).showRatings).toBe(true)
    expect(normaliseRules({ ...legacy, hardMode: false, respins: 3 }).difficulty).toBe('easy')
    expect(normaliseRules({ ...legacy, hardMode: false }).respins).toBe(2)
    // New saves pass through unchanged
    expect(normaliseRules(QUICK_RULES)).toEqual(QUICK_RULES)
  })

  it('normalise the settings and the draft of a saved game', () => {
    const g = createGame(settings())
    const legacyRules = { squadSize: 11, respins: 2, minFit: 'accomplished', hardMode: true, uniqueClubSeasons: true, twists: true, leagues: ['england'] } as DraftRules
    const draft: Record<string, unknown> = { ...g.draft!, rules: legacyRules }
    delete draft.target
    const old = { ...g, settings: { ...g.settings, rules: legacyRules }, draft } as unknown as Game
    const n = normaliseGame(old)!
    for (const r of [n.settings.rules, n.draft!.rules]) {
      expect(r.difficulty).toBe('hard')
      expect(r.showRatings).toBe(false)
      expect(r.draftMode).toBe('squad')
      expect(r.ratings).toBe('season')
    }
    expect(n.draft!.target).toBeNull()
    expect(n.draft!.respinsLeft).toBe(g.draft!.respinsLeft)
  })
})

describe('the Daily', () => {
  it('pins every option, whatever the quick defaults become', () => {
    const a = dailySettings(u, 'daily-2026-10-25')
    const b = dailySettings(u, 'daily-2026-10-25')
    expect(a).toEqual(b)
    expect(a.rules).toEqual({ ...DAILY_RULES, leagues: ['england'] })
    expect(a.rules).toMatchObject({ squadSize: 11, respins: 2, difficulty: 'normal', hardMode: false, showRatings: true, draftMode: 'squad', ratings: 'season', twists: true, uniqueClubSeasons: true, minFit: 'accomplished', leagues: ['england'] })
    expect(a.rules.fromSeason).toBeUndefined()
    expect(a.rules.toSeason).toBeUndefined()
    expect(a.rules.onlyClub).toBeUndefined()
    expect(a.rules.onlyNation).toBeUndefined()
    // Every rule key is written out, so no default can leak in
    for (const key of ['squadSize', 'respins', 'minFit', 'hardMode', 'uniqueClubSeasons', 'twists', 'difficulty', 'showRatings', 'draftMode', 'ratings', 'leagues'] as const) expect(Object.prototype.hasOwnProperty.call(DAILY_RULES, key) && DAILY_RULES[key] !== undefined, key).toBe(true)
    // DAILY_RULES spreads nothing, so a rule added to the quick defaults fails here until the Daily pins it
    for (const key of Object.keys(QUICK_RULES)) expect(Object.prototype.hasOwnProperty.call(DAILY_RULES, key), key).toBe(true)
    expect(a.difficulty).toBe('calibrated')
    expect(a.leagueId).toBe('england')
    expect(u.clubSeasonByKey[`${a.host}@${a.season}`]?.complete).toBe(true)
  })
  it('rotates the shape, the season and the host by date, as before', () => {
    // The 2026-10-25 seed: n = 20261025, so formation index (3n) % 5 and season index n % seasons
    const s = dailySettings(u, 'daily-2026-10-25')
    expect(s.formationId).toBe(['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '4-4-2-diamond'][(20261025 * 3) % 5])
    const days = new Set(['daily-2026-10-25', 'daily-2026-10-26', 'daily-2026-10-27'].map((seed) => `${dailySettings(u, seed).season}/${dailySettings(u, seed).host}`))
    expect(days.size).toBe(3)
  })
})

describe('prime ratings in a quick game', () => {
  it('rates the drafted side at its career best in the lookup, the strength and the season', () => {
    // One draft, two seasons from the same RNG point: rated by season and rated at their prime
    const base = createGame(settings({ seed: 'PRIME-1' }))
    const rng = Rng.fromState(base.rngState)
    autoDraft(u, base.draft!, rng)
    base.rngState = rng.getState()
    const prime = structuredClone(base)
    prime.settings.rules.ratings = 'prime'
    const get = playerLookup(prime, u)
    let lifted = 0
    for (const id of Object.values(base.draft!.lineup)) {
      expect(get(id)!.overall).toBe(primed(u, u.index[id], prime.settings.rules.leagues).overall)
      expect(get(id)!.overall).toBeGreaterThanOrEqual(u.index[id].overall)
      if (get(id)!.overall > u.index[id].overall) lifted++
    }
    expect(lifted).toBeGreaterThan(0)
    runQuickSeason(base, u)
    runQuickSeason(prime, u)
    expect(prime.quickResult!.strength.overall).toBeGreaterThan(base.quickResult!.strength.overall)
    expect(prime.quickResult!.results?.length).toBe(38)
  })

  it('auto-drafts by career-best rating under Prime', () => {
    const g = autoGame({ ...QUICK_RULES, ratings: 'prime' }, 'PRIME-2')
    expect(isComplete(g.draft!)).toBe(true)
    expect(g.quickResult).not.toBeNull()
  })
})

describe('position first through the game', () => {
  it('replays and verifies an auto-drafted Position First challenge', () => {
    const g = autoGame({ ...QUICK_RULES, draftMode: 'position' }, 'POS-LINK')
    const c = challengeFromGame(g, u, 'Minh')!
    expect(c.s.r.draftMode).toBe('position')
    expect(rulesFromPayload(c).draftMode).toBe('position')
    // Every row of the XI names its slot
    expect(c.p.every(([, slot]) => slot !== null)).toBe(true)
    expect(replayChallenge(u, c).verified).toBe('yes')
  })

  it('replays a Position First draft with a re-spin, the slot carried on the re-spun row', () => {
    const g = createGame(settings({ seed: 'POS-RESPIN', rules: { ...withDifficulty(QUICK_RULES, 'easy'), draftMode: 'position', leagues: ['england'] } }))
    const d = g.draft!
    const rng = Rng.fromState(g.rngState)
    let n = 0
    while (!isComplete(d)) {
      const open = d.formation.slots.filter((s) => !d.lineup[s.id])
      const slot = open[open.length - 1]
      chooseSlot(u, d, slot.id)
      let cs = spin(u, d, rng)
      if (n === 2) cs = respin(u, d, rng)
      const p = cs.squad.filter((x) => canUse(d, x)).sort((a, b) => b.overall - a.overall)[0]
      expect(eligibleSlots(d, p).map((s) => s.id)).toEqual([slot.id])
      pick(u, d, p.id, slot.id)
      n++
    }
    g.rngState = rng.getState()
    runQuickSeason(g, u)
    const c = challengeFromGame(g, u, 'Re-spinner')!
    const respun = c.p.findIndex(([id]) => id === null)
    expect(respun).toBe(2)
    expect(c.p[respun][1]).toBe(c.p[respun + 1][1])
    const out = replayChallenge(u, c)
    expect(out.verified).toBe('yes')
    // A tampered slot on the re-spun row lands elsewhere and is caught
    const tampered = { ...c, p: c.p.map((row, i) => (i === respun ? [null, c.p[0][1]] as [null, string | null] : row)) }
    expect(replayChallenge(u, tampered).verified).toBe('no')
  })

  it('in the store: asks for a slot, spins for it and keeps it on the row Auto-complete skips', () => {
    const g = createGame(settings({ seed: 'POS-STORE', rules: { ...QUICK_RULES, draftMode: 'position', leagues: ['england'] } }))
    useStore.setState({ universe: u, loadedLeagues: ['england'], game: g, toast: null })
    const st = useStore.getState()
    st.spin()
    expect(useStore.getState().toast).toBe('Choose a slot on the pitch first.')
    expect(useStore.getState().game!.draft!.current).toBeNull()
    const gk = g.draft!.formation.slots.find((s) => s.position === 'GK')!
    st.chooseSlot(gk.id)
    expect(useStore.getState().game!.draft!.target).toBe(gk.id)
    st.spin()
    expect(useStore.getState().game!.draft!.current).not.toBeNull()
    st.autoDraftRest()
    const d = useStore.getState().game!.draft!
    expect(d.history[0]).toMatchObject({ skipped: true, target: gk.id })
    expect(d.history[1].slotId).toBe(gk.id)
    expect(isComplete(d)).toBe(true)
    useStore.setState({ universe: null, loadedLeagues: [], game: null, toast: null })
  })
})

describe('links made before difficulties', () => {
  it('open with the two re-spins the challenger had, hard mode reading as hard, and still verify', () => {
    const g = autoGame({ ...QUICK_RULES }, 'LEGACY-LINK')
    const c = challengeFromGame(g, u, 'Minh')!
    // A new link always names its difficulty
    expect(c.s.r.difficulty).toBe('normal')
    expect(rulesFromPayload(c).respins).toBe(QUICK_RULES.respins)
    // The same link as an older build wrote it: no difficulty in the diff
    const older = { ...c.s.r }
    delete older.difficulty
    const legacy = decodeChallenge(encodeChallenge({ ...c, s: { ...c.s, r: older } }))
    expect(LEGACY_QUICK_RESPINS).toBe(2)
    expect(rulesFromPayload(legacy)).toMatchObject({ respins: 2, difficulty: 'normal' })
    const hard = rulesFromPayload({ ...legacy, s: { ...legacy.s, r: { hardMode: true } } })
    expect(difficultyOf(hard)).toBe('hard')
    expect(ratingsHidden(hard)).toBe(true)
    expect(hard.respins).toBe(2)
    // A re-spin budget the old link wrote out is kept
    expect(rulesFromPayload({ ...legacy, s: { ...legacy.s, r: { respins: 0 } } }).respins).toBe(0)
    expect(replayChallenge(u, legacy).verified).toBe('yes')
  })
})

describe('hard difficulty in a quick game', () => {
  it('counts as hard for the Blindfolded achievement and travels in a link', () => {
    const g = autoGame(withDifficulty(QUICK_RULES, 'hard'), 'HARD-1')
    expect(g.draft!.respinsLeft).toBe(0)
    const c = challengeFromGame(g, u, 'Minh')!
    expect(c.s.r).toMatchObject({ difficulty: 'hard', respins: 0, hardMode: true, showRatings: false })
    expect(replayChallenge(u, c).verified).toBe('yes')
    if (g.quickResult!.position === 1) expect(g.unlocked).toContain('hard-champions')
  })
})
