import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame } from '../logic/setup'
import { normaliseGame } from '../logic/save'
import { arenaRunEntry, arenaShareInput, beginArena, changeTheDraw, closeArenaMatch, cupGameSettings, finalGameSettings, gauntletGameSettings, playArenaStep, simArenaToEnd, sortArenaRuns, groupRunsByLadder, stepWon, type ArenaChoices } from '../logic/arena'
import { arenaChallengeFromGame, arenaVerifiedLine, challengeLink, challengeSettings, replayArenaChallenge, replayChallenge, runItBackArena, settingsFromArenaChallenge, settingsFromChallenge } from '../logic/challenge'
import { arenaClaimOf, arenaVerdictLine, arenaVerdictOf, challengeHeadline, ghostStepLine } from '../logic/arenaClaim'
import { dailyArenaGameSettings } from '../logic/arenaDaily'
import { arenaShareText } from '@engine/awards'
import { ARENA_LINK_STEPS_MAX, decodeChallenge, encodeChallenge, isArenaLink, isArenaPayload, NEWER_LINK, TRAINING_CODE, type ArenaChallengePayload, type ArenaClaim } from '@engine/challenge'
import { autoDraft, respin, spin } from '@engine/draft'
import { Rng } from '@engine/rng'
import type { ArenaRunEntry, Game } from '../types'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { useStore } from '../store'

const u = loadTestUniverse(['england'])
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

function choices(seed: string, partial: Partial<ArenaChoices> = {}): ArenaChoices {
  return { teamName: 'Ghost XI', formationId: '4-3-3', field: 'wheel', wheelLeagues: ['england'], difficulty: 'calibrated', seed, hardMode: false, twists: true, ...partial }
}

/** The assistant drafts and plays a run to the summary; `lifeline` swaps that rung's main before it is played. */
function run(kind: 'gauntlet' | 'cup' | 'final', seed: string, opts: { lifeline?: number; partial?: Partial<ArenaChoices> } = {}): Game {
  const c = choices(seed, opts.partial)
  const g = createGame(kind === 'gauntlet' ? gauntletGameSettings(u, c, 'GXI') : kind === 'cup' ? cupGameSettings(u, { ...c, size: 16 }, 'GXI') : finalGameSettings(u, { ...c, field: 'giants' }, 'GXI'))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginArena(g, u)
  if (opts.lifeline) {
    // Climb to the rung, use the lifeline there, then the assistant plays the rest
    while (g.arena!.step + 1 < opts.lifeline && !g.arena!.over) simOne(g)
    if (!g.arena!.over && g.phase === 'week') expect(changeTheDraw(g, u).ok).toBe(true)
  }
  simArenaToEnd(g, u)
  expect(g.phase).toBe('summary')
  return g
}

/** One step by the assistant as the hub plays it, then the match screen's continue; a bonus spin is drafted as Sim to the end drafts it. */
function simOne(g: Game): void {
  playArenaStep(g, u, false)
  closeArenaMatch(g)
  if (g.phase === 'draft') {
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginArena(g, u)
  }
}

const linkOf = (g: Game, name = 'Minh') => {
  const c = arenaChallengeFromGame(g, u, name)
  expect(c).not.toBeNull()
  return c!
}

// Each test plays whole runs; on a loaded machine they pass 5 s, so the suite gets 30 s
describe('arena challenge links: encoding', { timeout: 30_000 }, () => {
  it('round-trips a Gauntlet link, and the longest one (15 rungs, four bonus spins, every step on penalties) stays under 2,000 characters', () => {
    const g = run('gauntlet', 'link-gauntlet')
    const c = linkOf(g, 'Minh the Gaffer with a v')
    expect(c.v).toBe(2)
    expect(c.kind).toBe('arena')
    expect(c.arena).toEqual({ f: 'gauntlet' })
    expect(c.t).toHaveLength(g.arena!.log.length)
    expect(c.ac.g).toHaveLength(g.arena!.log.length)
    const back = decodeChallenge(encodeChallenge(c))
    expect(back).toEqual(c)
    expect(isArenaPayload(back)).toBe(true)
    // The worst case: the draft's rows with four more for the bonus spins and every re-spin used, fifteen claimed shoot-outs
    const extra = c.p.slice(0, 4).map((row) => [row[0] ?? 's123456', row[1] ?? 'bench'] as [string, string])
    const longest: ArenaChallengePayload = { ...c, name: 'Minh the Gaffer with a v', p: [...c.p, ...extra, [null, null], [null, null]], t: 'a'.repeat(15), lf: 7, ac: { s: 15, w: true, g: Array.from({ length: 15 }, () => [12, 12, 10, 9] as [number, number, number, number]) } }
    const link = challengeLink(longest, 'https://touchline.quest', '/')
    expect(link.length).toBeLessThan(2000)
    expect(decodeChallenge(link.split('#')[1])).toEqual(longest)
    // A Cup link carries its size and field; a Daily Arena link its day
    const cup = linkOf(run('cup', 'link-cup'))
    expect(cup.arena).toEqual({ f: 'cup', n: 16, fd: 'wheel' })
    const daily = createGame(dailyArenaGameSettings(u, 'arena-2026-10-24'))
    const rng = Rng.fromState(daily.rngState)
    autoDraft(u, daily.draft!, rng)
    daily.rngState = rng.getState()
    beginArena(daily, u)
    simArenaToEnd(daily, u)
    expect(linkOf(daily).arena).toEqual({ f: 'gauntlet', dl: '2026-10-24' })
    // The friend's game on a Daily Arena link is an ordinary run on that seed, off the streak
    expect(settingsFromArenaChallenge(linkOf(daily), 'Friend', 'FRI', challengeSettings(linkOf(daily), { verified: 'yes', picks: [] })).arena?.daily).toBeUndefined()
  })

  it('refuses an unknown format or field, a 21-step claim, a malformed step, a bad training letter, a lifeline in a Cup and v3', () => {
    const c = linkOf(run('gauntlet', 'link-refuse'))
    expect(decodeChallenge(b64(c))).toEqual(c)
    const bad: Array<[string, unknown]> = [
      ['format', { ...c, arena: { f: 'league' } }],
      ['field', { ...c, arena: { f: 'cup', n: 16, fd: 'moon' } }],
      ['size', { ...c, arena: { f: 'cup', n: 12 } }],
      ['a Gauntlet with a size', { ...c, arena: { f: 'gauntlet', n: 16 } }],
      ['an unknown arena key', { ...c, arena: { f: 'gauntlet', rungs: 20 } }],
      ['21 steps', { ...c, t: 'b'.repeat(ARENA_LINK_STEPS_MAX + 1), ac: { s: 1, w: false, g: Array.from({ length: ARENA_LINK_STEPS_MAX + 1 }, () => [1, 0]) } }],
      ['no steps', { ...c, t: '', ac: { s: 0, w: false, g: [] } }],
      ['a three-number step', { ...c, ac: { ...c.ac, g: [[1, 2, 3], ...c.ac.g.slice(1)] } }],
      ['a shoot-out after a decided match', { ...c, ac: { ...c.ac, g: [[2, 1, 4, 3], ...c.ac.g.slice(1)] } }],
      ['a level shoot-out', { ...c, ac: { ...c.ac, g: [[1, 1, 3, 3], ...c.ac.g.slice(1)] } }],
      ['a negative score', { ...c, ac: { ...c.ac, g: [[-1, 0], ...c.ac.g.slice(1)] } }],
      ['a score out of range', { ...c, ac: { ...c.ac, g: [[31, 0], ...c.ac.g.slice(1)] } }],
      ['a text score', { ...c, ac: { ...c.ac, g: [['2', 0], ...c.ac.g.slice(1)] } }],
      ['more won than played', { ...c, ac: { ...c.ac, s: c.ac.g.length + 1 } }],
      ['a training letter this build does not know', { ...c, t: 'z'.repeat(c.ac.g.length) }],
      ['training letters short of the steps', { ...c, t: c.t.slice(1) }],
      ['a lifeline in a Cup', { ...c, arena: { f: 'cup', n: 16 }, lf: 1 }],
      ['no assistant flag', { ...c, auto: 'yes' }],
    ]
    for (const [why, o] of bad) expect(() => decodeChallenge(b64(o)), why).toThrow('Not a Touchline challenge link')
    expect(() => decodeChallenge(b64({ ...c, v: 3 }))).toThrow(NEWER_LINK)
    // A key a later build might add reads as newer, not as garbage
    expect(() => decodeChallenge(b64({ ...c, ghosts: [] }))).toThrow(NEWER_LINK)
    expect(isArenaLink(c)).toBe(true)
    expect(isArenaLink({ f: 'gauntlet' })).toBe(false)
    expect(Object.values(TRAINING_CODE).every((l) => l.length === 1)).toBe(true)
    expect(new Set(Object.values(TRAINING_CODE)).size).toBe(Object.keys(TRAINING_CODE).length)
  })
})

// Each test plays whole runs; on a loaded machine they pass 5 s, so the suite gets 30 s
describe('arena challenge links: verification', { timeout: 30_000 }, () => {
  it('an assistant run verifies yes, Gauntlet (bonus spins and the lifeline included), Cup and final', () => {
    const games = [run('gauntlet', 'verify-g-1'), run('gauntlet', 'verify-g-2', { lifeline: 2 }), run('gauntlet', 'verify-g-3', { lifeline: 4 }), run('cup', 'verify-c-1'), run('cup', 'verify-c-2', { partial: { difficulty: 'realistic' } }), run('final', 'verify-f-1')]
    // At least one of the climbs earned a bonus spin, and the lifeline was used where asked
    expect(games.some((g) => g.arena!.format === 'gauntlet' && g.draft!.history.filter((h) => h.pickedId).length > 14)).toBe(true)
    expect(games[1].arena!.lifelineUsed ?? 2).toBe(2)
    for (const g of games) {
      const c = linkOf(g)
      expect(c.auto).toBe(true)
      const out = replayChallenge(u, decodeChallenge(encodeChallenge(c)))
      expect(out.verified, `${g.settings.seed}: ${out.reason}`).toBe('yes')
      expect(out.arena).toEqual(c.ac)
      expect(out.picks).toHaveLength(c.p.length)
    }
  })

  it('over 40 seeds every assistant run verifies, and its link stays under 1,100 characters', () => {
    for (let i = 0; i < 40; i++) {
      const g = run(i % 2 ? 'cup' : 'gauntlet', `verify-sweep-${i}`)
      const c = linkOf(g)
      expect(challengeLink(c, 'https://touchline.quest', '/').length).toBeLessThan(1100)
      const out = replayChallenge(u, c)
      expect(out.verified, `${g.settings.seed}: ${out.reason}`).toBe('yes')
    }
  }, 60_000)

  it('a tampered score fails, naming the step; a longer or shorter claim fails too', () => {
    const g = run('gauntlet', 'verify-tamper')
    const c = linkOf(g)
    const k = Math.min(1, c.ac.g.length - 1)
    const g0 = c.ac.g[k]
    const changed: ArenaChallengePayload = { ...c, ac: { ...c.ac, g: c.ac.g.map((x, i) => (i === k ? ([g0[0] + 1, g0[1]] as [number, number]) : x)) } }
    const out = replayArenaChallenge(u, changed)
    expect(out.verified).toBe('no')
    expect(out.reason).toContain(`step ${k + 1}`)
    // Claiming a step more than the run had
    const longer: ArenaChallengePayload = { ...c, t: c.t + 'b', ac: { s: c.ac.s + 1, w: c.ac.w, g: [...c.ac.g.slice(0, -1), [3, 0], [1, 0]] } }
    expect(replayArenaChallenge(u, longer).verified).toBe('no')
    // Only the claimed total changed
    expect(replayArenaChallenge(u, { ...c, ac: { ...c.ac, s: Math.max(0, c.ac.s - 1) } }).verified).toBe('no')
    // A pick swapped for a man who was not on the club-season the wheel landed on
    expect(replayArenaChallenge(u, { ...c, p: c.p.map((row, i) => (i === 0 ? ['s000001', row[1]] : row)) }).verified).toBe('no')
  })

  it('a run managed by hand reads hand, never yes, even when nothing it touched changed a score', () => {
    useStore.setState({ universe: u, loadedLeagues: u.available.map((l) => l.id), game: null, parked: {} })
    const s = useStore.getState()
    s.startGame(gauntletGameSettings(u, choices('verify-hand'), 'GXI'))
    useStore.getState().autoDraftRest()
    useStore.getState().finishDraft()
    // Choosing the captain the assistant already chose changes nothing on the pitch, but it is the manager's hand
    useStore.getState().setCaptain(useStore.getState().game!.captainId!)
    useStore.getState().simArenaToEnd()
    const g = useStore.getState().game!
    expect(g.phase).toBe('summary')
    expect(g.arena!.handManaged).toBe(true)
    const c = linkOf(g)
    expect(c.auto).toBe(false)
    const out = replayChallenge(u, decodeChallenge(encodeChallenge(c)))
    expect(out.verified).toBe('hand')
    expect(out.reason).toContain('the ladder replay')
    expect(out.picks.length).toBeGreaterThanOrEqual(14)
    expect(arenaVerifiedLine(challengeSettings(c, out), 'gauntlet')).toContain('Managed by hand')
    // The same figures flagged as the assistant's do verify: the flag alone is what kept it from yes
    expect(replayArenaChallenge(u, { ...c, auto: true }).verified).toBe('yes')
  })

  it('a different data stamp is unverified, with the draft still resolved for the ghost', () => {
    const c = linkOf(run('cup', 'verify-data'))
    const out = replayArenaChallenge(u, { ...c, data: '2020-01-01' })
    expect(out.verified).toBe('unverified')
    expect(out.reason).toContain('2020-01-01')
    expect(out.picks.length).toBeGreaterThanOrEqual(16)
    expect(out.picks.filter((p) => p.id).length).toBe(16)
    expect(replayArenaChallenge(u, { ...c, engine: '0' }).verified).toBe('unverified')
  })

  it('the friend climbs the challenger’s ladder and meets the challenger’s first-round draw, whatever the friend drafts', () => {
    for (const kind of ['gauntlet', 'cup'] as const) {
      const g = run(kind, `verify-same-${kind}`)
      const c = linkOf(g)
      const friend = createGame(settingsFromChallenge(c, 'Friend XI', 'FXI', challengeSettings(c, replayChallenge(u, c))))
      expect(friend.settings.mode).toBe('arena')
      expect(friend.settings.arena).toEqual({ format: g.settings.arena!.format, ...(kind === 'cup' ? { size: 16, field: 'wheel' } : {}) })
      expect(friend.settings.rules).toEqual(createGame(g.settings).settings.rules)
      // A different draft: a re-spin first moves the wheel
      const rng = Rng.fromState(friend.rngState)
      spin(u, friend.draft!, rng)
      respin(u, friend.draft!, rng)
      autoDraft(u, friend.draft!, rng)
      friend.rngState = rng.getState()
      expect(friend.draft!.history.map((h) => `${h.clubId}@${h.season}`)).not.toEqual(g.draft!.history.map((h) => `${h.clubId}@${h.season}`))
      beginArena(friend, u)
      if (kind === 'gauntlet') expect(friend.arena!.ladder).toEqual(g.arena!.ladder)
      else expect(friend.arena!.bracket!.rounds[0].map((t) => [t.home, t.away])).toEqual(g.arena!.bracket!.rounds[0].map((t) => [t.home, t.away]))
      expect(friend.arena!.next).toBe(g.arena!.log[0].opponent)
    }
  })
})

// Each test plays whole runs; on a loaded machine they pass 5 s, so the suite gets 30 s
describe('arena challenge links: the head-to-head', { timeout: 30_000 }, () => {
  const claim = (g: Array<[number, number] | [number, number, number, number]>, w = false): ArenaClaim => ({ s: g.filter((x) => x[0] > x[1] || (x.length === 4 && x[2] > x[3])).length, w, g })

  it('ranks further first, then goal difference, then fewer conceded', () => {
    const six = claim([[1, 0], [2, 1], [1, 0], [1, 1, 4, 3], [2, 0], [3, 1], [0, 1]])
    const nine = claim([[1, 0], [2, 1], [1, 0], [1, 0], [2, 0], [3, 1], [1, 0], [2, 1], [1, 0], [0, 2]])
    expect(arenaVerdictLine('Minh', six, nine, 'gauntlet')).toBe('⚔️ Climbed 9 rungs; Minh fell at rung 7')
    expect(arenaVerdictLine('Minh', nine, six, 'gauntlet')).toBe('⚔️ Minh climbed 9 rungs; you fell at rung 7')
    expect(arenaVerdictLine('Minh', six, six, 'gauntlet')).toBe('⚔️ Both climbed 6 rungs; dead level with Minh')
    const sixBetter = claim([[1, 0], [2, 1], [1, 0], [1, 1, 4, 3], [2, 0], [5, 1], [0, 1]])
    expect(arenaVerdictLine('Minh', six, sixBetter, 'gauntlet')).toBe('⚔️ Both climbed 6 rungs; your goal difference was better')
    // The same goal difference, fewer conceded
    const tight = claim([[1, 0], [1, 0], [1, 0], [0, 0, 4, 3], [1, 0], [1, 0], [0, 1]])
    const open = claim([[2, 1], [2, 1], [2, 1], [1, 1, 4, 3], [2, 1], [2, 1], [1, 2]])
    expect(arenaVerdictLine('Minh', open, tight, 'gauntlet')).toBe('⚔️ Both climbed 6 rungs; you conceded fewer')
    expect(arenaVerdictLine('Minh', tight, open, 'gauntlet')).toBe('⚔️ Both climbed 6 rungs; Minh conceded fewer')
    // The Cup in round names
    // Four up either way, one side letting four in
    const lifted = claim([[2, 1], [2, 1], [2, 1], [2, 1]], true)
    const liftedTight = claim([[1, 0], [1, 0], [1, 0], [1, 0]], true)
    const semi = claim([[2, 1], [1, 0], [0, 1]])
    expect(arenaVerdictLine('Minh', liftedTight, lifted, 'cup', 16)).toBe('⚔️ Both lifted it; Minh conceded fewer')
    expect(arenaVerdictLine('Minh', semi, lifted, 'cup', 16)).toBe('⚔️ You lifted it; Minh went out in the semi-final')
    expect(arenaVerdictLine('Minh', lifted, semi, 'cup', 16)).toBe('⚔️ Minh lifted it; you went out in the semi-final')
    expect(arenaVerdictLine('Minh', claim([[2, 1], [1, 0], [3, 0], [0, 1]]), semi, 'cup', 16)).toBe('⚔️ Minh lost the final; you went out in the semi-final')
  })

  it('shows the challenger on every step, and the verdict joins the share text, Best runs and the cabinet once', () => {
    const g = run('gauntlet', 'h2h-store')
    const c = linkOf(g)
    useStore.setState({ universe: u, loadedLeagues: u.available.map((l) => l.id), game: null, parked: {}, pendingChallenge: null, toast: null })
    return useStore
      .getState()
      .openChallenge(encodeChallenge(c))
      .then((ok) => {
        expect(ok).toBe(true)
        const st = useStore.getState()
        expect(st.setupMode).toBe('arena')
        expect(st.screen).toBe('setup')
        const pending = st.pendingChallenge!
        expect(pending.challenge.verified).toBe('yes')
        expect(pending.challenge.arena?.claim).toEqual(c.ac)
        expect(challengeHeadline(pending.challenge, 'gauntlet')).toBe(`${c.ac.s} rung${c.ac.s === 1 ? '' : 's'}`)
        // Every step shows the challenger; past where he fell, he went no further
        expect(ghostStepLine(pending.challenge, 0)).toMatch(/^Minh (here|fell here): \d+-\d+/)
        expect(ghostStepLine(pending.challenge, c.ac.g.length - 1)).toContain(c.ac.w ? 'Minh here' : 'Minh fell here')
        expect(ghostStepLine(pending.challenge, c.ac.g.length)).toBe('Minh went no further')
        // The friend plays it from the store and the run files against the challenger
        const before = useStore.getState().profile
        st.startGame(settingsFromChallenge(pending.payload, 'Friend XI', 'FXI', pending.challenge))
        useStore.getState().autoDraftRest()
        useStore.getState().finishDraft()
        useStore.getState().simArenaToEnd()
        const done = useStore.getState().game!
        expect(done.phase).toBe('summary')
        const verdict = arenaVerdictOf(done)!
        expect(verdict).toMatch(/^⚔️ /)
        expect(verdict).toContain('Minh')
        expect(arenaShareText(arenaShareInput(done, u)!)).toContain(verdict)
        const p = useStore.getState().profile
        const entry = p.arenaRuns!.find((e) => e.id === arenaRunEntry(done, '')!.id)!
        expect(entry.challenge).toEqual({ name: 'Minh', score: c.ac.s })
        expect(p.arenaRuns!.length).toBe(Math.min(50, (before.arenaRuns?.length ?? 0) + 1))
        expect(p.cabinet!.byMode.arena).toBe((before.cabinet?.byMode.arena ?? 0) + 1)
        // A friend's own run is a link again, played by the assistant: it verifies
        expect(replayChallenge(u, linkOf(done, 'Friend')).verified).toBe('yes')
      })
  })

  it('Run it back plays the same seed against your own run, verified on this device when the assistant played it', () => {
    const g = run('cup', 'run-back')
    const s = runItBackArena(g, u)!
    expect(s.seed).toBe(g.settings.seed)
    expect(s.challenge?.name).toBe('your ghost')
    expect(s.challenge?.verified).toBe('yes')
    expect(s.challenge?.arena?.claim).toEqual(arenaClaimOf(g.arena!))
    expect(s.challenge?.arena?.claim.s).toBe(g.arena!.log.filter(stepWon).length)
    const again = createGame(s)
    const rng = Rng.fromState(again.rngState)
    autoDraft(u, again.draft!, rng)
    again.rngState = rng.getState()
    beginArena(again, u)
    simArenaToEnd(again, u)
    // The same draft by the same assistant on the same seed: the same run, dead level with the ghost
    expect(arenaClaimOf(again.arena!)).toEqual(arenaClaimOf(g.arena!))
    expect(arenaVerdictOf(again)).toContain('dead level with your ghost')
    expect(JSON.parse(JSON.stringify(normaliseGame(again)!.settings.challenge))).toEqual(s.challenge)
  })

  it('Best runs keep the vs chip and sort best first within a format', () => {
    const entries = sortArenaRuns([
      { id: 'a', date: '2026-10-25', format: 'gauntlet', teamName: 'A', seed: 'S1', score: 3, tier: 'RUNGS', goalsFor: 5, goalsAgainst: 3, xi: [], challenge: { name: 'Minh', score: 6 } },
      { id: 'b', date: '2026-10-25', format: 'gauntlet', teamName: 'B', seed: 'S1', score: 7, tier: 'RUNGS', goalsFor: 9, goalsAgainst: 3, xi: [] },
    ])
    expect(entries.map((e) => e.id)).toEqual(['b', 'a'])
    expect(entries[1].challenge).toEqual({ name: 'Minh', score: 6 })
  })

  it('Best on this ladder groups the runs by seed within a format, size and field, best first', () => {
    const e = (id: string, seed: string, score: number, extra: Partial<ArenaRunEntry> = {}): ArenaRunEntry => ({ id, date: '2026-10-25', format: 'gauntlet', teamName: id, seed, score, tier: 'RUNGS', goalsFor: score, goalsAgainst: 1, xi: [], ...extra })
    const groups = groupRunsByLadder([e('a', 'S1', 3), e('b', 'S2', 9), e('c', 'S1', 6, { challenge: { name: 'Minh', score: 3 } }), e('d', 'S1', 2, { format: 'cup', size: 16, field: 'wheel', tier: 'QUARTER-FINALISTS' }), e('f', 'S1', 1, { format: 'cup', size: 8, field: 'wheel', tier: 'SEMI-FINALISTS' })])
    // The Cup sorts before the Gauntlet (format order), a bigger Cup first; the Gauntlet's S2 holds its best run
    expect(groups.map((g) => [g.format, g.size ?? 0, g.seed, g.runs.map((r) => r.id).join('')])).toEqual([
      ['cup', 16, 'S1', 'd'],
      ['cup', 8, 'S1', 'f'],
      ['gauntlet', 0, 'S2', 'b'],
      ['gauntlet', 0, 'S1', 'ca'],
    ])
    expect(groups[3].runs[0].challenge?.name).toBe('Minh')
  })
})
