import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft } from '@engine/draft'
import { decodeChallenge, encodeChallenge, isArenaPayload } from '@engine/challenge'
import { ENGINE_VERSION } from '@engine/version'
import type { Game } from '@game/types'
import { createGame } from '@game/logic/setup'
import { beginArena, simArenaToEnd } from '@game/logic/arena'
import { dailyArenaGameSettings } from '@game/logic/arenaDaily'
import { weeklyGameSettings, weeklyPlan } from '@game/logic/weekly'
import { kickOff, toKickoff } from '@game/logic/quick'
import { beginRunIn, seedRunInDraft } from '@game/logic/runin'
import { decodeRunIn, encodeRunIn, simRunIn, weeklyRunInPlan, weeklyRunInSettings } from '@game/logic/runinWeekly'
import { puzzleOf, settingsHash } from '../server/dailyVerify'
import type { Reply } from '../server/service'
import { buildCasualSubmission } from '../casual'
import { ALICE, BOB, GUEST, VISITOR, makeHarness } from './serverHarness'

const ARENA_SEED = 'arena-2026-10-25'
const WEEK = '2026-W44'
const plan = weeklyPlan({ available: ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal'].map((id) => ({ id })) as never }, `weekly-${WEEK}`)
const runPlan = weeklyRunInPlan(`runin-${WEEK}`)!
const u = loadTestUniverse([...new Set(['england', plan.leagueId, ...plan.wheelLeagues, runPlan.leagueId])])
const LIVE = { engine: ENGINE_VERSION, data: u.generatedAt, builtAt: '2026-10-25T00:05:00Z' }
const T = 180000

const call = (h: ReturnType<typeof makeHarness>, body: unknown, caller: Parameters<ReturnType<typeof makeHarness>['server']['handle']>[0] = ALICE): Promise<Reply> => h.server.handle(caller, JSON.stringify(body))

function auto(g: Game) {
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
}

function arenaRun(): Game {
  const g = createGame(dailyArenaGameSettings(u, ARENA_SEED))
  auto(g)
  beginArena(g, u)
  simArenaToEnd(g, u)
  return g
}

function themedRun(): Game {
  const g = createGame(weeklyGameSettings(u, `weekly-${WEEK}`, 'Weekly FC')!)
  auto(g)
  toKickoff(g, u)
  kickOff(g, u)
  return g
}

function runInRun(): Game {
  const g = createGame(weeklyRunInSettings(u, `runin-${WEEK}`)!)
  seedRunInDraft(g, u)
  auto(g)
  beginRunIn(g, u)
  simRunIn(g, u)
  g.phase = 'summary'
  return g
}

const bodyOf = (g: Game) => {
  const s = buildCasualSubmission(g, u, 'Tester')
  if (!s) throw new Error('not postable')
  return s
}

describe('casual.submit: the Daily Arena', () => {
  it('pins the day on the live data, ranks the replay and keeps the first post', { timeout: T }, async () => {
    const h = makeHarness(new Date('2026-10-25T12:00:00Z'), LIVE)
    const g = arenaRun()
    const r = await call(h, bodyOf(g))
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ status: 'ranked', board: 'arena', key: '2026-10-25', position: 1, total: 1, official: { claimMatched: true, trophy: g.arena!.won } })
    const pin = h.casualPins.get('arena|2026-10-25')!
    expect(pin).toMatchObject({ seed: ARENA_SEED, engineVersion: ENGINE_VERSION, dataVersion: u.generatedAt })
    expect(pin.settingsHash).toBe(settingsHash(puzzleOf(dailyArenaGameSettings(u, ARENA_SEED))))
    expect((await call(h, bodyOf(g))).body.status).toBe('duplicate')
    // Bob posts the same run: a second row, the same figures, ranked behind the first poster
    expect((await call(h, bodyOf(g), BOB)).body).toMatchObject({ status: 'ranked', position: 2, total: 2 })
  })

  it('refuses a run managed by hand, a guest, a closed day and a body for another board', { timeout: T }, async () => {
    const h = makeHarness(new Date('2026-10-25T12:00:00Z'), LIVE)
    const g = arenaRun()
    const sub = bodyOf(g)
    const c = decodeChallenge(sub.encoded)
    if (!isArenaPayload(c)) throw new Error('arena')
    const hand = await call(h, { ...sub, encoded: encodeChallenge({ ...c, auto: false }) })
    expect(hand.status).toBe(409)
    expect(hand.body.code).toBe('hand_managed')
    expect((await call(h, sub, GUEST)).body.code).toBe('guest')
    expect((await call(h, sub, VISITOR)).status).toBe(401)
    expect((await call(h, { ...sub, board: 'themed' })).body.code).toBe('invalid_payload')
    expect((await call(h, { ...sub, board: 'cup' })).status).toBe(400)
    const late = makeHarness(new Date('2026-10-27T00:00:00Z'), LIVE)
    expect((await call(late, sub)).body.code).toBe('closed')
    expect(late.casualPins.size).toBe(0)
  })

  it('pins only on the live engine', { timeout: T }, async () => {
    const h = makeHarness(new Date('2026-10-25T12:00:00Z'), { ...LIVE, engine: 'old' })
    const r = await call(h, bodyOf(arenaRun()))
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('engine_mismatch')
  })
})

describe('casual.submit: the Weekly Challenge and the Run-in of the week', () => {
  it('ranks a themed week on the leagues it needs', { timeout: T }, async () => {
    const h = makeHarness(new Date('2026-10-28T12:00:00Z'), LIVE)
    const g = themedRun()
    const r = await call(h, bodyOf(g))
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ status: 'ranked', board: 'themed', key: WEEK, official: { points: g.quickResult!.points, leaguePosition: g.quickResult!.position, claimMatched: true } })
    expect(h.casualPins.get(`themed|${WEEK}`)!.settings.mode).toBe('weekly')
  })

  it('ranks the Run-in of the week, and files a claim that does not replay as the replay', { timeout: T }, async () => {
    const h = makeHarness(new Date('2026-10-28T12:00:00Z'), LIVE)
    const g = runInRun()
    const sub = bodyOf(g)
    const p = decodeRunIn(sub.encoded)
    const r = await call(h, sub)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ status: 'ranked', board: 'runin', key: WEEK, official: { points: p.c.pts, leaguePosition: p.c.pos, claimMatched: true } })
    const tampered = await call(h, { ...sub, encoded: encodeRunIn({ ...p, c: { ...p.c, pts: p.c.pts + 3 } }) }, BOB)
    expect(tampered.body).toMatchObject({ status: 'ranked', official: { points: p.c.pts, claimMatched: false } })
    expect((await call(h, { ...sub, encoded: encodeRunIn({ ...p, p: p.p.slice(1) }) }, { ...BOB, userId: 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3' })).body.code).toBe('invalid_picks')
  })
})

