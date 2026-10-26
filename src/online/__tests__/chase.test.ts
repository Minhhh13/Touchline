import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { decodeChallenge, encodeChallenge } from '@engine/challenge'
import { QUICK_RULES } from '@engine/draft'
import { ENGINE_VERSION } from '@engine/version'
import type { LeaguesFile } from '@engine/universe'
import { challengeFromGame } from '@game/logic/challenge'
import { quickManagerOptions, setManager } from '@game/logic/managers'
import { createGame } from '@game/logic/setup'
import { runQuickSeason } from '@game/logic/quick'
import { Rng } from '@engine/rng'
import { autoDraft } from '@engine/draft'
import { CHASE_FORMATIONS, CHASE_NON_STANDARD_RULES, CHASE_RULES, NOT_A_CHASE_RUN, buildChaseSubmission, chaseCodeOfSeed, chaseGameSettings, chaseLeagues, chaseNonStandardRule, chaseUnrankedReason, isChaseGame } from '../chase'
import { NON_STANDARD_RULES } from '../daily'
import { settingsHash } from '../server/dailyVerify'
import { verifyChase, type ChaseAttempt } from '../server/chaseVerify'
import { autoPlayed } from './serverHarness'
import { chaseRowFrom, chaseStatusFrom, chaseSummaryFrom } from '../boards'
import { parseRequest } from '../server/validate'

const u = loadTestUniverse()
const CODES = ['K7Q2MX9A3B', 'AAAAAAAAAB', 'ZZZZ2222YY', 'HJKLMNPQRS', '23456789AB', 'QWERTYUPAS']
const attemptFor = (code: string, leagueId = 'england', formationId = '4-3-3'): ChaseAttempt => ({ code, seed: `chase-${code}`, leagueId, formationId, engineVersion: ENGINE_VERSION, dataVersion: u.generatedAt, createdAt: '2026-10-26T10:00:00Z', expiresAt: '2026-10-28T10:00:00Z', submittedAt: null })
const NOW = new Date('2026-10-26T12:00:00Z')

describe('the chase seed and its mapping', () => {
  it('reads only chase seeds with a ten-character code of the seed alphabet', () => {
    expect(chaseCodeOfSeed('chase-K7Q2MX9A3B')).toBe('K7Q2MX9A3B')
    for (const bad of ['chase-K7Q2MX9A3', 'chase-K7Q2MX9A3BC', 'chase-K7Q2MX9AOB', 'chase-k7q2mx9a3b', 'K7Q2-MX9A', 'daily-2026-10-26', 'weekly-2026-W43']) expect(chaseCodeOfSeed(bad)).toBeNull()
  })

  it('is the standard Quick Draft: QUICK_RULES at normal difficulty, the plain manager pick, nothing non-standard', () => {
    for (const [k, v] of Object.entries(QUICK_RULES)) expect(CHASE_RULES[k as keyof typeof CHASE_RULES]).toEqual(v)
    expect(CHASE_RULES.managerSpin).toBeUndefined()
    // The ranked boards' list less the plain manager pick: the spin, modes, power-ups, Super League, case, classic, cap and chain stay off
    expect([...CHASE_NON_STANDARD_RULES].sort()).toEqual(NON_STANDARD_RULES.filter((k) => k !== 'managers').sort())
    expect(CHASE_NON_STANDARD_RULES).toContain('managerSpin')
    const s = chaseGameSettings(u, CODES[0], 'england', '4-3-3', 'Chase FC')!
    expect(chaseNonStandardRule(s)).toBeNull()
    expect(s).toMatchObject({ mode: 'quick', seed: `chase-${CODES[0]}`, formationId: '4-3-3', leagueId: 'england', wheelLeagues: ['england'], difficulty: 'calibrated', jobSecurity: false, january: true, continental: false, teamName: 'Chase FC', shortName: 'CF' })
    expect(s.rules.leagues).toEqual(['england'])
    expect(isChaseGame(s)).toBe(true)
    expect(isChaseGame({ ...s, challenge: { name: 'x', picks: [], claim: { pts: 0, w: 0, d: 0, l: 0, t: 'MID_TABLE' }, verified: 'yes', data: '', engine: '' } })).toBe(false)
    for (const k of CHASE_NON_STANDARD_RULES) expect(chaseNonStandardRule({ rules: { ...s.rules, [k]: k === 'modes' ? ['crazy'] : k === 'budget' ? 180 : true } })).toBe(k)
  })

  it('maps every attempt to a complete real season of its league and a real host, the same on every call', () => {
    for (const code of CODES) {
      const a = chaseGameSettings(u, code, 'england', '4-4-2')!
      const b = chaseGameSettings(u, code, 'england', '4-4-2')!
      expect(settingsHash(a)).toBe(settingsHash(b))
      const host = u.clubSeasonByKey[`${a.hostClubId}@${a.leagueSeason}`]
      expect(host?.complete).toBe(true)
      expect(host?.classic).toBeFalsy()
      expect(host?.leagueId).toBe('england')
    }
    // Different codes spread over seasons rather than all landing on one
    expect(new Set(CODES.map((c) => chaseGameSettings(u, c, 'england', '4-3-3')!.leagueSeason)).size).toBeGreaterThan(1)
    expect(chaseGameSettings(u, 'K7Q2MX9A3', 'england', '4-3-3')).toBeNull()
    expect(chaseGameSettings(u, CODES[0], 'england', '9-9-9')).toBeNull()
    expect(chaseGameSettings(u, CODES[0], 'germany', '4-3-3')).toBeNull()
    expect(CHASE_FORMATIONS).toContain('4-4-2-diamond')
  })

  it('works in every league of the data, 18-club leagues included', () => {
    const index = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'public', 'data', 'leagues.json'), 'utf8')) as LeaguesFile
    const all = loadTestUniverse(index.leagues.map((l) => l.id))
    expect(chaseLeagues(all).sort()).toEqual(index.leagues.map((l) => l.id).sort())
    for (const l of index.leagues) {
      const s = chaseGameSettings(all, CODES[1], l.id, '4-2-3-1')!
      expect(s.leagueId).toBe(l.id)
      expect(all.clubSeasonByKey[`${s.hostClubId}@${s.leagueSeason}`]?.leagueId).toBe(l.id)
    }
  }, 60_000)
})

describe('eligibility on the Summary', () => {
  const chase = autoPlayed(u, chaseGameSettings(u, CODES[0], 'england', '4-3-3', 'Chase FC')!)

  it('accepts a standard chase run and builds its post', () => {
    expect(chaseUnrankedReason(chase, u)).toBeNull()
    const sub = buildChaseSubmission(chase, u, 'Minh')!
    expect(sub).toMatchObject({ op: 'chase.submit', teamName: 'Chase FC', shortName: 'CF' })
    expect(decodeChallenge(sub.encoded).s.seed).toBe(`chase-${CODES[0]}`)
  }, 60_000)

  it('says why anything else is not on the chase', () => {
    const quick = autoPlayed(u, { ...chaseGameSettings(u, CODES[0], 'england', '4-3-3')!, seed: 'K7Q2-MX9A' })
    expect(chaseUnrankedReason(quick, u)).toBe(NOT_A_CHASE_RUN)
    expect(buildChaseSubmission(quick, u, 'Minh')).toBeNull()
    // A chase seed played with other options (realistic opposition, the manager spin) is not its attempt
    const realistic = { ...chase, settings: { ...chase.settings, difficulty: 'realistic' as const } }
    expect(chaseUnrankedReason(realistic, u)).toMatch(/not its chase attempt/)
    const spun = { ...chase, settings: { ...chase.settings, rules: { ...chase.settings.rules, managerSpin: true } } }
    expect(chaseUnrankedReason(spun, u)).toMatch(/outside the standard Quick Draft/)
    const iconed = { ...chase, endCase: { sub: { slotId: 'ST', id: 'x' } } } as unknown as typeof chase
    expect(chaseUnrankedReason(iconed, u)).toMatch(/Icon/)
  }, 60_000)
})

describe('verifyChase', () => {
  const play = (code: string, before?: (g: ReturnType<typeof createGame>) => void) => {
    const g = createGame(chaseGameSettings(u, code, 'england', '4-3-3', 'Chase FC')!)
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    before?.(g)
    runQuickSeason(g, u)
    return g
  }
  const body = (g: ReturnType<typeof createGame>) => ({ encoded: encodeChallenge(challengeFromGame(g, u, 'Tester')!), teamName: g.settings.teamName, shortName: g.settings.shortName })

  it('ranks an honest run on the replay, with the plain manager pick', () => {
    const g = play(CODES[2], (x) => {
      // The last manager offered rather than the default first: the pick travels in the link (x.m) and replays
      const options = quickManagerOptions(x)
      expect(options.length).toBeGreaterThan(0)
      setManager(x, options[options.length - 1].id)
    })
    expect(g.manager).toBeDefined()
    expect(chaseUnrankedReason(g, u)).toBeNull()
    const v = verifyChase(u, attemptFor(CODES[2]), body(g), NOW, () => false)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const q = g.quickResult!
    expect(v.key).toBe(CODES[2])
    expect(v.entry).toMatchObject({ points: q.points, won: q.won, drawn: q.drawn, lost: q.lost, goals_for: q.goalsFor, goals_against: q.goalsAgainst, claim_matched: true })
  }, 60_000)

  it('refuses another attempt, another league or shape, a closed attempt and other engines or data', () => {
    const g = play(CODES[3])
    const b = body(g)
    expect(verifyChase(u, attemptFor(CODES[4]), b, NOW, () => false)).toMatchObject({ ok: false, code: 'puzzle_mismatch' })
    expect(verifyChase(u, attemptFor(CODES[3], 'england', '4-4-2'), b, NOW, () => false)).toMatchObject({ ok: false, code: 'puzzle_mismatch' })
    expect(verifyChase(u, attemptFor(CODES[3]), b, new Date('2026-10-28T10:00:00Z'), () => false)).toMatchObject({ ok: false, code: 'closed' })
    expect(verifyChase(u, { ...attemptFor(CODES[3]), engineVersion: '3' }, b, NOW, () => false)).toMatchObject({ ok: false, code: 'engine_mismatch' })
    expect(verifyChase(u, { ...attemptFor(CODES[3]), dataVersion: '2026-01-01' }, b, NOW, () => false)).toMatchObject({ ok: false, code: 'data_mismatch' })
    expect(verifyChase(u, attemptFor(CODES[3]), { ...b, teamName: 'Chase​FC' }, NOW, () => false)).toMatchObject({ ok: false, code: 'invalid_team' })
    // A Quick Draft on its own seed is not a chase run at all
    const quick = autoPlayed(u, { ...chaseGameSettings(u, CODES[3], 'england', '4-3-3')!, seed: 'K7Q2-MX9A' })
    expect(verifyChase(u, attemptFor(CODES[3]), body(quick), NOW, () => false)).toMatchObject({ ok: false, code: 'invalid_payload' })
  }, 60_000)
})

describe('the chase requests and board rows', () => {
  it('parses chase.start strictly and chase.submit like the other posts', () => {
    expect(parseRequest(JSON.stringify({ op: 'chase.start', leagueId: 'england', formationId: '4-3-3', engine: '4', data: '2026-10-25' }))).toEqual({ ok: true, value: { op: 'chase.start', leagueId: 'england', formationId: '4-3-3', engine: '4', data: '2026-10-25' } })
    for (const bad of [{ leagueId: 'England' }, { formationId: '4 3 3' }, { engine: '' }, { data: 'x'.repeat(41) }, { seed: 'chase-K7Q2MX9A3B' }]) {
      expect(parseRequest(JSON.stringify({ op: 'chase.start', leagueId: 'england', formationId: '4-3-3', engine: '4', data: '2026-10-25', ...bad })).ok).toBe(false)
    }
    expect(parseRequest(JSON.stringify({ op: 'chase.submit', encoded: 'abc', teamName: 'A', shortName: 'AB' }))).toMatchObject({ ok: true, value: { op: 'chase.submit' } })
  })

  it('reads the database rows into plain shapes', () => {
    const row = chaseRowFrom({ board_position: '2', display_name: 'Minh', country: 'VN', team_name: 'Chase FC', league_id: 'germany', games: 34, points: 100, won: 33, drawn: 1, lost: 0, goals_for: 95, goals_against: 20, goal_diff: 75, dropped: 2, perfect: false, league_position: 1, tier: 'INVINCIBLE', created_at: '2026-10-26', is_me: true, payload: 'abc' })
    expect(row).toMatchObject({ position: 2, country: 'VN', leagueId: 'germany', games: 34, dropped: 2, perfect: false, isMe: true, payload: 'abc' })
    const sum = chaseSummaryFrom([{ players: 3, runs: 5, flawless: 1, my_position: null, my_points: null, record_display_name: 'Carol', record_points: 114, record_won: 38, record_drawn: 0, record_lost: 0, record_games: 38, record_league_id: 'england', record_flawless: 2 }])
    expect(sum).toMatchObject({ players: 3, runs: 5, flawless: 1, myPosition: null, my: null, record: { name: 'Carol', won: 38, games: 38 }, recordFlawless: 2 })
    expect(chaseSummaryFrom([]).record).toBeNull()
    expect(chaseStatusFrom([{ attempts_today: 2, cap: 5, attempts_left: 3, resets_at: '2026-10-27T00:00:00Z', runs: 1, best_points: null }])).toMatchObject({ attemptsToday: 2, left: 3, best: null })
    expect(chaseStatusFrom([])).toBeNull()
  })
})
