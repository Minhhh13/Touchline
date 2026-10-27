import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION } from '@engine/version'
import { createReporter, ignoredMessage, postOutcome, type ReporterEnv } from '../errors'
import { DEVICE_LIMITS, reportProblem, type ErrorReport, type ErrorState } from '../core/errorReport'
import { signalError, takeEarlySignals } from '../core/errorSignal'

const ID = '0f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f'

/** A page with no DOM: a clock, a stored state, a server answering `status`, timers run by hand. */
function fakePage(status = 200) {
  const page = {
    t: Date.parse('2026-10-27T10:00:00Z'),
    stored: null as ErrorState | null,
    online: true,
    enabled: true,
    status,
    posts: [] as ErrorReport[][],
    timers: [] as Array<{ fn: () => void; ms: number }>,
  }
  const env: ReporterEnv = {
    origin: 'https://touchline.quest',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    now: () => page.t,
    viewport: () => '390x844',
    where: () => ({ screen: 'game', phase: 'draft' }),
    online: () => page.online,
    enabled: () => page.enabled,
    build: async () => '2026-10-27T00:00:00.000Z',
    post: async (reports) => {
      page.posts.push(structuredClone(reports))
      return page.status
    },
    load: () => (page.stored ? structuredClone(page.stored) : null),
    save: (s) => {
      page.stored = structuredClone(s)
    },
    randomId: () => ID,
    later: (fn, ms) => void page.timers.push({ fn, ms }),
  }
  const runTimers = async () => {
    const due = page.timers.splice(0)
    for (const d of due) d.fn()
    await new Promise((r) => setTimeout(r, 0))
  }
  return { page, rep: createReporter(env), runTimers }
}

const thrown = (message: string) => {
  const e = new TypeError(message)
  e.stack = `TypeError: ${message}\n    at render (https://touchline.quest/assets/Draft-abc.js:1:200)\n    at chrome-extension://abc/x.js:1:1`
  return e
}

describe('the error reporter', () => {
  it('builds a report the server takes, with no game data, account or email, and posts it as a batch', async () => {
    const { page, rep, runTimers } = fakePage()
    expect(await rep.capture('error', thrown('x is undefined for ana@example.com'))).toBe('queued')
    const queued = page.stored!.queue[0]
    expect(reportProblem(queued)).toBeNull()
    expect(queued).toEqual({
      kind: 'error', message: 'TypeError: x is undefined for <email>', stack: 'render /assets/Draft-abc.js:1:200', build: '2026-10-27T00:00:00.000Z', engine: ENGINE_VERSION,
      screen: 'game', phase: 'draft', viewport: '390x844', ua: 'safari/ios', device: ID, count: 1, at: '2026-10-27T10:00:00.000Z',
    })
    expect(Object.keys(queued).sort()).toEqual(['at', 'build', 'count', 'device', 'engine', 'kind', 'message', 'phase', 'screen', 'stack', 'ua', 'viewport'])
    // A flush is scheduled, not run at once
    expect(page.posts).toHaveLength(0)
    await rep.capture('rejection', new Error('second'))
    await runTimers()
    expect(page.posts).toHaveLength(1)
    expect(page.posts[0]).toHaveLength(2)
    expect(page.stored!.queue).toHaveLength(0)
  })

  it('keeps the queue while offline and sends it when the connection is back', async () => {
    const { page, rep } = fakePage()
    page.online = false
    await rep.capture('error', thrown('a'))
    await rep.flush()
    expect(page.posts).toHaveLength(0)
    expect(page.stored!.queue).toHaveLength(1)
    page.online = true
    await rep.flush()
    expect(page.posts).toHaveLength(1)
    expect(page.stored!.queue).toHaveLength(0)
  })

  it('backs off while the server is busy or missing, and drops what it refuses', async () => {
    const { page, rep } = fakePage(503)
    await rep.capture('error', thrown('a'))
    await rep.flush()
    expect(page.stored!.queue).toHaveLength(1)
    expect(page.stored!.nextAt).toBe(page.t + 60000)
    // Not again before the back-off ends
    await rep.flush()
    expect(page.posts).toHaveLength(1)
    page.t += 60000
    page.status = 400
    await rep.flush()
    expect(page.posts).toHaveLength(2)
    expect(page.stored!.queue).toHaveLength(0)
    expect([postOutcome(200), postOutcome(422), postOutcome(429)]).toEqual(['ok', 'drop', 'retry'])
    expect(postOutcome(0)).toBe('retry')
    expect(postOutcome(404)).toBe('retry')
  })

  it('takes nothing and empties the queue once switched off', async () => {
    const { page, rep } = fakePage()
    page.online = false
    await rep.capture('error', thrown('a'))
    expect(page.stored!.queue).toHaveLength(1)
    page.enabled = false
    expect(await rep.capture('error', thrown('b'))).toBe('off')
    expect(page.stored!.queue).toHaveLength(0)
    page.online = true
    await rep.flush()
    expect(page.posts).toHaveLength(0)
  })

  it('deduplicates, rate-limits and ignores the noise', async () => {
    const { page, rep } = fakePage()
    page.online = false
    expect(await rep.capture('error', thrown('same'))).toBe('queued')
    expect(await rep.capture('error', thrown('same'))).toBe('repeat')
    expect(page.stored!.queue[0].count).toBe(2)
    expect(await rep.capture('error', 'Script error.')).toBe('ignored')
    expect(await rep.capture('error', new Error('ResizeObserver loop completed with undelivered notifications.'))).toBe('ignored')
    // A chunk that cannot load offline is the offline card's job
    expect(await rep.capture('chunk', new TypeError('Failed to fetch dynamically imported module'))).toBe('ignored')
    const outcomes: string[] = []
    for (let i = 0; i < 20; i++) outcomes.push(await rep.capture('error', thrown(`e${i}`)))
    expect(outcomes.filter((o) => o === 'queued')).toHaveLength(DEVICE_LIMITS.hour - 1)
    expect(ignoredMessage('Uncaught Script error.')).toBe(true)
  })

  it('never throws, even when the page fails under it', async () => {
    const { page, rep } = fakePage()
    page.stored = null
    const broken = createReporter({ enabled: () => true, origin: '', userAgent: '', now: () => 0, viewport: () => { throw new Error('no window') }, where: () => ({ screen: 'x', phase: 'y' }), online: () => true, build: async () => 'b', post: async () => { throw new Error('down') }, load: () => null, save: () => undefined, randomId: () => ID, later: () => undefined })
    expect(await broken.capture('error', new Error('x'))).toBe('ignored')
    await expect(broken.flush()).resolves.toBeUndefined()
    expect(await rep.capture('error', thrown('fine'))).toBe('queued')
  })
})

describe('the boundary signal', () => {
  it('keeps the last few signals until a reporter takes them, then only dispatches', () => {
    for (let i = 0; i < 8; i++) signalError('boundary', new Error(`early ${i}`))
    const early = takeEarlySignals()
    expect(early).toHaveLength(5)
    expect((early[0].error as Error).message).toBe('early 3')
    signalError('chunk', new Error('late'))
    expect(takeEarlySignals()).toHaveLength(0)
  })
})
