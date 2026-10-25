import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft } from '@engine/draft'
import { decodeChallenge } from '@engine/challenge'
import type { Game, GameSettings } from '@game/types'
import { createGame, dailyGameSettings } from '@game/logic/setup'
import { runQuickSeason } from '@game/logic/quick'
import { freshRecord } from '../localState'
import { backoffMs, captureEntry, classify, closesAt, enqueue, flushOutbox, nextDue, rankedFinish } from '../outbox'
import { rankedBoardOf } from '../daily'
import { weeklyGameSettings } from '../weekly'
import { OnlineError } from '../transport'
import { FakeBackend, FakeTransport } from './fakeTransport'

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
    expect(classify(409, { code: 'engine_mismatch', reason: 'engine 3 vs 4' }, 0)).toEqual({ kind: 'done', post: { state: 'unranked', code: 'engine_mismatch', reason: 'engine 3 vs 4' } })
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
