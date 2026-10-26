import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { computeTable, positionOf, USER_TEAM, type NewsItem } from '@engine/season'
import { getFormation } from '@engine/formations'
import { DEFAULT_ROLE, rolesFor } from '@engine/roles'
import { playerLookup, squadPlayers } from '../logic/players'
import { teamStrength } from '../logic/squad'
import { filterNews, formTitle, formTrend, FORM_BAND, inboxGroup, INBOX_FILTERS, minutesLast3, positionHistory, positionStory, ratingBand, roleFit, roleOptions, sparkPoints, teamFamiliarity, windowCountdown } from '../logic/squadDisplay'
import { seasonGame } from './seasonGame'

const u = loadTestUniverse(['england'])

const stats = (ratings: number[]) => ({ recentRatings: ratings, seasonStats: { apps: ratings.length, starts: ratings.length, goals: 0, assists: 0, minutes: 90 * ratings.length, ratingSum: ratings.reduce((a, b) => a + b, 0), cleanSheets: 0, motm: 0 } })

describe('form on a squad row', () => {
  it('reads the last three ratings against the season average with a ±0.3 band', () => {
    expect(formTrend(stats([7, 7]))).toBeNull()
    expect(formTrend(stats([7, 7, 7]))!.dir).toBe('flat')
    const up = formTrend({ recentRatings: [7.5, 7.6, 7.7], seasonStats: { ...stats([]).seasonStats, apps: 10, ratingSum: 68 } })!
    expect(up.dir).toBe('up')
    expect(formTitle(up)).toBe('Form rising: 7.6 over the last 3, 6.8 this season')
    const down = formTrend({ recentRatings: [6.0, 6.1, 6.2], seasonStats: { ...stats([]).seasonStats, apps: 10, ratingSum: 70 } })!
    expect(down.dir).toBe('down')
    expect(formTitle(down)).toMatch(/^Form falling: 6\.1/)
    // Exactly the band is still steady
    const edge = formTrend({ recentRatings: [7.3, 7.3, 7.3], seasonStats: { ...stats([]).seasonStats, apps: 10, ratingSum: 70 } })!
    expect(edge.recent - edge.season).toBeCloseTo(FORM_BAND, 5)
    expect(edge.dir).toBe('flat')
  })

  it('over a played season every row gets an arrow that agrees with its numbers', () => {
    let arrows = 0
    for (const seed of ['form-1', 'form-2', 'form-3']) {
      const g = seasonGame(u, seed, 8)
      for (const s of Object.values(g.squad)) {
        const t = formTrend(s)
        if (!t) {
          expect(s.recentRatings.length < 3 || s.seasonStats.apps < 3).toBe(true)
          continue
        }
        arrows++
        const gap = t.recent - t.season
        expect(t.dir).toBe(gap > FORM_BAND ? 'up' : gap < -FORM_BAND ? 'down' : 'flat')
      }
    }
    expect(arrows).toBeGreaterThan(20)
  }, 60_000)

  it('bands ratings and draws the sparkline on a fixed scale inside its box', () => {
    expect(ratingBand(7.5)).toBe('good')
    expect(ratingBand(7.49)).toBe('mid')
    expect(ratingBand(6)).toBe('mid')
    expect(ratingBand(5.9)).toBe('bad')
    expect(sparkPoints([])).toEqual([])
    const pts = sparkPoints([4, 6, 7, 8, 10, 6.5], 40, 14)
    expect(pts).toHaveLength(5)
    expect(pts[0].r).toBe(6)
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(40)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(14)
    }
    // Higher ratings sit higher (smaller y); out-of-scale ratings clamp to the edge
    expect(pts[2].y).toBeLessThan(pts[1].y)
    expect(sparkPoints([10, 12])[0].y).toBe(sparkPoints([10, 12])[1].y)
  })

  it('sums the minutes of the last three matchweeks, and has none on an old save', () => {
    expect(minutesLast3({ recentMinutes: [90, 90, 0, 45, 90, 20] })).toBe(155)
    expect(minutesLast3({ recentMinutes: [] })).toBe(0)
    expect(minutesLast3({})).toBeNull()
  })
})

describe('roles', () => {
  it('grades the fit by the gap between his effective rating in the role and his overall', () => {
    expect(roleFit(80, 80)).toBe('suits')
    expect(roleFit(79, 80)).toBe('suits')
    expect(roleFit(78.9, 80)).toBe('fair')
    expect(roleFit(76, 80)).toBe('fair')
    expect(roleFit(75.9, 80)).toBe('poor')
    expect(roleFit(84, 80)).toBe('suits')
  })

  it('labels every role option with his rating there, and the default role matches the engine', () => {
    const g = seasonGame(u, 'roles-1', 2)
    const get = playerLookup(g, u)
    const formation = getFormation(g.tactics.formationId)
    const strength = teamStrength(g, u)
    for (const slot of formation.slots) {
      const p = get(g.lineup[slot.id])!
      const opts = roleOptions(p, slot.position)
      expect(opts.map((o) => o.id)).toEqual(rolesFor(slot.position).map((r) => r.id))
      for (const o of opts) {
        expect(o.rating).toBeGreaterThan(20)
        expect(o.rating).toBeLessThan(100)
      }
      const ev = strength.slots.find((s) => s.slotId === slot.id)!
      const chosen = opts.find((o) => o.id === (g.tactics.roles[slot.id] ?? DEFAULT_ROLE[slot.position]))!
      expect(chosen.rating).toBe(Math.round(ev.base))
    }
    expect(roleOptions(undefined, 'CB').every((o) => o.rating === null)).toBe(true)
  }, 60_000)

  it("averages the XI's familiarity", () => {
    const g = seasonGame(u, 'roles-2', 0)
    const xi = Object.values(g.lineup).map((id) => g.squad[id].familiarity)
    expect(teamFamiliarity(g)).toBeCloseTo(xi.reduce((a, b) => a + b, 0) / xi.length, 6)
    expect(teamFamiliarity({ lineup: {}, squad: g.squad })).toBeNull()
  })
})

describe('the inbox filters', () => {
  it('put every kind in exactly one filter, and All keeps the feed in order with its indexes', () => {
    const kinds: NewsItem['kind'][] = ['result', 'injury', 'suspension', 'board', 'transfer', 'award', 'event', 'cup', 'training', 'info']
    for (const k of kinds) expect(INBOX_FILTERS.some((f) => f.id === inboxGroup(k))).toBe(true)
    expect(inboxGroup('result')).toBe('matches')
    expect(inboxGroup('cup')).toBe('matches')
    expect(inboxGroup('transfer')).toBe('market')
    expect(inboxGroup('board')).toBe('board')
    expect(inboxGroup('injury')).toBe('squad')
    const g = seasonGame(u, 'inbox-1', 6)
    const news = g.season!.news
    expect(filterNews(news, 'all').map((x) => x.i)).toEqual(news.map((_, i) => i))
    const total = (['matches', 'squad', 'market', 'board'] as const).reduce((s, f) => s + filterNews(news, f).length, 0)
    expect(total).toBe(news.length)
    expect(filterNews(news, 'matches').length).toBeGreaterThan(0)
    for (const { n, i } of filterNews(news, 'squad')) expect(news[i]).toBe(n)
  }, 60_000)
})

describe('the window countdown', () => {
  it('counts the market days left after today and says so on the last', () => {
    expect(windowCountdown({ day: 0, days: 7 })).toEqual({ daysLeft: 6, label: 'Window shuts in 6 days', last: false })
    expect(windowCountdown({ day: 5, days: 7 }).label).toBe('Window shuts in 1 day')
    expect(windowCountdown({ day: 6, days: 7 })).toEqual({ daysLeft: 0, label: 'Window shuts today', last: true })
  })
})

describe('the league position by matchweek', () => {
  it('matches the table recomputed at each matchweek, ends at the table today, and covers every played matchweek', () => {
    for (const seed of ['pos-1', 'pos-2']) {
      const g = seasonGame(u, seed, 10)
      const s = g.season!
      const ids = [USER_TEAM, ...Object.keys(s.ai)]
      const h = positionHistory(s.fixtures, ids)
      expect(h.matchweeks).toEqual(Array.from({ length: s.matchweek }, (_, i) => i + 1))
      const now = computeTable(s.fixtures, ids)
      for (const id of ids) {
        expect(h.byTeam[id]).toHaveLength(h.matchweeks.length)
        expect(h.byTeam[id][h.byTeam[id].length - 1]).toBe(positionOf(now, id))
        for (const p of h.byTeam[id]) {
          expect(p).toBeGreaterThanOrEqual(1)
          expect(p).toBeLessThanOrEqual(ids.length)
        }
      }
      const at5 = computeTable(s.fixtures.filter((f) => f.matchweek <= 5), ids)
      expect(h.byTeam[USER_TEAM][4]).toBe(positionOf(at5, USER_TEAM))
      // Each matchweek's positions are a permutation of 1..n
      for (let k = 0; k < h.matchweeks.length; k++) expect(new Set(ids.map((id) => h.byTeam[id][k])).size).toBe(ids.length)
      const story = positionStory(s.fixtures, ids)
      expect(story.series).toEqual(h.byTeam[USER_TEAM])
      expect(story.rivals).toHaveLength(2)
      for (const r of story.rivals) expect(r.teamId).not.toBe(USER_TEAM)
      // Before a ball is kicked there is nothing to draw
      const fresh = seasonGame(u, seed, 0)
      expect(positionStory(fresh.season!.fixtures, ids).series).toEqual([])
      expect(squadPlayers(g, u).length).toBeGreaterThan(10)
    }
  }, 60_000)
})
