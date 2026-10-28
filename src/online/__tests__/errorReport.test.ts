import { describe, expect, it } from 'vitest'
import {
  admit,
  afterPost,
  DEDUPE_MS,
  DEVICE_LIMITS,
  fingerprintOf,
  freshErrorState,
  labelOf,
  messageOf,
  parseErrorState,
  QUEUE_CAP,
  reportProblem,
  scrubText,
  trimStack,
  uaFamily,
  type ErrorReport,
} from '../core/errorReport'

const ORIGIN = 'https://touchline.quest'
const ID = '0f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f'
const HOUR = 3600000

const report = (message = 'TypeError: x is undefined', extra: Partial<ErrorReport> = {}): ErrorReport => ({
  kind: 'error',
  message,
  stack: 'render /assets/Draft-abc.js:1:200',
  build: '2026-10-27T00:00:00.000Z',
  engine: '6',
  screen: 'game',
  phase: 'draft',
  viewport: '390x844',
  ua: 'safari/ios',
  device: ID,
  count: 1,
  at: '2026-10-27T10:00:00.000Z',
  ...extra,
})

describe('scrubbing a report', () => {
  it('takes out emails, tokens, keys and every URL query or hash', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const text = `failed for ana.lima+tl@example.co.uk with ${jwt} and sb_publishable_AbCdEf123456 at https://touchline.quest/#c=AAAABBBB?x=1 seat Kq3vZ9w1Yb7pXr2sTu5mNo8LcD4eFg6hIj0kRa1bSc2`
    const out = scrubText(text)
    expect(out).not.toMatch(/example|eyJ|sb_publishable|#c=|AAAABBBB|Kq3vZ9w1/)
    expect(out).toContain('<email>')
    expect(out).toContain('<token>')
    expect(out).toContain('https://touchline.quest/')
    // Idempotent, so the server's second look finds nothing left to take
    expect(scrubText(out)).toBe(out)
  })

  it('keeps our file names, paths and long identifiers', () => {
    const t = 'at advanceToNextSeasonInternalHelperForDynasty (/assets/SeasonPlayback-B3xY_z9q.js:12:3456)'
    expect(scrubText(t)).toBe(t)
  })

  it('words any thrown value as one short line', () => {
    expect(messageOf(new TypeError('x is\nundefined'))).toBe('TypeError: x is undefined')
    expect(messageOf(new Error('plain'))).toBe('plain')
    expect(messageOf('a string')).toBe('a string')
    expect(messageOf({ code: 3 })).toBe('{"code":3}')
    expect(messageOf(undefined)).toBe('undefined')
    expect(messageOf(new Error(''))).toBe('(no message)')
    expect(messageOf(new Error('y'.repeat(900))).length).toBe(300)
    expect(messageOf(new Error('mail me@here.io'))).toBe('mail <email>')
  })
})

describe('trimming a stack to our own frames', () => {
  it('keeps our V8 frames, drops extensions and other sites, strips the origin and query', () => {
    const stack = [
      'TypeError: x is undefined',
      '    at render (https://touchline.quest/assets/Draft-abc.js?v=2:1:200)',
      '    at chrome-extension://abcdef/content.js:5:5',
      '    at https://touchline.quest/assets/index-def.js:2:10',
      '    at https://cdn.example.com/lib.js:1:1',
    ].join('\n')
    expect(trimStack(stack, ORIGIN)).toBe('render /assets/Draft-abc.js:1:200\n/assets/index-def.js:2:10')
  })

  it('reads Gecko and WebKit frames, and caps the count', () => {
    const gecko = Array.from({ length: 20 }, (_, i) => `fn${i}@https://touchline.quest/assets/a.js:1:${i}`).join('\n')
    const out = trimStack(gecko, ORIGIN).split('\n')
    expect(out).toHaveLength(8)
    expect(out[0]).toBe('fn0 /assets/a.js:1:0')
    expect(trimStack('', ORIGIN)).toBe('')
    expect(trimStack(undefined, ORIGIN)).toBe('')
  })
})

describe('labels', () => {
  it('names a browser and OS family, never a version', () => {
    expect(uaFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('safari/ios')
    expect(uaFamily('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')).toBe('chrome/android')
    expect(uaFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('edge/windows')
    expect(uaFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('firefox/mac')
    expect(uaFamily('curl/8')).toBe('other/other')
  })

  it('keeps a screen or phase label to its own alphabet', () => {
    expect(labelOf('game')).toBe('game')
    expect(labelOf('Kick Off!')).toBe('kickoff')
    expect(labelOf(undefined)).toBe('none')
  })
})

describe('the device queue', () => {
  it('reports one error once a day; repeats add to the waiting copy', () => {
    let s = freshErrorState(ID)
    const t = Date.parse('2026-10-27T10:00:00Z')
    let r = admit(s, report(), t)
    expect(r.outcome).toBe('queued')
    s = r.state
    r = admit(s, report(), t + 1000)
    expect(r.outcome).toBe('repeat')
    expect(r.state.queue).toHaveLength(1)
    expect(r.state.queue[0].count).toBe(2)
    // Once sent, a repeat that day is only dropped; the next day it is a new report
    s = afterPost(r.state, 1, 'ok', t + 2000)
    expect(admit(s, report(), t + 3000).state.queue).toHaveLength(0)
    expect(admit(s, report(), t + DEDUPE_MS + 1).outcome).toBe('queued')
  })

  it('holds the hourly and daily limits and the queue cap', () => {
    let s = freshErrorState(ID)
    const t = Date.parse('2026-10-27T00:00:00Z')
    const outcomes: string[] = []
    for (let i = 0; i < DEVICE_LIMITS.hour + 3; i++) {
      const r = admit(s, report(`error ${i}`), t + i)
      s = r.state
      outcomes.push(r.outcome)
    }
    expect(outcomes.filter((o) => o === 'queued')).toHaveLength(DEVICE_LIMITS.hour)
    expect(outcomes.at(-1)).toBe('limited')
    expect(s.queue.length).toBeLessThanOrEqual(QUEUE_CAP)
    // Hour after hour, never more than the daily limit
    let queued = DEVICE_LIMITS.hour
    for (let h = 1; h < 24; h++) {
      for (let i = 0; i < DEVICE_LIMITS.hour; i++) {
        const r = admit(s, report(`h${h} e${i}`), t + h * HOUR + i)
        s = r.state
        if (r.outcome === 'queued') queued++
      }
    }
    expect(queued).toBe(DEVICE_LIMITS.day)
    expect(s.queue).toHaveLength(QUEUE_CAP)
  })

  it('backs off after a failed post and drops what the server refuses', () => {
    const t = 1_000_000
    let s = admit(freshErrorState(ID), report(), t).state
    s = afterPost(s, 1, 'retry', t)
    expect(s.queue).toHaveLength(1)
    expect(s.nextAt).toBe(t + 60000)
    s = afterPost(s, 1, 'retry', t)
    expect(s.nextAt).toBe(t + 120000)
    for (let i = 0; i < 10; i++) s = afterPost(s, 1, 'retry', t)
    expect(s.nextAt).toBe(t + HOUR)
    s = afterPost(s, 1, 'drop', t)
    expect(s.queue).toHaveLength(0)
    expect(s.failures).toBe(0)
  })

  it('reads a stored state field by field, and a fresh one from anything else', () => {
    const fresh = () => ID
    expect(parseErrorState(null, fresh)).toEqual(freshErrorState(ID))
    expect(parseErrorState({ id: 'nope' }, fresh)).toEqual(freshErrorState(ID))
    const s = parseErrorState({ id: ID, queue: [report(), { kind: 'bad' }], seen: { a: 1, b: 'x' }, sent: [1, 'y'], nextAt: 5, failures: 2 }, () => 'unused')
    expect(s.queue).toHaveLength(1)
    expect(s.seen).toEqual({ a: 1 })
    expect(s.sent).toEqual([1])
  })

  it('tells repeats apart by kind, message and first frame only', () => {
    expect(fingerprintOf(report())).toBe(fingerprintOf(report(undefined, { screen: 'home', count: 9 })))
    expect(fingerprintOf(report())).not.toBe(fingerprintOf(report(undefined, { kind: 'rejection' })))
    expect(fingerprintOf(report())).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('what the server takes', () => {
  it('takes a well-formed report and nothing else', () => {
    expect(reportProblem(report())).toBeNull()
    expect(reportProblem({ ...report(), user: 'x' })).toMatch(/unexpected/)
    expect(reportProblem(report('a@b.io is broken'))).toMatch(/email/)
    expect(reportProblem(report('x'.repeat(301)))).toMatch(/message/)
    expect(reportProblem(report(undefined, { stack: Array(9).fill('/a.js:1:1').join('\n') }))).toMatch(/frames/)
    expect(reportProblem(report(undefined, { device: 'my-device' }))).toMatch(/device/)
    expect(reportProblem(report(undefined, { ua: 'Mozilla/5.0 (Windows NT 10.0)' }))).toMatch(/ua/)
    expect(reportProblem(report(undefined, { count: 0 }))).toMatch(/count/)
    expect(reportProblem(report(undefined, { kind: 'warning' as ErrorReport['kind'] }))).toMatch(/kind/)
    expect(reportProblem([])).toMatch(/object/)
  })
})
