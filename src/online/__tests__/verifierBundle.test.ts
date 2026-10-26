/**
 * The verifier bundle (what the Edge Function runs) against the source (what the client runs): built fresh with the
 * same esbuild settings as `npm run build:verifier`, it must hash the same puzzles, reach the same verdict on the
 * same runs and name no DOM or Node global. A difference here means the server would rank a run differently from
 * how the player's own device scored it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { encodeChallenge } from '@engine/challenge'
import { ENGINE_VERSION } from '@engine/version'
import { dailyGameSettings } from '@game/logic/setup'
import { challengeFromGame } from '@game/logic/challenge'
import { puzzleOf, settingsHash, verifyDaily, type PuzzlePin, type Verdict } from '../server/dailyVerify'
import { weeklyGameSettings } from '../weekly'
import { chaseGameSettings } from '../chase'
import { verifyChase, type ChaseAttempt } from '../server/chaseVerify'
import { autoPlayed } from './serverHarness'

interface Bundle {
  ENGINE_VERSION: string
  settingsHash: typeof settingsHash
  verifyDaily: typeof verifyDaily
  dailyGameSettings: typeof dailyGameSettings
  weeklyGameSettings: typeof weeklyGameSettings
  chaseGameSettings: typeof chaseGameSettings
  verifyChase: typeof verifyChase
}
interface Builder {
  buildVerifier(o: { minify: boolean; outfile: string }): Promise<{ outfile: string; bytes: number }>
  forbiddenIn(code: string): string[]
}

const u = loadTestUniverse()
// inside the checkout (`.cache` is gitignored): the test runner loads modules only from under the project root
const cache = path.resolve(__dirname, '..', '..', '..', '.cache')
mkdirSync(cache, { recursive: true })
const dir = mkdtempSync(path.join(cache, 'verifier-test-'))
let bundle: Bundle
let code = ''

beforeAll(async () => {
  const builderUrl = pathToFileURL(path.resolve(__dirname, '..', '..', '..', 'scripts', 'online', 'build-verifier.mjs')).href
  const builder = (await import(/* @vite-ignore */ builderUrl)) as Builder
  const out = await builder.buildVerifier({ minify: true, outfile: path.join(dir, 'verifier.js') })
  code = readFileSync(out.outfile, 'utf8')
  expect(builder.forbiddenIn(code)).toEqual([])
  bundle = (await import(/* @vite-ignore */ pathToFileURL(out.outfile).href)) as Bundle
}, 120000)

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('the verifier bundle', () => {
  it('carries this engine and no browser or Node global', () => {
    expect(bundle.ENGINE_VERSION).toBe(ENGINE_VERSION)
    for (const g of ['window.', 'document.', 'localStorage', 'sessionStorage', 'process.', 'require(']) expect(code).not.toContain(g)
    // well under the Edge Functions bundle limit (20 MB)
    expect(code.length).toBeLessThan(2_000_000)
  })

  it('hashes the same Daily and weekly puzzles as the source', () => {
    for (const date of ['2026-10-25', '2026-12-31', '2027-02-28', '2028-02-29']) {
      expect(bundle.settingsHash(bundle.dailyGameSettings(u, `daily-${date}`))).toBe(settingsHash(dailyGameSettings(u, `daily-${date}`)))
    }
    for (const week of ['2026-W43', '2026-W53', '2027-W01']) {
      expect(bundle.settingsHash(bundle.weeklyGameSettings(u, week))).toBe(settingsHash(weeklyGameSettings(u, week)))
    }
  })

  it('reaches the same verdict as the source on honest and tampered runs', () => {
    const settings = dailyGameSettings(u, 'daily-2026-10-25', 'Parity FC')
    const pin: PuzzlePin = { kind: 'daily', key: '2026-10-25', seed: settings.seed, settings: puzzleOf(settings), settingsHash: settingsHash(settings), engineVersion: ENGINE_VERSION, dataVersion: u.generatedAt }
    const now = new Date('2026-10-25T12:00:00Z')
    const g = autoPlayed(u, settings)
    const c = challengeFromGame(g, u, 'Parity')!
    const bodies = [c, { ...c, p: [[null, null], [null, null], [null, null], ...c.p] as typeof c.p }, { ...c, c: { ...c.c, pts: c.c.pts + 9 } }].map((p) => ({ encoded: encodeChallenge(p), teamName: g.settings.teamName, shortName: g.settings.shortName }))
    const verdicts: Verdict[] = []
    for (const b of bodies) {
      const fromBundle = bundle.verifyDaily(u, pin, b, now, () => false)
      expect(fromBundle).toEqual(verifyDaily(u, pin, b, now, () => false))
      verdicts.push(fromBundle)
    }
    expect(verdicts.map((v) => (v.ok ? 'ranked' : v.code))).toEqual(['ranked', 'invalid_picks', 'ranked'])
  }, 120000)

  it('maps and verifies 38-0 chase runs as the source does', () => {
    for (const code of ['K7Q2MX9A3B', 'AAAAAAAAAB', 'ZZZZ2222YY']) {
      for (const f of ['4-3-3', '5-3-2']) expect(bundle.settingsHash(bundle.chaseGameSettings(u, code, 'england', f)!)).toBe(settingsHash(chaseGameSettings(u, code, 'england', f)!))
    }
    const attempt: ChaseAttempt = { code: 'K7Q2MX9A3B', seed: 'chase-K7Q2MX9A3B', leagueId: 'england', formationId: '4-3-3', engineVersion: ENGINE_VERSION, dataVersion: u.generatedAt, createdAt: '2026-10-26T10:00:00Z', expiresAt: '2026-10-28T10:00:00Z', submittedAt: null }
    const g = autoPlayed(u, chaseGameSettings(u, attempt.code, 'england', '4-3-3', 'Parity FC')!)
    const c = challengeFromGame(g, u, 'Parity')!
    const now = new Date('2026-10-26T12:00:00Z')
    for (const p of [c, { ...c, p: [[null, null], [null, null], ...c.p] as typeof c.p }]) {
      const b = { encoded: encodeChallenge(p), teamName: g.settings.teamName, shortName: g.settings.shortName }
      expect(bundle.verifyChase(u, attempt, b, now, () => false)).toEqual(verifyChase(u, attempt, b, now, () => false))
    }
    expect(bundle.verifyChase(u, attempt, { encoded: encodeChallenge(c), teamName: g.settings.teamName, shortName: g.settings.shortName }, now, () => false).ok).toBe(true)
  }, 120000)
})
