/**
 * The ranked Daily on a rotated day (engine 7, `DAILY_EPOCHS` in src/game/logic/daily.ts): the server pins it on the
 * day's league alone (`pinLeagues`), a browser plays it with England loaded as well, and the strict replay ranks it on
 * the figures the game produced. A Premier League day and the weekly still pin on England.
 */
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { decodeChallenge, encodeChallenge, type QuickChallengePayload } from '@engine/challenge'
import { respin, spin } from '@engine/draft'
import type { Rng } from '@engine/rng'
import type { Game } from '@game/types'
import { ENGINE_VERSION } from '@engine/version'
import { dailyGameSettings, dailyLeagueOf } from '@game/logic/setup'
import { challengeFromGame, replayChallenge } from '@game/logic/challenge'
import { puzzleOf, settingsHash, verifyDaily, type PuzzlePin } from '../server/dailyVerify'
import { dailyStartSettings } from '../daily'
import { pinLeagues, PUZZLE_LEAGUES, type Reply } from '../server/service'
import { puzzleLeagues } from '../server/packs'
import { ALICE, autoPlayed, makeHarness, submitBody } from './serverHarness'

const DATE = '2026-10-31'
const SEED = `daily-${DATE}`
const LEAGUE = 'spain'
const server = loadTestUniverse([LEAGUE])
const browser = loadTestUniverse(['england', LEAGUE])
const NOW = new Date(`${DATE}T12:00:00Z`)
const LIVE = { engine: ENGINE_VERSION, data: browser.generatedAt, builtAt: `${DATE}T00:05:00Z` }
const call = (h: ReturnType<typeof makeHarness>, body: string): Promise<Reply> => h.server.handle(ALICE, body)

describe('a rotated Daily on the ranked board', { timeout: 300_000 }, () => {
  it('pins on the day\'s league alone, and the weekly and a Premier League day on England', () => {
    expect(dailyLeagueOf(SEED)).toBe(LEAGUE)
    expect(pinLeagues('daily', DATE)).toEqual([LEAGUE])
    expect(pinLeagues('daily', '2026-10-29')).toEqual(['england'])
    expect(pinLeagues('daily', '2026-11-06')).toEqual(['england'])
    expect(pinLeagues('weekly', '2026-W45')).toEqual(PUZZLE_LEAGUES)
    // The browser's puzzle (England loaded too) is the server's, hash for hash, and needs no other league
    const s = dailyGameSettings(browser, SEED, 'Rotated FC')
    expect(settingsHash(s)).toBe(settingsHash(dailyGameSettings(server, SEED)))
    expect(puzzleLeagues(puzzleOf(s))).toEqual([LEAGUE])
    expect(s.leagueId).toBe(LEAGUE)
    expect(s.rules.leagues).toEqual([LEAGUE])
  })

  it('verifies an honest run played with England loaded on the server\'s one-league universe', () => {
    const s = dailyGameSettings(browser, SEED, 'Rotated FC')
    const pin: PuzzlePin = { kind: 'daily', key: DATE, seed: SEED, settings: puzzleOf(dailyGameSettings(server, SEED)), settingsHash: settingsHash(dailyGameSettings(server, SEED)), engineVersion: ENGINE_VERSION, dataVersion: server.generatedAt }
    expect(dailyStartSettings(browser, SEED, 'Rotated FC', pin)).toMatchObject({ source: 'local', ranked: true })
    for (const before of [undefined, (g: Game, rng: Rng) => {
      spin(browser, g.draft!, rng)
      respin(browser, g.draft!, rng)
      respin(browser, g.draft!, rng)
    }]) {
      const g = autoPlayed(browser, s, before)
      const payload = challengeFromGame(g, browser, 'Tester')!
      const v = verifyDaily(server, pin, { encoded: encodeChallenge(payload), teamName: s.teamName, shortName: s.shortName }, NOW, () => false)
      if (!v.ok) throw new Error(`${v.code}: ${v.reason}`)
      const q = g.quickResult!
      expect(v.entry).toMatchObject({ points: q.points, won: q.won, drawn: q.drawn, lost: q.lost, league_position: q.position, tier: q.tier, claim_matched: true })
      // A Spanish season: twenty clubs, 38 games
      expect(q.won + q.drawn + q.lost).toBe(38)
      expect(replayChallenge(server, decodeChallenge(encodeChallenge(payload))).result?.pts).toBe(q.points)
      // The same draft posted as another league's Daily is another puzzle
      const wrong = decodeChallenge(encodeChallenge(payload)) as QuickChallengePayload
      wrong.s = { ...wrong.s, l: 'england', wl: ['england'] }
      const w = verifyDaily(server, pin, { encoded: encodeChallenge(wrong), teamName: s.teamName, shortName: s.shortName }, NOW, () => false)
      expect(w.ok ? 'ok' : w.code).toBe('puzzle_mismatch')
    }
  })

  it('the Edge Function\'s server pins the rotated day on the day\'s league and ranks the browser\'s run', async () => {
    const h = makeHarness(NOW, LIVE)
    const g = autoPlayed(browser, dailyGameSettings(browser, SEED, 'Rotated FC'))
    const r = await call(h, submitBody('daily.submit', g, browser))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: 'ranked', key: DATE, official: { points: g.quickResult!.points, claimMatched: true } })
    const pinned = h.pins.get(`daily|${DATE}`)!
    expect(pinned.settings.leagueId).toBe(LEAGUE)
    expect(pinned.settingsHash).toBe(settingsHash(dailyGameSettings(server, SEED)))
  })
})
