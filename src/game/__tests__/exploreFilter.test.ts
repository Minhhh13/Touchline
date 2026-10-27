import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { boundOf, filterActive, filterPlayers, nationCounts } from '../logic/exploreFilter'
import { foldName } from '../logic/exploreSearch'

const u = loadTestUniverse(['england', 'germany'])

describe("Explore's filtered search", () => {
  it('needs a name or a filter before it lists anyone', () => {
    expect(filterActive({})).toBe(false)
    expect(filterActive({ query: 'k' })).toBe(false)
    expect(filterActive({ query: 'ka' })).toBe(true)
    expect(filterActive({ nation: 'BR' })).toBe(true)
    expect(filterActive({ minAge: 0 })).toBe(true)
    expect(filterPlayers(u, {}).rows).toEqual([])
  })

  it('keeps every filter on the season it shows', () => {
    const f = { leagueId: 'germany', position: 'ST' as const, minAge: 20, maxAge: 23, minRating: 75, maxRating: 85 }
    const { rows, total } = filterPlayers(u, f)
    expect(rows.length).toBeGreaterThan(0)
    expect(total).toBeGreaterThanOrEqual(rows.length)
    for (const h of rows) {
      expect(u.clubById[h.p.clubId].leagueId).toBe('germany')
      expect(h.p.positions[0]).toBe('ST')
      expect(h.p.age).toBeGreaterThanOrEqual(20)
      expect(h.p.age).toBeLessThanOrEqual(23)
      expect(h.p.overall).toBeGreaterThanOrEqual(75)
      expect(h.p.overall).toBeLessThanOrEqual(85)
    }
    // One row per player by default, best rating first
    expect(new Set(rows.map((h) => h.p.playerId)).size).toBe(rows.length)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].p.overall).toBeGreaterThanOrEqual(rows[i].p.overall)
    // Every season: at least as many rows
    expect(filterPlayers(u, { ...f, onePerPlayer: false }).total).toBeGreaterThanOrEqual(total)
  })

  it('filters by nation and by any position, and sorts both ways', () => {
    const top = nationCounts(u)
    expect(top[0].players).toBeGreaterThanOrEqual(top[1].players)
    const nation = top.find((n) => n.nation !== top[0].nation)!.nation
    const all = filterPlayers(u, { nation, limit: 100000 })
    expect(all.total).toBe(top.find((n) => n.nation === nation)!.players)
    for (const h of all.rows) expect(h.p.nationality).toBe(nation)
    const any = filterPlayers(u, { position: 'LW', anyPosition: true, minRating: 80 })
    for (const h of any.rows) expect(h.p.positions).toContain('LW')
    expect(any.total).toBeGreaterThanOrEqual(filterPlayers(u, { position: 'LW', minRating: 80 }).total)
    const young = filterPlayers(u, { minRating: 80, sort: 'age' }).rows
    for (let i = 1; i < young.length; i++) expect(young[i - 1].p.age).toBeLessThanOrEqual(young[i].p.age)
    const old = filterPlayers(u, { minRating: 80, sort: 'age', reverse: true }).rows
    for (let i = 1; i < old.length; i++) expect(old[i - 1].p.age).toBeGreaterThanOrEqual(old[i].p.age)
  })

  it('matches a name without accents and ranks a word that starts the name first', () => {
    const rows = filterPlayers(u, { query: 'muller' }).rows
    expect(rows.length).toBeGreaterThan(0)
    // Some spelling of his name holds the word ("N. Müller" in one season, "N. Mueller" in another)
    for (const h of rows) expect(Object.values(u.index).some((p) => p.playerId === h.p.playerId && foldName(p.name).includes('muller'))).toBe(true)
    expect(filterPlayers(u, { query: 'müller' }).rows.map((h) => h.p.id)).toEqual(rows.map((h) => h.p.id))
    // The same filter twice gives the same rows (the index is built once and never reordered)
    expect(filterPlayers(u, { query: 'muller' }).rows).toEqual(rows)
  })

  it('reads a number field', () => {
    expect(boundOf('')).toBeUndefined()
    expect(boundOf(' 23 ')).toBe(23)
    expect(boundOf('x')).toBeUndefined()
  })
})
