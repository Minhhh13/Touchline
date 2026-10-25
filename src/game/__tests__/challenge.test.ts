import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, canUse, eligibleSlots, isComplete, pick, QUICK_RULES, respin, spin } from '@engine/draft'
import { CHALLENGE_NAME_MAX, cleanName, decodeChallenge, encodeChallenge, historyKey, isRulesDiff, rulesDiff, rulesFromPayload, type ChallengePayload } from '@engine/challenge'
import { ENGINE_VERSION } from '@engine/version'
import { challengeFromGame, challengeLink, challengeSettings, replayChallenge, settingsFromChallenge, verdictLine } from '../logic/challenge'
import { createGame } from '../logic/setup'
import { runQuickSeason } from '../logic/quick'
import type { Game, GameSettings } from '../types'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
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
    seed: 'GHOST-1',
    formationId: '4-3-3',
    teamName: 'Ghost XI',
    shortName: 'GHO',
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

/** A finished quick game drafted by the assistant, the way "Auto-complete" then "Simulate" leaves it. */
function autoGame(partial: Partial<GameSettings> = {}): Game {
  const g = createGame(settings(partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  runQuickSeason(g, u)
  return g
}

describe('challenge links', () => {
  it('round-trips through encode and decode, with the rules as a diff and the name cleaned', () => {
    const g = autoGame({ rules: { ...QUICK_RULES, leagues: ['england'], fromSeason: 2014, hardMode: true, onlyClub: undefined } })
    const c = challengeFromGame(g, u, '  Minh\u0007 the Gaffer with a very long name  ')!
    expect(c).not.toBeNull()
    expect(c.s.r).toEqual({ fromSeason: 2014, hardMode: true })
    expect(rulesDiff(QUICK_RULES)).toEqual({})
    const encoded = encodeChallenge(c)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    // Real player ids and a rules diff keep an eleven-pick link well under a thousand characters
    expect(encoded.length).toBeLessThan(1000)
    const back = decodeChallenge(encoded)
    expect(back.name).toBe('Minh the Gaffer with a v')
    expect(back.name.length).toBeLessThanOrEqual(CHALLENGE_NAME_MAX)
    expect(back.p).toEqual(c.p)
    expect(back.k).toBe(c.k)
    expect(back.c).toEqual(c.c)
    expect(back.s).toEqual(c.s)
    expect(rulesFromPayload(back)).toEqual({ ...QUICK_RULES, fromSeason: 2014, hardMode: true, leagues: ['england'] })
    // The fragment form and the bare form both decode
    expect(decodeChallenge(`#c=${encoded}`)).toEqual(back)
    expect(challengeLink(c, 'https://example.test', '/touchline/')).toBe(`https://example.test/touchline/#c=${encoded}`)
  })

  it('refuses anything that is not a challenge with a readable error', () => {
    expect(() => decodeChallenge('not base64url!!')).toThrow('Not a Touchline challenge link')
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    expect(() => decodeChallenge(b64({ v: 1 }))).toThrow('Not a Touchline challenge link')
    expect(() => decodeChallenge(b64([1, 2, 3]))).toThrow('Not a Touchline challenge link')
    expect(() => decodeChallenge(b64({ v: 2 }))).toThrow('newer version')
    expect(cleanName('a\u0000b\u001fc  d\u007f')).toBe('abc d')
  })

  it('checks the rules diff key by key, so a link cannot smuggle a rule the game does not offer', () => {
    const g = autoGame({ seed: 'GHOST-RULES' })
    const c = challengeFromGame(g, u, 'Minh')!
    const withRules = (r: unknown) => Buffer.from(JSON.stringify({ ...c, s: { ...c.s, r } })).toString('base64url')
    expect(decodeChallenge(withRules({ fromSeason: 2014, respins: 0, minFit: 'natural', twists: false })).s.r).toEqual({ fromSeason: 2014, respins: 0, minFit: 'natural', twists: false })
    for (const bad of [{ squadSize: 0 }, { squadSize: 1000 }, { squadSize: 11.5 }, { respins: -1 }, { minFit: 'superb' }, { hardMode: 'yes' }, { leagues: ['england'] }, { bogus: 1 }, { fromSeason: '2014' }, [], null, 'x']) {
      expect(() => decodeChallenge(withRules(bad)), JSON.stringify(bad)).toThrow('Not a Touchline challenge link')
    }
    expect(isRulesDiff(rulesDiff({ ...QUICK_RULES, squadSize: 18, respins: 3, fromSeason: 2000, toSeason: 2010, onlyClub: 'burnley', onlyNation: 'ENG', minFit: 'awkward', hardMode: true, uniqueClubSeasons: false, twists: false }))).toBe(true)
    // A non-integer league season is not one the data has
    expect(() => decodeChallenge(Buffer.from(JSON.stringify({ ...c, s: { ...c.s, ls: 2025.5 } })).toString('base64url'))).toThrow('Not a Touchline challenge link')
  })

  it('opens a link only for a league and a host club-season this build has', async () => {
    const g = autoGame({ seed: 'GHOST-OPEN' })
    const c = challengeFromGame(g, u, 'Minh')!
    useStore.setState({ universe: u, loadedLeagues: ['england'], toast: null, pendingChallenge: null, screen: 'home' })
    const { openChallenge } = useStore.getState()
    expect(await openChallenge('garbage!')).toBe(false)
    expect(useStore.getState().toast).toBe('Not a Touchline challenge link')
    expect(await openChallenge(encodeChallenge({ ...c, s: { ...c.s, l: 'mars', wl: ['mars'] } }))).toBe(false)
    expect(useStore.getState().toast).toContain('mars')
    expect(await openChallenge(encodeChallenge({ ...c, s: { ...c.s, h: 'nowhere' } }))).toBe(false)
    expect(useStore.getState().toast).toContain('nowhere 2025')
    expect(await openChallenge(encodeChallenge({ ...c, s: { ...c.s, ls: 1850 } }))).toBe(false)
    expect(useStore.getState().pendingChallenge).toBeNull()
    expect(await openChallenge(`#c=${encodeChallenge(c)}`)).toBe(true)
    const st = useStore.getState()
    expect(st.screen).toBe('setup')
    expect(st.setupMode).toBe('quick')
    expect(st.pendingChallenge?.challenge.verified).toBe('yes')
    expect(st.pendingChallenge?.payload.s.seed).toBe('GHOST-OPEN')
    // Any navigation drops it
    st.go('home')
    expect(useStore.getState().pendingChallenge).toBeNull()
    useStore.setState({ universe: null, loadedLeagues: [], toast: null })
  })

  it('replays an auto-drafted game and verifies the claim', () => {
    const g = autoGame()
    const c = challengeFromGame(g, u, 'Minh')!
    expect(c.p.length).toBe(g.draft!.history.length)
    expect(c.p.every(([id]) => id !== null)).toBe(true)
    const out = replayChallenge(u, c)
    expect(out.verified).toBe('yes')
    expect(out.reason).toBeUndefined()
    expect(out.result).toEqual(c.c)
    // The resolved picks are the challenger's full player-season ids, in spin order
    expect(out.picks.map((p) => p.id)).toEqual(g.draft!.history.map((h) => h.pickedId))
    const cs = challengeSettings(c, out)
    expect(cs.verified).toBe('yes')
    expect(cs.picks.length).toBe(11)
    expect(cs.data).toBe(u.generatedAt)
    expect(cs.engine).toBe(ENGINE_VERSION)
  })

  it('rejects a tampered pick and a tampered claim with the reason', () => {
    const g = autoGame({ seed: 'GHOST-2' })
    const c = challengeFromGame(g, u, 'Minh')!
    const fake: ChallengePayload = { ...c, p: c.p.map((row, i) => (i === 3 ? ['s000001', row[1]] : row)) }
    const out = replayChallenge(u, fake)
    expect(out.verified).toBe('no')
    expect(out.reason).toMatch(/^Spin 4: no player s000001/)
    expect(out.picks).toEqual([])
    // Another real player from a different squad fails the "current squad" check, not the index
    const stranger = Object.values(u.index).find((p) => p.clubId !== c.p[0][0] && !c.p.some(([id]) => id === p.playerId))!
    const swapped: ChallengePayload = { ...c, p: c.p.map((row, i) => (i === 0 ? [stranger.playerId, row[1]] : row)) }
    expect(replayChallenge(u, swapped).verified).toBe('no')
    const greedy: ChallengePayload = { ...c, c: { ...c.c, pts: c.c.pts + 3 } }
    const out2 = replayChallenge(u, greedy)
    expect(out2.verified).toBe('no')
    expect(out2.reason).toMatch(new RegExp(`replay to ${c.c.pts} points`))
    expect(out2.result).toEqual(c.c)
    // A wrong club-season key is caught even when every pick fits
    const rekeyed: ChallengePayload = { ...c, k: 'zzz' }
    expect(replayChallenge(u, rekeyed).reason).toBe('The wheel did not land on the same club-seasons')
  })

  it('replays a draft that used a re-spin', () => {
    // Two re-spins (the budget quick drafts had before difficulties; normal now gives one), which the link carries in its rules diff
    const g = createGame(settings({ seed: 'GHOST-RESPIN', rules: { ...QUICK_RULES, respins: 2, leagues: ['england'] } }))
    const d = g.draft!
    const rng = Rng.fromState(g.rngState)
    let n = 0
    while (!isComplete(d)) {
      let cs = spin(u, d, rng)
      if (n === 1 || n === 5) cs = respin(u, d, rng)
      const p = cs.squad.filter((x) => canUse(d, x)).sort((a, b) => b.overall - a.overall)[0]
      const slot = eligibleSlots(d, p)[0]
      pick(u, d, p.id, slot ? slot.id : 'bench')
      n++
    }
    g.rngState = rng.getState()
    runQuickSeason(g, u)
    expect(d.history.length).toBe(13)
    expect(d.respinsLeft).toBe(0)
    const c = challengeFromGame(g, u, 'Re-spinner')!
    expect(c.p.filter(([id]) => id === null).length).toBe(2)
    expect(c.p[1]).toEqual([null, null])
    const out = replayChallenge(u, c)
    expect(out.verified).toBe('yes')
    expect(out.picks[1].id).toBeNull()
    expect(out.picks[1].clubId).toBe(d.history[1].clubId)
    expect(historyKey(out.picks)).toBe(c.k)
  })

  it('reports a data-stamp or engine mismatch as unverified without throwing, and still resolves the ghost picks', () => {
    const g = autoGame({ seed: 'GHOST-3' })
    const c = challengeFromGame(g, u, 'Minh')!
    const stale = replayChallenge(u, { ...c, data: '2020-01-01' })
    expect(stale.verified).toBe('unverified')
    expect(stale.reason).toContain('2020-01-01')
    expect(stale.picks.length).toBe(11)
    const other = replayChallenge(u, { ...c, engine: `${ENGINE_VERSION}-other` })
    expect(other.verified).toBe('unverified')
    expect(other.reason).toContain('engine')
    const cs = challengeSettings({ ...c, data: '2020-01-01' }, stale)
    expect(cs.verified).toBe('unverified')
    expect(cs.reason).toBeDefined()
    // An unverified challenge still fixes the wheel and plays
    const s = settingsFromChallenge(c, 'My XI', 'MXI', cs)
    expect(s.mode).toBe('quick')
    expect(s.seed).toBe('GHOST-3')
    expect(s.rules).toEqual(g.settings.rules)
    expect(s.challenge?.verified).toBe('unverified')
  })

  it('keeps a spin the assistant discards in the history, so the game still replays', () => {
    const g = createGame(settings({ seed: 'GHOST-SKIP' }))
    useStore.setState({ universe: u, game: g, loadedLeagues: ['england'] })
    const { spin: storeSpin, autoDraftRest, finishDraft } = useStore.getState()
    storeSpin()
    storeSpin() // ignored: a spin is pending
    expect(useStore.getState().game!.draft!.current).not.toBeNull()
    autoDraftRest()
    const after = useStore.getState().game!
    expect(after.draft!.history[0]).toMatchObject({ pickedId: null, slotId: null, skipped: true })
    expect(after.draft!.history.length).toBe(after.draft!.spins)
    finishDraft()
    const done = useStore.getState().game!
    expect(done.phase).toBe('summary')
    const c = challengeFromGame(done, u, 'Skipper')!
    expect(c.p[0]).toEqual([null, null])
    expect(replayChallenge(u, c).verified).toBe('yes')
    useStore.setState({ game: null, universe: null, loadedLeagues: [] })
  })

  it('words the verdict from points, then defeats', () => {
    const ch = { name: 'Minh', picks: [], claim: { pts: 90, w: 28, d: 6, l: 4, t: 'CHAMPIONS' as const }, verified: 'yes' as const, data: '', engine: '' }
    expect(verdictLine(ch, { pts: 93, w: 29, d: 6, l: 3, t: 'CHAMPIONS' })).toBe('⚔️ Beat Minh by 3 points: 93 to 90')
    expect(verdictLine(ch, { pts: 89, w: 28, d: 5, l: 5, t: 'CHAMPIONS' })).toBe('⚔️ Minh wins by 1 point: 90 to 89')
    expect(verdictLine(ch, { pts: 90, w: 29, d: 3, l: 6, t: 'CHAMPIONS' })).toBe('⚔️ Level with Minh on 90, more defeats')
    expect(verdictLine(ch, { pts: 90, w: 28, d: 6, l: 4, t: 'CHAMPIONS' })).toBe('⚔️ Dead level with Minh: 90 points each')
  })
})
