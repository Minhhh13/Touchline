import { describe, expect, it } from 'vitest'
import type { PlayerSeason } from '@engine/types'
import { rolesFor } from '@engine/roles'
import { roleRating } from '@engine/ratings'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { byRating, playerEntry, playerIndex, warmExplore } from '../logic/exploreIndex'
import { attributeColumns, careerSeasons } from '../logic/playerCard'
import { attrTone, bestSeasons, careerRows, careerSummary, groupAverage, roleSuitability, SIMILAR_RANGE, similarPlayers } from '../logic/playerProfile'
import { leagueTrivia, STAR_RATING, TRIVIA_LIMIT } from '../logic/exploreRecords'
import { nationCounts } from '../logic/exploreFilter'
import { topPlayerSeasons } from '../logic/exploreSearch'

const u = loadTestUniverse(['england', 'germany'])
const all = Object.values(u.index)

/** The old, uncached walks the index replaced, kept here as the reference. */
function careerByWalk(playerId: string): PlayerSeason[] {
  return all.filter((p) => p.playerId === playerId).sort((a, b) => a.season - b.season || a.clubId.localeCompare(b.clubId))
}

function topByWalk(opts: { leagueId: string; onePerPlayer?: boolean; position?: string; season?: number; limit?: number }): PlayerSeason[] {
  const list = all.filter((p) => (!opts.position || p.positions[0] === opts.position) && (opts.season === undefined || p.season === opts.season) && u.clubById[p.clubId]?.leagueId === opts.leagueId)
  list.sort((a, b) => b.overall - a.overall || a.season - b.season || a.id.localeCompare(b.id))
  const out: PlayerSeason[] = []
  const seen = new Set<string>()
  for (const p of list) {
    if (opts.onePerPlayer && seen.has(p.playerId)) continue
    seen.add(p.playerId)
    out.push(p)
    if (out.length >= (opts.limit ?? 60)) break
  }
  return out
}

const sample = playerIndex(u).filter((_, i) => i % 997 === 0)

describe("Explore's cached indexes", () => {
  it('give the same careers, top lists and nation counts as walking every player-season', () => {
    warmExplore(u)
    for (const e of sample) expect(careerSeasons(u, e.playerId).map((p) => p.id)).toEqual(careerByWalk(e.playerId).map((p) => p.id))
    for (const opts of [{ leagueId: 'england' }, { leagueId: 'germany', onePerPlayer: true }, { leagueId: 'england', position: 'GK', season: 2015 }, { leagueId: 'germany', position: 'ST', limit: 5 }]) {
      expect(topPlayerSeasons(u, opts as Parameters<typeof topPlayerSeasons>[1]).map((p) => p.id)).toEqual(topByWalk(opts).map((p) => p.id))
    }
    const counts = new Map<string, Set<string>>()
    for (const p of all) (counts.get(p.nationality) ?? counts.set(p.nationality, new Set()).get(p.nationality)!).add(p.playerId)
    for (const { nation, players } of nationCounts(u).slice(0, 20)) expect(players).toBe(counts.get(nation)!.size)
  })

  it('build once per universe and hand a copy of a career', () => {
    expect(playerIndex(u)).toBe(playerIndex(u))
    expect(byRating(u)).toBe(byRating(u))
    const id = sample[3].playerId
    const a = careerSeasons(u, id)
    a.reverse()
    expect(careerSeasons(u, id)).toEqual(playerEntry(u, id)!.seasons)
    expect(careerSeasons(u, 'no-such-player')).toEqual([])
  })

  it('order every player-season best first, whatever order the index holds them in', () => {
    const list = byRating(u)
    expect(list).toHaveLength(all.length)
    for (let i = 1; i < list.length; i += 101) expect(list[i - 1].overall).toBeGreaterThanOrEqual(list[i].overall)
  })
})

describe('the player card profile', () => {
  it('tones attributes in five bands and averages each column', () => {
    expect([90, 85, 84, 75, 70, 65, 55, 50, 49, 10].map(attrTone)).toEqual(['elite', 'elite', 'good', 'good', 'fair', 'fair', 'poor', 'poor', 'weak', 'weak'])
    const p = byRating(u)[0]
    for (const col of attributeColumns(p)) {
      const nums = col.rows.flatMap((r) => (r.kind === 'attr' ? [r.value] : []))
      expect(groupAverage(col)).toBe(Math.round(nums.reduce((s, v) => s + v, 0) / nums.length))
    }
    expect(groupAverage({ rows: [] })).toBeNull()
  })

  it("reads each season's club finish and the change on the season before", () => {
    let checked = 0
    for (const e of sample) {
      const rows = careerRows(u, e.seasons)
      expect(rows).toHaveLength(e.seasons.length)
      rows.forEach((r) => {
        const cs = u.clubSeasonByKey[`${r.p.clubId}@${r.p.season}`]
        if (cs?.complete && cs.position > 0) expect(r.finish).toBe(cs.position)
        else expect(r.finish).toBe(0)
        const prev = e.seasons.filter((q) => q.season === r.p.season - 1)
        if (!prev.length) expect(r.delta).toBeNull()
        else expect(r.delta).toBe(r.p.overall - Math.max(...prev.map((q) => q.overall)))
        if (r.p.accolades.includes('Champion')) expect(r.champions).toBe(true)
        checked++
      })
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('lists his best seasons one per season, best first, and sums the career', () => {
    for (const e of sample) {
      const best = bestSeasons(e.seasons, 5)
      expect(new Set(best.map((p) => p.season)).size).toBe(best.length)
      expect(best.length).toBe(Math.min(5, e.seasonCount))
      for (let i = 1; i < best.length; i++) expect(best[i - 1].overall).toBeGreaterThanOrEqual(best[i].overall)
      const sum = careerSummary(e.seasons)!
      expect(sum.peak).toBe(Math.max(...e.seasons.map((p) => p.overall)))
      expect(sum.seasons).toBe(e.seasonCount)
      expect(sum.clubs).toBe(e.clubs.length)
    }
    expect(careerSummary([])).toBeNull()
  })

  it("rates roles with the engine's own roleRating, best first, at natural and cover positions only", () => {
    for (const p of byRating(u).filter((_, i) => i % 1500 === 0)) {
      const roles = roleSuitability(p, 50)
      expect(roles.length).toBeGreaterThan(0)
      for (let i = 1; i < roles.length; i++) expect(roles[i - 1].rating).toBeGreaterThanOrEqual(roles[i].rating)
      for (const r of roles) {
        expect(['natural', 'cover']).toContain(r.fit)
        const role = rolesFor(r.position).find((x) => x.id === r.roleId)!
        expect(r.rating).toBe(Math.round(roleRating(p, role, r.position)))
      }
      // His first position is natural, so its roles are always on the list
      expect(roles.some((r) => r.position === p.positions[0])).toBe(true)
    }
  })

  it('finds similar players: same first position, close overall, one season each, never himself', () => {
    for (const p of byRating(u).filter((_, i) => i % 2500 === 0)) {
      const hits = similarPlayers(u, p, { limit: 6 })
      expect(hits.length).toBeLessThanOrEqual(6)
      expect(new Set(hits.map((h) => h.p.playerId)).size).toBe(hits.length)
      for (let i = 1; i < hits.length; i++) expect(hits[i - 1].match).toBeGreaterThanOrEqual(hits[i].match)
      for (const h of hits) {
        expect(h.p.playerId).not.toBe(p.playerId)
        expect(h.p.positions[0]).toBe(p.positions[0])
        expect(Math.abs(h.p.overall - p.overall)).toBeLessThanOrEqual(SIMILAR_RANGE)
        expect(h.match).toBeGreaterThanOrEqual(0)
        expect(h.match).toBeLessThanOrEqual(100)
        expect(u.clubSeasonByKey[`${h.p.clubId}@${h.p.season}`]?.classic).toBeFalsy()
      }
    }
    // The same call, the same answer
    const p = byRating(u)[40]
    expect(similarPlayers(u, p).map((h) => h.p.id)).toEqual(similarPlayers(u, p).map((h) => h.p.id))
  })
})

describe("Explore's Records view", () => {
  it('climbs and falls are real moves between two seasons in a row, biggest first', () => {
    const tr = leagueTrivia(u, 'england')
    expect(tr.climbs.length).toBe(TRIVIA_LIMIT)
    for (const m of [...tr.climbs, ...tr.falls]) {
      const before = u.clubSeasonByKey[`${m.clubId}@${m.season - 1}`]
      const after = u.clubSeasonByKey[`${m.clubId}@${m.season}`]
      expect(before.position).toBe(m.before)
      expect(after.position).toBe(m.after)
      expect(m.change).toBe(m.before - m.after)
      expect(m.estimated).toBe(!!(before.estimated || after.estimated))
    }
    for (let i = 1; i < tr.climbs.length; i++) expect(tr.climbs[i - 1].change).toBeGreaterThanOrEqual(tr.climbs[i].change)
    for (let i = 1; i < tr.falls.length; i++) expect(tr.falls[i - 1].change).toBeLessThanOrEqual(tr.falls[i].change)
    expect(tr.climbs.every((m) => m.change > 0) && tr.falls.every((m) => m.change < 0)).toBe(true)
    // Leicester's title from 14th is among the biggest climbs of the Premier League in the data
    expect(tr.climbs.some((m) => m.clubId === 'leicester-city' && m.season === 2015 && m.after === 1)).toBe(true)
  })

  it('title runs are champions in seasons in a row', () => {
    const tr = leagueTrivia(u, 'england')
    expect(tr.streaks.length).toBeGreaterThan(0)
    for (const s of tr.streaks) {
      expect(s.length).toBe(s.to - s.from + 1)
      for (let y = s.from; y <= s.to; y++) expect(u.clubSeasonByKey[`${s.clubId}@${y}`].champions).toBe(true)
    }
  })

  it('players: service, titles and rating jumps from the data, ordered and capped', () => {
    for (const leagueId of ['england', 'germany']) {
      const tr = leagueTrivia(u, leagueId)
      expect(tr.serving).toHaveLength(TRIVIA_LIMIT)
      for (const s of tr.serving) {
        const at = playerEntry(u, s.playerId)!.seasons.filter((p) => p.clubId === s.clubId)
        expect(new Set(at.map((p) => p.season)).size).toBe(s.seasons)
      }
      for (let i = 1; i < tr.serving.length; i++) expect(tr.serving[i - 1].seasons).toBeGreaterThanOrEqual(tr.serving[i].seasons)
      for (const r of tr.risers) {
        expect(r.after.season).toBe(r.before.season + 1)
        expect(r.change).toBe(r.after.overall - r.before.overall)
        expect(r.change).toBeGreaterThan(0)
      }
      for (const h of tr.titles) expect(h.titles).toBe(new Set(playerEntry(u, h.playerId)!.seasons.filter((p) => p.accolades.includes('Champion') && u.clubById[p.clubId].leagueId === leagueId).map((p) => p.season)).size)
      for (const p of [...tr.youngest, ...tr.oldest]) expect(p.overall).toBeGreaterThanOrEqual(STAR_RATING)
      for (let i = 1; i < tr.youngest.length; i++) expect(tr.youngest[i - 1].age).toBeLessThanOrEqual(tr.youngest[i].age)
      for (let i = 1; i < tr.oldest.length; i++) expect(tr.oldest[i - 1].age).toBeGreaterThanOrEqual(tr.oldest[i].age)
      expect(tr.coverage.playerSeasons).toBe(all.filter((p) => u.clubById[p.clubId]?.leagueId === leagueId).length)
    }
  })

  it('marks classic seasons as estimates and is cached', () => {
    const tr = leagueTrivia(u, 'england')
    expect(leagueTrivia(u, 'england')).toBe(tr)
    expect(tr.coverage.estimatedSeasons).toBeGreaterThan(0)
    for (const s of tr.serving) if (s.from < u.firstSeason) expect(s.estimated).toBe(true)
    // A jump never compares an estimated rating with an EA one
    for (const r of tr.risers) expect(r.before.season < u.firstSeason).toBe(r.after.season < u.firstSeason)
  })
})

describe('display only', () => {
  it('no engine, online or simulation module imports the Explore and player-card helpers', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const root = join(__dirname, '..', '..')
    const display = ['exploreIndex', 'exploreSearch', 'exploreFilter', 'exploreDb', 'exploreRecords', 'playerCard', 'playerProfile']
    const files: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const path = join(dir, f)
        if (statSync(path).isDirectory()) {
          if (f !== '__tests__') walk(path)
        } else if (/\.tsx?$/.test(f)) files.push(path)
      }
    }
    for (const dir of ['engine', 'online', join('game', 'logic')]) walk(join(root, dir))
    walk(join(root, 'game'))
    const offenders = files.filter((f) => !display.some((d) => f.endsWith(`${d}.ts`))).filter((f) => display.some((d) => new RegExp(`from '[^']*/${d}'`).test(readFileSync(f, 'utf8'))))
    expect(offenders).toEqual([])
  })
})
