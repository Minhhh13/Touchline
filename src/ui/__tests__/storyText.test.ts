import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { USER_TEAM } from '@engine/season'
import { createGame, beginSeason } from '@game/logic/setup'
import { playMatchweek, startSeasonProper } from '@game/logic/week'
import { matchPreview, nextLeagueFixture, nextTieFixture, storylines, type Stake, type Storyline, type SummerReview } from '@game/logic/storylines'
import type { SeasonRecord } from '@game/types'
import { formLine, meetingLabel, previewLines, previewTitle, stakeLine, storylineText, summerText } from '../storyText'

const u = loadTestUniverse(['england'])
const EMOJI = /\p{Extended_Pictographic}/u

/** Every line reads as a sentence: something said, nothing left unfilled, no emoji as a picture. */
function sound(text: string): void {
  expect(text.length).toBeGreaterThan(5)
  expect(text).not.toMatch(/undefined|NaN|null|\{\w+\}|\s\s|^\s|\s$/)
  expect(text).not.toMatch(EMOJI)
  expect(text[0]).toBe(text[0].toUpperCase())
}

const STORIES: Storyline[] = [
  { kind: 'title-race', id: 'title-race', position: 1, gap: 3, before: 5, rivalId: 'arsenal', toPlay: 9 },
  { kind: 'title-race', id: 'title-race', position: 1, gap: 0, before: null, rivalId: 'arsenal', toPlay: 1 },
  { kind: 'title-race', id: 'title-race', position: 2, gap: -4, before: -2, rivalId: 'liverpool', toPlay: 5 },
  { kind: 'title-race', id: 'title-race', position: 2, gap: -1, before: -1, rivalId: USER_TEAM, toPlay: 5 },
  { kind: 'relegation', id: 'relegation', position: 18, gap: -2, before: -4, toPlay: 7 },
  { kind: 'relegation', id: 'relegation', position: 17, gap: 1, before: 3, toPlay: 1 },
  { kind: 'relegation', id: 'relegation', position: 18, gap: 0, before: null, toPlay: 3 },
  { kind: 'golden-boot', id: 'boot-a', playerId: 'a', name: 'A. Striker', goals: 14, rank: 1, rival: { name: 'B. Rival', teamId: 'chelsea', goals: 12 } },
  { kind: 'golden-boot', id: 'boot-b', playerId: 'a', name: 'A. Striker', goals: 14, rank: 1, rival: { name: 'B. Rival', teamId: 'chelsea', goals: 14 } },
  { kind: 'golden-boot', id: 'boot-c', playerId: 'a', name: 'A. Striker', goals: 11, rank: 3, rival: { name: 'B. Rival', teamId: 'chelsea', goals: 13 } },
  { kind: 'golden-boot', id: 'boot-d', playerId: 'a', name: 'A. Striker', goals: 9, rank: 1, rival: null },
  { kind: 'winning-run', id: 'w', length: 5 },
  { kind: 'unbeaten-run', id: 'u', length: 8 },
  { kind: 'losing-run', id: 'l', length: 3 },
  { kind: 'winless-run', id: 'n', length: 6 },
  { kind: 'milestone', id: 'm1', playerId: 'p', name: 'C. Keeper', stat: 'apps', target: 50, value: 49, reached: false },
  { kind: 'milestone', id: 'm2', playerId: 'p', name: 'C. Keeper', stat: 'apps', target: 100, value: 100, reached: true },
  { kind: 'milestone', id: 'm3', playerId: 'p', name: 'D. Nine', stat: 'goals', target: 50, value: 49, reached: false },
  { kind: 'milestone', id: 'm4', playerId: 'p', name: 'D. Nine', stat: 'goals', target: 50, value: 48, reached: false },
  { kind: 'milestone', id: 'm5', playerId: 'p', name: 'D. Nine', stat: 'goals', target: 100, value: 101, reached: true },
  { kind: 'old-club', id: 'o1', playerId: 'p', name: 'E. Winger', clubId: 'arsenal', season: 2019, comp: 'league' },
  { kind: 'old-club', id: 'o2', playerId: 'p', name: 'E. Winger', clubId: 'arsenal', season: 2019, comp: 'cup' },
  { kind: 'pressure', id: 'pressure', confidence: 18, canSack: true, target: 8, position: 16 },
  { kind: 'pressure', id: 'pressure', confidence: 28, canSack: false, target: 8, position: 12 },
  { kind: 'run-in', id: 'r1', toPlay: 6, position: 1, target: 4, gapTop: 4, gapSafety: 40 },
  { kind: 'run-in', id: 'r2', toPlay: 1, position: 2, target: 4, gapTop: -2, gapSafety: 30 },
  { kind: 'run-in', id: 'r3', toPlay: 4, position: 17, target: 14, gapTop: -30, gapSafety: 2 },
  { kind: 'run-in', id: 'r4', toPlay: 3, position: 9, target: 10, gapTop: -20, gapSafety: 15 },
  { kind: 'run-in', id: 'r5', toPlay: 3, position: 12, target: 10, gapTop: -24, gapSafety: 9 },
]

describe('storyline words', () => {
  it('says every kind of story soundly, the same for the same week', () => {
    for (const s of STORIES) {
      const t = storylineText(s, u, 'Story XI', 'g1|1|20')
      for (const line of [t.title, t.text, t.chip]) sound(line)
      expect(t.text.endsWith('.')).toBe(true)
      expect(storylineText(s, u, 'Story XI', 'g1|1|20')).toEqual(t)
    }
  })

  it('reads the numbers right', () => {
    const say = (s: Storyline) => storylineText(s, u, 'Story XI', 'k').text
    expect(say(STORIES[0])).toMatch(/^3 points clear of Arsenal with 9 to play\. /)
    expect(say(STORIES[1])).toMatch(/^Level on points with Arsenal at the top, one game to play\./)
    expect(say(STORIES[2])).toMatch(/^4 points behind Liverpool/)
    expect(say(STORIES[3])).toMatch(/^1 point behind Story XI/)
    expect(say(STORIES[4])).toMatch(/^In the bottom three, 2 points from safety/)
    expect(say(STORIES[7])).toBe('A. Striker leads the scoring charts with 14, 2 goals ahead of B. Rival (Chelsea).')
    expect(say(STORIES[9])).toBe('A. Striker has 11 goals, 3rd in the charts, 2 goals behind B. Rival (Chelsea).')
    expect(say(STORIES[15])).toBe('C. Keeper is one game from 50 appearances for the club.')
    expect(say(STORIES[17])).toBe('D. Nine needs 1 more goal for 50 for the club.')
    expect(say(STORIES[18])).toBe('D. Nine needs 2 more goals for 50 for the club.')
    expect(say(STORIES[22])).toBe('Board confidence is down to 18. The board want 8th; you are 16th. The job is on the line.')
    expect(say(STORIES[25])).toBe('The last day. 2nd, 2 points off the top.')
  })

  it('varies a story by the week it is told in', () => {
    for (const s of [STORIES[11], STORIES[13], STORIES[16]]) {
      const told = new Set(Array.from({ length: 40 }, (_, i) => storylineText(s, u, 'Story XI', `g|1|${i}`).text))
      expect(told.size).toBeGreaterThan(1)
    }
  })
})

describe('preview words', () => {
  it('reads form, meetings and every stake', () => {
    expect(formLine([], [], 'Arsenal', 'k')).toBe('No league form to go on yet.')
    expect(formLine(['W', 'D'], ['W', 'W', 'W', 'W', 'L'], 'Arsenal', 'k')).toMatch(/Arsenal .*4 wins/)
    expect(formLine(['L', 'L', 'L', 'D', 'W'], ['D', 'D', 'W', 'L', 'D'], 'Arsenal', 'k')).toMatch(/3 defeats/)
    expect(meetingLabel({ comp: 'league', matchweek: 4, home: true, gf: 2, ga: 0 })).toBe('2-0 at home, MW 4')
    expect(meetingLabel({ comp: 'cup', matchweek: 9, home: false, gf: 1, ga: 1, pens: { ours: 4, theirs: 3 } })).toBe('1-1 away (4-3 on penalties), in the Cup')
    const stakes: Stake[] = [
      { kind: 'title-decider', gap: 2 },
      { kind: 'title-decider', gap: -1 },
      { kind: 'title-decider', gap: 0 },
      { kind: 'title', gap: 4, leaderId: USER_TEAM },
      { kind: 'title', gap: 0, leaderId: USER_TEAM },
      { kind: 'title', gap: -3, leaderId: 'arsenal' },
      { kind: 'europe', gap: 0 },
      { kind: 'europe', gap: -2 },
      { kind: 'six-pointer', gap: 1 },
      { kind: 'survival', gap: 3 },
      { kind: 'survival', gap: -2 },
      { kind: 'survival', gap: 0 },
      { kind: 'leapfrog', gap: 0 },
      { kind: 'leapfrog', gap: -2 },
      { kind: 'final' },
      { kind: 'semi' },
      { kind: 'knockout', round: 'QF' },
      { kind: 'knockout', round: 'R16' },
    ]
    for (const s of stakes) sound(stakeLine(s, 'Arsenal', 'k', u, 'Story XI'))
    expect(stakeLine({ kind: 'knockout', round: 'QF' }, 'Arsenal', 'k', u, 'Story XI')).toBe('Quarter-final: lose and you are out.')
  })

  it('writes a sound preview for every match of a played season, the cups included', () => {
    const g = createGame({ mode: 'season', seed: 'story-words', formationId: '4-3-3', teamName: 'Story XI', shortName: 'STY', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2022, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    startSeasonProper(g)
    let previews = 0
    let ties = 0
    let stories = 0
    while (g.phase !== 'summary') {
      const key = `${g.id}|${g.year}|${g.season!.matchweek}`
      for (const f of [nextLeagueFixture(g), nextTieFixture(g)]) {
        if (!f) continue
        const p = matchPreview(g, u, f)!
        sound(previewTitle(p, u))
        const lines = previewLines(p, u, 'Story XI', key)
        expect(lines.map((l) => l.id)).toContain('form')
        for (const l of lines) sound(l.text)
        previews++
        if (f.comp !== 'league') ties++
      }
      for (const s of storylines(g, u)) {
        const t = storylineText(s, u, 'Story XI', key)
        sound(t.text)
        stories++
      }
      playMatchweek(g, u, true)
    }
    expect(previews).toBeGreaterThan(30)
    expect(ties).toBeGreaterThan(0)
    expect(stories).toBeGreaterThan(10)
  }, 120_000)
})

describe('the summer review in words', () => {
  const record: SeasonRecord = { year: 1, leagueId: 'england', leagueSeason: 2022, teamName: 'Story XI', hostClubId: 'everton', position: 1, points: 88, won: 27, drawn: 7, lost: 4, goalsFor: 85, goalsAgainst: 30, tier: 'CHAMPIONS', cupWon: true, continentalWon: false, continentalRun: 'SF', potsName: 'A. Mid', bootName: 'D. Nine', bootGoals: 24 }
  it('heads every kind of summer soundly', () => {
    const heads: SummerReview['headline'][] = ['treble', 'double', 'perfect', 'invincible', 'champions', 'relegated', 'cup', 'europe', 'climb', 'slide', 'steady']
    for (const headline of heads) {
      const r: SummerReview = { record, previous: { ...record, year: 0, position: 6, points: 60 }, headline, climb: headline === 'slide' ? -4 : 5, titles: 1, seasons: 2, legend: { name: 'D. Nine', goals: 40, apps: 70, seasons: 2 } }
      const t = summerText(r, u, 'g1')
      sound(t.headline)
      for (const l of t.lines) sound(l.text)
      expect(summerText(r, u, 'g1')).toEqual(t)
    }
    const t = summerText({ record, previous: null, headline: 'double', climb: null, titles: 1, seasons: 1, legend: null }, u, 'g1')
    expect(t.lines.map((l) => l.id)).toEqual(['finish', 'goals', 'cups', 'awards'])
    expect(t.lines[0].text).toBe('1st on 88 points, won 27, drew 7, lost 4.')
    expect(t.lines[2].text).toBe('Won the Cup and reached the Continental Cup semi-final.')
  })
})
