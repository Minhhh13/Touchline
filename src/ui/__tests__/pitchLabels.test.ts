import { describe, expect, it } from 'vitest'
import { FORMATIONS } from '@engine/formations'
import { ROLES, ROLE_BY_ID } from '@engine/roles'
import { LABEL_MIN, MAT, ONE_LINE_BELOW, discRadius, labelFont, labelHeight, labelLines, labelRooms } from '../match/pitchLabels'
import { ROLE_SHORT, SHORT_ROLE_MAX, roleCodeByName, roleLine, shortRoleByName, shortRoleName } from '../match/roleNames'
import { ROLE_CODE } from '../match/shirts'
import { WIDE_CHAR, textWidth, whenFontsReady } from '../match/textWidth'

const slotsOf = (id: string) => FORMATIONS.find((f) => f.id === id)!.slots.map((s) => ({ id: s.id, x: s.x, y: s.y, foot: s.y <= 10 }))

describe('short role names', () => {
  it('names every role: a short form that is a real word or two, at most the cap long, never longer than the full name', () => {
    for (const r of ROLES) {
      const short = ROLE_SHORT[r.id]
      expect(short, r.id).toBeTruthy()
      expect(short.length, r.id).toBeLessThanOrEqual(SHORT_ROLE_MAX)
      expect(short.length, r.id).toBeLessThanOrEqual(r.name.length)
      expect(short).not.toMatch(/…|\.\.\./)
      expect(shortRoleName(r.id)).toBe(short)
    }
    expect(Object.keys(ROLE_SHORT).sort()).toEqual(ROLES.map((r) => r.id).sort())
  })

  it('keeps the short names of one position apart, and the two sides of the pitch alike', () => {
    const byPos = new Map<string, string[]>()
    for (const r of ROLES) byPos.set(r.position, [...(byPos.get(r.position) ?? []), ROLE_SHORT[r.id]])
    for (const [pos, names] of byPos) expect(new Set(names).size, pos).toBe(names.length)
    for (const role of ['winger', 'inside', 'wideplay', 'defwing']) expect(ROLE_SHORT[`lw-${role}`]).toBe(ROLE_SHORT[`rw-${role}`])
    for (const role of ['fullback', 'wingback', 'inverted']) expect(ROLE_SHORT[`lb-${role}`]).toBe(ROLE_SHORT[`rb-${role}`])
  })

  it('reads a role by its full display name, and knows nothing of a bare position', () => {
    expect(shortRoleByName('Inside Forward')).toBe('Inside')
    expect(shortRoleByName('Covering Defender')).toBe('Cover')
    expect(roleCodeByName('Complete Forward')).toBe(ROLE_CODE['st-complete'])
    expect(shortRoleByName('CB')).toBeUndefined()
    expect(roleCodeByName('CB')).toBeUndefined()
    expect(shortRoleName('no-such-role')).toBe('no-such-role')
    expect(shortRoleName('st-poacher')).toBe(ROLE_BY_ID['st-poacher'].name)
  })

  it('picks the full role, then the short name, then the code, by what fits', () => {
    const fits = (n: number) => (t: string) => t.length <= n
    expect(roleLine('Inside Forward', fits(20))).toBe('Inside Forward')
    expect(roleLine('Inside Forward', fits(8))).toBe('Inside')
    expect(roleLine('Inside Forward', fits(3))).toBe('IF')
    // The fit note counts against the room
    expect(roleLine('Complete Forward', fits(10), ' · acc.')).toBe('CF')
    expect(roleLine('Complete Forward', fits(15), ' · acc.')).toBe('Complete')
    // A bare position has nothing shorter
    expect(roleLine('GK', fits(1))).toBe('GK')
    expect(roleLine('Inside Forward', fits(3), '', 'IFW')).toBe('IFW')
  })
})

describe('pitch label rooms', () => {
  it('never lets a label reach a neighbour disc or label in any shape, at the pitch widths the screens give it', () => {
    for (const width of [200, 240, 260, 300, 340, 420, 520]) {
      for (const f of FORMATIONS) {
        const slots = slotsOf(f.id)
        const rooms = labelRooms(slots, width, 110)
        const inner = width - MAT * 2
        const h = (width * 4) / 3 - MAT * 2
        const r = discRadius(inner)
        const lh = labelHeight(inner)
        for (const a of slots) {
          expect(rooms[a.id]).toBeGreaterThanOrEqual(LABEL_MIN)
          expect(rooms[a.id]).toBeLessThanOrEqual(110)
          if (a.foot || rooms[a.id] === LABEL_MIN) continue
          const ax = (a.x / 100) * inner
          const ay = ((100 - a.y) / 100) * h
          for (const b of slots) {
            if (b === a) continue
            const bx = (b.x / 100) * inner
            const by = ((100 - b.y) / 100) * h
            // His disc, where it sits in my label's rows
            if (by + r > ay + r + 2 && by - r < ay + r + 2 + lh) expect(Math.abs(bx - ax) - r, `${f.id} ${a.id}/${b.id} @${width}`).toBeGreaterThanOrEqual(rooms[a.id] / 2)
          }
        }
      }
    }
  })

  it('gives the 4-3-3 centre-backs and midfielders less than a lone striker, and a wider pitch more', () => {
    const narrow = labelRooms(slotsOf('4-3-3'), 260, 110)
    const wide = labelRooms(slotsOf('4-3-3'), 420, 110)
    expect(narrow.cb1).toBeLessThan(narrow.st)
    expect(narrow.cm1).toBeLessThan(narrow.st)
    for (const id of Object.keys(narrow)) expect(wide[id]).toBeGreaterThanOrEqual(narrow[id])
  })

  it('keeps a midfielder clear of the holding midfielder beside him (the 4-3-3 at 260 px)', () => {
    // The holding man's disc sits in the next rows down: the old level-only rule gave the midfielders the whole gap between them
    const rooms = labelRooms(slotsOf('4-3-3'), 260, 110)
    const inner = 260 - MAT * 2
    const dx = (0.5 - 0.3) * inner
    expect(rooms.cm1 / 2 + discRadius(inner)).toBeLessThanOrEqual(dx)
  })

  it('stays on the grass: a wide man gets less than a central one', () => {
    const rooms = labelRooms(slotsOf('4-3-3'), 260, 110)
    expect(rooms.lw).toBeLessThanOrEqual(2 * 0.18 * (260 - MAT * 2))
    expect(rooms.rb).toBeLessThanOrEqual(rooms.cb2 + 30)
  })

  it('takes one line a slot on a small pitch that names roles, two everywhere else', () => {
    expect(labelLines(ONE_LINE_BELOW, true)).toBe(1)
    expect(labelLines(ONE_LINE_BELOW + 1, true)).toBe(2)
    expect(labelLines(ONE_LINE_BELOW, false)).toBe(2)
    expect(labelHeight(204, true)).toBeLessThan(labelHeight(204, false))
    expect(labelFont(300)).toBe(10)
    expect(labelFont(301)).toBe(11)
  })

  it('keeps a small pitch that names roles clear too: the holding midfielder has room under his name without a role line', () => {
    const roomsOne = labelRooms(slotsOf('4-3-3'), 214, 110, true)
    const roomsTwo = labelRooms(slotsOf('4-3-3'), 214, 110, false)
    for (const id of Object.keys(roomsOne)) expect(roomsOne[id]).toBeGreaterThanOrEqual(roomsTwo[id])
    expect(roomsOne.dm).toBeGreaterThan(roomsTwo.dm)
  })

  it('is pure: the same input gives the same rooms', () => {
    expect(labelRooms(slotsOf('3-5-2'), 300, 110)).toEqual(labelRooms(slotsOf('3-5-2'), 300, 110))
  })
})

describe('label text width', () => {
  it('falls back, where there is no canvas, to a wide per-letter estimate that scales with the type', () => {
    // The node test environment has no document: the estimate stands in for the measurement
    expect(textWidth('Aubameyang', 11)).toBeCloseTo(10 * WIDE_CHAR, 5)
    expect(textWidth('Aubameyang', 10)).toBeCloseTo((10 * 10 * WIDE_CHAR) / 11, 5)
    expect(textWidth('', 11)).toBe(0)
    expect(textWidth('Complete Forward', 11)).toBeGreaterThan(textWidth('Complete', 11))
  })
})

describe('the web font wait (r9 perf)', () => {
  it('reads the font set once a page, and nothing once it has loaded', async () => {
    let reads = 0
    const fonts = {
      get ready() {
        reads++
        return Promise.resolve()
      },
    }
    const first = whenFontsReady(fonts)
    expect(first).not.toBeNull()
    expect(whenFontsReady(fonts)).toBe(first)
    await first
    expect(whenFontsReady(fonts)).toBeNull()
    expect(reads).toBe(1)
    expect(whenFontsReady(undefined)).toBeNull()
  })
})
