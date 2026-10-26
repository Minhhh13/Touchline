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
