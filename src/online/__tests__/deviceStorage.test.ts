import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENGINE_VERSION } from '@engine/version'
import { AUTH_KEY, dismissPrompt, freshRecord, hasStoredSession, loadRecord, ONLINE_KEY, promptDismissed, PROMPTS_KEY, saveRecord, updateRecord } from '../localState'
import { ERROR_PREF_KEY, errorReportsOn, setErrorReportsOn } from '../core/errorPref'
import { createReporter, type ReporterEnv } from '../errors'
import { freshErrorState, parseErrorState, type ErrorReport, type ErrorState } from '../core/errorReport'

/**
 * The device's own storage under the online layer (r10): the record in `touchline-online-v1`, the prompts, the stored
 * session, the Profile's error-report setting, and the error reporter over that record, on a fake `localStorage` (a
 * plain map, or one that refuses every call, as a private window or a full disk does).
 */

function memoryStorage() {
  const map = new Map<string, string>()
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k) }
}
const refusing = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
  removeItem: () => {
    throw new Error('SecurityError')
  },
}

afterEach(() => vi.unstubAllGlobals())

describe('the device record in localStorage', () => {
  it('stores a fresh record on the first read and reads the same device id back after', () => {
    const s = memoryStorage()
    vi.stubGlobal('localStorage', s)
    const first = loadRecord()
    expect(s.map.has(ONLINE_KEY)).toBe(true)
    expect(first.deviceId.length).toBeGreaterThanOrEqual(8)
    expect(loadRecord().deviceId).toBe(first.deviceId)
    // An update is read, changed and stored in one step; a recipe that returns nothing keeps its own changes
    updateRecord((r) => {
      r.userId = 'user-1'
    })
    expect(loadRecord().userId).toBe('user-1')
    const next = updateRecord((r) => ({ ...r, claims: 3 }))
    expect(next.claims).toBe(3)
    expect(JSON.parse(s.map.get(ONLINE_KEY)!).claims).toBe(3)
  })

  it('caps what it stores, and keeps the newest', () => {
    const s = memoryStorage()
    vi.stubGlobal('localStorage', s)
    const r = freshRecord('device-12345678')
    for (let i = 0; i < 90; i++) r.captured.push(`key-${i}`)
    saveRecord(r)
    const stored = JSON.parse(s.map.get(ONLINE_KEY)!)
    expect(stored.captured).toHaveLength(60)
    expect(stored.captured[0]).toBe('key-30')
  })

  it('works for the visit when storage refuses every call, and never throws', () => {
    vi.stubGlobal('localStorage', refusing)
    const r = loadRecord()
    expect(r.v).toBe(1)
    expect(() => saveRecord(r)).not.toThrow()
    expect(updateRecord((x) => ({ ...x, claims: 2 })).claims).toBe(2)
    expect(hasStoredSession()).toBe(false)
    expect(promptDismissed('sign-in')).toBe(false)
    expect(() => dismissPrompt('sign-in')).not.toThrow()
  })

  it('remembers dismissed prompts one by one, and sees a stored session', () => {
    const s = memoryStorage()
    vi.stubGlobal('localStorage', s)
    expect(hasStoredSession()).toBe(false)
    s.map.set(AUTH_KEY, '{"access_token":"x"}')
    expect(hasStoredSession()).toBe(true)
    dismissPrompt('sign-in')
    dismissPrompt('cloud')
    expect(promptDismissed('sign-in')).toBe(true)
    expect(promptDismissed('cloud')).toBe(true)
    expect(promptDismissed('boards')).toBe(false)
    // A damaged prompts value reads as nothing dismissed
    s.map.set(PROMPTS_KEY, '{not json')
    expect(promptDismissed('sign-in')).toBe(false)
  })
})

describe("the Profile's error-report setting", () => {
  it('is on by default, off only by its own key, and on again by removing it', () => {
    const s = memoryStorage()
    vi.stubGlobal('localStorage', s)
    expect(errorReportsOn()).toBe(true)
    setErrorReportsOn(false)
    expect(s.map.get(ERROR_PREF_KEY)).toBe('off')
    expect(errorReportsOn()).toBe(false)
    setErrorReportsOn(true)
    expect(s.map.has(ERROR_PREF_KEY)).toBe(false)
    expect(errorReportsOn()).toBe(true)
    s.map.set(ERROR_PREF_KEY, 'anything else')
    expect(errorReportsOn()).toBe(true)
  })

  it('reads on, and never throws, where storage is refused', () => {
    vi.stubGlobal('localStorage', refusing)
    expect(errorReportsOn()).toBe(true)
    expect(() => setErrorReportsOn(false)).not.toThrow()
  })
})

describe('the error reporter over the device record', () => {
  const ID = '0f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f'
  /** The reporter as `startErrorReporter` wires it, but with the page's clock, network and timers in hand. */
  function wired(post: (reports: ErrorReport[]) => Promise<number>) {
    const timers: Array<() => void> = []
    let t = Date.parse('2026-10-29T10:00:00Z')
    const env: ReporterEnv = {
      origin: 'https://touchline.quest',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
      now: () => t,
      viewport: () => '1280x800',
      where: () => ({ screen: 'game', phase: 'week' }),
      online: () => true,
      enabled: errorReportsOn,
      build: async () => 'dev',
      post,
      load: () => {
        const stored = loadRecord().errors
        return stored ? parseErrorState(stored, () => ID) : null
      },
      save: (s: ErrorState) => void updateRecord((r) => ({ ...r, errors: s })),
      randomId: () => ID,
      later: (fn) => void timers.push(fn),
    }
    return { rep: createReporter(env), timers, tick: (ms: number) => (t += ms) }
  }

  it('keeps a report in the record through a failed post, and sends it when the server answers', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    let fail = true
    const sent: ErrorReport[][] = []
    const { rep, tick } = wired(async (reports) => {
      if (fail) throw new TypeError('Failed to fetch')
      sent.push(reports)
      return 200
    })
    expect(await rep.capture('error', new TypeError('x is undefined'))).toBe('queued')
    expect(loadRecord().errors?.queue).toHaveLength(1)
    await rep.flush()
    // A post that threw is a post with no answer: the report stays, for later
    expect(loadRecord().errors?.queue).toHaveLength(1)
    fail = false
    tick(3_600_000)
    await rep.flush()
    expect(sent).toHaveLength(1)
    expect(sent[0][0]).toMatchObject({ kind: 'error', engine: ENGINE_VERSION, device: ID, ua: 'chrome/windows', screen: 'game', phase: 'week' })
    expect(loadRecord().errors?.queue).toEqual([])
  })

  it('switched off in the Profile: takes nothing and empties what waits', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const { rep } = wired(async () => 200)
    await rep.capture('rejection', new Error('one'))
    expect(loadRecord().errors?.queue).toHaveLength(1)
    setErrorReportsOn(false)
    expect(await rep.capture('error', new Error('two'))).toBe('off')
    expect(loadRecord().errors?.queue).toEqual([])
  })

  it('never throws when the storage under it fails', async () => {
    vi.stubGlobal('localStorage', refusing)
    const { rep } = wired(async () => 200)
    await expect(rep.capture('error', new Error('boom'))).resolves.toBeDefined()
    await expect(rep.flush()).resolves.toBeUndefined()
    expect(() => rep.clear()).not.toThrow()
    expect(freshErrorState(ID).queue).toEqual([])
  })
})
