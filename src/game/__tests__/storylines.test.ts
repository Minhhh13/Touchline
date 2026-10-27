import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { newSquadPlayer, seasonTable, USER_TEAM } from '@engine/season'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { advanceToNextSeason } from '../logic/dynasty'
import { currentRuns, derbyKey, derbyOf, DERBIES, forTheSide, matchPreview, MILESTONES, nextLeagueFixture, nextTieFixture, PRESSURE_CONFIDENCE, RACE_GAP, RUN_MIN, storylines, summerReview, userLeagueResults, type Storyline } from '../logic/storylines'
import { squadPlayers } from '../logic/players'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function settings(seed: string, mode: GameSettings['mode'] = 'season', hostClubId = 'everton'): GameSettings {
  return { mode, seed, formationId: '4-3-3', teamName: 'Story XI', shortName: 'STY', leagueId: 'england', wheelLeagues: ['england'], hostClubId, leagueSeason: 2022, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' }
}

function started(seed: string, mode: GameSettings['mode'] = 'season', hostClubId = 'everton'): Game {
  const g = createGame(settings(seed, mode, hostClubId))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  return g
}

describe('derbies', () => {
  it('names only real clubs of the packs, keyed in alphabetical order', () => {
    const ids = new Set<string>()
    for (const lid of ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']) {
      const meta = JSON.parse(readFileSync(join(__dirname, '../../../public/data', lid, 'meta.json'), 'utf8')) as { clubs: Array<{ id: string }> }
      for (const c of meta.clubs) ids.add(c.id)
    }
    for (const key of Object.keys(DERBIES)) {
      const [a, b] = key.split('|')
      expect(ids.has(a), a).toBe(true)
      expect(ids.has(b), b).toBe(true)
      expect(derbyKey(b, a)).toBe(key)
      expect(a < b).toBe(true)
    }
    // No marks of competitions, only the clubs' own derbies
    expect(Object.values(DERBIES).join(' ')).not.toMatch(/champions|uefa|premier league/i)
  })

  it('reads a named derby, a rivalry, a shared city, or nothing', () => {
    expect(derbyOf(u, 'arsenal', 'tottenham-hotspur')).toEqual({ kind: 'named', name: 'North London derby' })
    expect(derbyOf(u, 'tottenham-hotspur', 'arsenal')).toEqual({ kind: 'named', name: 'North London derby' })
    expect(derbyOf(u, 'arsenal', 'manchester-united')).toEqual({ kind: 'rival' })
    expect(derbyOf(u, 'crystal-palace', 'brentford')).toEqual({ kind: 'city', city: 'London' })
    expect(derbyOf(u, 'burnley', 'brentford')).toBeNull()
    expect(derbyOf(u, 'arsenal', 'arsenal')).toBeNull()
  })
})

describe('storylines over a played season', () => {
  it('agree with the table every week, read the same twice and leave the game alone', () => {
    const seen = new Set<Storyline['kind']>()
    for (const seed of ['story-a', 'story-b', 'story-c']) {
      const g = started(seed)
      while (g.phase !== 'summary') {
        const before = JSON.stringify(g)
        const stories = storylines(g, u)
        expect(storylines(g, u)).toEqual(stories)
        expect(new Set(stories.map((s) => s.id)).size).toBe(stories.length)
        const table = seasonTable(g.season!)
        const pos = table.findIndex((r) => r.teamId === USER_TEAM) + 1
        const results = userLeagueResults(g.season!)
        const runs = currentRuns(results)
        for (const s of stories) {
          seen.add(s.kind)
          if (s.kind === 'title-race') {
            expect(s.position).toBe(pos)
            expect(pos).toBeLessThanOrEqual(3)
            expect(Math.abs(s.gap)).toBeLessThanOrEqual(RACE_GAP)
          }
          if (s.kind === 'relegation') {
            expect(s.position).toBe(pos)
            expect(s.gap).toBeLessThanOrEqual(RACE_GAP)
            expect(pos).toBeGreaterThan(table.length - 6)
          }
          if (s.kind === 'winning-run' || s.kind === 'losing-run' || s.kind === 'unbeaten-run' || s.kind === 'winless-run') {
            expect(s.length).toBe(runs[s.kind])
            expect(s.length).toBeGreaterThanOrEqual(RUN_MIN[s.kind])
          }
          if (s.kind === 'run-in') expect(g.season!.matchweeks - g.season!.matchweek).toBe(s.toPlay)
          if (s.kind === 'pressure') expect(g.season!.confidence).toBeLessThan(PRESSURE_CONFIDENCE)
          if (s.kind === 'golden-boot') expect(s.goals).toBeGreaterThanOrEqual(5)
        }
        // The previews of the coming week
        for (const f of [nextLeagueFixture(g), nextTieFixture(g)]) {
          if (!f) continue
          const p = matchPreview(g, u, f)!
          expect(p.form.ours.length).toBeLessThanOrEqual(5)
          expect(p.form.theirs.length).toBeLessThanOrEqual(5)
          for (const m of p.meetings) expect(m.matchweek).toBeLessThanOrEqual(g.season!.matchweek)
          if (f.comp === 'league') {
            expect(p.table?.ours).toBe(pos)
            expect(p.meetings.filter((m) => m.comp === 'league').length).toBeLessThanOrEqual(1)
          } else expect(p.stake?.kind).toMatch(/final|semi|knockout/)
          if (p.watch.theirs) expect(u.index[p.watch.theirs.playerId] ?? p.watch.theirs.playerId.startsWith('reserve-gk-')).toBeTruthy()
          if (p.watch.ours) expect(g.squad[p.watch.ours.playerId]).toBeDefined()
        }
        expect(JSON.stringify(g)).toBe(before)
        playMatchweek(g, u, true)
      }
      expect(storylines(g, u).length).toBeGreaterThanOrEqual(0)
    }
    // Three seasons tell more than a handful of kinds of story
    expect(seen.size).toBeGreaterThanOrEqual(4)
    expect(seen.has('run-in')).toBe(true)
  }, 300_000)

  it('a league preview second time round recalls the first meeting', () => {
    const g = started('story-meet')
    let checked = false
    while (g.phase !== 'summary' && !checked) {
      const f = nextLeagueFixture(g)
      if (f) {
        const p = matchPreview(g, u, f)!
        const first = p.meetings.find((m) => m.comp === 'league')
        if (first) {
          expect(first.home).toBe(!f.home)
          checked = true
        }
      }
      playMatchweek(g, u, true)
    }
    expect(checked).toBe(true)
  }, 120_000)
})

describe('storylines from a crafted week', () => {
  it('a milestone one game away and one reached this week', () => {
    const g = started('story-milestone')
    for (let i = 0; i < 3; i++) playMatchweek(g, u, true)
    // A week with a league game and no cup tie, so each man who ran out made exactly one appearance
    while (g.lastMatchContext?.matchweek !== g.season!.matchweek || g.lastCupContext?.matchweek === g.season!.matchweek) playMatchweek(g, u, true)
    const m = g.lastMatch!
    const ran = new Set((m.homeTeamId === USER_TEAM ? m.homeStats : m.awayStats).filter((s) => s.minutes > 0).map((s) => s.playerSeasonId))
    const played = squadPlayers(g, u).find((x) => ran.has(x.p.id))!
    const idle = squadPlayers(g, u).find((x) => !ran.has(x.p.id) && !x.s.injury && !x.s.suspension)!
    const before = JSON.stringify(g)
    const copy: Game = JSON.parse(before)
    const target = MILESTONES[0]
    copy.careerStats = {
      [played.p.playerId]: { name: played.p.name, seasons: 1, apps: target - played.s.seasonStats.apps, goals: 0, assists: 0, motm: 0, titles: 0, lastYear: 1 },
      [idle.p.playerId]: { name: idle.p.name, seasons: 1, apps: target - 1 - idle.s.seasonStats.apps, goals: 0, assists: 0, motm: 0, titles: 0, lastYear: 1 },
    }
    expect(forTheSide(copy, played.p, played.s).apps).toBe(target)
    const ms = storylines(copy, u).filter((s) => s.kind === 'milestone')
    expect(ms).toContainEqual(expect.objectContaining({ playerId: played.p.id, stat: 'apps', target, reached: true }))
    expect(ms).toContainEqual(expect.objectContaining({ playerId: idle.p.id, stat: 'apps', target, reached: false }))
    expect(JSON.stringify(g)).toBe(before)
  }, 60_000)

  it("a former club's visit names the man and the season he played there", () => {
    const g = started('story-old-club')
    const f = nextLeagueFixture(g)!
    const theirs = u.clubSeasons.find((cs) => cs.clubId === f.opponentId && cs.season !== g.settings.leagueSeason)!
    const man = theirs.squad.find((p) => !Object.keys(g.squad).some((sid) => u.index[sid]?.playerId === p.playerId))!
    const copy: Game = JSON.parse(JSON.stringify(g))
    copy.squad[man.id] = newSquadPlayer(man.id)
    const story = storylines(copy, u).find((s) => s.kind === 'old-club')
    expect(story).toMatchObject({ playerId: man.id, clubId: f.opponentId, season: man.season, comp: 'league' })
    expect(matchPreview(copy, u, f)!.oldBoys.map((b) => b.playerId)).toContain(man.id)
    // The club the user replaced is never an old club
    expect(storylines(g, u).filter((s) => s.kind === 'old-club' && s.clubId === g.season!.hostClubId)).toEqual([])
  })

  it('the board under pressure from matchweek 6, with or without job security', () => {
    const g = started('story-pressure')
    for (let i = 0; i < 6; i++) playMatchweek(g, u, true)
    const copy: Game = JSON.parse(JSON.stringify(g))
    copy.season!.confidence = 20
    copy.settings.jobSecurity = true
    expect(storylines(copy, u).find((s) => s.kind === 'pressure')).toMatchObject({ confidence: 20, canSack: true })
    copy.season!.confidence = PRESSURE_CONFIDENCE
    expect(storylines(copy, u).some((s) => s.kind === 'pressure')).toBe(false)
  }, 60_000)
})

describe('a Dynasty summer', () => {
  it('opens with the season just finished, and only in a Dynasty summer', () => {
    const g = started('story-summer', 'dynasty')
    expect(summerReview(g)).toBeNull()
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    expect(summerReview(g)).toBeNull()
    advanceToNextSeason(g, u)
    expect(g.phase).toBe('draft')
    const r = summerReview(g)!
    expect(r.record).toBe(g.history[g.history.length - 1])
    expect(r.previous).toBeNull()
    expect(r.seasons).toBe(1)
    expect(r.titles).toBe(r.record.position === 1 && r.record.tier !== 'RELEGATED' ? 1 : 0)
    if (r.record.position === 1) expect(r.headline).toMatch(/treble|double|perfect|invincible|champions/)
    else if (r.record.tier === 'RELEGATED') expect(r.headline).toBe('relegated')
    if (r.legend) expect(r.legend.goals).toBe(Math.max(...Object.values(g.careerStats ?? {}).map((c) => c.goals)))
    // A Season never has one
    const s = started('story-summer')
    while (s.phase !== 'summary') playMatchweek(s, u, true)
    expect(summerReview(s)).toBeNull()
  }, 240_000)
})
