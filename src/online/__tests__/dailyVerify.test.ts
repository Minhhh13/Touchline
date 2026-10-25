import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, canUse, eligibleSlots, isComplete, pick, respin, spin } from '@engine/draft'
import { decodeChallenge, encodeChallenge, historyKey, picksFromHistory, replayDraft, rulesDiff, type ChallengePayload } from '@engine/challenge'
import { ENGINE_VERSION } from '@engine/version'
import type { Game, GameSettings } from '@game/types'
import { createGame, dailyGameSettings } from '@game/logic/setup'
import { closeJanuary, kickOff, runQuickSeason, toKickoff } from '@game/logic/quick'
import { DAILY_RULES } from '@game/logic/daily'
import { challengeFromGame, replayChallenge } from '@game/logic/challenge'
import { HIDDEN_CHARS, maxDraftRows, puzzleOf, settingsHash, strictReplayDraft, verifyDaily, verifyWeekly, type PuzzlePin, type RankedBody, type Verdict } from '../server/dailyVerify'
import { buildRankedSubmission, dailyStartSettings, weeklyStartSettings } from '../daily'
import { weekKeyOf, weekKeyOfSeed, weekStartOf, weeklyGameSettings, weeklyIsOpen } from '../weekly'

const u = loadTestUniverse()
const SEED = 'daily-2026-10-25'
const NOW = new Date('2026-10-25T12:00:00Z')
const never = () => false

// ------------------------------------------------- the store's draft actions, exactly

function withRng(g: Game, f: (rng: Rng) => void) {
  const rng = Rng.fromState(g.rngState)
  f(rng)
  g.rngState = rng.getState()
}
const doSpin = (g: Game) => withRng(g, (rng) => spin(u, g.draft!, rng))
const doRespin = (g: Game) => withRng(g, (rng) => respin(u, g.draft!, rng))
/** The player's pick: the best usable player of the landed club-season, in his first eligible slot (or the bench). */
function doPickBest(g: Game) {
  const d = g.draft!
  const cs = u.clubSeasonByKey[`${d.current!.clubId}@${d.current!.season}`]
  const best = cs.squad.filter((p) => canUse(d, p)).sort((a, b) => b.overall - a.overall)[0]
  pick(u, d, best.id, eligibleSlots(d, best)[0]?.id ?? 'bench')
}
/** `autoDraftRest` in store.ts. */
function doAutoRest(g: Game) {
  withRng(g, (rng) => {
    const d = g.draft!
    if (d.current) d.history.push({ ...d.current, pickedId: null, slotId: null, skipped: true, ...(d.twist ? { twist: d.twist } : {}) })
    d.current = null
    d.twist = null
    autoDraft(u, d, rng)
  })
}

function pinFor(settings: GameSettings, over: Partial<PuzzlePin> = {}): PuzzlePin {
  return { kind: 'daily', key: settings.seed.slice(6), seed: settings.seed, settings: puzzleOf(settings), settingsHash: settingsHash(settings), engineVersion: ENGINE_VERSION, dataVersion: u.generatedAt, ...over }
}

function finished(settings: GameSettings, script: (g: Game) => void): Game {
  const g = createGame(settings)
  script(g)
  runQuickSeason(g, u)
  return g
}

const body = (g: Game, payload?: ChallengePayload) => ({ encoded: encodeChallenge(payload ?? challengeFromGame(g, u, 'Tester')!), teamName: g.settings.teamName, shortName: g.settings.shortName })

function expectRanked(v: Verdict, g: Game) {
  if (!v.ok) throw new Error(`expected ranked, got ${v.code}: ${v.reason}`)
  const q = g.quickResult!
  expect(v.entry).toMatchObject({ points: q.points, won: q.won, drawn: q.drawn, lost: q.lost, goals_for: q.goalsFor, goals_against: q.goalsAgainst, league_position: q.position, tier: q.tier, claim_matched: true, engine_version: ENGINE_VERSION, data_version: u.generatedAt })
  expect(v.entry.xi).toHaveLength(11)
  expect(v.entry.points).toBe(3 * v.entry.won + v.entry.drawn)
  return v.entry
}

// The verifier replays whatever `DAILY_RULES` (src/game/logic/daily.ts) says, never a literal: the owner's decision
// is two re-spins (restored with dailyPin.test.ts on another branch), and this suite follows whichever value lands.
describe('the Daily the verifier replays is DAILY_RULES', () => {
  it('pins the Daily rules', () => {
    const s = dailyGameSettings(u, SEED)
    expect(s.rules).toEqual(DAILY_RULES)
    expect(s.rules.squadSize).toBe(11)
    expect(s.rules.twists).toBe(true)
    expect(maxDraftRows(createGame(s).draft!)).toBe(11 + DAILY_RULES.respins + 1)
  })
})

describe('verifyDaily: honest runs rank on the replay, with the figures the game produced', () => {
  const daily = dailyGameSettings(u, SEED, 'Verified FC')
  const pin = pinFor(daily)
  const scripts: Array<[string, (g: Game) => void]> = [
    ['no re-spin, all Auto-complete', (g) => doAutoRest(g)],
    ['one re-spin, then Auto-complete over a pending spin', (g) => {
      doSpin(g)
      doRespin(g)
      doAutoRest(g)
    }],
    ['every re-spin and every pick by hand', (g) => {
      doSpin(g)
      for (let i = 0; i < DAILY_RULES.respins; i++) doRespin(g)
      doPickBest(g)
      while (!isComplete(g.draft!)) {
        doSpin(g)
        doPickBest(g)
      }
    }],
    ['every re-spin spent, then Auto-complete discards a pending spin', (g) => {
      doSpin(g)
      doPickBest(g)
      doSpin(g)
      for (let i = 0; i < DAILY_RULES.respins; i++) doRespin(g)
      doPickBest(g)
      doSpin(g)
      doAutoRest(g)
    }],
  ]

  for (const [name, script] of scripts) {
    it(name, () => {
      const g = finished(daily, script)
      const v = verifyDaily(u, pin, body(g), NOW, never)
      const entry = expectRanked(v, g)
      // Parity with the ghost-draft replay every opener runs: the same figures
      const replay = replayChallenge(u, decodeChallenge(body(g).encoded))
      expect(replay.verified).toBe('yes')
      expect(replay.result).toEqual({ pts: entry.points, w: entry.won, d: entry.drawn, l: entry.lost, t: entry.tier })
    }, 120000)
  }

  it('ranks an inflated claim on the replay\'s figures, with claimMatched false', () => {
    const g = finished(daily, (x) => doAutoRest(x))
    const c = challengeFromGame(g, u, 'Tester')!
    const v = verifyDaily(u, pin, body(g, { ...c, c: { ...c.c, pts: c.c.pts + 12, w: c.c.w + 4 } }), NOW, never)
    if (!v.ok) throw new Error(v.reason)
    expect(v.entry.points).toBe(g.quickResult!.points)
    expect(v.entry.claim_matched).toBe(false)
  }, 120000)

  it('stores the run under the team name, never the device\'s manager name (the payload turns public)', () => {
    const g = finished(daily, (x) => doAutoRest(x))
    const posted = challengeFromGame(g, u, 'Jane Q Private')!
    const v = verifyDaily(u, pin, body(g, posted), NOW, never)
    if (!v.ok) throw new Error(v.reason)
    const stored = decodeChallenge(v.entry.payload)
    expect(stored.name).toBe('Verified FC')
    expect(Buffer.from(v.entry.payload, 'base64url').toString('utf8')).not.toContain('Jane')
    // the same draft, claim and puzzle: it still races and replays as the poster's run
    expect({ ...stored, name: posted.name }).toEqual(decodeChallenge(encodeChallenge(posted)))
    expect(replayChallenge(u, stored).verified).toBe('yes')
  }, 120000)

  it('accepts yesterday\'s Daily shortly after midnight', () => {
    const g = finished(daily, (x) => doAutoRest(x))
    const v = verifyDaily(u, pin, body(g), new Date('2026-10-26T00:20:00Z'), never)
    expect(v.ok).toBe(true)
  }, 120000)
})

describe('verifyDaily: refusals', () => {
  const daily = dailyGameSettings(u, SEED, 'Verified FC')
  const pin = pinFor(daily)
  const g = createGame(daily)
  doAutoRest(g)
  // A payload is checked before the season runs, so the draft alone makes a valid one
  const honest: ChallengePayload = { v: 1, data: u.generatedAt, engine: ENGINE_VERSION, name: 'T', s: { seed: SEED, f: daily.formationId, l: 'england', wl: ['england'], h: daily.hostClubId, ls: daily.leagueSeason, d: 'calibrated', r: rulesDiff(daily.rules) }, p: picksFromHistory(g.draft!.history, (id) => u.index[id]?.playerId), c: { pts: 70, w: 20, d: 10, l: 8, t: 'EUROPEAN' }, k: historyKey(g.draft!.history) }
  const post = (p: ChallengePayload, over: Partial<{ teamName: string; shortName: string }> = {}) => ({ encoded: encodeChallenge(p), teamName: 'Verified FC', shortName: 'VFC', ...over })
  const code = (v: Verdict) => (v.ok ? 'ok' : `${v.status} ${v.code}`)

  it('409 puzzle_mismatch for a changed formation, host, season or rules', () => {
    expect(code(verifyDaily(u, pin, post({ ...honest, s: { ...honest.s, f: daily.formationId === '4-4-2' ? '4-3-3' : '4-4-2' } }), NOW, never))).toBe('409 puzzle_mismatch')
    expect(code(verifyDaily(u, pin, post({ ...honest, s: { ...honest.s, h: 'arsenal' } }), NOW, never))).toBe('409 puzzle_mismatch')
    expect(code(verifyDaily(u, pin, post({ ...honest, s: { ...honest.s, ls: honest.s.ls - 1 } }), NOW, never))).toBe('409 puzzle_mismatch')
    expect(code(verifyDaily(u, pin, post({ ...honest, s: { ...honest.s, r: { respins: 3 } } }), NOW, never))).toBe('409 puzzle_mismatch')
    expect(code(verifyDaily(u, pin, post({ ...honest, s: { ...honest.s, d: 'realistic' } }), NOW, never))).toBe('409 puzzle_mismatch')
  })

  it('409 engine_mismatch for another engine, in the payload or the pin', () => {
    const v = verifyDaily(u, pin, post({ ...honest, engine: '3' }), NOW, never)
    expect(code(v)).toBe('409 engine_mismatch')
    expect(code(verifyDaily(u, { ...pin, engineVersion: '3' }, post(honest), NOW, never))).toBe('409 engine_mismatch')
  })

  it('409 data_mismatch for data the pin does not allow, or data the verifier does not hold', () => {
    expect(code(verifyDaily(u, pin, post({ ...honest, data: '2026-10-01' }), NOW, never))).toBe('409 data_mismatch')
    expect(code(verifyDaily(u, pin, post({ ...honest, data: '2026-10-01' }), NOW, () => true))).toBe('409 data_mismatch')
    expect(code(verifyDaily(u, { ...pin, dataVersion: '2026-10-01' }, post(honest), NOW, (v) => v === u.generatedAt))).not.toBe('409 data_mismatch')
  })

  it('409 closed outside today and yesterday; 422 for a seed that is not a Daily or a payload that is not one', () => {
    expect(code(verifyDaily(u, pin, post(honest), new Date('2026-10-27T00:00:01Z'), never))).toBe('409 closed')
    expect(code(verifyDaily(u, pin, post(honest), new Date('2026-10-24T23:59:00Z'), never))).toBe('409 closed')
    expect(code(verifyDaily(u, pin, post({ ...honest, s: { ...honest.s, seed: 'K7Q2-MX9A' } }), NOW, never))).toBe('422 invalid_payload')
    expect(code(verifyDaily(u, pin, { encoded: 'not-a-payload', teamName: 'A', shortName: 'AB' }, NOW, never))).toBe('422 invalid_payload')
    expect(code(verifyDaily(u, pin, { encoded: 'A'.repeat(9000), teamName: 'A', shortName: 'AB' }, NOW, never))).toBe('422 invalid_payload')
    // Yesterday's seed against today's pin
    expect(code(verifyDaily(u, pin, post({ ...honest, s: { ...honest.s, seed: 'daily-2026-10-24' } }), NOW, never))).toBe('409 puzzle_mismatch')
  })

  it('422 invalid_team for a bad team name or short name, used exactly as given otherwise', () => {
    expect(code(verifyDaily(u, pin, post(honest, { teamName: '' }), NOW, never))).toBe('422 invalid_team')
    expect(code(verifyDaily(u, pin, post(honest, { teamName: 'x'.repeat(29) }), NOW, never))).toBe('422 invalid_team')
    expect(code(verifyDaily(u, pin, post(honest, { teamName: 'Bad\u0007Name' }), NOW, never))).toBe('422 invalid_team')
    expect(code(verifyDaily(u, pin, post(honest, { shortName: 'vf' }), NOW, never))).toBe('422 invalid_team')
    expect(code(verifyDaily(u, pin, post(honest, { shortName: 'ABCD' }), NOW, never))).toBe('422 invalid_team')
    // Names that pose as another on the board: zero-width, bidi override, byte-order mark, no-break space, padding
    for (const teamName of ['Verified\u200bFC', 'Verified \u202eCF', 'Verified FC\ufeff', 'Verified\u00a0FC', ' Verified FC', 'Verified FC ']) {
      expect(code(verifyDaily(u, pin, post(honest, { teamName }), NOW, never))).toBe('422 invalid_team')
    }
    // Accented and non-Latin names are fine (28 code points, not UTF-16 units)
    expect(code(verifyDaily(u, pin, post(honest, { teamName: 'Hà Nội FC' }), NOW, never))).not.toBe('422 invalid_team')
    expect(code(verifyDaily(u, pin, post(honest, { teamName: '\u{1F981}'.repeat(28) }), NOW, never))).not.toBe('422 invalid_team')
  }, 300000)

  it('422 for a body whose fields are not text (the Edge Function passes raw JSON)', () => {
    const bad = (b: unknown) => code(verifyDaily(u, pin, b as RankedBody, NOW, never))
    expect(bad(null)).toBe('422 invalid_payload')
    expect(bad({ encoded: 42, teamName: 'Verified FC', shortName: 'VFC' })).toBe('422 invalid_payload')
    expect(bad({ encoded: encodeChallenge(honest), teamName: 12345, shortName: 'VFC' })).toBe('422 invalid_team')
    expect(bad({ encoded: encodeChallenge(honest), teamName: ['Verified FC'], shortName: 'VFC' })).toBe('422 invalid_team')
    expect(bad({ encoded: encodeChallenge(honest), teamName: 'Verified FC', shortName: ['VFC'] })).toBe('422 invalid_team')
  })

  it('refuses the same hidden characters as the database (private.is_clean_name)', () => {
    const sql = readFileSync(path.resolve(__dirname, '../../../supabase/migrations/20261025093008_review_hardening.sql'), 'utf8')
    const m = /p !~ '(\[[^']+\])'/.exec(sql)
    expect(m).not.toBeNull()
    expect(HIDDEN_CHARS.source).toBe(m![1])
  })

  it('422 invalid_picks with the spin number for a tampered draft', () => {
    const p = honest.p.map((r) => [...r] as [string | null, string | null])
    p[3] = ['s999999999', p[3][1]]
    const v = verifyDaily(u, pin, post({ ...honest, p }), NOW, never)
    expect(code(v)).toBe('422 invalid_picks')
    expect(v.ok ? '' : v.reason).toMatch(/^Spin 4: no player s999999999/)
  })
})

describe('strictReplayDraft: the tamper suite over 200 Daily dates', () => {
  type Row = [string | null, string | null]
  const N: Row = [null, null]

  function honestFor(seed: string): { settings: GameSettings; p: Row[]; k: string } {
    const settings = dailyGameSettings(u, seed)
    const g = createGame(settings)
    doAutoRest(g)
    return { settings, p: picksFromHistory(g.draft!.history, (id) => u.index[id]?.playerId) as Row[], k: historyKey(g.draft!.history) }
  }

  const replay = (settings: GameSettings, p: Row[], k: string) => {
    const c = { v: 1, data: u.generatedAt, engine: ENGINE_VERSION, name: 'T', s: { seed: settings.seed, f: settings.formationId, l: 'england', wl: ['england'], h: settings.hostClubId, ls: settings.leagueSeason, d: 'calibrated', r: {} }, p, c: { pts: 0, w: 0, d: 0, l: 0, t: 'RELEGATED' }, k } as ChallengePayload
    strictReplayDraft(u, createGame(settings), c)
  }

  it('passes every honest draft and refuses every tampered one, naming where it broke', () => {
    const start = Date.UTC(2026, 0, 1)
    for (let i = 0; i < 200; i++) {
      const seed = `daily-${new Date(start + i * 86400000).toISOString().slice(0, 10)}`
      const { settings, p, k } = honestFor(seed)
      expect(() => replay(settings, p, k)).not.toThrow()
      const gk = p.findIndex((r) => r[1] === 'GK')
      const outfield = p.findIndex((r) => r[1] !== null && r[1] !== 'GK')
      const tampered: Array<[string, Row[]]> = [
        ['three null rows first (more than the re-spins)', [N, N, N, ...p]],
        ['three null rows mid-draft', [...p.slice(0, 5), N, N, N, ...p.slice(5)]],
        ['twenty-nine null rows (the judge\'s attack)', [...Array.from({ length: 29 }, () => N), ...p]],
        ['two rows swapped', p.map((r, j) => (j === 2 ? p[7] : j === 7 ? p[2] : r))],
        ['the keeper\'s slot swapped with an outfield slot', p.map((r, j) => (j === gk ? [r[0], p[outfield][1]] : j === outfield ? [r[0], 'GK'] : r) as Row)],
        ['a foreign player', p.map((r, j) => (j === 4 ? ['s999999999', r[1]] : r) as Row)],
        ['a slot without a player', p.map((r, j) => (j === 6 ? [null, r[1]] : r) as Row)],
        ['the last pick dropped', p.slice(0, -1)],
      ]
      for (const [what, rows] of tampered) {
        let message = ''
        try {
          replay(settings, rows, k)
        } catch (e) {
          message = e instanceof Error ? e.message : String(e)
        }
        if (!message) throw new Error(`${seed}: "${what}" replayed as honest`)
        expect(message).toMatch(/^Spin \d+|^The draft (has|stopped)|^The wheel did not land|^The spins do not add up/)
      }
    }
  }, 600000)

  it('refuses the free re-spin drafts the lenient replay lets through', () => {
    for (let i = 0; i < 20; i++) {
      const settings = dailyGameSettings(u, `daily-2026-08-${String(i + 1).padStart(2, '0')}`)
      // Re-spin the first three spins, then any spin without someone rated 84 or more (up to 29 times)
      const g = createGame(settings)
      const rng = Rng.fromState(g.rngState)
      const d = g.draft!
      let nulls = 0
      while (!isComplete(d)) {
        const cs = spin(u, d, rng)
        const best = cs.squad.filter((p) => canUse(d, p)).sort((a, b) => b.overall - a.overall)[0]
        if (nulls < 3 || (best.overall < 84 && nulls < 29)) {
          nulls++
          d.history.push({ clubId: cs.clubId, season: cs.season, pickedId: null, slotId: null, ...(d.twist ? { twist: d.twist } : {}) })
          d.current = null
          d.twist = null
          continue
        }
        pick(u, d, best.id, eligibleSlots(d, best)[0]?.id ?? 'bench')
      }
      const p = picksFromHistory(d.history, (id) => u.index[id]?.playerId) as Row[]
      const k = historyKey(d.history)
      expect(nulls).toBeGreaterThan(2)
      const c = { v: 1, data: u.generatedAt, engine: ENGINE_VERSION, name: 'T', s: { seed: settings.seed, f: settings.formationId, l: 'england', wl: ['england'], h: settings.hostClubId, ls: settings.leagueSeason, d: 'calibrated', r: {} }, p, c: { pts: 0, w: 0, d: 0, l: 0, t: 'RELEGATED' }, k } as ChallengePayload
      const lenient = createGame(settings)
      expect(() => replayDraft(u, lenient.draft!, Rng.fromState(lenient.rngState), c)).not.toThrow()
      expect(() => replay(settings, p, k)).toThrow()
    }
  }, 600000)
})

describe('strictReplayDraft: guards the tamper suite does not reach on its own (security review)', () => {
  type Row = [string | null, string | null]
  const payloadOf = (settings: GameSettings, g: Game, k?: string) =>
    ({ v: 1, data: u.generatedAt, engine: ENGINE_VERSION, name: 'T', s: { seed: settings.seed, f: settings.formationId, l: 'england', wl: ['england'], h: settings.hostClubId, ls: settings.leagueSeason, d: 'calibrated', r: {} }, p: picksFromHistory(g.draft!.history, (id) => u.index[id]?.playerId) as Row[], c: { pts: 0, w: 0, d: 0, l: 0, t: 'RELEGATED' }, k: k ?? historyKey(g.draft!.history) }) as ChallengePayload
  /** The player's own pick, never the assistant's: the weakest usable player in his first eligible slot. */
  function pickWorst(g: Game) {
    const d = g.draft!
    const cs = u.clubSeasonByKey[`${d.current!.clubId}@${d.current!.season}`]
    const worst = cs.squad.filter((p) => canUse(d, p) && (eligibleSlots(d, p).length > 0 || !isComplete(d))).sort((a, b) => a.overall - b.overall)[0]
    pick(u, d, worst.id, eligibleSlots(d, worst)[0]?.id ?? 'bench')
  }
  function drafted(settings: GameSettings, respins: number): Game {
    const g = createGame(settings)
    g.draft!.respinsLeft = respins
    doSpin(g)
    for (let i = 0; i < respins; i++) doRespin(g)
    pickWorst(g)
    while (!isComplete(g.draft!)) {
      doSpin(g)
      pickWorst(g)
    }
    return g
  }

  it('refuses one re-spin too many followed by the player\'s own picks, and passes the allowed number', () => {
    for (let i = 0; i < 20; i++) {
      const settings = dailyGameSettings(u, `daily-2026-07-${String(i + 1).padStart(2, '0')}`)
      const allowed = settings.rules.respins
      expect(allowed).toBe(DAILY_RULES.respins)
      const honest = drafted(settings, allowed)
      expect(() => strictReplayDraft(u, createGame(settings), payloadOf(settings, honest))).not.toThrow()
      const extra = drafted(settings, allowed + 1)
      expect(() => strictReplayDraft(u, createGame(settings), payloadOf(settings, extra))).toThrow(/after an auto-complete the assistant drafts the rest/)
    }
  }, 600000)

  it('refuses a history key the wheel did not produce (it is stored with the entry)', () => {
    const settings = dailyGameSettings(u, SEED)
    const g = drafted(settings, 0)
    expect(() => strictReplayDraft(u, createGame(settings), payloadOf(settings, g))).not.toThrow()
    expect(() => strictReplayDraft(u, createGame(settings), payloadOf(settings, g, 'forged'))).toThrow(/did not land on the same club-seasons/)
  })

  it('refuses a seed that only names the day by date overflow (daily-2026-09-55 is 25 October)', () => {
    const settings = dailyGameSettings(u, SEED, 'Verified FC')
    const g = finished(settings, doAutoRest)
    const c = challengeFromGame(g, u, 'Tester')!
    const v = verifyDaily(u, pinFor(settings), body(g, { ...c, s: { ...c.s, seed: 'daily-2026-09-55' } }), NOW, never)
    expect(v).toMatchObject({ ok: false, status: 409, code: 'puzzle_mismatch' })
  })
})

describe('dailyStartSettings', () => {
  const local = dailyGameSettings(u, SEED, 'My Side')

  it('plays the local mapping without a pin or with a matching pin, and ranks only on the pin\'s engine', () => {
    expect(dailyStartSettings(u, SEED, 'My Side', null)).toEqual({ settings: local, source: 'local', ranked: false })
    expect(dailyStartSettings(u, SEED, 'My Side', pinFor(local))).toEqual({ settings: local, source: 'local', ranked: true })
    expect(dailyStartSettings(u, SEED, 'My Side', pinFor(local, { engineVersion: '3' })).ranked).toBe(false)
    // A pin of another day is ignored
    expect(dailyStartSettings(u, SEED, 'My Side', pinFor(dailyGameSettings(u, 'daily-2026-10-24'))).source).toBe('local')
  })

  it('plays the pinned puzzle when this build maps the day differently, with the player\'s team name', () => {
    const changed: GameSettings = { ...local, formationId: local.formationId === '4-4-2' ? '4-3-3' : '4-4-2' }
    const pin = pinFor(changed)
    const d = dailyStartSettings(u, SEED, 'My Side', pin)
    expect(d.source).toBe('pinned')
    expect(d.ranked).toBe(true)
    expect(d.settings).toEqual({ ...changed, teamName: 'My Side', shortName: 'MS' })
  })

  it('falls back to the local puzzle when the pin names a club season this build does not have', () => {
    const missing: GameSettings = { ...local, hostClubId: 'atlantis-fc' }
    expect(dailyStartSettings(u, SEED, 'My Side', pinFor(missing))).toEqual({ settings: local, source: 'missing_data', ranked: false })
  })
})

describe('buildRankedSubmission', () => {
  it('posts a finished Daily, which then verifies as ranked; nothing for an ordinary Quick Draft', () => {
    const daily = dailyGameSettings(u, SEED, 'Posted XI')
    const g = finished(daily, (x) => doAutoRest(x))
    const sub = buildRankedSubmission(g, u, 'Minh')!
    expect(sub.op).toBe('daily.submit')
    expect(sub.teamName).toBe('Posted XI')
    expect(sub.shortName).toBe('PX')
    expectRanked(verifyDaily(u, pinFor(daily), sub, NOW, never), g)
    const quick = finished({ ...daily, mode: 'quick', seed: 'K7Q2-MX9A' }, (x) => doAutoRest(x))
    expect(buildRankedSubmission(quick, u, 'Minh')).toBeNull()
    expect(buildRankedSubmission(createGame(daily), u, 'Minh')).toBeNull()
  }, 120000)
})

describe('the weekly challenge', () => {
  it('keys weeks the way Postgres does (ISO weeks)', () => {
    expect(weekKeyOf(new Date('2026-10-25T23:59:00Z'))).toBe('2026-W43')
    expect(weekKeyOf(new Date('2026-10-19T00:00:00Z'))).toBe('2026-W43')
    expect(weekKeyOf(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53')
    expect(weekKeyOf(new Date('2026-12-31T12:00:00Z'))).toBe('2026-W53')
    expect(weekKeyOf(new Date('2024-12-30T12:00:00Z'))).toBe('2025-W01')
    expect(weekKeyOf(new Date('2021-01-03T12:00:00Z'))).toBe('2020-W53')
    expect(weekKeyOf(new Date('2026-01-01T12:00:00Z'))).toBe('2026-W01')
    expect(weekStartOf('2026-W43')?.toISOString().slice(0, 10)).toBe('2026-10-19')
    expect(weekStartOf('2025-W01')?.toISOString().slice(0, 10)).toBe('2024-12-30')
    expect(weekStartOf('2025-W53')).toBeNull()
    expect(weekStartOf('2026-W00')).toBeNull()
    expect(weekKeyOfSeed('weekly-2026-W43')).toBe('2026-W43')
    expect(weekKeyOfSeed('daily-2026-10-25')).toBeNull()
  })

  it('opens on the Monday and closes at 00:00 UTC on the Tuesday after the week', () => {
    expect(weeklyIsOpen('2026-W43', new Date('2026-10-18T23:59:59Z'))).toBe(false)
    expect(weeklyIsOpen('2026-W43', new Date('2026-10-19T00:00:00Z'))).toBe(true)
    expect(weeklyIsOpen('2026-W43', new Date('2026-10-26T23:59:59Z'))).toBe(true)
    expect(weeklyIsOpen('2026-W43', new Date('2026-10-27T00:00:00Z'))).toBe(false)
  })

  it('maps every week of a year to a real complete club season, the same way each time', () => {
    const seen = new Set<string>()
    for (let w = 1; w <= 52; w++) {
      const key = `2026-W${String(w).padStart(2, '0')}`
      const s = weeklyGameSettings(u, key)
      expect(weeklyGameSettings(u, key)).toEqual(s)
      expect(u.clubSeasonByKey[`${s.hostClubId}@${s.leagueSeason}`]?.complete).toBe(true)
      expect(s.rules).toEqual(DAILY_RULES)
      expect(s.january).toBe(true)
      expect(s.continental).toBe(false)
      expect(s.mode).toBe('quick')
      expect(s.seed).toBe(`weekly-${key}`)
      seen.add(`${s.hostClubId}@${s.leagueSeason}@${s.formationId}`)
    }
    expect(seen.size).toBeGreaterThan(45)
    const w43 = weeklyGameSettings(u, '2026-W43')
    expect([w43.hostClubId, w43.leagueSeason, w43.formationId]).toEqual(WEEK_43)
  })

  it('verifies a weekly run like a Daily, and refuses a Daily posted to the week or a closed week', () => {
    const key = '2026-W43'
    const settings = weeklyGameSettings(u, key, 'Weekly XI')
    const pin = pinFor(settings, { kind: 'weekly', key, seed: settings.seed })
    expect(weeklyStartSettings(u, key, 'Weekly XI', pin)).toEqual({ settings, source: 'local', ranked: true })
    const g = finished(settings, (x) => doAutoRest(x))
    const sub = buildRankedSubmission(g, u, 'Minh')!
    expect(sub.op).toBe('weekly.submit')
    const v = verifyWeekly(u, pin, sub, NOW, never)
    expectRanked(v, g)
    expect(v.ok && v.key).toBe(key)
    expect(verifyWeekly(u, pin, sub, new Date('2026-10-27T00:00:01Z'), never)).toMatchObject({ ok: false, code: 'closed' })
    const daily = finished(dailyGameSettings(u, SEED), (x) => doAutoRest(x))
    expect(verifyWeekly(u, pin, body(daily), NOW, never)).toMatchObject({ ok: false, code: 'invalid_payload' })
  }, 120000)
})

// Week 43 of 2026, pinned like the Daily's mapping test: a change here changes a live week for everyone
const WEEK_43: [string, number, string] = ['southampton', 2018, '4-4-2-diamond']

// ------------------------------------------------- the season's own choices (main's quick season: tactics, January)

describe('verifyDaily replays the season the player chose, as a challenge link does', () => {
  const daily = dailyGameSettings(u, SEED, 'Verified FC')
  const pin = pinFor(daily)

  /** The store's quick-season path: the draft, the Kick-off tactics, the first half, then the January window. */
  function withWindow(deal: (g: Game) => number | null, secondHalf?: (g: Game) => void): Game {
    const g = createGame(daily)
    doAutoRest(g)
    toKickoff(g, u)
    g.tactics.mentality = 'attacking'
    g.tactics.pressing = 'high'
    g.captainId = Object.values(g.lineup)[3]
    kickOff(g, u)
    expect(g.phase).toBe('january')
    secondHalf?.(g)
    closeJanuary(g, u, deal(g))
    expect(g.quickResult).toBeTruthy()
    return g
  }

  it('ranks a run with Kick-off tactics, a January deal and new second-half tactics on its own figures', () => {
    const g = withWindow((x) => (x.quickJanuary!.listings.length ? 0 : null), (x) => {
      x.tactics.mentality = 'defensive'
    })
    const c = challengeFromGame(g, u, 'Tester')!
    expect(c.x?.t).toBeTruthy()
    // The old verifier played the season with default tactics and no deal: the official figures were not the player's
    const entry = expectRanked(verifyDaily(u, pin, body(g), NOW, never), g)
    expect(entry.xi).toEqual(Object.values(g.lineup))
    const replay = replayChallenge(u, decodeChallenge(body(g).encoded))
    expect(replay.result).toEqual({ pts: entry.points, w: entry.won, d: entry.drawn, l: entry.lost, t: entry.tier })
  }, 120000)

  it('ranks a run that passed the window with its Kick-off tactics', () => {
    const g = withWindow(() => null)
    expectRanked(verifyDaily(u, pin, body(g), NOW, never), g)
  }, 120000)

  it('refuses a January deal that was not on offer, a captain or penalty taker from outside the squad, and bench changes on a Daily', () => {
    const g = withWindow(() => null)
    const c = challengeFromGame(g, u, 'Tester')!
    const outsider = u.clubSeasons.find((cs) => cs.leagueId === 'england')!.squad.find((p) => !Object.values(g.draft!.lineup).includes(p.id) && !g.draft!.bench.includes(p.id))!.id
    const slot = Object.keys(g.lineup)[0]
    const cases: Array<[ChallengePayload['x'], RegExp]> = [
      [{ ...c.x, j: [outsider, slot] }, /January deal was not on offer/],
      [{ ...c.x, t: { ...c.x?.t, captain: outsider } }, /captain is not in the drafted squad/],
      [{ ...c.x, t: { ...c.x?.t, penalties: outsider } }, /penalty taker is not in the drafted squad/],
      [{ ...c.x, s: [[5, slot, outsider]] }, /Bench changes on a puzzle without a bench/],
    ]
    for (const [x, reason] of cases) {
      const v = verifyDaily(u, pin, body(g, { ...c, x }), NOW, never)
      expect(v).toMatchObject({ ok: false, status: 422, code: 'invalid_picks' })
      if (!v.ok) expect(v.reason).toMatch(reason)
    }
  }, 120000)
})
