import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft } from '@engine/draft'
import { decodeChallenge } from '@engine/challenge'
import { createGame, dailyGameSettings } from '@game/logic/setup'
import { runQuickSeason } from '@game/logic/quick'
import { challengeFromGame } from '@game/logic/challenge'
import { createShortLink, resolveShortCode } from '../challengeLinks'
import { boardDate, boardRowFrom, fetchAlltime, fetchBoard, fetchSummary, summaryFrom } from '../boards'
import { normaliseError, OnlineError, pinFromRow } from '../transport'
import { FakeBackend, FakeTransport } from './fakeTransport'

const u = loadTestUniverse()
const g = createGame({ ...dailyGameSettings(u, 'daily-2026-10-25'), mode: 'quick', seed: 'LINK-TEST' })
const rng = Rng.fromState(g.rngState)
autoDraft(u, g.draft!, rng)
g.rngState = rng.getState()
runQuickSeason(g, u)
const payload = challengeFromGame(g, u, 'Minh')!
const ORIGIN = 'https://touchline.quest'

describe('challenge short links', () => {
  it('mints one code per payload and owner, and the link opens signed out with the same payload', async () => {
    const b = new FakeBackend()
    const t = new FakeTransport(b, 'user-a')
    const a = await createShortLink(t, true, payload, ORIGIN, '/')
    expect(a.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect(a.url).toBe(`${ORIGIN}/#s=${a.code!.replace('-', '')}`)
    expect(a.fallback).toBeNull()
    expect(a.longUrl).toMatch(/#c=/)
    expect((await createShortLink(t, true, payload, ORIGIN, '/')).code).toBe(a.code)
    const opened = await resolveShortCode(new FakeTransport(b, null), a.code!.toLowerCase())
    expect(opened.ok).toBe(true)
    if (opened.ok) expect(decodeChallenge(opened.encoded)).toEqual(decodeChallenge(a.longUrl.split('#c=')[1]))
  })

  it('falls back to the long link when signed out, offline, rate limited or not configured', async () => {
    const b = new FakeBackend()
    const t = new FakeTransport(b, 'user-a')
    expect((await createShortLink(null, true, payload, ORIGIN, '/')).fallback).toBe('not_configured')
    expect((await createShortLink(t, false, payload, ORIGIN, '/')).fallback).toBe('signed_out')
    expect((await createShortLink(t, true, payload, ORIGIN, '/', false)).fallback).toBe('offline')
    b.failNext.push(new OnlineError('rate', 'too many short links today', 'PT429', 429))
    const r = await createShortLink(t, true, payload, ORIGIN, '/')
    expect(r).toMatchObject({ fallback: 'rate', code: null })
    expect(r.url).toBe(r.longUrl)
    b.failNext.push(new OnlineError('network', 'Failed to fetch'))
    expect((await createShortLink(t, true, payload, ORIGIN, '/')).fallback).toBe('offline')
  })

  it('says why a code does not open', async () => {
    const b = new FakeBackend()
    expect(await resolveShortCode(new FakeTransport(b, null), 'K7Q2-MXAA')).toMatchObject({ ok: false, message: expect.stringMatching(/No challenge/) })
    expect(await resolveShortCode(new FakeTransport(b, null), 'IIII-OOOO')).toMatchObject({ ok: false, message: 'That is not a challenge code.' })
    expect(await resolveShortCode(null, 'K7Q2-MXAA')).toMatchObject({ ok: false })
    b.failNext.push(new OnlineError('network', 'offline'))
    expect(await resolveShortCode(new FakeTransport(b, null), 'K7Q2-MXAA')).toMatchObject({ ok: false, message: expect.stringMatching(/connection/) })
  })
})

describe('boards and transport parsing', () => {
  it('passes the board date (the Daily, or the Monday of the week) and the country', async () => {
    const b = new FakeBackend()
    const t = new FakeTransport(b, null)
    const seen: Array<[string, Record<string, unknown>]> = []
    t.rpc = async <T,>(fn: string, args: Record<string, unknown>) => {
      seen.push([fn, args])
      return [] as T
    }
    await fetchBoard(t, 'daily', '2026-10-25', 'vn')
    await fetchBoard(t, 'weekly', '2026-W43', null, 50)
    await fetchSummary(t, 'weekly', '2026-W43', 'GB')
    await fetchAlltime(t, 'streak', 'gb')
    expect(seen).toEqual([
      ['daily_board', { p_date: '2026-10-25', p_limit: 50, p_offset: 0, p_country: 'VN' }],
      ['weekly_board', { p_week: '2026-10-19', p_limit: 50, p_offset: 50, p_country: null }],
      ['weekly_summary', { p_week: '2026-10-19', p_country: 'GB' }],
      ['daily_alltime_board', { p_order: 'streak', p_country: 'GB', p_limit: 50, p_offset: 0 }],
    ])
    expect(boardDate('weekly', '2026-W99')).toBeNull()
  })

  it('reads board rows and summaries, payloads only when revealed', () => {
    const r = boardRowFrom({ board_position: '3', display_name: 'Minh', country: 'VN', team_name: 'Hanoi XI', points: 71, won: 21, drawn: 8, lost: 9, goals_for: 60, goals_against: 40, goal_diff: 20, league_position: 4, tier: 'EUROPEAN', created_at: 'x', is_me: true, revealed: false, payload: null })
    expect(r).toMatchObject({ position: 3, country: 'VN', isMe: true, payload: null, goalDiff: 20 })
    expect(summaryFrom([{ played: 1204, top_points: 89, my_position: 37, my_points: 71, posts_open: true, revealed: false }])).toEqual({ played: 1204, top: 89, myPosition: 37, myPoints: 71, open: true, revealed: false })
    expect(summaryFrom([])).toMatchObject({ played: 0, myPosition: null })
  })

  it('normalises PostgREST errors by code and status, and reads pins', () => {
    expect(normaliseError({ code: 'PT429', message: 'x' }).kind).toBe('rate')
    expect(normaliseError({ code: 'PT401', message: 'x' }).kind).toBe('auth')
    expect(normaliseError({ code: 'PT403', message: 'x' }).kind).toBe('guest')
    expect(normaliseError({ code: '23505', message: 'dup' }).kind).toBe('taken')
    expect(normaliseError({ code: '22023', message: 'bad' }).kind).toBe('bad')
    expect(normaliseError({ code: '', message: 'TypeError: Failed to fetch' }).kind).toBe('network')
    expect(normaliseError({ message: 'x' }, 503).kind).toBe('unavailable')
    const pin = pinFromRow('daily', { puzzle_date: '2026-10-25', seed: 'daily-2026-10-25', settings: { mode: 'daily' }, settings_hash: 'abc', engine_version: '4', data_version: '2026-10-24', created_at: 'x' })
    expect(pin).toEqual({ kind: 'daily', key: '2026-10-25', seed: 'daily-2026-10-25', settings: { mode: 'daily' }, settingsHash: 'abc', engineVersion: '4', dataVersion: '2026-10-24' })
    expect(pinFromRow('weekly', null)).toBeNull()
  })
})
