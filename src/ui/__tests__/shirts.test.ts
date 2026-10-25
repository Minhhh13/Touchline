import { describe, expect, it } from 'vitest'
import { FORMATIONS, getFormation } from '@engine/formations'
import { ROLES } from '@engine/roles'
import { defaultTactics } from '@engine/tactics'
import { USER_TEAM } from '@engine/season'
import type { Appearance } from '@engine/match'
import { colourDistance } from '../match/pitchGeometry'
import { KEEPER_KITS, keeperKit, kitColours, positionCode, ROLE_CODE, roleCode, shirtNumbers, surname, teamCode } from '../match/shirts'
import { u } from './feeds'

function xi(formationId: string): Appearance[] {
  return getFormation(formationId).slots.map((s) => ({ psId: `p-${s.id}`, slotId: s.id, position: s.position, onAt: 0, offAt: 90, red: false, injured: false }))
}

describe('shirts, numbers and codes', () => {
  it('numbers every formation the classic way: unique, the keeper 1, the first striker 9, the bench from 12', () => {
    for (const f of FORMATIONS) {
      const starters = xi(f.id)
      const bench = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7']
      const late: Appearance = { psId: 'late', slotId: f.slots[5].id, position: f.slots[5].position, onAt: 60, offAt: 90, red: false, injured: false }
      const n = shirtNumbers(f, [...starters, late], bench)
      const values = Object.values(n)
      expect(new Set(values).size).toBe(values.length)
      expect(values).toHaveLength(11 + bench.length + 1)
      expect(n['p-gk']).toBe(1)
      const firstSt = f.slots.find((s) => s.position === 'ST')!
      expect(n[`p-${firstSt.id}`]).toBe(9)
      for (const s of starters) expect(n[s.psId]).toBeLessThanOrEqual(19)
      for (const id of bench) expect(n[id]).toBeGreaterThanOrEqual(12)
      expect(n.late).toBeGreaterThan(Math.max(...bench.map((id) => n[id])))
      // Stable: the same inputs give the same numbers
      expect(shirtNumbers(f, [...starters, late], bench)).toEqual(n)
    }
    const n433 = shirtNumbers(getFormation('4-3-3'), xi('4-3-3'), [])
    expect([n433['p-rb'], n433['p-lb'], n433['p-cb1'], n433['p-cb2'], n433['p-dm'], n433['p-cm1'], n433['p-cm2'], n433['p-rw'], n433['p-lw']]).toEqual([2, 3, 5, 4, 6, 8, 14, 7, 11])
    // A replay without the bench numbers the men who came on in the order they came on
    const replay = shirtNumbers(getFormation('4-4-2'), [...xi('4-4-2'), { ...xi('4-4-2')[3], psId: 'second', onAt: 70 }, { ...xi('4-4-2')[2], psId: 'first', onAt: 55 }], [])
    expect(replay.first).toBeLessThan(replay.second)
  })

  it('codes every role in at most three letters, unique within a position', () => {
    for (const r of ROLES) {
      expect(ROLE_CODE[r.id]).toMatch(/^[A-Z0-9]{1,3}$/)
    }
    const byPos = new Map<string, string[]>()
    for (const r of ROLES) byPos.set(r.position, [...(byPos.get(r.position) ?? []), ROLE_CODE[r.id]])
    for (const codes of byPos.values()) expect(new Set(codes).size).toBe(codes.length)
    expect(ROLES).toHaveLength(34)
    const t = defaultTactics('4-3-3')
    expect(roleCode(t, 'st', 'ST')).toBe('CF')
    expect(roleCode({ ...t, roles: { ...t.roles, st: 'st-false9' } }, 'st', 'ST')).toBe('F9')
    expect(roleCode({ ...t, roles: {} }, 'gk', 'GK')).toBe('GK')
  })

  it('gives every slot of every formation its Football Manager position code', () => {
    const codes = (id: string) => getFormation(id).slots.map((s) => positionCode(getFormation(id), s.id))
    expect(codes('4-3-3')).toEqual(['GK', 'DL', 'DC', 'DC', 'DR', 'DM', 'MC', 'MC', 'AML', 'STC', 'AMR'])
    expect(codes('4-4-2')).toEqual(['GK', 'DL', 'DC', 'DC', 'DR', 'ML', 'MC', 'MC', 'MR', 'STC', 'STC'])
    expect(codes('4-2-3-1')).toEqual(['GK', 'DL', 'DC', 'DC', 'DR', 'DM', 'DM', 'AML', 'AMC', 'AMR', 'STC'])
    expect(codes('3-5-2')).toEqual(['GK', 'DC', 'DC', 'DC', 'WBL', 'DM', 'MC', 'MC', 'WBR', 'STC', 'STC'])
    expect(codes('3-4-3')).toEqual(['GK', 'DC', 'DC', 'DC', 'WBL', 'MC', 'MC', 'WBR', 'AML', 'STC', 'AMR'])
    expect(codes('4-1-4-1')).toEqual(['GK', 'DL', 'DC', 'DC', 'DR', 'DM', 'ML', 'MC', 'MC', 'MR', 'STC'])
    expect(codes('4-4-2-diamond')).toEqual(['GK', 'DL', 'DC', 'DC', 'DR', 'DM', 'MC', 'MC', 'AMC', 'STC', 'STC'])
    expect(codes('5-3-2')).toEqual(['GK', 'WBL', 'DC', 'DC', 'DC', 'WBR', 'MC', 'DM', 'MC', 'STC', 'STC'])
    expect(positionCode(getFormation('4-3-3'), 'nope')).toBe('?')
  })

  it('surnames keep their particles; team codes and kit colours come from the clubs', () => {
    expect(surname('Virgil van Dijk')).toBe('van Dijk')
    expect(surname('Kevin De Bruyne')).toBe('De Bruyne')
    expect(surname('Ruud van der Gaag')).toBe('van der Gaag')
    expect(surname('Alexis Mac Allister')).toBe('Mac Allister')
    expect(surname('Rodri')).toBe('Rodri')
    expect(surname('Erling Haaland')).toBe('Haaland')
    expect(surname(undefined)).toBe('?')
    const arsenal = u.clubById.arsenal
    expect(teamCode(u, 'arsenal', 'ARS')).toBe(arsenal.code.toUpperCase())
    expect(teamCode(u, 'friendly-arsenal', 'X')).toBe(arsenal.code.toUpperCase())
    expect(teamCode(u, USER_TEAM, 'X', 'txi')).toBe('TXI')
    const kits = kitColours(u, 'burnley', USER_TEAM, 'arsenal')
    expect(kits.home).toBe(u.clubById.burnley.colours.primary)
    expect(colourDistance(kits.home, kits.away)).toBeGreaterThan(0)
  })

  it('dresses the keeper apart from both outfield kits', () => {
    const kits = ['#ffffff', '#d00027', '#034694', '#6caddf', '#fdb913', '#000000', '#7a263a', '#e03a3e', '#132257', '#00a650', '#ef0107', '#ffcd00']
    for (const h of kits) {
      for (const a of kits) {
        const k = keeperKit(h, a)
        expect(k).toMatch(/^#[0-9a-f]{6}$/)
        const apart = (x: string) => Math.min(colourDistance(x, h), colourDistance(x, a))
        const first = KEEPER_KITS.find((x) => apart(x) >= 120)
        // The first kit far enough from both; failing that, the one that stands furthest apart
        expect(k).toBe(first ?? KEEPER_KITS.reduce((best, x) => (apart(x) > apart(best) ? x : best)))
        expect(apart(k)).toBeGreaterThanOrEqual(100)
      }
    }
  })
})
