// Which finished runs may go to the ranked boards (the Daily and the weekly challenge): only the puzzle's own
// standard Quick Draft, never one with the release line's extra rules (modes, the Upgrader, power-ups, the Super
// League, managers and the manager spin, the end-of-draft case, classic seasons, the salary cap, the chain), the
// locker, the case's Icon, an arena link, or any casual mode's result.
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { decodeChallenge, encodeChallenge, isArenaPayload, type QuickChallengePayload } from '@engine/challenge'
import type { DraftRules } from '@engine/draft'
import { ENGINE_VERSION } from '@engine/version'
import { arenaDailySeed } from '@engine/rng'
import type { Game, GameSettings } from '@game/types'
import { dailyGameSettings } from '@game/logic/setup'
import { challengeFromGame } from '@game/logic/challenge'
import { dailyArenaGameSettings } from '@game/logic/arenaDaily'
import { weeklyGameSettings as casualWeeklySettings } from '@game/logic/weekly'
import { buildRankedSubmission, NON_STANDARD_RULES, nonStandardRule, rankedBoardOf, unrankedReason } from '../daily'
import { rankedFinish } from '../outbox'
import { nonStandardRun, puzzleOf, settingsHash, verifyDaily, type PuzzlePin } from '../server/dailyVerify'
import { weeklyGameSettings } from '../weekly'
import { autoPlayed } from './serverHarness'

const u = loadTestUniverse()
const SEED = 'daily-2026-10-25'
const NOW = new Date('2026-10-25T12:00:00Z')
const never = () => false

/** One value per non-standard rule that switches it on. */
const ON: Record<(typeof NON_STANDARD_RULES)[number], Partial<DraftRules>> = {
  modes: { modes: ['crazy'] as DraftRules['modes'] },
  upgrader: { upgrader: true },
  powerUps: { powerUps: true },
  superLeague: { superLeague: true },
  managers: { managers: true },
  managerSpin: { managerSpin: true },
  endCase: { endCase: true },
  classic: { classic: true },
  budget: { budget: 180 },
  chain: { chain: true },
}

const pinFor = (settings: GameSettings): PuzzlePin => ({ kind: 'daily', key: settings.seed.slice(6), seed: settings.seed, settings: puzzleOf(settings), settingsHash: settingsHash(settings), engineVersion: ENGINE_VERSION, dataVersion: u.generatedAt })
const bodyOf = (g: Game, c: QuickChallengePayload) => ({ encoded: encodeChallenge(c), teamName: g.settings.teamName, shortName: g.settings.shortName })

describe('ranked board eligibility', () => {
  const daily = dailyGameSettings(u, SEED, 'Verified FC')

  it('the Daily and the weekly challenge are standard; every release-line rule makes a run non-standard', () => {
    expect(nonStandardRule(daily)).toBeNull()
    expect(nonStandardRule(weeklyGameSettings(u, '2026-W43'))).toBeNull()
    expect(rankedBoardOf(daily)).toEqual({ kind: 'daily', key: '2026-10-25' })
    expect(rankedBoardOf(weeklyGameSettings(u, '2026-W43'))).toEqual({ kind: 'weekly', key: '2026-W43' })
    for (const k of NON_STANDARD_RULES) {
      const s = { ...daily, rules: { ...daily.rules, ...ON[k] } }
      expect(nonStandardRule(s), k).toBe(k)
      expect(rankedBoardOf(s), k).toBeNull()
      const w = weeklyGameSettings(u, '2026-W43')
      expect(rankedBoardOf({ ...w, rules: { ...w.rules, ...ON[k] } }), k).toBeNull()
    }
    // Switched off (false, an empty list, undefined) is still standard, as DAILY_RULES writes them
    expect(nonStandardRule({ rules: { ...daily.rules, managers: false, modes: [], upgrader: false, budget: undefined } })).toBeNull()
  })

  it('no casual mode lands on the Daily or weekly boards', () => {
    expect(rankedBoardOf(dailyArenaGameSettings(u, arenaDailySeed(NOW)))).toBeNull()
    // The casual Weekly shares the `weekly-YYYY-Www` seed shape with the online weekly but is its own mode
    const casual = ['2026-W43', '2026-W44', '2026-W45', '2026-W46', '2026-W47', '2026-W48', '2026-W49', '2026-W50'].map((w) => casualWeeklySettings(u, `weekly-${w}`)).find((s) => s)
    expect(casual?.mode).toBe('weekly')
    expect(rankedBoardOf(casual!)).toBeNull()
    for (const mode of ['arena', 'runin', 'season', 'dynasty', 'weekly'] as const) expect(rankedBoardOf({ ...daily, mode }), mode).toBeNull()
  })

  it('a standard Daily files; the locker, the case Icon or the tray keep it off the board, and the verifier refuses them', () => {
    const g = autoPlayed(u, daily)
    expect(unrankedReason(g, u)).toBeNull()
    expect(buildRankedSubmission(g, u, 'Tester')).not.toBeNull()
    expect(rankedFinish({ game: { ...g, phase: 'january' } }, { game: g })).toBe(g)
    expect(verifyDaily(u, pinFor(daily), bodyOf(g, challengeFromGame(g, u, 'Tester')!), NOW, never).ok).toBe(true)

    const locker: Game = { ...g, draft: { ...g.draft!, locker: ['swap'] } }
    expect(unrankedReason(locker, u)).toMatch(/locker/)
    expect(buildRankedSubmission(locker, u, 'Tester')).toBeNull()
    const icon: Game = { ...g, endCase: { drop: g.endCase?.drop ?? ({} as NonNullable<Game['endCase']>['drop']), sub: { slotId: 'GK', outId: 'x' } } }
    expect(unrankedReason(icon, u)).toMatch(/Icon/)
    expect(buildRankedSubmission(icon, u, 'Tester')).toBeNull()

    const honest = challengeFromGame(g, u, 'Tester')!
    const forged: Array<[Partial<QuickChallengePayload>, RegExp]> = [
      [{ i: ['swap'] }, /locker/],
      [{ g: [0, 3] }, /Upgrader/],
      [{ w: [['a', 0]] }, /Power-ups/],
      [{ x: { ...honest.x, ic: 'GK' } }, /Icon/],
      [{ x: { ...honest.x, m: 'arch-tactician' } }, /manager/],
    ]
    for (const [extra, reason] of forged) {
      const c = { ...honest, ...extra } as QuickChallengePayload
      expect(nonStandardRun(c, daily.rules)).toMatch(reason)
      const v = verifyDaily(u, pinFor(daily), bodyOf(g, c), NOW, never)
      expect(v.ok, JSON.stringify(extra)).toBe(false)
      // Refused by the link's own checks (a tray use with no tray in the rules) or by the ranked check
      if (!v.ok) {
        expect(['puzzle_mismatch', 'invalid_payload']).toContain(v.code)
      }
    }
    // A Daily whose rules were changed to a mode never matches the pinned puzzle
    const crazy = decodeChallenge(encodeChallenge(honest))
    if (isArenaPayload(crazy)) throw new Error('not a quick link')
    const v = verifyDaily(u, pinFor(daily), bodyOf(g, { ...crazy, s: { ...crazy.s, r: { ...crazy.s.r, modes: ['crazy'] } } } as QuickChallengePayload), NOW, never)
    expect(v.ok).toBe(false)
  }, 60_000)
})
