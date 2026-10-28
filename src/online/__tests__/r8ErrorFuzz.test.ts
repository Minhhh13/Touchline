/**
 * QA round 3 (r8): the error reporter against hostile input. Thrown values and stacks of every shape (emoji, CJK,
 * control characters, URLs with queries, emails, tokens, long digit runs, cut anywhere) go through the client's own
 * `messageOf` and `trimStack`; every report built from them must be one the server takes (`reportProblem`, which the
 * Edge Function's validator runs), and a full batch of the largest must fit the request limit, or one bad report
 * would lose its whole batch.
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '@engine/rng'
import { messageOf, reportProblem, REPORTS_PER_POST, trimStack, type ErrorReport } from '../core/errorReport'
import { MAX_BODY_BYTES, parseRequest } from '../server/validate'
import { batchOf, BODY_BUDGET } from '../errors'

const ORIGIN = 'https://touchline.quest'
const PIECES = ['a', ' ', 'TypeError: ', 'é', '漢字', '😀', '\u0001', '​', '"', '\\', '\n', '\t', '?', '#', '@', 'x@y.co', 'https://touchline.quest/a?b=1#c=XYZ', 'eyJabcdefgh.ijklmnop.qrs', 'sb_secret_ABCDEFGH12', '0123456789abcdef0123456789abcdef01', '<email>', '<redacted>', '%', '/', ':', '.', '-', '9']

function junk(rng: Rng, n: number): string {
  let s = ''
  while (s.length < n) s += PIECES[rng.int(0, PIECES.length - 1)]
  return s.slice(0, rng.int(Math.floor(n / 2), n))
}

function stackOf(rng: Rng): string {
  const lines = ['Error: x']
  for (let i = rng.int(0, 14); i > 0; i--) {
    const where = rng.chance(0.7) ? ORIGIN : rng.pick(['chrome-extension://abc', 'https://evil.example'])
    const path = `/assets/${junk(rng, rng.int(5, 90)).replace(/[\s)]/g, '')}.js`
    lines.push(rng.chance(0.5) ? `    at ${junk(rng, 20).replace(/\s/g, '')} (${where}${path}?v=1:${rng.int(1, 9999)}:${rng.int(1, 999)})` : `${junk(rng, 12).replace(/\s/g, '')}@${where}${path}:${rng.int(1, 99)}:${rng.int(1, 99)}`)
  }
  return lines.join('\n')
}

function reportOf(message: string, stack: string): ErrorReport {
  return { kind: 'error', message, stack, build: '2026-10-28.abc123', engine: '7', screen: 'game', phase: 'week', viewport: '390x844', ua: 'safari/ios', device: '0f8fad5b-d9cb-469f-a165-70867728950e', count: 1000, at: new Date(Date.UTC(2026, 9, 28)).toISOString() }
}

describe('QA r8: the error reporter never builds a report the server refuses', () => {
  it('over 4,000 hostile throws and stacks', () => {
    const rng = new Rng('r8-error-fuzz')
    const refused: string[] = []
    let biggest: ErrorReport[] = []
    const bytes = (r: ErrorReport) => new TextEncoder().encode(JSON.stringify(r)).length
    for (let i = 0; i < 4000; i++) {
      const thrown: unknown = rng.chance(0.6) ? Object.assign(new Error(junk(rng, rng.int(1, 2000))), { stack: stackOf(rng) }) : rng.chance(0.5) ? junk(rng, rng.int(0, 3000)) : { odd: junk(rng, 400) }
      const r = reportOf(messageOf(thrown), trimStack(thrown instanceof Error ? thrown.stack : undefined, ORIGIN))
      const problem = reportProblem(r)
      if (problem) refused.push(`${problem}: ${JSON.stringify(r.message).slice(0, 120)} | ${JSON.stringify(r.stack).slice(0, 120)}`)
      else biggest = [...biggest, r].sort((a, b) => bytes(b) - bytes(a)).slice(0, REPORTS_PER_POST)
    }
    expect(refused.slice(0, 5)).toEqual([])
    // The largest batch the client could send, as it sends it
    const body = JSON.stringify({ op: 'errors.report', reports: biggest })
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(MAX_BODY_BYTES)
    expect(parseRequest(body).ok).toBe(true)
  })
  it('the worst batch the caps allow still fits: control characters escape to six bytes each in JSON', () => {
    const message = messageOf(new Error('\u0001'.repeat(400)))
    expect(message.length).toBe(300)
    const frame = (i: number) => `f${i} /assets/${'x'.repeat(130)}.js:12345:678`
    const stack = trimStack(['Error', ...Array.from({ length: 9 }, (_, i) => `    at ${frame(i).split(' ')[0]} (${ORIGIN}${frame(i).split(' ')[1]})`)].join('\n'), ORIGIN)
    expect(stack.length).toBe(1200)
    const worst: ErrorReport = { ...reportOf(message, stack), build: 'b'.repeat(40), engine: 'e'.repeat(16), screen: 's'.repeat(24), phase: 'p'.repeat(24), viewport: '99999x99999', ua: 'abcdefghij/abcdefghij', at: '2026-10-28T12:34:56.789Z' }
    expect(reportProblem(worst)).toBeNull()
    const five = Array.from({ length: REPORTS_PER_POST }, () => worst)
    // Five of them pass the limit: the server would refuse the batch and the device drop all five
    expect(new TextEncoder().encode(JSON.stringify({ op: 'errors.report', reports: five })).length).toBeGreaterThan(MAX_BODY_BYTES)
    // The reporter's batch stops short of it, and the rest go in the next post
    expect(BODY_BUDGET).toBe(MAX_BODY_BYTES)
    const batch = batchOf(five)
    expect(batch.length).toBe(4)
    const body = JSON.stringify({ op: 'errors.report', reports: batch })
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(MAX_BODY_BYTES)
    expect(parseRequest(body).ok).toBe(true)
    // Ordinary reports still go five at a time
    expect(batchOf(Array.from({ length: 7 }, () => reportOf('TypeError: x is undefined', '')))).toHaveLength(REPORTS_PER_POST)
    expect(batchOf([])).toEqual([])
  })
})
