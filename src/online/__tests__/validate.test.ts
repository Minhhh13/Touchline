import { describe, expect, it } from 'vitest'
import { DELETE_CONFIRMATION, MAX_BODY_BYTES, OPS, isIsoDate, logId, parseBuildInfo, parseLeaguesIndex, parseRequest } from '../server/validate'

const reason = (text: string) => {
  const r = parseRequest(text)
  if (r.ok) throw new Error(`expected a refusal for ${text.slice(0, 60)}`)
  return r.reason
}

describe('parseRequest', () => {
  it('accepts every operation in its own shape', () => {
    expect(parseRequest('{"op":"status"}')).toEqual({ ok: true, value: { op: 'status' } })
    expect(parseRequest('{"op":"daily.pin"}')).toEqual({ ok: true, value: { op: 'daily.pin' } })
    expect(parseRequest('{"op":"daily.pin","date":"2026-10-25"}')).toEqual({ ok: true, value: { op: 'daily.pin', date: '2026-10-25' } })
    expect(parseRequest('{"op":"weekly.pin","week":"2026-W43"}')).toEqual({ ok: true, value: { op: 'weekly.pin', week: '2026-W43' } })
    for (const op of ['daily.submit', 'weekly.submit']) {
      expect(parseRequest(JSON.stringify({ op, encoded: 'abc', teamName: 'Verified FC', shortName: 'VFC' }))).toEqual({ ok: true, value: { op, encoded: 'abc', teamName: 'Verified FC', shortName: 'VFC' } })
    }
    expect(parseRequest(JSON.stringify({ op: 'account.delete', confirm: DELETE_CONFIRMATION }))).toEqual({ ok: true, value: { op: 'account.delete', confirm: DELETE_CONFIRMATION } })
    expect(OPS).toEqual(['status', 'daily.pin', 'daily.submit', 'weekly.pin', 'weekly.submit', 'account.delete'])
  })

  it('refuses every malformed body with a reason', () => {
    expect(reason('')).toMatch(/no body/)
    expect(reason(' '.repeat(MAX_BODY_BYTES + 1))).toMatch(/larger than/)
    // the limit is in UTF-8 bytes, not characters
    expect(reason(JSON.stringify({ op: 'status', pad: 'é'.repeat(MAX_BODY_BYTES / 2) }))).toMatch(/larger than/)
    expect(reason('{op:status}')).toMatch(/not JSON/)
    expect(reason('[1]')).toMatch(/not an object/)
    expect(reason('null')).toMatch(/not an object/)
    expect(reason('{"op":"h2h.create"}')).toMatch(/Unknown operation/)
    expect(reason('{"op":7}')).toMatch(/Unknown operation/)
    expect(reason('{"op":"status","userId":"x"}')).toMatch(/Unexpected field userId/)
    expect(reason('{"op":"daily.submit","encoded":"a","teamName":"A","shortName":"AB","user":"x"}')).toMatch(/Unexpected field user/)
    expect(reason('{"op":"daily.pin","date":"2026-13-01"}')).toMatch(/YYYY-MM-DD/)
    expect(reason('{"op":"daily.pin","date":20261025}')).toMatch(/YYYY-MM-DD/)
    expect(reason('{"op":"weekly.pin","week":"2026-W54"}')).toMatch(/ISO week/)
    expect(reason('{"op":"daily.submit","teamName":"A","shortName":"AB"}')).toMatch(/encoded/)
    expect(reason('{"op":"daily.submit","encoded":"","teamName":"A","shortName":"AB"}')).toMatch(/encoded/)
    expect(reason(JSON.stringify({ op: 'daily.submit', encoded: 'x'.repeat(8101), teamName: 'A', shortName: 'AB' }))).toMatch(/encoded/)
    expect(reason('{"op":"daily.submit","encoded":"a","teamName":5,"shortName":"AB"}')).toMatch(/teamName/)
    expect(reason(JSON.stringify({ op: 'daily.submit', encoded: 'a', teamName: 'x'.repeat(65), shortName: 'AB' }))).toMatch(/teamName/)
    expect(reason('{"op":"daily.submit","encoded":"a","teamName":"A","shortName":null}')).toMatch(/shortName/)
    expect(reason('{"op":"account.delete"}')).toMatch(/confirm/)
    expect(reason('{"op":"account.delete","confirm":true}')).toMatch(/confirm/)
  })

  it('knows a calendar date', () => {
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(isIsoDate('2026-1-01')).toBe(false)
  })
})

describe('parseBuildInfo', () => {
  it('accepts the live build.json and nothing else', () => {
    expect(parseBuildInfo({ engine: '4', data: '2026-10-25', builtAt: '2026-10-25T00:05:00.000Z' })).toEqual({ engine: '4', data: '2026-10-25', builtAt: '2026-10-25T00:05:00.000Z' })
    expect(parseBuildInfo(null)).toBeNull()
    expect(parseBuildInfo([])).toBeNull()
    expect(parseBuildInfo({ engine: 4, data: '2026-10-25', builtAt: 'x' })).toBeNull()
    expect(parseBuildInfo({ engine: '4', data: '../../etc', builtAt: 'x' })).toBeNull()
    expect(parseBuildInfo({ engine: '4', data: 'x'.repeat(41), builtAt: 'x' })).toBeNull()
    expect(parseBuildInfo({ engine: '4', data: '2026-10-25' })).toBeNull()
  })
})

describe('parseLeaguesIndex', () => {
  const index = { version: 2, generatedAt: '2026-10-25', leagues: [{ id: 'england' }, { id: 'spain' }] }
  it('accepts an index stamped with the expected version', () => {
    expect(parseLeaguesIndex(index, '2026-10-25').ok).toBe(true)
  })
  it('refuses another stamp, no leagues, duplicates and odd ids', () => {
    expect(parseLeaguesIndex(index, '2026-10-24')).toMatchObject({ ok: false })
    expect(parseLeaguesIndex({ ...index, leagues: [] }, '2026-10-25')).toMatchObject({ ok: false })
    expect(parseLeaguesIndex({ ...index, leagues: [{ id: 'england' }, { id: 'england' }] }, '2026-10-25')).toMatchObject({ ok: false })
    expect(parseLeaguesIndex({ ...index, leagues: [{ id: '../x' }] }, '2026-10-25')).toMatchObject({ ok: false })
    expect(parseLeaguesIndex('x', '2026-10-25')).toMatchObject({ ok: false })
  })
})

describe('logId', () => {
  it('keeps only the first 8 hex characters of a user id', () => {
    expect(logId('11111111-1111-4111-8111-111111111111')).toBe('11111111')
    expect(logId('ab-cd')).toBe('abcd')
  })
})
