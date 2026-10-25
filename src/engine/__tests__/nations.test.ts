import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { getFormation } from '../formations'
import { NATION_SLOT_COVER, NATION_SQUAD_MARGIN, nationCover, nationDepth, nationDepthFrom, nationDepthLabel, UNKNOWN_NATION } from '../nations'
import { canCover } from '../positions'
import type { Position } from '../types'

describe('nationDepth', () => {
  const u = loadTestUniverse()
  const f433 = getFormation('4-3-3')

  it('never offers unknown nationalities and skips a nation without two keepers', () => {
    const depth = nationDepth(u, ['england'], {}, f433, 11)
    expect(depth.length).toBeGreaterThan(10)
    expect(depth.some((n) => n.nation === UNKNOWN_NATION)).toBe(false)
    // Côte d'Ivoire has had plenty of Premier League players but not two distinct goalkeepers
    const civKeepers = new Set(Object.values(u.index).filter((p) => p.nationality === 'CIV' && canCover(p, 'GK', 'accomplished')).map((p) => p.playerId))
    expect(civKeepers.size).toBeLessThan(NATION_SLOT_COVER)
    expect(depth.some((n) => n.nation === 'CIV')).toBe(false)
    // England itself is obviously deep enough, and the label carries flag, name and count
    const eng = depth.find((n) => n.nation === 'ENG')
    expect(eng).toBeDefined()
    expect(nationDepthLabel(eng!)).toBe(`England · ${eng!.players} players`)
    expect(eng!.players).toBeGreaterThan(1000)
    expect(depth.map((n) => n.name)).toEqual([...depth.map((n) => n.name)].sort((a, b) => a.localeCompare(b)))
  })

  it('every qualifying nation really covers each position twice and the squad plus margin', () => {
    const squadSize = 18
    const depth = nationDepth(u, ['england'], { fromSeason: 2016 }, f433, squadSize)
    const demand = new Map<Position, number>()
    for (const s of f433.slots) demand.set(s.position, (demand.get(s.position) ?? 0) + 1)
    for (const n of depth) {
      expect(n.players).toBeGreaterThanOrEqual(squadSize + NATION_SQUAD_MARGIN)
      const rows = Object.values(u.index).filter((p) => p.nationality === n.nation && p.season >= 2016)
      expect(new Set(rows.map((p) => p.playerId)).size).toBe(n.players)
      for (const [pos, count] of demand) {
        const humans = new Set(rows.filter((p) => canCover(p, pos, 'accomplished')).map((p) => p.playerId))
        expect(humans.size).toBeGreaterThanOrEqual(NATION_SLOT_COVER * count)
      }
    }
    // A bigger squad asks for more humans, so the list can only shrink
    expect(nationDepth(u, ['england'], { fromSeason: 2016 }, f433, 22).length).toBeLessThanOrEqual(depth.length)
    // A league that is not loaded contributes nothing
    expect(nationDepth(u, ['spain'], {}, f433, 11)).toEqual([])
  })

  it('one scan filtered per squad size gives the same list as a fresh scan, so the setup slider need not rescan', () => {
    const scan = nationCover(u, ['england'], {}, f433)
    // The scan keeps every known nation, covered or not, and never the unknown bucket
    expect(scan.some((n) => n.nation === UNKNOWN_NATION)).toBe(false)
    expect(scan.some((n) => !n.covered)).toBe(true)
    expect(scan.find((n) => n.nation === 'CIV')?.covered).toBe(false)
    for (const squadSize of [11, 16, 18, 22]) {
      const fromScan = nationDepthFrom(scan, squadSize)
      expect(fromScan).toEqual(nationDepth(u, ['england'], {}, f433, squadSize))
      for (const n of fromScan) expect(n).not.toHaveProperty('covered')
    }
    // Squad sizes beyond the data leave nothing
    expect(nationDepthFrom(scan, 100000)).toEqual([])
  })
})
