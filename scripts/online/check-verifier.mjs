#!/usr/bin/env node
// Check the verifier bundle the Edge Function runs, on its own, in Node: build it (unless --no-build), load it,
// and drive its createServer through a whole Phase 1 day with in-memory stand-ins for the database, Storage and the
// live site (public/data from disk): pin today's Daily, post an honest Auto-complete run, a retry and a tampered
// copy, then pin and post the weekly challenge. The bundle must rank the honest runs with the figures the game
// itself produced (and that replayChallenge reproduces), refuse the tampered one with a spin number, and never
// name a DOM or Node global. `npm run check:verifier`; CI runs it after `build:verifier`.
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
const deps = {
  now: () => NOW,
  log: () => {},
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
    dataPack: async (v) => packs.get(v) ?? null,
    registerDataPack: async (version, leagues, files) => {
      if (!packs.has(version)) packs.set(version, { version, leagues, files, firstSeenAt: NOW.toISOString() })
      return { status: 'ok', pack: packs.get(version) }
    },
  },
}
const server = V.createServer(deps)
const caller = { userId: '11111111-1111-4111-8111-111111111111', isAnonymous: false, jwt: 'jwt' }
const call = (body) => server.handle(caller, JSON.stringify(body))

// The universe the bundle itself builds, for playing the honest runs
const england = { players: JSON.parse(readFileSync(path.join(DATA, 'england/players.json'), 'utf8')), meta: JSON.parse(readFileSync(path.join(DATA, 'england/meta.json'), 'utf8')) }
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
console.log(`check:verifier OK: engine ${V.ENGINE_VERSION}, data ${index.generatedAt}, ${(Buffer.byteLength(code) / 1024).toFixed(0)} KB; Daily ${day} ranked ${dailyPts} pts, weekly ${week} ranked ${weeklyPts} pts, tampered drafts refused`)
