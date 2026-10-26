/**
 * Content depth (commentary colour, the inbox's flavour, the pundit's verdict, the Trophy Room's milestones) is
 * display only. The three hashes below were captured on 9ad0a24, before any of it: a seeded Quick Draft, a Daily and a
 * Season must play to exactly the same result now. Reading a game for every new piece of text, mid-season and at the
 * summary, must leave the game byte-identical and the season it goes on to play the same.
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { feedFromResult } from '@engine/matchFeed'
import { computeTable, USER_TEAM } from '@engine/season'
import { createGame, beginSeason, dailyGameSettings } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { closeJanuary, kickOff, toKickoff } from '../logic/quick'
import { creditGame, emptyCabinet } from '../logic/cabinet'
import { milestoneStates } from '../logic/milestoneBadges'
import { newsBody } from '../logic/newsFlavour'
import { punditVerdict, verdictInputOf } from '../logic/pundit'
import { commentaryUpTo } from '../../ui/match/commentary'
import { commentaryContextFor } from '../../ui/match/commentaryColour'
import { matchPath } from '../../ui/match/epochs'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])
const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex')

function quickSettings(seed: string): GameSettings {
  return { mode: 'quick', seed, formationId: '4-4-2', teamName: 'Content XI', shortName: 'CXI', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2023, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: false }
}

function playQuick(s: GameSettings): Game {
  const g = createGame(s)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, u)
  kickOff(g, u)
  if (g.phase === 'january') closeJanuary(g, u, null)
  expect(g.phase).toBe('summary')
  return g
}

/** Every new piece of text a finished or running game can show, read the way the screens read it. */
function readForDisplay(g: Game): string[] {
  const out: string[] = []
  const v = verdictInputOf(g, g.quickResult?.table.length ?? 20)
  if (v) out.push(punditVerdict(v))
  const profile = { achievements: { boot30: '2026-10-26' }, leaderboard: [], seasonsSimulated: 3, dailyResults: {}, quickBests: { longestPerfectRun: 12 } }
  out.push(...milestoneStates({ cabinet: creditGame(emptyCabinet(), g), profile }).map((m) => `${m.badge.id}:${m.value}:${m.progress}`))
  for (const n of g.season?.news ?? []) out.push(newsBody(n))
  const last = g.lastMatch
  if (last) {
    const feed = feedFromResult(last, 'content-last', { home: 'HOM', away: 'AWA' })
    const ctx = commentaryContextFor(g, last.homeTeamId, last.awayTeamId, true)
    out.push(...commentaryUpTo(feed, matchPath(feed), feed.lastMinute, { home: 'HOM', away: 'AWA' }, (id) => u.index[id]?.name, [], ctx).map((l) => l.text))
  }
  return out
}

/** Read for display and prove nothing moved: the game's JSON is the same before and after, and reading twice reads the same. */
function readsWithoutTouching(g: Game): string[] {
  const before = JSON.stringify(g)
  const a = readForDisplay(g)
  expect(JSON.stringify(g)).toBe(before)
  expect(readForDisplay(g)).toEqual(a)
  return a
}

const QUICK_PIN = '4b00593a3c0647773b684ac8072f8a9aab6793d987bbabe01c45ce8ef5feb9ab'
const DAILY_PIN = '95167753ae2ccace60a8dac32911d03f8ac6a38f841b945fbf379b8fcd8c843c'
const SEASON_PIN = '1759f877dd5c9b7b94d574b314aa989c87403969f12b3be14d286ac460f1f636'

describe('content depth is display only', () => {
  it('plays a seeded Quick Draft and the Daily to the results they had before, and reading them changes nothing', () => {
    const q = playQuick(quickSettings('content-quick-1'))
    expect(hash([q.quickResult, q.rngState, q.tier])).toBe(QUICK_PIN)
    expect(readsWithoutTouching(q).length).toBeGreaterThan(10)
    const d = playQuick(dailyGameSettings(u, 'daily-2026-10-26', 'Content XI'))
    expect(hash([d.quickResult, d.rngState, d.tier])).toBe(DAILY_PIN)
    readsWithoutTouching(d)
  }, 300_000)

  it('plays a Season read for its commentary, inbox and verdict every few weeks to the end it had before', () => {
    const g = createGame({ mode: 'season', seed: 'content-season-1', formationId: '4-3-3', teamName: 'Content XI', shortName: 'CXI', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2022, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    startSeasonProper(g)
    let guard = 0
    let read = 0
    while (g.phase !== 'summary' && guard++ < 60) {
      playMatchweek(g, u, true)
      if (guard % 5 === 0) read += readsWithoutTouching(g).length
    }
    expect(g.phase).toBe('summary')
    expect(read).toBeGreaterThan(100)
    readsWithoutTouching(g)
    const table = computeTable(g.season!.fixtures, [USER_TEAM, ...Object.keys(g.season!.ai)])
    expect(hash([table, g.rngState, g.finances, g.tier, g.history])).toBe(SEASON_PIN)
  }, 300_000)
})
