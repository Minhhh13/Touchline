/**
 * An engine release while ranked posts wait in a device's outbox: the real server (`createServer` through the
 * harness) answers, the outbox routes and words it. Each case would lose the run, or say something wrong, without
 * `engineRoute.ts`.
 */
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { decodeChallenge, encodeChallenge } from '@engine/challenge'
import { ENGINE_VERSION } from '@engine/version'
import { dailyGameSettings } from '@game/logic/setup'
import { freshRecord } from '../localState'
import { captureEntry, enqueue, flushOutbox } from '../outbox'
import { PIN_NOTE, PIN_TAG, pinStanding, roomVersionNote } from '../engineRoute'
import { FakeBackend, FakeTransport } from './fakeTransport'
import { ALICE, autoPlayed, makeHarness } from './serverHarness'

const u = loadTestUniverse()
const OLD = String(Number(ENGINE_VERSION) - 1)
const LIVE = { engine: ENGINE_VERSION, data: u.generatedAt, builtAt: '2026-10-25T00:05:00Z' }
const NOW = Date.UTC(2026, 9, 25, 12)
const game = autoPlayed(u, dailyGameSettings(u, 'daily-2026-10-25', 'Release FC'))

/** A FakeBackend whose function is this engine's real server (an older engine's is not deployed in the harness). */
function bridged(h: ReturnType<typeof makeHarness>, older: 'retired' | 'same' | 'none' = 'none') {
  const b = new FakeBackend()
  b.fn = async (body, _uid, opts) => {
    if (opts.engine && opts.engine !== ENGINE_VERSION && older !== 'same') return older === 'retired' ? { status: 404, body: { code: 'NOT_FOUND', message: 'Requested function was not found' } } : { status: 503, body: {} }
    return h.server.handle(ALICE, JSON.stringify(body))
  }
  return b
}

describe('a release while a ranked post waits', () => {
  it('an old-engine run on a board pinned after the release is worded, kept as final and never silently dropped', async () => {
    // Today's board pinned on this engine; the old engine's function answers as this server does (the same code, a
    // payload and a pin on different engines), so the server stands in for it
    const h = makeHarness(new Date(NOW), LIVE)
    const e = captureEntry(game, u, 'Minh', new Date(NOW), ALICE.userId)!
    // as the older build filed it: the payload names the old engine and there is no engine field
    const { engine: _e, ...old } = { ...e, encoded: encodeChallenge({ ...decodeChallenge(e.encoded), engine: OLD }) }
    void _e
    const b = bridged(h, 'same')
    let r = enqueue(freshRecord('device-release-01'), old)
    r = await flushOutbox(r, { transport: new FakeTransport(b, ALICE.userId), signedIn: true, userId: ALICE.userId, now: () => NOW, random: () => 0 })
    expect(r.outbox).toEqual([])
    const post = r.posts['daily:2026-10-25']
    expect(post).toMatchObject({ state: 'unranked', code: 'engine_mismatch' })
    expect(post.state === 'unranked' && post.reason).toContain(`earlier version of the game (engine ${OLD})`)
    expect(b.calls).toEqual([`invoke:daily.submit@e${OLD}`])
  })

  it('a retired old engine is explained at once', async () => {
    const h = makeHarness(new Date(NOW), LIVE)
    const e = captureEntry(game, u, 'Minh', new Date(NOW), ALICE.userId)!
    const { engine: _e, ...old } = { ...e, encoded: encodeChallenge({ ...decodeChallenge(e.encoded), engine: OLD }) }
    void _e
    let r = enqueue(freshRecord('device-release-02'), old)
    r = await flushOutbox(r, { transport: new FakeTransport(bridged(h, 'retired'), ALICE.userId), signedIn: true, userId: ALICE.userId, now: () => NOW, random: () => 0 })
    expect(r.posts['daily:2026-10-25']).toMatchObject({ state: 'unranked', code: 'engine_retired' })
  })

  it('a current run on a board pinned before the release says the next board ranks it', async () => {
    const h = makeHarness(new Date(NOW), LIVE)
    expect((await h.server.handle(ALICE, JSON.stringify({ op: 'daily.pin', date: '2026-10-25' }))).status).toBe(200)
    // the stored pin as the older function made it before the site moved on
    const pin = h.pins.get('daily|2026-10-25')!
    pin.engineVersion = OLD
    expect(pinStanding(pin, 'local')).toBe('older_pin')
    expect(PIN_TAG.older_pin).toBe('Unranked today')
    expect(PIN_NOTE.older_pin).toMatch(/next board/)
    expect(pinStanding({ engineVersion: ENGINE_VERSION }, 'local')).toBe('ranked')
    expect(pinStanding({ engineVersion: String(Number(ENGINE_VERSION) + 1) }, 'local')).toBe('newer_pin')
    let r = enqueue(freshRecord('device-release-03'), captureEntry(game, u, 'Minh', new Date(NOW), ALICE.userId)!)
    r = await flushOutbox(r, { transport: new FakeTransport(bridged(h), ALICE.userId), signedIn: true, userId: ALICE.userId, now: () => NOW, random: () => 0 })
    const post = r.posts['daily:2026-10-25']
    expect(post).toMatchObject({ state: 'unranked', code: 'engine_mismatch' })
    expect(post.state === 'unranked' && post.reason).toMatch(/opened on an earlier version.*next one can/)
  })
})

describe('a room opened on another version', () => {
  it('says an older room cannot be finished here (a reload would not help) and a newer one needs a reload', () => {
    const here = { engine: ENGINE_VERSION, data: '2026-10-25' }
    expect(roomVersionNote({ engineVersion: ENGINE_VERSION, dataVersion: '2026-10-25' }, here)).toBeNull()
    expect(roomVersionNote({ engineVersion: OLD, dataVersion: '2026-10-25' }, here)).toMatchObject({ older: true, title: expect.stringMatching(/earlier version/) })
    expect(roomVersionNote({ engineVersion: ENGINE_VERSION, dataVersion: '2026-10-20' }, here)).toMatchObject({ older: true })
    expect(roomVersionNote({ engineVersion: String(Number(ENGINE_VERSION) + 1), dataVersion: '2026-10-25' }, here)).toMatchObject({ older: false, line: expect.stringMatching(/Reload/) })
    expect(roomVersionNote({ engineVersion: ENGINE_VERSION, dataVersion: '2026-10-25.b' }, here)).toMatchObject({ older: false })
  })
})

