import { describe, expect, it } from 'vitest'
import { capRecord, freshRecord, parseRecord } from '../localState'

describe('the device record (touchline-online-v1)', () => {
  it('reads a fresh record from nothing, junk or another version', () => {
    for (const text of [null, '', 'not json', '{"v":2,"deviceId":"device-12345678"}', '{"v":1,"deviceId":"x"}']) {
      const r = parseRecord(text)
      expect(r.v).toBe(1)
      expect(r.userId).toBeNull()
      expect(r.outbox).toEqual([])
    }
  })

  it('keeps the device id and fills fields added later', () => {
    const r = parseRecord(JSON.stringify({ v: 1, deviceId: 'device-12345678', userId: 'u1', slots: { season: { gameId: 'g', revision: 2, hash: 'h', progress: [1] } } }))
    expect(r).toMatchObject({ deviceId: 'device-12345678', userId: 'u1', localOnly: [], captured: [], profileLocalOnly: false, claims: 0 })
    expect(r.slots.season?.revision).toBe(2)
  })

  it('caps the lists that grow', () => {
    const r = freshRecord('device-12345678')
    for (let i = 0; i < 100; i++) {
      r.posts[`daily:2026-01-${String(i).padStart(3, '0')}`] = { state: 'closed' }
      r.captured.push(`k${i}`)
    }
    const c = capRecord(r)
    expect(Object.keys(c.posts)).toHaveLength(60)
    expect(c.captured).toHaveLength(60)
    expect(c.captured.at(-1)).toBe('k99')
  })
})
