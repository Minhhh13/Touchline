#!/usr/bin/env node
// Check the verifier bundle the Edge Function runs, on its own, in Node: build it (unless --no-build), load it,
// and drive its createServer through a whole Phase 1 day with in-memory stand-ins for the database, Storage and the
// live site (public/data from disk): pin today's Daily, post an honest Auto-complete run, a retry and a tampered
// copy, then pin and post the weekly challenge, then issue a 38-0 chase attempt and post a run on it. The bundle must rank the honest runs with the figures the game
// itself produced (and that replayChallenge reproduces), refuse the tampered one with a spin number, and never
// name a DOM or Node global. Then an online head-to-head room (Phase 2) between two guests: made, joined and drafted
// pick by pick to the season, which must equal the same game played hot-seat on the seed the finished room reveals.
// `npm run check:verifier`; CI runs it after `build:verifier`.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BUNDLE, buildVerifier, forbiddenIn } from './build-verifier.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DATA = path.join(root, 'public', 'data')
const NOW = new Date(process.env.CHECK_NOW ?? '2026-10-25T12:00:00Z')

function fail(msg) {
  console.error(`check:verifier FAILED: ${msg}`)
  process.exit(1)
}
const expect = (cond, msg) => cond || fail(msg)

if (!process.argv.includes('--no-build')) await buildVerifier()
const code = readFileSync(BUNDLE, 'utf8')
expect(forbiddenIn(code).length === 0, `the bundle uses ${forbiddenIn(code).join(', ')}`)
const V = await import(pathToFileURL(BUNDLE).href)

const index = JSON.parse(readFileSync(path.join(DATA, 'leagues.json'), 'utf8'))
const live = { engine: V.ENGINE_VERSION, data: index.generatedAt, builtAt: NOW.toISOString() }
const enc = new TextEncoder()
const pins = new Map()
const packs = new Map()
const entries = new Map()
const archive = new Map()
// The rooms' stand-in: the SQL's contract in short (src/online/__tests__/serverHarness.ts has the full one)
const rooms = new Map()
let roomN = 0
let tokenN = 0
const view = (r) => structuredClone({ code: r.code, status: r.status, settings: r.settings, managers: r.managers, events: r.events, version: r.version, turn: r.status === 'drafting' ? r.turn : null, result: r.result, seed: r.status === 'finished' ? r.seed : null, engineVersion: r.engine, dataVersion: r.data, createdAt: NOW.toISOString(), expiresAt: NOW.toISOString(), idleAt: null, endedAt: null })
const roomDb = {
  roomCreate: async (settings, manager, seatHash, userId, engine, data) => {
    const n = ++roomN
    const r = { code: `CHECK${'ABCDEFGH'[n % 8]}${'JKLMNPQR'[n % 8]}2`, seed: `room-CHECKROOM${'ABCDEFGH'[n % 8]}${'JKLMNPQR'[n % 8]}2`, settings, managers: [manager, null], seat0Hash: seatHash, seat1Hash: null, events: [], turn: null, result: null, status: 'waiting', version: 0, engine, data }
    rooms.set(r.code, r)
    return { status: 'ok', room: view(r) }
  },
  roomGet: async (code) => {
    const r = rooms.get(code)
    return r ? { room: view(r), seed: r.seed, seat0Hash: r.seat0Hash, seat1Hash: r.seat1Hash, seat0User: null, seat1User: null } : null
  },
  roomJoin: async (code, manager, seatHash, userId, events, turn, expect) => {
    const r = rooms.get(code)
    if (!r || r.status !== 'waiting' || r.version !== expect) return { status: 'conflict' }
    Object.assign(r, { managers: [r.managers[0], manager], seat1Hash: seatHash, events, turn, status: 'drafting', version: r.version + 1 })
    return { status: 'ok', room: view(r) }
  },
  roomMove: async (code, seat, seatHash, expect, events, turn, result) => {
    const r = rooms.get(code)
    if (!r || seatHash !== (seat === 0 ? r.seat0Hash : r.seat1Hash)) return { status: 'not_seated' }
    if (r.status !== 'drafting' || r.turn !== seat || r.version !== expect) return { status: 'conflict' }
    Object.assign(r, { events: [...r.events, ...events], turn: result ? null : turn, result, status: result ? 'finished' : 'drafting', version: r.version + 1 })
    return { status: 'ok', room: view(r) }
  },
  roomLeave: async () => ({ status: 'bad' }),
  roomReseat: async () => ({ status: 'bad' }),
  errorReport: async (reports) => {
    errorRows.push(...reports)
    return reports.length
  },
}
const errorRows = []
const attempts = new Map()
const chaseEntries = new Map()
const deps = {
  now: () => NOW,
  log: () => {},
  randomToken: () => `check${String(++tokenN).padStart(38, '0')}`,
  sha256Hex: async (b) => createHash('sha256').update(b).digest('hex'),
  fetchSite: async (p) => {
    if (p === 'build.json') return enc.encode(JSON.stringify(live))
    try {
      return p.startsWith('data/') ? new Uint8Array(readFileSync(path.join(DATA, p.slice(5)))) : null
    } catch {
      return null
    }
  },
  storage: {
    getPack: async (p) => archive.get(p) ?? null,
    putPack: async (p, b) => void (archive.has(p) || archive.set(p, b)),
    listSaves: async () => [],
    removeSaves: async () => {},
  },
  auth: { signOutEverywhere: async () => {}, deleteUser: async () => {} },
  db: {
    rateLimit: async () => true,
    getPin: async (kind, date) => pins.get(`${kind}|${date}`) ?? null,
    pin: async (kind, date, settings, hash, engine, data) => {
      const k = `${kind}|${date}`
      if (!pins.has(k)) pins.set(k, { kind, key: kind === 'daily' ? date : settings.seed.slice(7), seed: settings.seed, settings, settingsHash: hash, engineVersion: engine, dataVersion: data, createdAt: NOW.toISOString() })
      return pins.get(k)
    },
    submit: async (kind, uid, date, entry) => {
      const k = `${kind}|${date}|${uid}`
      const prior = entries.get(k)
      if (prior) return { status: prior.draft_fingerprint === entry.draft_fingerprint ? 'duplicate' : 'already_submitted' }
      entries.set(k, entry)
      return { status: 'ranked', position: 1, total: 1 }
    },
    chaseStart: async (uid, leagueId, formationId, options, engine, data) => {
      const code = 'CHECKRUN' + String(attempts.size + 2).padStart(2, '2')
      const attempt = { code, seed: `chase-${code}`, leagueId, formationId, ratings: options.ratings, benchPicks: options.benchPicks, engineVersion: engine, dataVersion: data, createdAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 48 * 3600000).toISOString(), submittedAt: null }
      attempts.set(code, { ...attempt, uid })
      return { status: 'ok', left: 4, cap: 5, attempt }
    },
    chaseAttempt: async (uid, code) => {
      const a = attempts.get(code)
      if (!a || a.uid !== uid) return null
      const { uid: _u, ...attempt } = a
      return attempt
    },
    chaseSubmit: async (uid, code, entry) => {
      const prior = chaseEntries.get(code)
      if (prior) return { status: prior.draft_fingerprint === entry.draft_fingerprint ? 'duplicate' : 'already_submitted' }
      chaseEntries.set(code, entry)
      return { status: 'ranked', position: 1, total: 1 }
    },
    dataPack: async (v) => packs.get(v) ?? null,
    registerDataPack: async (version, leagues, files) => {
      if (!packs.has(version)) packs.set(version, { version, leagues, files, firstSeenAt: NOW.toISOString() })
      return { status: 'ok', pack: packs.get(version) }
    },
    ...roomDb,
  },
}
const server = V.createServer(deps)
const caller = { userId: '11111111-1111-4111-8111-111111111111', isAnonymous: false, jwt: 'jwt' }
const call = (body) => server.handle(caller, JSON.stringify(body))

// The universe the bundle itself builds, for playing the honest runs
// As the browser loads England: with its classic pack when the index gives it one
const england = { players: JSON.parse(readFileSync(path.join(DATA, 'england/players.json'), 'utf8')), meta: JSON.parse(readFileSync(path.join(DATA, 'england/meta.json'), 'utf8')), ...(V.hasClassic(index, 'england') ? { classic: JSON.parse(readFileSync(path.join(DATA, V.classicFile('england')), 'utf8')) } : {}) }
const u = V.universeFromPacks(index, { england }, ['england'])
expect(u.generatedAt === index.generatedAt, 'the bundle built a universe with another stamp')

function autoPlayed(settings) {
  const g = V.createGame(settings)
  const rng = V.Rng.fromState(g.rngState)
  V.autoDraft(u, g.draft, rng)
  g.rngState = rng.getState()
  V.runQuickSeason(g, u)
  return g
}

async function rankedRun(kind, settings, key) {
  const op = `${kind}.submit`
  const g = autoPlayed(settings)
  const payload = V.challengeFromGame(g, u, 'Check')
  const encoded = V.encodeChallenge(payload)
  const body = { op, encoded, teamName: g.settings.teamName, shortName: g.settings.shortName }
  const r = await call(body)
  expect(r.status === 200 && r.body.status === 'ranked', `${op}: expected ranked, got ${r.status} ${JSON.stringify(r.body)}`)
  const q = g.quickResult
  const o = r.body.official
  expect(o.points === q.points && o.won === q.won && o.drawn === q.drawn && o.lost === q.lost && o.tier === q.tier && o.claimMatched === true, `${op}: the official figures differ from the game's own`)
  const replay = V.replayChallenge(u, V.decodeChallenge(encoded))
  expect(replay.result && replay.result.pts === q.points && replay.result.t === q.tier, `${op}: replayChallenge disagrees with the verifier`)
  expect(r.body.key === key, `${op}: filed under ${r.body.key}, not ${key}`)
  const again = await call(body)
  expect(again.body.status === 'duplicate', `${op}: a retry was ${again.body.status}`)
  const tampered = V.decodeChallenge(encoded)
  // One null row more than the puzzle's re-spins allow, still within the row cap, so the replay itself finds it
  tampered.p = [...Array.from({ length: settings.rules.respins + 1 }, () => [null, null]), ...tampered.p]
  const t = await server.handle({ ...caller, userId: '22222222-2222-4222-8222-222222222222' }, JSON.stringify({ ...body, encoded: V.encodeChallenge(tampered) }))
  expect(t.status === 422 && /^Spin \d+/.test(t.body.reason), `${op}: a tampered draft was not refused with a spin number (${JSON.stringify(t.body)})`)
  return q.points
}

const day = NOW.toISOString().slice(0, 10)
const week = V.weekKeyOf(NOW)
const pin = await call({ op: 'daily.pin' })
expect(pin.status === 200, `daily.pin answered ${pin.status} ${JSON.stringify(pin.body)}`)
expect(pin.body.pin.settingsHash === V.settingsHash(V.dailyGameSettings(u, `daily-${day}`)), 'the pinned Daily is not the Daily mapping')
const dailyPts = await rankedRun('daily', V.dailyGameSettings(u, `daily-${day}`, 'Check FC'), day)
const weeklyPts = await rankedRun('weekly', V.weeklyGameSettings(u, week, 'Check FC'), week)
// The 38-0 chase: an attempt issued on the live data, a run on its wheel ranked on the replay, another account refused
const start = await call({ op: 'chase.start', leagueId: 'england', formationId: '4-3-3', ratings: 'prime', benchPicks: 1, engine: V.ENGINE_VERSION, data: index.generatedAt })
expect(start.status === 200 && start.body.attempt, `chase.start answered ${start.status} ${JSON.stringify(start.body)}`)
const chaseSettings = V.chaseGameSettings(u, start.body.attempt.code, 'england', '4-3-3', 'Check FC', { ratings: 'prime', benchPicks: 1 })
expect(chaseSettings && chaseSettings.seed === start.body.attempt.seed, 'the chase mapping gave no settings for the issued attempt')
const chaseGame = autoPlayed(chaseSettings)
const chaseBody = { op: 'chase.submit', encoded: V.encodeChallenge(V.challengeFromGame(chaseGame, u, 'Check')), teamName: chaseGame.settings.teamName, shortName: chaseGame.settings.shortName }
const chased = await call(chaseBody)
const cq = chaseGame.quickResult
expect(chased.status === 200 && chased.body.status === 'ranked' && chased.body.official.points === cq.points && chased.body.official.won === cq.won && chased.body.official.claimMatched === true, `chase.submit: expected ranked on the game's own figures, got ${chased.status} ${JSON.stringify(chased.body)}`)
const stranger = await server.handle({ ...caller, userId: '22222222-2222-4222-8222-222222222222' }, JSON.stringify(chaseBody))
expect(stranger.status === 409 && stranger.body.code === 'no_attempt', `chase.submit: another account's post was not refused (${JSON.stringify(stranger.body)})`)

// An online room between two guests (the publishable key, no account), played to the season through the bundle
const guests = [{ guest: true, subject: await V.guestSubject('192.0.2.1', deps.sha256Hex) }, { guest: true, subject: await V.guestSubject('192.0.2.2', deps.sha256Hex) }]
const asGuest = (i, body) => server.handle(guests[i], JSON.stringify(body))
const refused = await asGuest(0, { op: 'daily.pin' })
expect(refused.status === 401, `a guest reached daily.pin (${refused.status})`)
const roomSettings = { leagueId: 'england', wheelLeagues: ['england'], leagueSeason: Math.max(...V.roomSeasons(u, 'england')), difficulty: 'calibrated', hardMode: false }
const roomClubs = V.roomClubs(u, roomSettings)
const made = await asGuest(0, { op: 'room.create', settings: roomSettings, manager: { name: 'Check A', formationId: '4-3-3', hostClubId: roomClubs[0] }, engine: V.ENGINE_VERSION, data: index.generatedAt })
expect(made.status === 200 && made.body.seat === 0, `room.create answered ${made.status} ${JSON.stringify(made.body)}`)
const joined = await asGuest(1, { op: 'room.join', code: made.body.room.code, manager: { name: 'Check B', formationId: '4-4-2', hostClubId: roomClubs[4] }, engine: V.ENGINE_VERSION, data: index.generatedAt })
expect(joined.status === 200 && joined.body.seat === 1, `room.join answered ${joined.status} ${JSON.stringify(joined.body)}`)
const tokens = [made.body.token, joined.body.token]
let room = joined.body.room
let picks = 0
while (room.status === 'drafting' && picks < 60) {
  const h = V.draftFromEvents(u, room.settings, room.managers, room.events)
  const seat = h.picking
  const copy = structuredClone(h)
  V.h2hAutoPick(u, copy)
  const slot = Object.keys(copy.drafts[seat].lineup).find((k) => !h.drafts[seat].lineup[k])
  const pick = slot ? { p: copy.drafts[seat].lineup[slot], k: slot } : { p: copy.drafts[seat].bench.at(-1), k: 'bench' }
  if (picks === 0) {
    const wrong = await asGuest(seat === 0 ? 1 : 0, { op: 'room.pick', code: room.code, token: tokens[seat === 0 ? 1 : 0], version: room.version, playerSeasonId: pick.p, slotId: pick.k })
    expect(wrong.status === 409 && wrong.body.code === 'not_your_turn', `a pick out of turn was not refused (${JSON.stringify(wrong.body)})`)
  }
  const r = await asGuest(seat, { op: 'room.pick', code: room.code, token: tokens[seat], version: room.version, playerSeasonId: pick.p, slotId: pick.k })
  expect(r.status === 200, `room.pick answered ${r.status} ${JSON.stringify(r.body)}`)
  room = r.body.room
  picks++
}
expect(room.status === 'finished' && /^room-/.test(room.seed ?? ''), `the room did not finish (${room.status})`)
// The same game hot-seat, on the revealed seed
const hot = V.newH2HDraft([V.getFormation(room.managers[0].formationId), V.getFormation(room.managers[1].formationId)], V.h2hRules(room.settings.wheelLeagues, room.settings.hardMode))
const rng = new V.Rng(room.seed)
while (!V.h2hComplete(hot)) {
  if (hot.picking === null) V.h2hSpin(u, hot, rng)
  else V.h2hAutoPick(u, hot)
}
const season = V.runH2HSeason(u, rng, room.managers, hot.drafts, room.settings.leagueId, room.settings.leagueSeason, room.settings.difficulty)
expect(JSON.stringify(season) === JSON.stringify(room.result), 'the room\'s season differs from the same game played hot-seat')
// A guest's error report goes in as sent; one holding an email is refused before the database
const report = { kind: 'error', message: 'TypeError: x is undefined', stack: 'render /assets/Draft-abc.js:1:200', build: '2026-10-27T00:00:00.000Z', engine: V.ENGINE_VERSION, screen: 'game', phase: 'draft', viewport: '390x844', ua: 'safari/ios', device: '0f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f', count: 1, at: '2026-10-27T10:00:00.000Z' }
const filed = await asGuest(0, { op: 'errors.report', reports: [report] })
expect(filed.status === 200 && filed.body.taken === 1 && errorRows.length === 1, `errors.report answered ${filed.status} ${JSON.stringify(filed.body)}`)
const leaky = await asGuest(0, { op: 'errors.report', reports: [{ ...report, message: 'failed for someone@example.com' }] })
expect(leaky.status === 400 && errorRows.length === 1, `an error report with an email was filed (${leaky.status})`)
console.log(`check:verifier OK: engine ${V.ENGINE_VERSION}, data ${index.generatedAt}, ${(Buffer.byteLength(code) / 1024).toFixed(0)} KB; Daily ${day} ranked ${dailyPts} pts, weekly ${week} ranked ${weeklyPts} pts, 38-0 chase ranked ${cq.won}-${cq.drawn}-${cq.lost}, tampered drafts refused; a guests' room drafted in ${picks} picks to ${room.result.positions.map((p) => `#${p}`).join(' v ')}, equal to the hot-seat game; a guest's error report filed`)
