#!/usr/bin/env node
// Smoke the deployed Edge Function on the real project with two TEST accounts (never a player's account).
//
//   SMOKE_URL=https://yvqpmyqomkwtudxmkeou.supabase.co SMOKE_KEY=sb_publishable_... \
//   SMOKE_SITE=https://touchline.quest \
//   SMOKE_EMAIL_A=... SMOKE_PASSWORD_A=... SMOKE_EMAIL_B=... SMOKE_PASSWORD_B=... \
//   node scripts/online/smoke-function.mjs [--delete-b]
//
// It plays today's Daily and this week's challenge with the verifier bundle (built first) on the live site's packs,
// posts them as account A, and checks: the pin exists; an honest run is `ranked` and the board shows it under the
// display name without picks; the same again is `duplicate`; a tampered draft is 422 with a spin number; a changed
// formation is 409 puzzle_mismatch; a payload stamped engine 2 is 409. --delete-b ends with account.delete for B
// (its saves, sessions and user go). Only the publishable key is used; the accounts sign in with passwords.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BUNDLE, buildVerifier } from './build-verifier.mjs'

const env = (k) => {
  const v = process.env[k]
  if (!v) {
    console.error(`${k} is not set (see the header of this script)`)
    process.exit(1)
  }
  return v.replace(/\/+$/, '')
}
const URL_ = env('SMOKE_URL')
const KEY = env('SMOKE_KEY')
const SITE = env('SMOKE_SITE')
if (!URL_.includes('yvqpmyqomkwtudxmkeou')) {
  console.error('SMOKE_URL must be the TouchLine project (yvqpmyqomkwtudxmkeou)')
  process.exit(1)
}
await buildVerifier()
const V = await import(pathToFileURL(BUNDLE).href)
const FN = `touchline-e${V.ENGINE_VERSION}`
let failures = 0
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` ${detail}`}`)
  if (!ok) failures++
}

async function signIn(email, password) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
  const j = await r.json()
  if (!r.ok) throw new Error(`sign-in for ${email.replace(/(.).*@/, '$1***@')} failed: ${j.error_description ?? j.msg ?? r.status}`)
  return j.access_token
}
async function invoke(jwt, body) {
  const t0 = Date.now()
  const r = await fetch(`${URL_}/functions/v1/${FN}`, { method: 'POST', headers: { apikey: KEY, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, body: j, ms: Date.now() - t0 }
}
async function anonRpc(fn, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify(args) })
  return r.json()
}
const site = async (p) => {
  const r = await fetch(`${SITE}/${p}`)
  if (!r.ok) throw new Error(`${SITE}/${p} answered ${r.status}`)
  return r.json()
}

const jwtA = await signIn(env('SMOKE_EMAIL_A'), env('SMOKE_PASSWORD_A'))
const jwtB = await signIn(env('SMOKE_EMAIL_B'), env('SMOKE_PASSWORD_B'))
const status = await invoke(jwtA, { op: 'status' })
check(status.status === 200 && status.body.live, `status (live build ${JSON.stringify(status.body.live)})`, JSON.stringify(status.body))
const pin = await invoke(jwtA, { op: 'daily.pin' })
check(pin.status === 200, `daily.pin ${pin.body.pin?.seed ?? ''} on data ${pin.body.pin?.dataVersion ?? '?'} (${pin.ms} ms)`, JSON.stringify(pin.body))
if (pin.status !== 200) process.exit(1)

const index = await site('data/leagues.json')
const u = V.universeFromPacks(index, { england: { players: await site('data/england/players.json'), meta: await site('data/england/meta.json') } }, ['england'])
function played(settings) {
  const g = V.createGame(settings)
  const rng = V.Rng.fromState(g.rngState)
  V.autoDraft(u, g.draft, rng)
  g.rngState = rng.getState()
  V.runQuickSeason(g, u)
  return g
}
const bodyOf = (op, g, payload) => ({ op, encoded: V.encodeChallenge(payload ?? V.challengeFromGame(g, u, 'Smoke')), teamName: g.settings.teamName, shortName: g.settings.shortName })

for (const [kind, settings] of [['daily', V.dailyGameSettings(u, pin.body.pin.seed, 'Smoke FC')], ['weekly', V.weeklyGameSettings(u, V.weekKeyOf(new Date()), 'Smoke FC')]]) {
  const op = `${kind}.submit`
  const g = played(settings)
  const first = await invoke(jwtA, bodyOf(op, g))
  check(first.status === 200 && ['ranked', 'duplicate', 'already_submitted'].includes(first.body.status), `${op} honest: ${first.body.status} ${first.body.official?.points ?? ''} pts, position ${first.body.position}/${first.body.total} (${first.ms} ms)`, JSON.stringify(first.body))
  check(first.body.official?.points === g.quickResult.points || first.body.status === 'already_submitted', `${op} official points equal the local game's`)
  const again = await invoke(jwtA, bodyOf(op, g))
  check(['duplicate', 'already_submitted'].includes(again.body.status), `${op} retry: ${again.body.status} (${again.ms} ms)`)
  const c = V.decodeChallenge(V.encodeChallenge(V.challengeFromGame(g, u, 'Smoke')))
  const tampered = await invoke(jwtB, bodyOf(op, g, { ...c, p: [[null, null], [null, null], [null, null], ...c.p] }))
  check(tampered.status === 422 && /^Spin \d+/.test(tampered.body.reason ?? ''), `${op} tampered: ${tampered.status} ${tampered.body.reason ?? ''}`)
  const formation = await invoke(jwtB, bodyOf(op, g, { ...c, s: { ...c.s, f: c.s.f === '4-3-3' ? '4-4-2' : '4-3-3' } }))
  check(formation.status === 409 && formation.body.code === 'puzzle_mismatch', `${op} other formation: ${formation.status} ${formation.body.code}`)
  const engine = await invoke(jwtB, bodyOf(op, g, { ...c, engine: '2' }))
  check(engine.status === 409 && engine.body.code === 'engine_mismatch', `${op} engine 2: ${engine.status} ${engine.body.code}`)
}

const board = await anonRpc('daily_board', { p_date: pin.body.pin.key, p_limit: 50, p_offset: 0 })
check(Array.isArray(board) && board.length >= 1, `daily_board (signed out) lists ${Array.isArray(board) ? board.length : 0} rows`, JSON.stringify(board).slice(0, 200))
if (Array.isArray(board) && board[0]) check(board[0].display_name && board[0].payload == null && board[0].xi == null && !('user_id' in board[0]), 'the board shows display names, no picks, no user ids while posts are open')

if (process.argv.includes('--delete-b')) {
  const del = await invoke(jwtB, { op: 'account.delete', confirm: V.DELETE_CONFIRMATION })
  check(del.status === 200 && del.body.status === 'deleted', `account.delete for B: ${JSON.stringify(del.body)}`)
}
console.log(failures ? `${failures} check(s) FAILED` : `smoke passed against ${FN}`)
process.exit(failures ? 1 : 0)
