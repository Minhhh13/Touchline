import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft } from '@engine/draft'
import { decodeChallenge } from '@engine/challenge'
import type { Game, GameSettings } from '@game/types'
import { createGame, dailyGameSettings } from '@game/logic/setup'
import { runQuickSeason } from '@game/logic/quick'
import { freshRecord } from '../localState'
import { backoffMs, captureChaseEntry, captureEntry, classify, closesAt, enqueue, flushOutbox, nextDue, rankedFinish } from '../outbox'
import { chaseGameSettings } from '../chase'
import { rankedBoardOf } from '../daily'
import { weeklyGameSettings } from '../weekly'
import { OnlineError } from '../transport'
import { FakeBackend, FakeTransport } from './fakeTransport'
import { encodeChallenge } from '@engine/challenge'
import { ENGINE_VERSION } from '@engine/version'
import { entryEngine, payloadEngine } from '../engineRoute'

const u = loadTestUniverse()

function finished(settings: GameSettings): { before: Game; after: Game } {
  const g = createGame(settings)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  const before = structuredClone(g)
  runQuickSeason(g, u)
  return { before, after: g }
}

const daily = finished(dailyGameSettings(u, 'daily-2026-10-25', 'Outbox FC'))
const weekly = finished(weeklyGameSettings(u, '2026-W43', 'Weekly FC'))
const NOW = Date.UTC(2026, 9, 25, 12)

describe('ranked capture', () => {
  it('fires once, when the game this device was playing reaches its summary, for a Daily or the week only', () => {
    expect(rankedFinish({ game: daily.before }, { game: daily.after })?.id).toBe(daily.after.id)
    expect(rankedFinish({ game: weekly.before }, { game: weekly.after })?.id).toBe(weekly.after.id)
    // already in the summary, or arriving finished (a cloud download): nothing
    expect(rankedFinish({ game: daily.after }, { game: { ...daily.after } })).toBeNull()
    expect(rankedFinish({ game: null }, { game: daily.after })).toBeNull()
    // a Quick Draft, a ghost of a Daily, a Season
    const quick = finished({ ...dailyGameSettings(u, 'daily-2026-10-25'), mode: 'quick', seed: 'K7Q2-MX9A' })
    expect(rankedFinish({ game: quick.before }, { game: quick.after })).toBeNull()
    const ghost = { ...daily.after, settings: { ...daily.after.settings, mode: 'quick' as const, challenge: { name: 'x', picks: [], claim: { pts: 1, w: 0, d: 0, l: 0, t: 'MID_TABLE' as const }, verified: 'yes' as const, data: '', engine: '' } } }
    expect(rankedFinish({ game: { ...daily.before, settings: ghost.settings } }, { game: ghost })).toBeNull()
    expect(rankedBoardOf(daily.after.settings)).toEqual({ kind: 'daily', key: '2026-10-25' })
    expect(rankedBoardOf(weekly.after.settings)).toEqual({ kind: 'weekly', key: '2026-W43' })
  })

  it('files the ghost-draft payload with the names played, and only the first completion per board', () => {
    const e = captureEntry(daily.after, u, 'Minh', new Date(NOW))!
    expect(e).toMatchObject({ kind: 'daily', key: '2026-10-25', teamName: 'Outbox FC', points: daily.after.quickResult!.points })
    expect(decodeChallenge(e.encoded).s.seed).toBe('daily-2026-10-25')
    let r = enqueue(freshRecord('device-test-0001'), e)
    expect(r.outbox).toHaveLength(1)
    expect(r.posts['daily:2026-10-25']).toEqual({ state: 'waiting', reason: 'sign_in', points: e.points })
    r = enqueue(r, { ...e, id: 'again' })
    expect(r.outbox).toHaveLength(1)
    const w = captureEntry(weekly.after, u, 'Minh', new Date(NOW))!
    expect(w).toMatchObject({ kind: 'weekly', key: '2026-W43' })
  })
})

describe('outbox answers (build plan 4.8)', () => {
  it('maps every response class', () => {
    expect(classify(200, { status: 'ranked', position: 14, total: 312, entry: { points: 71, claimMatched: true } }, 70)).toEqual({ kind: 'done', post: { state: 'posted', position: 14, total: 312, countryPosition: null, countryTotal: null, country: null, points: 71, claimMatched: true, already: false } })
    expect(classify(200, { status: 'already_submitted', position: 23, total: 312, entry: { points: 65 } }, 71)).toMatchObject({ kind: 'done', post: { already: true, points: 65 } })
    expect(classify(200, { status: 'duplicate', position: 2, total: 3, country: 'VN', countryPosition: 1, countryTotal: 1, entry: { points: 80, claimMatched: false } }, 80)).toMatchObject({ post: { state: 'posted', country: 'VN', countryPosition: 1, claimMatched: false } })
    expect(classify(409, { code: 'engine_mismatch', reason: 'engine 3 vs 4' }, 0)).toMatchObject({ kind: 'done', post: { state: 'unranked', code: 'engine_mismatch' } })
    expect(classify(409, { code: 'puzzle_mismatch', reason: 'x' }, 0)).toMatchObject({ post: { state: 'unranked' } })
    expect(classify(409, { code: 'closed' }, 0)).toEqual({ kind: 'drop', post: { state: 'closed' } })
    expect(classify(422, { code: 'invalid_picks', reason: 'Spin 4: no player' }, 0)).toEqual({ kind: 'done', post: { state: 'rejected', code: 'invalid_picks', reason: 'Spin 4: no player' } })
    expect(classify(401, {}, 0)).toEqual({ kind: 'wait_sign_in' })
    for (const s of [404, 429, 500, 503]) expect(classify(s, {}, 0)).toEqual({ kind: 'retry' })
  })

  it('backs off from 5 s doubling to 10 minutes with jitter, and closes entries with their board', () => {
    expect(backoffMs(1, 0)).toBe(5000)
    expect(backoffMs(2, 0)).toBe(10000)
    expect(backoffMs(30, 0)).toBe(600000)
    expect(backoffMs(1, 1)).toBe(6500)
    expect(closesAt({ kind: 'daily', key: '2026-10-25' })).toBe(Date.UTC(2026, 9, 27))
    expect(closesAt({ kind: 'weekly', key: '2026-W43' })).toBe(Date.UTC(2026, 9, 27))
  })

  it('posts after sign-in, keeps retrying on a failure, and drops an entry once its day has closed', async () => {
    const b = new FakeBackend()
    const e = captureEntry(daily.after, u, 'Minh', new Date(NOW))!
    let r = enqueue(freshRecord('device-test-0001'), e)
    let now = NOW
    // signed out: kept, waiting
    r = await flushOutbox(r, { transport: new FakeTransport(b, null), signedIn: false, now: () => now, random: () => 0 })
    expect(r.outbox).toHaveLength(1)
    expect(b.calls).toEqual([])
    // signed in, the network drops: retry later
    const t = new FakeTransport(b, 'user-a')
    b.failNext.push(new OnlineError('network', 'Failed to fetch'))
    r = await flushOutbox(r, { transport: t, signedIn: true, now: () => now, random: () => 0 })
    expect(r.outbox[0]).toMatchObject({ attempts: 1, nextAt: NOW + 5000 })
    expect(r.posts['daily:2026-10-25']).toMatchObject({ state: 'waiting', reason: 'retry' })
    expect(nextDue(r)).toBe(NOW + 5000)
    // not due yet: nothing sent
    const sent = b.calls.length
    r = await flushOutbox(r, { transport: t, signedIn: true, now: () => now, random: () => 0 })
    expect(b.calls.length).toBe(sent)
    // due: the function ranks it
    now += 6000
    b.fn = (body) => (body.op === 'daily.submit' ? { status: 200, body: { status: 'ranked', position: 1, total: 1, entry: { points: e.points, claimMatched: true } } } : { status: 400, body: {} })
    r = await flushOutbox(r, { transport: t, signedIn: true, now: () => now, random: () => 0 })
    expect(r.outbox).toEqual([])
    expect(r.posts['daily:2026-10-25']).toMatchObject({ state: 'posted', position: 1, total: 1 })
    // a late entry for a closed day is dropped without a call
    let late = enqueue(freshRecord('device-test-0002'), e)
    const calls = b.calls.length
    late = await flushOutbox(late, { transport: t, signedIn: true, now: () => Date.UTC(2026, 9, 27, 0, 0, 1), random: () => 0 })
    expect(late.outbox).toEqual([])
    expect(late.posts['daily:2026-10-25']).toEqual({ state: 'closed' })
    expect(b.calls.length).toBe(calls)
  })

  it('posts a run only under the account that was signed in when it finished (shared devices)', async () => {
    const b = new FakeBackend()
    b.fn = (body) => (body.op === 'daily.submit' ? { status: 200, body: { status: 'ranked', position: 1, total: 1, entry: { points: 70, claimMatched: true } } } : { status: 400, body: {} })
    const mine = captureEntry(daily.after, u, 'Minh', new Date(NOW), 'user-a')!
    expect(mine.owner).toBe('user-a')
    let r = enqueue(freshRecord('device-test-0003'), mine)
    // another account signs in on this device: the run waits for its own account and nothing is sent
    r = await flushOutbox(r, { transport: new FakeTransport(b, 'user-b'), signedIn: true, userId: 'user-b', now: () => NOW, random: () => 0 })
    expect(b.calls).toEqual([])
    expect(r.outbox).toHaveLength(1)
    expect(r.posts['daily:2026-10-25']).toMatchObject({ state: 'waiting', reason: 'sign_in' })
    // its own account posts it
    r = await flushOutbox(r, { transport: new FakeTransport(b, 'user-a'), signedIn: true, userId: 'user-a', now: () => NOW, random: () => 0 })
    expect(r.outbox).toEqual([])
    expect(r.posts['daily:2026-10-25']).toMatchObject({ state: 'posted' })
    // a run filed signed out posts under whoever signs in next (the plan's "posted after sign-in")
    const anon = captureEntry(daily.after, u, 'Minh', new Date(NOW))!
    expect(anon.owner).toBeNull()
    let r2 = enqueue(freshRecord('device-test-0004'), anon)
    r2 = await flushOutbox(r2, { transport: new FakeTransport(b, 'user-b'), signedIn: true, userId: 'user-b', now: () => NOW, random: () => 0 })
    expect(r2.outbox).toEqual([])
  })
})

describe('38-0 chase posts', () => {
  const chase = finished(chaseGameSettings(u, 'K7Q2MX9A3B', 'england', '4-3-3', 'Chase FC')!)

  it('are never filed on their own: the Summary submits them, once per attempt, and they close with the attempt', () => {
    expect(rankedFinish({ game: chase.before }, { game: chase.after })).toBeNull()
    const e = captureChaseEntry(chase.after, u, 'Minh', new Date(NOW), 'user-a')!
    expect(e).toMatchObject({ kind: 'chase', key: 'K7Q2MX9A3B', teamName: 'Chase FC', owner: 'user-a', points: chase.after.quickResult!.points })
    expect(e.closes).toBe(Date.parse(chase.after.createdAt) + 48 * 3600000)
    expect(closesAt(e)).toBe(e.closes)
    expect(closesAt({ kind: 'chase', key: 'K7Q2MX9A3B', at: new Date(NOW).toISOString() })).toBe(NOW + 48 * 3600000)
    let r = enqueue(freshRecord('device-test-0005'), e)
    r = enqueue(r, { ...e, id: 'again' })
    expect(r.outbox).toHaveLength(1)
    expect(r.posts['chase:K7Q2MX9A3B']).toMatchObject({ state: 'waiting', reason: 'sign_in' })
    // A Quick Draft on its own seed, or a Daily, is no chase run
    expect(captureChaseEntry(daily.after, u, 'Minh', new Date(NOW))).toBeNull()
  })

  it('post with chase.submit and keep the week place and the flawless flag', async () => {
    const b = new FakeBackend()
    b.fn = (body) => (body.op === 'chase.submit' ? { status: 200, body: { status: 'ranked', position: 3, total: 40, weekPosition: 1, weekTotal: 9, perfect: false, entry: { points: 90, claimMatched: true } } } : { status: 400, body: {} })
    const e = captureChaseEntry(chase.after, u, 'Minh', new Date(NOW), 'user-a')!
    let r = enqueue(freshRecord('device-test-0006'), e)
    r = await flushOutbox(r, { transport: new FakeTransport(b, 'user-a'), signedIn: true, userId: 'user-a', now: () => NOW, random: () => 0 })
    expect(b.calls).toContain('invoke:chase.submit')
    expect(r.posts['chase:K7Q2MX9A3B']).toMatchObject({ state: 'posted', position: 3, total: 40, weekPosition: 1, weekTotal: 9, perfect: false, points: 90 })
    expect(classify(409, { code: 'no_attempt', reason: 'This wheel was not issued to this account' }, 0)).toMatchObject({ kind: 'done', post: { state: 'unranked', code: 'no_attempt' } })
  })
})

describe('runs filed on another engine (a release while a post waits)', () => {
  const OLD = String(Number(ENGINE_VERSION) - 1)
  /** The entry an older build filed: its payload says the old engine, and it has no `engine` field (older builds never wrote one). */
  const oldEntry = () => {
    const e = captureEntry(daily.after, u, 'Minh', new Date(NOW), 'user-a')!
    const payload = { ...decodeChallenge(e.encoded), engine: OLD }
    const { engine: _drop, ...rest } = { ...e, encoded: encodeChallenge(payload) }
    void _drop
    return rest
  }
  const ranked = { status: 200, body: { status: 'ranked', position: 4, total: 9, entry: { points: 70, claimMatched: true } } }
  const mismatch = (pinned: string) => ({ status: 409, body: { status: 409, code: 'engine_mismatch', reason: `Played on engine ${OLD}; the ranked puzzle runs on engine ${pinned}`, pinnedEngine: pinned } })

  it('stamps new entries with this engine and reads old ones from their payload', () => {
    const e = captureEntry(daily.after, u, 'Minh', new Date(NOW))!
    expect(e.engine).toBe(ENGINE_VERSION)
    expect(entryEngine(e)).toBe(ENGINE_VERSION)
    const old = oldEntry()
    expect('engine' in old).toBe(false)
    expect(payloadEngine(old.encoded)).toBe(OLD)
    expect(entryEngine(old)).toBe(OLD)
    // garbage never names a function
    expect(entryEngine({ encoded: 'not a payload', engine: '../4' })).toBe(ENGINE_VERSION)
  })

  it('posts an older engine\'s run to that engine\'s function, which ranks it', async () => {
    const b = new FakeBackend()
    b.fn = (_body, _uid, opts) => (opts.engine === OLD ? ranked : mismatch(OLD))
    let r = enqueue(freshRecord('device-test-0101'), oldEntry())
    r = await flushOutbox(r, { transport: new FakeTransport(b, 'user-a'), signedIn: true, userId: 'user-a', now: () => NOW, random: () => 0 })
    expect(b.calls).toEqual([`invoke:daily.submit@e${OLD}`])
    expect(r.outbox).toEqual([])
    expect(r.posts['daily:2026-10-25']).toMatchObject({ state: 'posted', position: 4, total: 9 })
    // a run on this engine still calls this build's function (no engine option)
    const b2 = new FakeBackend()
    b2.fn = (_body, _uid, opts) => (opts.engine ? mismatch(ENGINE_VERSION) : ranked)
    let r2 = enqueue(freshRecord('device-test-0102'), captureEntry(daily.after, u, 'Minh', new Date(NOW), 'user-a')!)
    r2 = await flushOutbox(r2, { transport: new FakeTransport(b2, 'user-a'), signedIn: true, userId: 'user-a', now: () => NOW, random: () => 0 })
    expect(b2.calls).toEqual(['invoke:daily.submit'])
    expect(r2.posts['daily:2026-10-25']).toMatchObject({ state: 'posted' })
  })

  it('explains a retired engine (404) at once instead of retrying until the board closes', async () => {
    const b = new FakeBackend()
    b.fn = () => ({ status: 404, body: { code: 'NOT_FOUND', message: 'Requested function was not found' } })
    let r = enqueue(freshRecord('device-test-0103'), oldEntry())
    r = await flushOutbox(r, { transport: new FakeTransport(b, 'user-a'), signedIn: true, userId: 'user-a', now: () => NOW, random: () => 0 })
    expect(r.outbox).toEqual([])
    const post = r.posts['daily:2026-10-25']
    expect(post).toMatchObject({ state: 'unranked', code: 'engine_retired' })
    expect(post.state === 'unranked' && post.reason).toContain(`engine ${OLD}`)
    // this engine's own 404 (its function not deployed yet) is still retried
    expect(classify(404, {}, 0, ENGINE_VERSION)).toEqual({ kind: 'retry' })
  })

  it('words an engine_mismatch for the side that is older, and keeps it as a final answer', async () => {
    // a run on this engine against a board pinned on the older one (a release mid-week): wait for the next board
    const newer = classify(409, { code: 'engine_mismatch', reason: 'x', pinnedEngine: OLD }, 70, ENGINE_VERSION)
    expect(newer).toMatchObject({ kind: 'done', post: { state: 'unranked', code: 'engine_mismatch' } })
    expect(newer.kind === 'done' && newer.post.state === 'unranked' && newer.post.reason).toMatch(/opened on an earlier version.*next one can/)
    // an old run against a board on this engine
    const older = classify(409, { code: 'engine_mismatch', reason: 'x', pinnedEngine: ENGINE_VERSION }, 70, OLD)
    expect(older.kind === 'done' && older.post.state === 'unranked' && older.post.reason).toContain(`earlier version of the game (engine ${OLD})`)
    // through the outbox: the entry leaves the queue with the reason kept for the Summary and the Account screen
    const b = new FakeBackend()
    b.fn = () => mismatch(ENGINE_VERSION)
    let r = enqueue(freshRecord('device-test-0104'), oldEntry())
    r = await flushOutbox(r, { transport: new FakeTransport(b, 'user-a'), signedIn: true, userId: 'user-a', now: () => NOW, random: () => 0 })
    expect(r.outbox).toEqual([])
    expect(r.posts['daily:2026-10-25']).toMatchObject({ state: 'unranked', code: 'engine_mismatch' })
  })
})

