/**
 * Content depth (commentary colour, the inbox's flavour, the pundit's verdict, the Trophy Room's milestones) is
 * display only. Every claim is checked against the same engine, so no literal moves with an ENGINE_VERSION bump:
 *  - no simulation code imports the content modules (only the screens and the content modules themselves do);
 *  - a seeded Quick Draft, the Daily and a Season played with every new piece of text read at each step (after the
 *    draft, at kick-off, every few matchweeks, at the summary) end byte-identical to the same games played with the
 *    content never read, and reading leaves the game's JSON untouched and reads the same twice.
 * The first version (9ad0a24) pinned engine 4 hashes; engine 5 moved them, which is what an engine bump does.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { feedFromResult } from '@engine/matchFeed'
import { seasonTable } from '@engine/season'
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

/** Everything a game is, but the id and creation time `createGame` stamps from the clock. */
function played(g: Game): string {
  const { id: _id, createdAt: _at, ...rest } = g
  void _id
  void _at
  return JSON.stringify(rest)
}

function quickSettings(seed: string): GameSettings {
  return { mode: 'quick', seed, formationId: '4-4-2', teamName: 'Content XI', shortName: 'CXI', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2023, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: false }
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

/** A Quick Draft from setup to summary; with `read`, every piece of content is read at each step. */
function playQuick(s: GameSettings, read: boolean): { g: Game; lines: number } {
  let lines = 0
  const look = (g: Game) => {
    if (read) lines += readsWithoutTouching(g).length
  }
  const g = createGame(s)
  look(g)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  look(g)
  toKickoff(g, u)
  look(g)
  kickOff(g, u)
  look(g)
  if (g.phase === 'january') {
    closeJanuary(g, u, null)
    look(g)
  }
  expect(g.phase).toBe('summary')
  return { g, lines }
}

/** A Season from the draft to the summary; with `read`, the content is read every few matchweeks and at the end. */
function playSeason(read: boolean): { g: Game; lines: number } {
  const g = createGame({ mode: 'season', seed: 'content-season-1', formationId: '4-3-3', teamName: 'Content XI', shortName: 'CXI', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2022, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  let guard = 0
  let lines = 0
  while (g.phase !== 'summary' && guard++ < 60) {
    playMatchweek(g, u, true)
    if (read && guard % 3 === 0) lines += readsWithoutTouching(g).length
  }
  expect(g.phase).toBe('summary')
  if (read) lines += readsWithoutTouching(g).length
  return { g, lines }
}

/** Every non-test source file under `dir`. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') out.push(...sources(p))
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const CONTENT_MODULE = /from '[^']*(?:logic\/flavour|logic\/newsFlavour|logic\/pundit|logic\/milestoneBadges|match\/commentaryColour|\.\/flavour|\.\/newsFlavour|\.\/pundit|\.\/milestoneBadges|\.\/commentaryColour)'/
const CONTENT_FILES = new Set(['game/logic/flavour.ts', 'game/logic/newsFlavour.ts', 'game/logic/pundit.ts', 'game/logic/milestoneBadges.ts'])

describe('content depth is display only', () => {
  it('is imported by no simulation, store or online code', () => {
    const src = join(__dirname, '..', '..')
    const offenders: string[] = []
    for (const area of ['engine', 'game', 'online']) {
      for (const file of sources(join(src, area))) {
        const rel = relative(src, file).replace(/\\/g, '/')
        if (CONTENT_FILES.has(rel)) continue
        if (CONTENT_MODULE.test(readFileSync(file, 'utf8'))) offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })

  it('plays a seeded Quick Draft and the Daily read at every step to the same result as never read', () => {
    for (const s of [quickSettings('content-quick-1'), dailyGameSettings(u, 'daily-2026-10-26', 'Content XI')]) {
      const plain = playQuick(s, false)
      const read = playQuick(s, true)
      expect(read.lines).toBeGreaterThan(10)
      expect(played(read.g)).toBe(played(plain.g))
    }
  }, 300_000)

  it('plays a Season read for its commentary, inbox and verdict every few weeks to the same end as never read', () => {
    const plain = playSeason(false)
    const read = playSeason(true)
    expect(read.lines).toBeGreaterThan(100)
    expect(seasonTable(read.g.season!)).toEqual(seasonTable(plain.g.season!))
    expect(played(read.g)).toBe(played(plain.g))
  }, 300_000)
})
