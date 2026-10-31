import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft } from '@engine/draft'
import { decodeChallenge } from '@engine/challenge'
import type { Game } from '@game/types'
import { createGame } from '@game/logic/setup'
import { beginArena, simArenaToEnd } from '@game/logic/arena'
import { arenaAgainSettings, dailyArenaGameSettings } from '@game/logic/arenaDaily'
import { beginRunIn, seedRunInDraft } from '@game/logic/runin'
import { decodeRunIn, simRunIn, weeklyRunInPlan, weeklyRunInSettings } from '@game/logic/runinWeekly'
import { freshRecord } from '../localState'
import { captureCasualEntry, casualFinish, classify, closesAt, enqueue, flushOutbox } from '../outbox'
import { casualRowFrom, casualSummaryFrom, fetchCasualBoard, fetchCasualSummary, myCasualEntries } from '../boards'
import { devicePosts, postLabel } from '../postText'
import type { OnlineTransport } from '../transport'
import { FakeBackend, FakeTransport } from './fakeTransport'

const u = loadTestUniverse([...new Set(['england', weeklyRunInPlan('runin-2026-W44')!.leagueId])])

function arena(): { before: Game; after: Game } {
  const g = createGame(dailyArenaGameSettings(u, 'arena-2026-10-27'))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginArena(g, u)
  const before = structuredClone(g)
  simArenaToEnd(g, u)
  return { before, after: g }
}

function runIn(): { before: Game; after: Game } {
  const g = createGame(weeklyRunInSettings(u, 'runin-2026-W44')!)
  seedRunInDraft(g, u)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginRunIn(g, u)
  const before = structuredClone(g)
  simRunIn(g, u)
  g.phase = 'summary'
  return { before, after: g }
}

const A = arena()
const R = runIn()
const NOW = Date.UTC(2026, 9, 27, 12)

describe('casual capture and posting', { timeout: 60_000 }, () => {
  it('fires once, when the Daily Arena or the Run-in of the week this device was playing reaches its summary', () => {
    expect(A.after.phase).toBe('summary')
    expect(casualFinish({ game: A.before }, { game: A.after })?.id).toBe(A.after.id)
    expect(casualFinish({ game: R.before }, { game: R.after })?.id).toBe(R.after.id)
    expect(casualFinish({ game: A.after }, { game: { ...A.after } })).toBeNull()
    expect(casualFinish({ game: null }, { game: A.after })).toBeNull()
    // The day's puzzle played again as an ordinary run: off the board
    const again = { ...A.after, settings: arenaAgainSettings(A.after.settings, 'arena-2026-10-27') }
    expect(casualFinish({ game: { ...A.before, settings: again.settings } }, { game: again })).toBeNull()
  })

  it('files each run under its board and period, once per device', () => {
    const e = captureCasualEntry(A.after, u, 'Minh', new Date(NOW))!
    expect(e).toMatchObject({ kind: 'arena', key: '2026-10-27', teamName: 'Touchline XI', points: A.after.arena!.log.filter((s) => s.gf > s.ga || (s.pens && s.pens.us > s.pens.them)).length })
    expect(decodeChallenge(e.encoded).s.seed).toBe('arena-2026-10-27')
    expect(closesAt(e)).toBe(Date.UTC(2026, 9, 29))
    const r = captureCasualEntry(R.after, u, 'Minh', new Date(NOW))!
    expect(r).toMatchObject({ kind: 'runin', key: '2026-W44' })
    expect(decodeRunIn(r.encoded).seed).toBe('runin-2026-W44')
    expect(closesAt(r)).toBe(Date.UTC(2026, 10, 3))
    let rec = enqueue(freshRecord('device-test-casual'), e)
    rec = enqueue(rec, { ...e, id: 'again' })
    expect(rec.outbox).toHaveLength(1)
    expect(rec.posts['arena:2026-10-27']).toMatchObject({ state: 'waiting', reason: 'sign_in' })
    // A run managed by hand is never filed
    const hand = structuredClone(A.after)
    hand.arena!.handManaged = true
    expect(captureCasualEntry(hand, u, 'Minh', new Date(NOW))).toBeNull()
  })

  it('posts as casual.submit with its board, and reads the answer', async () => {
    const b = new FakeBackend()
    const seen: Array<Record<string, unknown>> = []
    b.fn = (body) => {
      seen.push(body)
      return { status: 200, body: { status: 'ranked', position: 3, total: 40, entry: { points: 9, detail: '9 rungs', trophy: false, claimMatched: true } } }
    }
    let rec = enqueue(freshRecord('device-test-casual2'), captureCasualEntry(A.after, u, 'Minh', new Date(NOW))!)
    rec = enqueue(rec, captureCasualEntry(R.after, u, 'Minh', new Date(NOW))!)
    rec = await flushOutbox(rec, { transport: new FakeTransport(b, 'user-a'), signedIn: true, now: () => NOW, random: () => 0 })
    expect(seen.map((x) => `${String(x.op)}:${String(x.board)}`)).toEqual(['casual.submit:arena', 'casual.submit:runin'])
    expect(rec.outbox).toEqual([])
    expect(rec.posts['arena:2026-10-27']).toMatchObject({ state: 'posted', position: 3, total: 40, detail: '9 rungs', trophy: false })
    // A run managed by hand that reached the server anyway is told why
    expect(classify(409, { code: 'hand_managed', reason: 'Managed by hand: only a Daily Arena run the assistant played ranks' }, 9)).toMatchObject({ kind: 'done', post: { state: 'unranked', code: 'hand_managed' } })
  })

  it('says which board a post was for on the Account screen', () => {
    expect(postLabel('arena:2026-10-27')).toBe('Daily Arena 2026-10-27')
    expect(postLabel('themed:2026-W44')).toBe('Weekly Challenge 2026-W44')
    expect(postLabel('runin:2026-W44')).toBe('Run-in of the week 2026-W44')
    const list = devicePosts({ 'arena:2026-10-27': { state: 'posted', position: 2, total: 9, points: 9, claimMatched: true, already: false, detail: '9 rungs' }, 'runin:2026-W44': { state: 'closed' }, 'daily:2026-10-20': { state: 'closed' } }, true)
    expect(list.map((p) => p.key)).toEqual(['arena:2026-10-27', 'runin:2026-W44', 'daily:2026-10-20'])
    expect(list[0].line).toBe('Posted 9 rungs: 2nd of 9.')
  })
})

describe('casual board readers', () => {
  const calls: Array<[string, Record<string, unknown>]> = []
  const t = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args])
      if (fn === 'casual_summary') return [{ played: '12', top_score: 15, trophies: 2, my_position: null, my_score: null, posts_open: true, revealed: false }]
      if (fn === 'casual_my_entries') return [{ board: 'runin', period_key: '2026-W44', board_position: 4, total: 20, score: 41, detail: 'SURVIVED', team_name: 'West Ham United', claim_matched: true }]
      return [{ board_position: 1, display_name: 'Erin', country: 'vn', team_name: 'Touchline XI', score: 15, won: 15, drawn: 0, lost: 0, goals_for: 40, goals_against: 9, goal_diff: 31, league_position: null, trophy: true, detail: 'Gauntlet complete', created_at: '2026-10-27T10:00:00Z', is_me: false, revealed: false, payload: null }]
    },
  } as unknown as OnlineTransport

  it('asks the database readers with the board and key, and parses their rows', async () => {
    const rows = await fetchCasualBoard(t, 'arena', '2026-10-27', 'gb')
    expect(calls[0]).toEqual(['casual_board', { p_board: 'arena', p_key: '2026-10-27', p_limit: 50, p_offset: 0, p_country: 'GB' }])
    expect(rows[0]).toMatchObject({ position: 1, name: 'Erin', country: 'VN', score: 15, leaguePosition: null, trophy: true, detail: 'Gauntlet complete' })
    expect(await fetchCasualSummary(t, 'themed', '2026-W44', null)).toEqual({ played: 12, top: 15, trophies: 2, myPosition: null, myScore: null, open: true, revealed: false })
    expect((await myCasualEntries(t))[0]).toMatchObject({ board: 'runin', key: '2026-W44', position: 4, score: 41 })
    // A key of the wrong shape never reaches the database
    const before = calls.length
    expect(await fetchCasualBoard(t, 'arena', '2026-W44', null)).toEqual([])
    expect(await fetchCasualBoard(t, 'runin', '2026-10-27', null)).toEqual([])
    expect(calls.length).toBe(before)
    expect(casualRowFrom({}).leaguePosition).toBeNull()
    expect(casualSummaryFrom(null).played).toBe(0)
  })
})

describe('a post that reaches a function older than the build', () => {
  it('waits for the function rather than filing the run as refused', () => {
    expect(classify(400, { code: 'bad_request', reason: 'Unknown operation' }, 9)).toEqual({ kind: 'retry' })
    expect(classify(400, { code: 'bad_request', reason: 'board is arena, themed or runin' }, 9)).toMatchObject({ kind: 'done', post: { state: 'rejected' } })
  })
})
