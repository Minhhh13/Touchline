import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { foldName, searchPlayers, SEARCH_LIMIT, topPlayerSeasons } from '../logic/exploreSearch'

const u = loadTestUniverse(['england', 'germany'])

describe("Explore's search", () => {
  it('folds accents and case', () => {
    expect(foldName('Guéhi')).toBe('guehi')
    expect(foldName('Ødegaard')).toBe('odegaard')
    expect(foldName('Rúben DIAS')).toBe('ruben dias')
  })

  it('finds a player without his accents, one row per player, across leagues', () => {
    const hits = searchPlayers(u, 'haaland')
    const erling = hits.filter((h) => h.name === 'Erling Haaland')
    expect(erling).toHaveLength(1)
    const h = erling[0]
    // Every season of his in the loaded leagues is in the one row: Dortmund before Manchester City
    expect(h.clubs.length).toBeGreaterThan(1)
    expect(h.clubs.indexOf('manchester-city')).toBeGreaterThan(0)
    expect(h.from).toBeLessThan(h.to)
    expect(h.seasons).toBe(new Set(Object.values(u.index).filter((p) => p.playerId === h.playerId).map((p) => p.season)).size)
    expect(h.best.overall).toBe(Math.max(...Object.values(u.index).filter((p) => p.playerId === h.playerId).map((p) => p.overall)))
    // The fullest spelling of the name
    expect(h.name.length).toBeGreaterThanOrEqual(h.latest.name.length)
    // With and without an accent the same players come back
    expect(searchPlayers(u, 'guehi').map((x) => x.playerId)).toEqual(searchPlayers(u, 'guéhi').map((x) => x.playerId))
    expect(searchPlayers(u, 'guehi').length).toBeGreaterThan(0)
  })

  it('ranks a word that starts the name first, then by peak rating, and keeps every word', () => {
    const hits = searchPlayers(u, 'kane')
    const firstLoose = hits.findIndex((h) => !foldName(h.name).split(/[\s.'-]+/).some((w) => w.startsWith('kane')))
    if (firstLoose >= 0) for (const h of hits.slice(firstLoose)) expect(foldName(h.name).split(/[\s.'-]+/).some((w) => w.startsWith('kane'))).toBe(false)
    for (const h of searchPlayers(u, 'de bruyne')) expect(foldName(h.name)).toMatch(/de/)
    expect(searchPlayers(u, 'k')).toEqual([])
    expect(searchPlayers(u, '  ')).toEqual([])
    expect(searchPlayers(u, 'a').length).toBe(0)
    expect(searchPlayers(u, 'an').length).toBeLessThanOrEqual(SEARCH_LIMIT)
  })

  it('filters by his best season position and keeps a fixed order', () => {
    for (const h of searchPlayers(u, 'son', { position: 'GK' })) expect(h.best.positions[0]).toBe('GK')
    expect(searchPlayers(u, 'son')).toEqual(searchPlayers(u, 'son'))
  })
})

describe("Explore's Highest rated", () => {
  it('lists the best player-seasons of a league, best first, one per player on request', () => {
    const all = topPlayerSeasons(u, { leagueId: 'england' })
    expect(all).toHaveLength(60)
    for (let i = 1; i < all.length; i++) expect(all[i - 1].overall).toBeGreaterThanOrEqual(all[i].overall)
    for (const p of all) expect(u.clubById[p.clubId].leagueId).toBe('england')
    const one = topPlayerSeasons(u, { leagueId: 'england', onePerPlayer: true })
    expect(new Set(one.map((p) => p.playerId)).size).toBe(one.length)
    // Each is that player's best season in the league
    for (const p of one.slice(0, 10)) {
      const his = Object.values(u.index).filter((q) => q.playerId === p.playerId && u.clubById[q.clubId].leagueId === 'england')
      expect(p.overall).toBe(Math.max(...his.map((q) => q.overall)))
    }
    const keepers = topPlayerSeasons(u, { leagueId: 'germany', position: 'GK', season: 2020 })
    for (const p of keepers) {
      expect(p.positions[0]).toBe('GK')
      expect(p.season).toBe(2020)
    }
    expect(keepers.length).toBeGreaterThan(0)
  })
})

/**
 * `searchPlayers` as a fresh pass over every player-season per query, as it was before it read the shared index, but for
 * one thing: of two spellings of a name the same length it keeps the earlier season's, as the filter always did (the
 * scan kept the first in the index, which moves with the order the packs load in).
 */
function searchByScan(query: string, opts: { position?: 'ST' | 'GK'; limit?: number } = {}) {
  const words = foldName(query).trim().split(/\s+/).filter(Boolean)
  if (!words.length || words.join('').length < 2) return []
  const by = new Map<string, Array<(typeof u.index)[string]>>()
  for (const p of Object.values(u.index)) by.set(p.playerId, [...(by.get(p.playerId) ?? []), p])
  const hits = []
  for (const [playerId, list] of by) {
    const ordered = [...list].sort((a, b) => a.season - b.season || a.clubId.localeCompare(b.clubId))
    const names = [...new Set(ordered.map((p) => p.name))]
    const folded = names.map(foldName)
    if (!folded.some((n) => words.every((w) => n.includes(w)))) continue
    const best = ordered.reduce((m, p) => (p.overall > m.overall ? p : m), ordered[0])
    if (opts.position && best.positions[0] !== opts.position) continue
    const starts = folded.some((n) => words.every((w) => n.split(/[\s.'-]+/).some((part) => part.startsWith(w))))
    const clubs: string[] = []
    for (const p of ordered) if (!clubs.includes(p.clubId)) clubs.push(p.clubId)
    hits.push({ playerId, name: names.reduce((m, n) => (n.length > m.length ? n : m), names[0]), best, latest: ordered[ordered.length - 1], seasons: new Set(ordered.map((p) => p.season)).size, from: ordered[0].season, to: ordered[ordered.length - 1].season, clubs, rank: starts ? 0 : 1 })
  }
  hits.sort((a, b) => a.rank - b.rank || b.best.overall - a.best.overall || a.name.localeCompare(b.name) || a.playerId.localeCompare(b.playerId))
  return hits.slice(0, opts.limit ?? SEARCH_LIMIT).map(({ rank: _rank, ...hit }) => hit)
}

describe("Explore's search over the shared index", () => {
  it('finds exactly what a fresh scan finds, row for row, and hands out its own club lists', () => {
    for (const q of ['kane', 'haaland', 'mo sa', 'son', 'de', 'muller', 'ja']) {
      expect(searchPlayers(u, q)).toEqual(searchByScan(q))
      expect(searchPlayers(u, q, { position: 'ST', limit: 20 })).toEqual(searchByScan(q, { position: 'ST', limit: 20 }))
    }
    const first = searchPlayers(u, 'haaland')[0]
    first.clubs.push('nowhere')
    expect(searchPlayers(u, 'haaland')[0].clubs).not.toContain('nowhere')
  })
})
