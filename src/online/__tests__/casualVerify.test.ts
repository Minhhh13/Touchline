import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, canUse, eligibleSlots, pick, respin, spin } from '@engine/draft'
import { decodeChallenge, encodeChallenge, type ArenaChallengePayload, type QuickChallengePayload } from '@engine/challenge'
import { ENGINE_VERSION } from '@engine/version'
import type { Game, GameSettings } from '@game/types'
import { createGame } from '@game/logic/setup'
import { beginArena, simArenaToEnd } from '@game/logic/arena'
import { dailyArenaGameSettings } from '@game/logic/arenaDaily'
import { weeklyGameSettings, weeklyTheme } from '@game/logic/weekly'
import { arenaChallengeFromGame, challengeFromGame } from '@game/logic/challenge'
import { kickOff, toKickoff } from '@game/logic/quick'
import { beginRunIn, seedRunInDraft } from '@game/logic/runin'
import { decodeRunIn, encodeRunIn, runInPayloadFromGame, simRunIn, weeklyRunInPlan, weeklyRunInSettings } from '@game/logic/runinWeekly'
import { puzzleOf, settingsHash } from '../server/dailyVerify'
import { casualClosesAt, casualIsOpen, casualKeyOfBody, casualKeyOfSeed, casualLeagues, casualSettings, verifyCasual, type CasualBoard, type CasualPin, type CasualVerdict } from '../server/casualVerify'
import { buildCasualSubmission, casualBoardOf, casualUnrankedReason } from '../casual'

const ALL = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
const u = loadTestUniverse(ALL)
const never = () => false

function withRng(g: Game, f: (rng: Rng) => void) {
  const rng = Rng.fromState(g.rngState)
  f(rng)
  g.rngState = rng.getState()
}
const auto = (g: Game) => withRng(g, (rng) => autoDraft(u, g.draft!, rng))
/** `autoDraftRest` in store.ts: the showing spin discarded, then the assistant. */
const autoRest = (g: Game) =>
  withRng(g, (rng) => {
    const d = g.draft!
    if (d.current) d.history.push({ ...d.current, pickedId: null, slotId: null, skipped: true, ...(d.twist ? { twist: d.twist } : {}) })
    d.current = null
    d.twist = null
    autoDraft(u, d, rng)
  })
const pickBest = (g: Game) => {
  const d = g.draft!
  const cs = u.clubSeasonByKey[`${d.current!.clubId}@${d.current!.season}`]
  const best = cs.squad.filter((p) => canUse(d, p)).sort((a, b) => b.overall - a.overall)[0]
  if (best) pick(u, d, best.id, eligibleSlots(d, best)[0]?.id ?? 'bench')
}

function pinOf(board: CasualBoard, settings: GameSettings): CasualPin {
  return { board, key: casualKeyOfSeed(board, settings.seed)!, seed: settings.seed, settings: puzzleOf(settings), settingsHash: settingsHash(settings), engineVersion: ENGINE_VERSION, dataVersion: u.generatedAt }
}

function ok(v: CasualVerdict) {
  if (!v.ok) throw new Error(`expected ranked, got ${v.code}: ${v.reason}`)
  return v.entry
}

// ------------------------------------------------------------------ the Daily Arena

function arenaRun(seed: string, draft: (g: Game) => void = auto): Game {
  const g = createGame(dailyArenaGameSettings(u, seed))
  draft(g)
  beginArena(g, u)
  simArenaToEnd(g, u)
  expect(g.phase).toBe('summary')
  return g
}

describe('the Daily Arena board', { timeout: 120_000 }, () => {
  const NOW = new Date('2026-10-25T12:00:00Z')
  const arenaBody = (g: Game, c?: ArenaChallengePayload) => ({ encoded: encodeChallenge(c ?? arenaChallengeFromGame(g, u, 'Minh')!), teamName: g.settings.teamName, shortName: g.settings.shortName })

  it('keys, windows and leagues', () => {
    expect(casualKeyOfSeed('arena', 'arena-2026-10-25')).toBe('2026-10-25')
    expect(casualKeyOfSeed('arena', 'arena-2026-02-30')).toBeNull()
    expect(casualIsOpen('arena', '2026-10-24', NOW)).toBe(true)
    expect(casualIsOpen('arena', '2026-10-23', NOW)).toBe(false)
    expect(casualClosesAt('arena', '2026-10-24')).toBe(Date.parse('2026-10-26T00:00:00Z'))
    expect(casualLeagues('arena', 'arena-2026-10-24', ALL)).toEqual(['england'])
  })

  it("ranks the assistant's Gauntlet and Cup on the replay's own figures, on an England-only universe too", () => {
    const england = loadTestUniverse(['england'])
    for (const seed of ['arena-2026-10-24', 'arena-2026-10-25']) {
      const g = arenaRun(seed)
      expect(casualBoardOf(g.settings)).toEqual({ board: 'arena', key: seed.slice(6) })
      expect(casualUnrankedReason(g, u)).toBeNull()
      const pin = pinOf('arena', casualSettings(england, 'arena', seed)!)
      expect(pin.settings.arena?.format).toBe(seed.endsWith('24') ? 'gauntlet' : 'cup')
      const e = ok(verifyCasual(england, pin, arenaBody(g), NOW, never))
      const a = g.arena!
      expect(e.score).toBe(a.log.filter((s) => s.gf > s.ga || (s.pens && s.pens.us > s.pens.them)).length)
      expect(e.won + e.lost).toBe(a.log.length)
      expect(e.trophy).toBe(a.won)
      expect(e.goals_for).toBe(a.log.reduce((t, s) => t + s.gf, 0))
      expect(e.claim_matched).toBe(true)
      expect(e.league_position).toBeNull()
      expect(casualKeyOfBody('arena', arenaBody(g).encoded)).toBe(seed.slice(6))
      // The submission the device files is the same body
      expect(buildCasualSubmission(g, u, 'Minh')).toMatchObject({ op: 'casual.submit', board: 'arena', encoded: arenaBody(g).encoded })
    }
  })

  it('replays a hand-drafted run with its re-spin and an Auto-complete', () => {
    const g = arenaRun('arena-2026-10-24', (x) => {
      withRng(x, (rng) => spin(u, x.draft!, rng))
      withRng(x, (rng) => respin(u, x.draft!, rng))
      pickBest(x)
      withRng(x, (rng) => spin(u, x.draft!, rng))
      autoRest(x)
    })
    expect(casualUnrankedReason(g, u)).toBeNull()
    ok(verifyCasual(u, pinOf('arena', casualSettings(u, 'arena', 'arena-2026-10-24')!), arenaBody(g), NOW, never))
  })

  it('refuses a run managed by hand, free re-spins, an extra row, another day, another engine, and records a claim that does not match', () => {
    const g = arenaRun('arena-2026-10-25')
    const pin = pinOf('arena', casualSettings(u, 'arena', 'arena-2026-10-25')!)
    const c = arenaChallengeFromGame(g, u, 'Minh')!
    const hand = verifyCasual(u, pin, arenaBody(g, { ...c, auto: false }), NOW, never)
    expect(hand).toMatchObject({ ok: false, code: 'hand_managed' })
    // Re-spins the rules never gave: three null rows before the draft
    expect(verifyCasual(u, pin, arenaBody(g, { ...c, p: [[null, null], [null, null], [null, null], ...c.p] }), NOW, never)).toMatchObject({ ok: false, code: 'invalid_picks' })
    expect(verifyCasual(u, pin, arenaBody(g, { ...c, p: [...c.p, c.p[0]] }), NOW, never)).toMatchObject({ ok: false, code: 'invalid_picks' })
    expect(verifyCasual(u, { ...pin, key: '2026-10-24', seed: 'arena-2026-10-24' }, arenaBody(g), NOW, never)).toMatchObject({ ok: false, code: 'puzzle_mismatch' })
    expect(verifyCasual(u, pin, arenaBody(g, { ...c, engine: '1' }), NOW, never)).toMatchObject({ ok: false, code: 'engine_mismatch' })
    expect(verifyCasual(u, pin, arenaBody(g), new Date('2026-10-27T00:00:00Z'), never)).toMatchObject({ ok: false, code: 'closed' })
    // The same run on the same seed but not as the day's puzzle (a link's ordinary run carries no day)
    const { dl, ...plain } = c.arena
    expect(dl).toBe('2026-10-25')
    expect(verifyCasual(u, pin, arenaBody(g, { ...c, arena: plain }), NOW, never)).toMatchObject({ ok: false, code: 'puzzle_mismatch' })
    // A claimed score off by a goal in a step that was still won: the replay's figures stand, flagged
    const i = c.ac.g.findIndex((s) => s.length === 2 && s[0] > s[1])
    if (i >= 0) {
      const g2 = c.ac.g.map((s, j) => (j === i ? ([s[0] + 1, s[1]] as [number, number]) : s))
      const e = ok(verifyCasual(u, pin, arenaBody(g, { ...c, ac: { ...c.ac, g: g2 } }), NOW, never))
      expect(e.claim_matched).toBe(false)
    }
  })

  it('a Daily Arena replayed from a link, or practised as an ordinary run, is not on the board', () => {
    const s = dailyArenaGameSettings(u, 'arena-2026-10-25')
    expect(casualBoardOf({ ...s, arena: { ...s.arena!, daily: undefined } })).toBeNull()
    expect(casualBoardOf({ ...s, challenge: { name: 'x', picks: [], claim: { pts: 0, w: 0, d: 0, l: 0, t: 'MID_TABLE' }, verified: 'yes', data: u.generatedAt, engine: ENGINE_VERSION } })).toBeNull()
  })
})

// ------------------------------------------------------------------ the themed Weekly Challenge

function weeklyRun(seed: string, draft: (g: Game) => void = auto): Game {
  const s = weeklyGameSettings(u, seed, 'Weekly FC')!
  const g = createGame(s)
  draft(g)
  toKickoff(g, u)
  kickOff(g, u)
  expect(g.phase).toBe('summary')
  return g
}

describe('the Weekly Challenge board (mode weekly)', { timeout: 300_000 }, () => {
  const NOW = new Date('2026-10-28T12:00:00Z')
  const qBody = (g: Game, c?: QuickChallengePayload) => ({ encoded: encodeChallenge(c ?? challengeFromGame(g, u, 'Minh')!), teamName: g.settings.teamName, shortName: g.settings.shortName })

  it('ranks every theme of the epoch on its own week, on just the leagues the week needs', () => {
    const themes = new Set<string>()
    for (let w = 43; w <= 51; w++) {
      const seed = `weekly-2026-W${w}`
      const key = `2026-W${w}`
      const now = new Date(Date.parse(`2026-10-19T12:00:00Z`) + (w - 43) * 7 * 86400000)
      themes.add(weeklyTheme(seed))
      const g = weeklyRun(seed)
      expect(casualBoardOf(g.settings)).toEqual({ board: 'themed', key })
      expect(casualUnrankedReason(g, u)).toBeNull()
      const sub = loadTestUniverse(casualLeagues('themed', seed, ALL))
      const pin = pinOf('themed', casualSettings(sub, 'themed', seed)!)
      expect(pin.settingsHash).toBe(settingsHash(weeklyGameSettings(u, seed)!))
      const e = ok(verifyCasual(sub, pin, qBody(g), now, never))
      const q = g.quickResult!
      expect(e).toMatchObject({ score: q.points, won: q.won, drawn: q.drawn, lost: q.lost, league_position: q.position, detail: q.tier, claim_matched: true, trophy: q.position === 1 })
    }
    expect(themes.size).toBe(9)
  })

  it('is not the online weekly: a run of either refuses the other puzzle', () => {
    const g = weeklyRun('weekly-2026-W44')
    const pin = pinOf('themed', casualSettings(u, 'themed', 'weekly-2026-W44')!)
    const c = challengeFromGame(g, u, 'Minh')!
    // The same seed with the online weekly's plain rules
    expect(verifyCasual(u, pin, qBody(g, { ...c, s: { ...c.s, r: { difficulty: 'normal', managers: false } } }), NOW, never)).toMatchObject({ ok: false, code: 'puzzle_mismatch' })
    expect(verifyCasual(u, pin, qBody(g, { ...c, i: ['peek'] }), NOW, never)).toMatchObject({ ok: false, code: 'puzzle_mismatch' })
    expect(verifyCasual(u, pin, qBody(g), new Date('2026-11-03T00:00:00Z'), never)).toMatchObject({ ok: false, code: 'closed' })
    expect(ok(verifyCasual(u, pin, qBody(g), new Date('2026-11-02T23:59:00Z'), never)).claim_matched).toBe(true)
  })
})

// ------------------------------------------------------------------ the Run-in of the week

describe('the Run-in of the week board', { timeout: 120_000 }, () => {
  const NOW = new Date('2026-10-28T12:00:00Z')
  const SEED = 'runin-2026-W44'

  function runIn(handTactics = false): Game {
    const g = createGame(weeklyRunInSettings(u, SEED)!)
    seedRunInDraft(g, u)
    auto(g)
    beginRunIn(g, u)
    if (handTactics) g.tactics = { ...g.tactics, mentality: 'defensive', pressing: 'low', tempo: 'slow', defensiveLine: 'deep' }
    simRunIn(g, u)
    g.phase = 'summary'
    return g
  }

  it("ranks the assistant's run-in on the replay's table row, on its league's universe", () => {
    const g = runIn()
    expect(casualBoardOf(g.settings)).toEqual({ board: 'runin', key: '2026-W44' })
    expect(casualUnrankedReason(g, u)).toBeNull()
    const sub = loadTestUniverse(casualLeagues('runin', SEED, ALL))
    expect(casualLeagues('runin', SEED, ALL)).toEqual([weeklyRunInPlan(SEED)!.leagueId])
    const pin = pinOf('runin', casualSettings(sub, 'runin', SEED)!)
    const sub2 = buildCasualSubmission(g, u, 'Minh')!
    expect(sub2.board).toBe('runin')
    expect(casualKeyOfBody('runin', sub2.encoded)).toBe('2026-W44')
    const e = ok(verifyCasual(sub, pin, { encoded: sub2.encoded, teamName: sub2.teamName, shortName: sub2.shortName }, NOW, never))
    const p = runInPayloadFromGame(g, u, 'Minh')!
    expect(e).toMatchObject({ score: p.c.pts, won: p.c.w, drawn: p.c.d, lost: p.c.l, league_position: p.c.pos, claim_matched: true })
    expect(['SURVIVED', 'TITLE WON', 'TOP FOUR', 'MISSED', 'SACKED']).toContain(e.detail)
  })

  it('records a tampered claim as unmatched, and refuses a tampered draft or another week', () => {
    const g = runIn()
    const pin = pinOf('runin', casualSettings(u, 'runin', SEED)!)
    const p = runInPayloadFromGame(g, u, 'Minh')!
    const post = (x: typeof p) => verifyCasual(u, pin, { encoded: encodeRunIn(x), teamName: 'x', shortName: 'XX' }, NOW, never)
    expect(ok(post({ ...p, c: { ...p.c, pts: p.c.pts + 3, w: p.c.w + 1 } })).claim_matched).toBe(false)
    expect(post({ ...p, p: p.p.slice(1) })).toMatchObject({ ok: false, code: 'invalid_picks' })
    expect(post({ ...p, seed: 'runin-2026-W45' })).toMatchObject({ ok: false, code: 'puzzle_mismatch' })
    expect(post({ ...p, f: p.f === '4-4-2' ? '4-3-3' : '4-4-2' })).toMatchObject({ ok: false, code: 'puzzle_mismatch' })
    expect(decodeRunIn(encodeRunIn(p))).toEqual(p)
  })

  it('a run-in managed by hand is not filed when its table differs from the replay', () => {
    const hand = runIn(true)
    const plain = runIn()
    const differs = JSON.stringify(runInPayloadFromGame(hand, u, 'x')!.c) !== JSON.stringify(runInPayloadFromGame(plain, u, 'x')!.c)
    // This week's seed and draft: the hand-set tactics end on another table row (pinned, so the check is exercised)
    expect(differs).toBe(true)
    expect(casualUnrankedReason(hand, u)).toMatch(/Managed by hand/)
    expect(buildCasualSubmission(hand, u, 'x')).toBeNull()
  })

  it('reads every board key back from its own payload only', () => {
    const g = runIn()
    expect(casualKeyOfBody('arena', encodeRunIn(runInPayloadFromGame(g, u, 'x')!))).toBeNull()
    expect(casualKeyOfBody('runin', 'nonsense')).toBeNull()
    expect(decodeChallenge).toBeTypeOf('function')
  })
})
