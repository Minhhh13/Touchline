import { DAILY_RULES } from '@game/logic/daily'
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { decodeChallenge, encodeChallenge, isArenaPayload, type QuickChallengePayload } from '@engine/challenge'
import { spin } from '@engine/draft'
import type { LeaguesFile, MetaFile, PlayersFile } from '@engine/universe'
import { ENGINE_VERSION } from '@engine/version'
import { dailyGameSettings } from '@game/logic/setup'
import { challengeFromGame, replayChallenge } from '@game/logic/challenge'
import { settingsHash } from '../server/dailyVerify'
import { universeFromPacks } from '../server/packs'
import { DELETE_CONFIRMATION } from '../server/validate'
import { boardIsOpen, pinDateOf, type Reply, type Requester } from '../server/service'
import { weeklyGameSettings } from '../weekly'
import { chaseGameSettings } from '../chase'
import { ALICE, BOB, GUEST, VISITOR, VISITOR2, autoPlayed, makeHarness, siteFile, submitBody } from './serverHarness'
import { LIMITS } from '../server/service'
import type { ErrorReport } from '../core/errorReport'

const u = loadTestUniverse()
const STAMP = u.generatedAt
const LIVE = { engine: ENGINE_VERSION, data: STAMP, builtAt: '2026-10-25T00:05:00Z' }
const DATE = '2026-10-25'
const SEED = `daily-${DATE}`
const WEEK = '2026-W43'
const T = 180000

const call = (h: ReturnType<typeof makeHarness>, body: unknown, caller: Requester = ALICE): Promise<Reply> => h.server.handle(caller, typeof body === 'string' ? body : JSON.stringify(body))
const honestDaily = () => autoPlayed(u, dailyGameSettings(u, SEED, 'Verified FC'))
const reencode = (encoded: string, f: (c: QuickChallengePayload) => void) => {
  const c = decodeChallenge(encoded)
  if (isArenaPayload(c)) throw new Error('Not a quick link')
  f(c)
  return encodeChallenge(c)
}
const encodedOf = (g: ReturnType<typeof honestDaily>) => encodeChallenge(challengeFromGame(g, u, 'Tester')!)

describe('requests the function refuses before any work', () => {
  it('answers 400 to anything that is not a known, well-formed operation', async () => {
    const h = makeHarness(undefined, LIVE)
    for (const body of ['', 'not json', '[]', '{"op":"daily.hack"}', '{"op":"status","extra":1}', '{"op":"daily.pin","date":"2026-02-30"}', '{"op":"weekly.pin","week":"2026-W99"}', '{"op":"daily.submit","encoded":5,"teamName":"A","shortName":"AB"}', JSON.stringify({ op: 'daily.submit', encoded: 'x'.repeat(17000), teamName: 'A', shortName: 'AB' })]) {
      const r = await call(h, body)
      expect(r.status, body.slice(0, 40)).toBe(400)
      expect(r.body.code).toBe('bad_request')
    }
    // Nothing was fetched or written for a refused request
    expect(h.site.served).toEqual([])
    expect(h.pins.size).toBe(0)
  })

  it('keeps guests off the boards (accounts only) and meters every route per account', async () => {
    const h = makeHarness(undefined, LIVE)
    expect((await call(h, { op: 'daily.pin' }, GUEST)).body.code).toBe('guest')
    for (let i = 0; i < 30; i++) h.limits.set(`daily.pin|${BOB.userId}`, 30)
    const r = await call(h, { op: 'daily.pin' }, BOB)
    expect(r.status).toBe(429)
    expect(r.body.code).toBe('rate_limited')
  })

  it('reports its engine and the live build', async () => {
    const h = makeHarness(undefined, LIVE)
    const r = await call(h, { op: 'status' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: 'ok', engine: ENGINE_VERSION, live: LIVE, today: DATE, week: WEEK })
  })
})

describe('pinning a puzzle from the data the live site serves', () => {
  it('needs the live build.json and the live engine', async () => {
    const none = makeHarness(undefined, null)
    expect((await call(none, { op: 'daily.pin' })).body.code).toBe('live_build_unavailable')
    const stale = makeHarness(undefined, { ...LIVE, engine: 'old' })
    const r = await call(stale, { op: 'daily.pin' })
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'engine_mismatch', liveEngine: 'old' })
    expect(stale.pins.size).toBe(0)
  })

  it('archives the live packs once, registers their hashes and pins today\'s Daily mapping', async () => {
    const h = makeHarness(undefined, LIVE)
    const r = await call(h, { op: 'daily.pin' })
    expect(r.status).toBe(200)
    const pin = r.body.pin as { settingsHash: string; dataVersion: string; engineVersion: string; seed: string }
    expect(pin).toMatchObject({ seed: SEED, dataVersion: STAMP, engineVersion: ENGINE_VERSION })
    expect(pin.settingsHash).toBe(settingsHash(dailyGameSettings(u, SEED)))
    const index = JSON.parse(new TextDecoder().decode(siteFile('leagues.json', null)!)) as LeaguesFile
    const reg = h.packs.get(STAMP)!
    expect(reg.leagues).toEqual(index.leagues.map((l) => l.id))
    // The index, each league's players and meta, and the classic pack of each league the index gives one
    expect(Object.keys(reg.files)).toHaveLength(1 + 2 * index.leagues.length + index.leagues.filter((l) => l.classicFrom !== undefined).length)
    expect(reg.files['england/players-classic.json']).toMatch(/^[0-9a-f]{64}$/)
    expect([...h.archive.keys()].every((k) => k.startsWith(`v/${STAMP}/`))).toBe(true)
    expect(h.archive.size).toBe(Object.keys(reg.files).length)
    // A second call (and the weekly pin) reuse the archive: no pack is fetched again
    const fetched = h.site.served.filter((p) => p.startsWith('data/')).length
    expect((await call(h, { op: 'daily.pin' })).body.pin).toEqual(r.body.pin)
    const w = await call(h, { op: 'weekly.pin' })
    expect(w.status).toBe(200)
    expect((w.body.pin as { settingsHash: string }).settingsHash).toBe(settingsHash(weeklyGameSettings(u, WEEK)))
    expect(h.site.served.filter((p) => p.startsWith('data/')).length).toBe(fetched)
  }, T)

  it('pins yesterday after midnight but never a closed or future day', async () => {
    const h = makeHarness(new Date('2026-10-26T00:10:00Z'), LIVE)
    expect((await call(h, { op: 'daily.pin', date: DATE })).status).toBe(200)
    expect((await call(h, { op: 'daily.pin', date: '2026-10-23' })).body.code).toBe('closed')
    expect((await call(h, { op: 'daily.pin', date: '2026-10-28' })).body.code).toBe('closed')
    expect((await call(h, { op: 'weekly.pin', week: '2026-W45' })).body.code).toBe('closed')
  }, T)

  it('refuses archived bytes that no longer match their registered hash', async () => {
    const h = makeHarness(undefined, LIVE)
    await call(h, { op: 'daily.pin' })
    const fresh = makeHarness(undefined, LIVE)
    fresh.packs.set(STAMP, h.packs.get(STAMP)!)
    for (const [k, v] of h.archive) fresh.archive.set(k, v)
    fresh.archive.set(`v/${STAMP}/england/players.json`, new TextEncoder().encode('{"tampered":true}'))
    const r = await call(fresh, { op: 'weekly.pin' })
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('packs_unavailable')
  }, T)
})

describe('daily.submit: the replay is the official result', () => {
  it('ranks an honest Daily on the replay, then answers a retry as duplicate and another draft as already_submitted', async () => {
    const h = makeHarness(undefined, LIVE)
    const g = honestDaily()
    const r = await call(h, submitBody('daily.submit', g, u))
    expect(r.status).toBe(200)
    const q = g.quickResult!
    expect(r.body).toMatchObject({ status: 'ranked', key: DATE, position: 1, total: 1, official: { points: q.points, won: q.won, drawn: q.drawn, lost: q.lost, goalsFor: q.goalsFor, goalsAgainst: q.goalsAgainst, leaguePosition: q.position, tier: q.tier, claimMatched: true } })
    // The pin was made by the first submission of the day
    expect(h.pins.get(`daily|${DATE}`)?.settingsHash).toBe(settingsHash(dailyGameSettings(u, SEED)))
    // Parity with the ghost-draft replay every opener runs
    const replay = replayChallenge(u, decodeChallenge(encodedOf(g)))
    expect(replay.result).toEqual({ pts: q.points, w: q.won, d: q.drawn, l: q.lost, t: q.tier })
    expect((await call(h, submitBody('daily.submit', g, u))).body.status).toBe('duplicate')
    const other = autoPlayed(u, dailyGameSettings(u, SEED, 'Verified FC'), (x, rng) => {
      spin(u, x.draft!, rng)
    })
    expect((await call(h, submitBody('daily.submit', other, u))).body.status).toBe('already_submitted')
    // Bob's first post ranks on the same board
    expect((await call(h, submitBody('daily.submit', other, u), BOB)).body).toMatchObject({ status: 'ranked', total: 2 })
  }, T)

  it('ranks an inflated claim on the replay\'s figures, never the claim', async () => {
    const h = makeHarness(undefined, LIVE)
    const g = honestDaily()
    const inflated = reencode(encodedOf(g), (c) => {
      c.c = { ...c.c, pts: c.c.pts + 15, w: c.c.w + 5 }
    })
    const r = await call(h, submitBody('daily.submit', g, u, inflated))
    expect(r.body).toMatchObject({ status: 'ranked', official: { points: g.quickResult!.points, claimMatched: false } })
    expect(h.entries.get(`daily|${DATE}|${ALICE.userId}`)?.entry.points).toBe(g.quickResult!.points)
  }, T)

  it('refuses tampered drafts with the spin number, other puzzles, other engines and closed days', async () => {
    const h = makeHarness(undefined, LIVE)
    const g = honestDaily()
    const enc = encodedOf(g)
    const extraNulls = reencode(enc, (c) => {
      // One null row more than the re-spins allow, still within the row cap, so the replay itself finds it
      c.p = [...Array.from({ length: DAILY_RULES.respins + 1 }, (): [null, null] => [null, null]), ...c.p]
    })
    const tampered = await call(h, submitBody('daily.submit', g, u, extraNulls))
    expect(tampered.status).toBe(422)
    expect(tampered.body.code).toBe('invalid_picks')
    expect(String(tampered.body.reason)).toMatch(/^Spin \d+/)
    const formation = reencode(enc, (c) => {
      c.s.f = c.s.f === '4-4-2' ? '4-3-3' : '4-4-2'
    })
    expect((await call(h, submitBody('daily.submit', g, u, formation))).body).toMatchObject({ status: 409, code: 'puzzle_mismatch' })
    const engine2 = reencode(enc, (c) => {
      c.engine = '2'
    })
    expect((await call(h, submitBody('daily.submit', g, u, engine2))).body).toMatchObject({ status: 409, code: 'engine_mismatch' })
    expect((await call(h, { op: 'daily.submit', encoded: 'AAAA', teamName: 'A', shortName: 'AB' })).body.code).toBe('invalid_payload')
    const badTeam = JSON.stringify({ op: 'daily.submit', encoded: enc, teamName: 'Verified​FC', shortName: g.settings.shortName })
    expect((await call(h, badTeam)).body.code).toBe('invalid_team')
    // Nothing reached the board
    expect(h.entries.size).toBe(0)
    const late = makeHarness(new Date('2026-10-27T09:00:00Z'), LIVE)
    expect((await call(late, submitBody('daily.submit', g, u))).body).toMatchObject({ status: 409, code: 'closed' })
    expect(late.pins.size).toBe(0)
  }, T)

  it('ranks data the live site served after the pin (a mid-day rebuild) and refuses data older than the pin', async () => {
    const h = makeHarness(undefined, LIVE)
    await call(h, { op: 'daily.pin' })
    // An older data version, registered before the pin, never ranks
    h.packs.set('2026-10-20', { ...h.packs.get(STAMP)!, version: '2026-10-20', firstSeenAt: '2026-10-20T00:00:00Z' })
    const g = honestDaily()
    const old = reencode(encodedOf(g), (c) => {
      c.data = '2026-10-20'
    })
    expect((await call(h, submitBody('daily.submit', g, u, old))).body).toMatchObject({ status: 409, code: 'data_mismatch', pinnedData: STAMP })
    // An unknown version the live site does not serve never ranks either
    const unknown = reencode(encodedOf(g), (c) => {
      c.data = '2031-01-01'
    })
    expect((await call(h, submitBody('daily.submit', g, u, unknown))).body.code).toBe('data_mismatch')
    // At 13:00 the live site serves a rebuild under a new stamp; a client on it plays and posts
    const NEW = `${STAMP}b`
    h.clock.now = new Date('2026-10-25T13:00:00Z')
    h.site.build = { ...LIVE, data: NEW }
    h.site.stamp = NEW
    const index = JSON.parse(new TextDecoder().decode(siteFile('leagues.json', NEW)!)) as LeaguesFile
    const uNew = universeFromPacks(index, { england: { players: JSON.parse(new TextDecoder().decode(siteFile('england/players.json', NEW)!)) as PlayersFile, meta: JSON.parse(new TextDecoder().decode(siteFile('england/meta.json', NEW)!)) as MetaFile, classic: JSON.parse(new TextDecoder().decode(siteFile('england/players-classic.json', NEW)!)) as PlayersFile } }, ['england'])
    expect(uNew.generatedAt).toBe(NEW)
    const gNew = autoPlayed(uNew, dailyGameSettings(uNew, SEED, 'Verified FC'))
    const r = await call(h, submitBody('daily.submit', gNew, uNew), BOB)
    expect(r.body).toMatchObject({ status: 'ranked' })
    expect(h.entries.get(`daily|${DATE}|${BOB.userId}`)?.entry.data_version).toBe(NEW)
    expect(h.pins.get(`daily|${DATE}`)?.dataVersion).toBe(STAMP)
  }, T)
})

describe('the live build.json cache', () => {
  it('rechecks a warm build.json before refusing data a deploy minutes old serves', async () => {
    const h = makeHarness(undefined, LIVE)
    await call(h, { op: 'daily.pin' })
    // One minute after the pin (the 5-minute copy is still warm) the live site serves a rebuild
    const NEW = `${STAMP}c`
    h.clock.now = new Date('2026-10-25T12:01:00Z')
    h.site.build = { ...LIVE, data: NEW }
    h.site.stamp = NEW
    const index = JSON.parse(new TextDecoder().decode(siteFile('leagues.json', NEW)!)) as LeaguesFile
    const uNew = universeFromPacks(index, { england: { players: JSON.parse(new TextDecoder().decode(siteFile('england/players.json', NEW)!)) as PlayersFile, meta: JSON.parse(new TextDecoder().decode(siteFile('england/meta.json', NEW)!)) as MetaFile, classic: JSON.parse(new TextDecoder().decode(siteFile('england/players-classic.json', NEW)!)) as PlayersFile } }, ['england'])
    const gNew = autoPlayed(uNew, dailyGameSettings(uNew, SEED, 'Verified FC'))
    const r = await call(h, submitBody('daily.submit', gNew, uNew), BOB)
    expect(r.body).toMatchObject({ status: 'ranked' })
    expect(h.entries.get(`daily|${DATE}|${BOB.userId}`)?.entry.data_version).toBe(NEW)
  }, T)

  it('fetches build.json at most once per 30 seconds, failures included', async () => {
    const h = makeHarness(undefined, null)
    for (let i = 0; i < 5; i++) await call(h, { op: 'status' })
    expect(h.site.served.filter((p) => p === 'build.json')).toHaveLength(1)
    h.site.build = LIVE
    h.clock.now = new Date(h.clock.now.getTime() + 31000)
    expect((await call(h, { op: 'status' })).body.live).toEqual(LIVE)
    // A post naming unknown data cannot make the function fetch build.json again within the window
    const g = honestDaily()
    const unknown = reencode(encodedOf(g), (c) => {
      c.data = '2031-01-01'
    })
    for (let i = 0; i < 3; i++) expect((await call(h, submitBody('daily.submit', g, u, unknown))).body.code).toBe('data_mismatch')
    expect(h.site.served.filter((p) => p === 'build.json')).toHaveLength(2)
  }, T)
})

describe('weekly.submit', () => {
  it('ranks an honest weekly challenge on its pinned week', async () => {
    const h = makeHarness(undefined, LIVE)
    const g = autoPlayed(u, weeklyGameSettings(u, WEEK, 'Weekly FC'))
    const r = await call(h, submitBody('weekly.submit', g, u))
    expect(r.body).toMatchObject({ status: 'ranked', key: WEEK, official: { points: g.quickResult!.points, claimMatched: true } })
    expect(h.pins.get('weekly|2026-10-19')?.seed).toBe(`weekly-${WEEK}`)
    // A Daily posted as a weekly entry is not one
    expect((await call(h, submitBody('weekly.submit', honestDaily(), u))).body.code).toBe('invalid_payload')
  }, T)
})

describe('the 38-0 chase: server-issued wheels, one post each', () => {
  const start = (h: ReturnType<typeof makeHarness>, caller = ALICE, over: Record<string, unknown> = {}) => call(h, { op: 'chase.start', leagueId: 'england', formationId: '4-3-3', engine: ENGINE_VERSION, data: STAMP, ...over }, caller)
  const played = (code: string, team = 'Chase FC') => autoPlayed(u, chaseGameSettings(u, code, 'england', '4-3-3', team)!)

  it('issues an attempt only on the live engine and data, archives that data, and at most five a day', async () => {
    expect((await start(makeHarness(undefined, null))).body.code).toBe('live_build_unavailable')
    const h = makeHarness(undefined, LIVE)
    // A stale tab is told to reload before an attempt is spent
    const stale = await start(h, ALICE, { data: '2026-01-01' })
    expect(stale).toMatchObject({ status: 409, body: { code: 'data_mismatch', liveData: STAMP } })
    expect((await start(h, ALICE, { engine: '3' })).body.code).toBe('engine_mismatch')
    expect((await start(h, ALICE, { formationId: '9-9-9' })).body.code).toBe('invalid_payload')
    expect((await start(h, ALICE, { leagueId: 'atlantis' })).body.code).toBe('invalid_payload')
    expect((await start(h, ALICE, { leagueId: 'England!' })).status).toBe(400)
    expect((await call(h, { op: 'chase.start', leagueId: 'england' })).status).toBe(400)
    expect(h.attempts.size).toBe(0)
    for (let i = 0; i < 5; i++) {
      const r = await start(h)
      expect(r.status).toBe(200)
      expect(r.body).toMatchObject({ status: 'ok', left: 4 - i, attempt: { leagueId: 'england', formationId: '4-3-3', engineVersion: ENGINE_VERSION, dataVersion: STAMP } })
    }
    expect(h.packs.has(STAMP)).toBe(true)
    const sixth = await start(h)
    expect(sixth).toMatchObject({ status: 429, body: { code: 'rate_limited' } })
    // The next UTC day frees them again; guests never get one
    h.clock.now = new Date('2026-10-26T00:00:01Z')
    expect((await start(h)).status).toBe(200)
    expect((await start(h, GUEST)).body.code).toBe('guest')
  }, T)

  it('ranks an honest run on its attempt, once, and only for the account it was issued to', async () => {
    const h = makeHarness(undefined, LIVE)
    const code = String(((await start(h)).body.attempt as { code: string }).code)
    const g = played(code)
    const r = await call(h, submitBody('chase.submit', g, u))
    const q = g.quickResult!
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: 'ranked', key: code, position: 1, total: 1, official: { points: q.points, won: q.won, drawn: q.drawn, lost: q.lost, goalsFor: q.goalsFor, goalsAgainst: q.goalsAgainst, claimMatched: true } })
    expect(h.chaseEntries.get(code)?.entry.points).toBe(q.points)
    expect((await call(h, submitBody('chase.submit', g, u))).body.status).toBe('duplicate')
    // Bob cannot post Alice's wheel, and a seed the server never issued is nobody's
    expect((await call(h, submitBody('chase.submit', g, u), BOB)).body).toMatchObject({ code: 'no_attempt' })
    expect((await call(h, submitBody('chase.submit', played('ZZZZZZZZZZ'), u))).body.code).toBe('no_attempt')
    // A Quick Draft on its own seed, a Daily posted as a chase run
    expect((await call(h, submitBody('chase.submit', autoPlayed(u, { ...g.settings, seed: 'K7Q2-MX9A' }), u))).body.code).toBe('invalid_payload')
    expect((await call(h, submitBody('chase.submit', honestDaily(), u))).body.code).toBe('invalid_payload')
  }, T)

  it('replays rather than trusts: an inflated claim ranks on the replay, a tampered draft is refused, a closed attempt too', async () => {
    const h = makeHarness(undefined, LIVE)
    const a = String(((await start(h)).body.attempt as { code: string }).code)
    const b = String(((await start(h)).body.attempt as { code: string }).code)
    const g = played(a)
    const inflated = reencode(encodedOf(g), (c) => {
      c.c = { pts: 114, w: 38, d: 0, l: 0, t: 'PERFECT' }
    })
    expect((await call(h, submitBody('chase.submit', g, u, inflated))).body).toMatchObject({ status: 'ranked', official: { points: g.quickResult!.points, claimMatched: false } })
    const other = played(b)
    const tampered = reencode(encodedOf(other), (c) => {
      c.p = [[null, null], [null, null], ...c.p]
    })
    const t = await call(h, submitBody('chase.submit', other, u, tampered))
    expect(t.status).toBe(422)
    expect(String(t.body.reason)).toMatch(/^Spin \d+/)
    h.clock.now = new Date(h.clock.now.getTime() + 49 * 3600000)
    expect((await call(h, submitBody('chase.submit', other, u))).body.code).toBe('closed')
  }, T)

  it('meters both routes per account and leaves the Daily untouched', async () => {
    const h = makeHarness(undefined, LIVE)
    h.limits.set(`chase.submit|${BOB.userId}`, 20)
    expect((await call(h, submitBody('chase.submit', honestDaily(), u), BOB)).status).toBe(429)
    h.limits.set(`chase.start|${BOB.userId}`, 12)
    expect((await start(h, BOB)).status).toBe(429)
    expect((await call(h, submitBody('daily.submit', honestDaily(), u), BOB)).body.status).toBe('ranked')
  }, T)
})

describe('account.delete', () => {
  it('needs the confirmation, then removes the caller\'s saves, revokes the sessions and deletes the user', async () => {
    const h = makeHarness(undefined, LIVE)
    h.saves.set(`${ALICE.userId}/season/1-0123456789abcdef.json.gz`, new Uint8Array([1]))
    h.saves.set(`${ALICE.userId}/quick/2-0123456789abcdef.json.gz`, new Uint8Array([2]))
    h.saves.set(`${BOB.userId}/season/3-0123456789abcdef.json.gz`, new Uint8Array([3]))
    expect((await call(h, { op: 'account.delete' })).status).toBe(400)
    expect(h.deleted).toEqual([])
    const r = await call(h, { op: 'account.delete', confirm: DELETE_CONFIRMATION })
    expect(r.body).toEqual({ status: 'deleted', objects: 2 })
    expect([...h.saves.keys()]).toEqual([`${BOB.userId}/season/3-0123456789abcdef.json.gz`])
    expect(h.signedOut).toEqual([ALICE.jwt])
    expect(h.deleted).toEqual([ALICE.userId])
  })
})

describe('logs and keys', () => {
  it('logs the op, the outcome and an 8-character user prefix, never a body or a token', async () => {
    const h = makeHarness(undefined, LIVE)
    await call(h, { op: 'status' })
    await call(h, '{"op":"daily.submit","encoded":"secret-payload","teamName":"A","shortName":"AB"}')
    const text = JSON.stringify(h.logs)
    expect(text).not.toContain(ALICE.userId)
    expect(text).not.toContain(ALICE.jwt)
    expect(text).not.toContain('secret-payload')
    expect(h.logs.at(-1)).toMatchObject({ op: 'daily.submit', status: 422, user: '11111111' })
  })

  it('maps boards to their database dates and windows', () => {
    expect(pinDateOf('daily', DATE)).toBe(DATE)
    expect(pinDateOf('weekly', WEEK)).toBe('2026-10-19')
    // a week runs Monday to Sunday, with posts open until 00:00 UTC on the Tuesday after
    expect(boardIsOpen('weekly', WEEK, new Date('2026-10-18T23:59:00Z'))).toBe(false)
    expect(boardIsOpen('weekly', WEEK, new Date('2026-10-19T00:00:00Z'))).toBe(true)
    expect(boardIsOpen('weekly', WEEK, new Date('2026-10-26T23:59:00Z'))).toBe(true)
    expect(boardIsOpen('weekly', WEEK, new Date('2026-10-27T00:00:00Z'))).toBe(false)
    expect(boardIsOpen('daily', '2026-10-24', new Date('2026-10-25T23:59:00Z'))).toBe(true)
    expect(boardIsOpen('daily', '2026-10-23', new Date('2026-10-25T00:00:00Z'))).toBe(false)
  })
})

describe('errors.report', () => {
  const report = (extra: Partial<ErrorReport> = {}): ErrorReport => ({
    kind: 'boundary', message: 'TypeError: x is undefined', stack: 'render /assets/Draft-abc.js:1:200', build: '2026-10-27T00:00:00.000Z', engine: ENGINE_VERSION,
    screen: 'game', phase: 'draft', viewport: '1280x720', ua: 'chrome/windows', device: '0f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f', count: 1, at: '2026-10-27T10:00:00.000Z', ...extra,
  })

  it('files a guest\'s reports as sent, with no account and no address, and reaches nothing else', async () => {
    const h = makeHarness(undefined, LIVE)
    const r = await call(h, { op: 'errors.report', reports: [report(), report({ kind: 'chunk', message: 'Failed to fetch dynamically imported module' })] }, VISITOR)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ status: 'ok', taken: 2 })
    expect(h.errorReports).toEqual([report(), report({ kind: 'chunk', message: 'Failed to fetch dynamically imported module' })])
    expect(JSON.stringify(h.errorReports)).not.toContain(VISITOR.subject)
    // A signed-in caller's reports carry no account id either; the work is metered per subject
    await call(h, { op: 'errors.report', reports: [report()] }, ALICE)
    expect(JSON.stringify(h.errorReports)).not.toContain(ALICE.userId)
    expect(h.limits.get(`errors.report|${VISITOR.subject}`)).toBe(1)
    expect(h.limits.get(`errors.report|${ALICE.userId}`)).toBe(1)
    // Fetched nothing from the site, archived nothing
    expect(h.site.served).toEqual([])
    // The log line names the op and no subject
    expect(h.logs[0]).toMatchObject({ op: 'errors.report', status: 200, user: 'guest' })
  })

  it('refuses a malformed, oversized or leaky batch before the database', async () => {
    const h = makeHarness(undefined, LIVE)
    for (const body of [
      { op: 'errors.report' },
      { op: 'errors.report', reports: [] },
      { op: 'errors.report', reports: Array.from({ length: 6 }, () => report()) },
      { op: 'errors.report', reports: [{ ...report(), userId: ALICE.userId }] },
      { op: 'errors.report', reports: [report({ message: 'no save for ana@example.com' })] },
      { op: 'errors.report', reports: [report({ stack: 'at https://touchline.quest/#c=AAAA' })] },
      { op: 'errors.report', reports: [report({ message: 'x'.repeat(301) })] },
      { op: 'errors.report', reports: [report({ device: 'my-phone' })] },
      { op: 'errors.report', reports: [report()], extra: 1 },
    ]) {
      const r = await call(h, body, VISITOR)
      expect(r.status, JSON.stringify(body).slice(0, 80)).toBe(400)
    }
    expect(h.errorReports).toEqual([])
  })

  it('meters each guest per hour', async () => {
    const h = makeHarness(undefined, LIVE)
    const limit = LIMITS['errors.report']
    for (let i = 0; i < limit; i++) expect((await call(h, { op: 'errors.report', reports: [report()] }, VISITOR)).status).toBe(200)
    const over = await call(h, { op: 'errors.report', reports: [report()] }, VISITOR)
    expect(over.status).toBe(429)
    expect(over.body.code).toBe('rate_limited')
    expect((await call(h, { op: 'errors.report', reports: [report()] }, VISITOR2)).status).toBe(200)
    expect(h.errorReports).toHaveLength(limit + 1)
  })

  it('still keeps a guest off everything but the rooms and the reports', async () => {
    const h = makeHarness(undefined, LIVE)
    for (const op of ['daily.pin', 'weekly.pin', 'chase.start', 'account.delete']) expect((await call(h, { op }, VISITOR)).status).toBeGreaterThanOrEqual(400)
    expect((await call(h, { op: 'daily.pin' }, VISITOR)).status).toBe(401)
  })
})
