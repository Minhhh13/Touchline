import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { canCover, POSITIONS, ratingAt } from '@engine/positions'
import type { PlayerSeason } from '@engine/types'
import { attributeColumns, careerSeasons, formBand, formSeries, positionMap, seasonScale, seasonSeries, shortSeason, traitWord } from '../logic/playerCard'
import { formTitle, formTrend } from '../logic/squadDisplay'
import { squadPlayers } from '../logic/players'
import { seasonGame } from './seasonGame'

const u = loadTestUniverse()

describe('player card: rating by season', () => {
  it('labels seasons as 08/09 and wraps the century', () => {
    expect(shortSeason(2008)).toBe('08/09')
    expect(shortSeason(1999)).toBe('99/00')
    expect(shortSeason(2026)).toBe('26/27')
  })

  it('gives one point per season, oldest first, with exactly one peak at the highest rating', () => {
    const byPlayer = new Map<string, PlayerSeason[]>()
    for (const p of Object.values(u.index)) byPlayer.set(p.playerId, [...(byPlayer.get(p.playerId) ?? []), p])
    const bad: string[] = []
    for (const id of [...byPlayer.keys()].sort().slice(0, 600)) {
      const seasons = byPlayer.get(id)!.sort((a, b) => a.season - b.season || a.clubId.localeCompare(b.clubId))
      const pts = seasonSeries(u, seasons)
      const { min, max } = seasonScale(pts)
      const ok =
        pts.length === new Set(seasons.map((s) => s.season)).size &&
        pts.every((p, i) => i === 0 || p.season > pts[i - 1].season) &&
        pts.filter((p) => p.peak).length === 1 &&
        pts.find((p) => p.peak)!.overall === Math.max(...seasons.map((s) => s.overall)) &&
        pts.every((p, i) => p.clubChange === (i > 0 && p.clubId !== pts[i - 1].clubId)) &&
        max === 99 &&
        pts.every((p) => p.overall >= min)
      if (!ok) bad.push(id)
    }
    expect(bad).toEqual([])
    expect(careerSeasons(u, [...byPlayer.keys()][0]).length).toBe(byPlayer.get([...byPlayer.keys()][0])!.length)
  }, 60_000)

  it('keeps the scale at 50 to 99 unless a season dips below 50', () => {
    expect(seasonScale([{ overall: 78 }, { overall: 80 }])).toEqual({ min: 50, max: 99 })
    expect(seasonScale([{ overall: 50 }])).toEqual({ min: 50, max: 99 })
    expect(seasonScale([{ overall: 47 }, { overall: 70 }])).toEqual({ min: 40, max: 99 })
  })

  it('finds Haaland in the packs with a season per row', () => {
    const p = Object.values(u.index).find((x) => x.name.includes('Haaland'))
    expect(p).toBeDefined()
    const pts = seasonSeries(u, careerSeasons(u, p!.playerId))
    expect(pts.length).toBeGreaterThanOrEqual(2)
    expect(pts.some((x) => x.estimated)).toBe(false)
  }, 60_000)
})

describe('player card: position map', () => {
  it('marks natural and cover exactly where canCover accepts, for every England player-season', () => {
    let natural = 0
    let cover = 0
    const bad: string[] = []
    for (const p of Object.values(u.index)) {
      const spots = positionMap(p)
      if (spots.map((s) => s.pos).join() !== POSITIONS.join()) bad.push(p.id)
      for (const s of spots) {
        if ((s.fit === 'natural' || s.fit === 'cover') !== canCover(p, s.pos) || (s.fit === 'natural') !== p.positions.includes(s.pos) || s.rating !== Math.round(ratingAt(p, s.pos))) bad.push(`${p.id} ${s.pos}`)
        if (s.fit === 'natural') natural++
        if (s.fit === 'cover') cover++
      }
    }
    expect(bad).toEqual([])
    expect(natural).toBeGreaterThan(0)
    expect(cover).toBeGreaterThan(0)
  }, 60_000)
})

describe('player card: attribute columns', () => {
  it('splits into Technical 5, Physical 5 and Mental 6 with goalkeeping first for a keeper', () => {
    const all = Object.values(u.index)
    const gk = all.find((p) => p.positions[0] === 'GK')!
    const st = all.find((p) => p.positions[0] === 'ST')!
    for (const p of [gk, st]) {
      const cols = attributeColumns(p)
      expect(cols.map((c) => c.title)).toEqual(['Technical', 'Physical', 'Mental'])
      expect(cols.map((c) => c.rows.length)).toEqual([5, 5, 6])
      expect(cols[0].rows.map((r) => r.key)).toContain('defending')
      expect(cols[1].rows[4].kind).toBe('risk')
    }
    expect(attributeColumns(gk)[0].rows[0].key).toBe('goalkeeping')
    expect(attributeColumns(st)[0].rows[4].key).toBe('goalkeeping')
  }, 60_000)

  it('shows hidden traits as words, never numbers', () => {
    expect(traitWord(0.9)).toBe('High')
    expect(traitWord(0.5)).toBe('Avg')
    expect(traitWord(0.1)).toBe('Low')
    for (const p of Object.values(u.index).slice(0, 500)) {
      for (const r of attributeColumns(p)[2].rows) if (r.kind === 'trait') expect(['High', 'Avg', 'Low']).toContain(r.word)
    }
  }, 60_000)
})

describe('player card: form', () => {
  it('bands ratings: good from 7.5, bad under 6', () => {
    expect(formBand(7.5)).toBe('good')
    expect(formBand(7.49)).toBe('mid')
    expect(formBand(6)).toBe('mid')
    expect(formBand(5.99)).toBe('bad')
  })

  it('points the squad row arrow (squadDisplay.formTrend) from the last three against the season average, with a ±0.3 band', () => {
    const stats = (avg: number, apps = 10) => ({ apps, starts: apps, minutes: apps * 90, goals: 0, assists: 0, ratingSum: avg * apps, motm: 0, cleanSheets: 0, yellows: 0, reds: 0 })
    expect(formTrend({ recentRatings: [7, 7], seasonStats: stats(6.5) })).toBeNull()
    expect(formTrend({ recentRatings: [7, 7, 7], seasonStats: stats(6.5, 0) })).toBeNull()
    expect(formTrend({ recentRatings: [6, 7.5, 7.5, 7.5], seasonStats: stats(7) })!.dir).toBe('up')
    expect(formTrend({ recentRatings: [8, 6.5, 6.5, 6.5], seasonStats: stats(7) })!.dir).toBe('down')
    const flat = formTrend({ recentRatings: [7.2, 6.9, 7.1], seasonStats: stats(7) })!
    expect(flat.dir).toBe('flat')
    expect(formTitle(flat)).toBe('Form steady: 7.1 over the last 3, 7.0 this season')
  })

  it('reads a real season: at most six stored ratings, and an arrow for every regular', () => {
    const g = seasonGame(u, 'player-card-form', 8)
    let arrows = 0
    for (const { s } of squadPlayers(g, u)) {
      const pts = formSeries(s)
      expect(pts.length).toBeLessThanOrEqual(6)
      expect(pts.map((x) => x.rating)).toEqual(s.recentRatings)
      const t = formTrend(s)
      if (s.recentRatings.length >= 3) {
        expect(t).not.toBeNull()
        arrows++
      }
    }
    expect(arrows).toBeGreaterThanOrEqual(11)
  }, 60_000)
})
