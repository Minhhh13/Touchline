import { describe, expect, it } from 'vitest'
import { getFormation } from '@engine/formations'
import { defaultTactics } from '@engine/tactics'
import type { MatchEvent, Tactics } from '@engine/types'
import type { Appearance } from '@engine/match'
import { ballAt, buildBallPath, MAX_HOP, type BallKeyframe } from '../match/possession'
import { initials, kitColour, onPitchAt, placeSide, slotPoint, toShared, type Side } from '../match/pitchGeometry'

function xi(formationId: string, prefix: string): Appearance[] {
  return getFormation(formationId).slots.map((s) => ({ psId: `${prefix}-${s.id}`, slotId: s.id, position: s.position, onAt: 0, offAt: 90, red: false, injured: false }))
}

const homeT = defaultTactics('4-3-3')
const awayT = defaultTactics('4-2-3-1')
const sub: Appearance = { psId: 'h-sub', slotId: 'st', position: 'ST', onAt: 60, offAt: 90, red: false, injured: false }
const homeXI: Appearance[] = [...xi('4-3-3', 'h'), sub].map((a) => (a.psId === 'h-st' ? { ...a, offAt: 60 } : a))
const home = placeSide(homeXI, homeT, 'home')
const away = placeSide(xi('4-2-3-1', 'a'), awayT, 'away')
const events: MatchEvent[] = [
  { minute: 12, type: 'chance', side: 'home', playerId: 'h-lw', text: 'X drags a shot wide.', position: { x: 88, y: 40 } },
  { minute: 23, type: 'save', side: 'away', playerId: 'a-st', secondaryId: 'h-gk', text: 'Saved.', position: { x: 91, y: 55 } },
  { minute: 31, type: 'goal', side: 'home', playerId: 'h-st', text: 'GOAL!', position: { x: 93, y: 48 } },
  { minute: 44, type: 'yellow', side: 'away', playerId: 'a-dm1', text: 'Booked.' },
  { minute: 67, type: 'penalty', side: 'away', playerId: 'a-am', text: 'Penalty scored.', position: { x: 89.5, y: 50 } },
  { minute: 67, type: 'chance', side: 'home', playerId: 'h-sub', text: 'Over the bar.', position: { x: 80, y: 60 } },
  { minute: 92, type: 'goal', side: 'home', playerId: 'h-sub', text: 'GOAL!', position: { x: 95, y: 50 } },
]
const momentum = Array.from({ length: 18 }, (_, i) => (i < 9 ? 0.7 : 0.4))
const dist = (a: BallKeyframe, b: BallKeyframe) => Math.hypot(a.x - b.x, a.y - b.y)

describe('ball path generator', () => {
  const path = buildBallPath({ from: 0, to: 90, momentum, events, home, away, seed: 'test' })

  it('is deterministic and keeps time strictly increasing', () => {
    expect(buildBallPath({ from: 0, to: 90, momentum, events, home, away, seed: 'test' })).toEqual(path)
    expect(buildBallPath({ from: 0, to: 90, momentum, events, home, away, seed: 'other' })).not.toEqual(path)
    expect(path.length).toBeGreaterThan(150)
    for (let i = 1; i < path.length; i++) expect(path[i].t).toBeGreaterThan(path[i - 1].t)
    expect(path[0].t).toBeGreaterThanOrEqual(0)
    expect(path[path.length - 1].t).toBeLessThan(95)
  })

  it('stays on the pitch and never teleports except for a kick-off', () => {
    for (let i = 0; i < path.length; i++) {
      const k = path[i]
      expect(k.x).toBeGreaterThanOrEqual(0)
      expect(k.x).toBeLessThanOrEqual(100)
      expect(k.y).toBeGreaterThanOrEqual(0)
      expect(k.y).toBeLessThanOrEqual(100)
      if (i > 0 && k.kind !== 'reset') expect(dist(path[i - 1], k)).toBeLessThanOrEqual(MAX_HOP + 1)
    }
  })

  it('puts the shot at the event position in the event minute, mirrored for the away side, and resets after a goal', () => {
    const shots = path.filter((k) => k.kind === 'shot')
    expect(shots).toHaveLength(6)
    const at = (minute: number, side: Side) => shots.find((k) => k.t >= minute && k.t < minute + 1 && k.side === side)!
    expect(at(12, 'home')).toMatchObject({ x: 88, y: 40, holder: 'h-lw' })
    expect(at(23, 'away')).toMatchObject({ x: 9, y: 45, holder: 'a-st' })
    expect(at(67, 'away')).toMatchObject({ x: 10.5, y: 50 })
    expect(at(92, 'home')).toMatchObject({ x: 95, y: 50, holder: 'h-sub' })
    const goals = path.filter((k) => k.kind === 'goal')
    expect(goals).toHaveLength(3)
    for (const g of goals) {
      const i = path.indexOf(g)
      expect(path[i + 1]).toMatchObject({ kind: 'reset', x: 50, y: 50 })
      expect(path[i + 1].side).not.toBe(g.side)
      expect(g.x).toBe(g.side === 'home' ? 100 : 0)
    }
    const save = path.find((k) => k.kind === 'save')!
    expect(save).toMatchObject({ side: 'home', holder: 'h-gk' })
    const miss = path.filter((k) => k.kind === 'miss')
    expect(miss).toHaveLength(2)
    for (const m of miss) expect(Math.abs(m.y - 50)).toBeGreaterThan(10)
  })

  it('follows the momentum: the side with the pressure has most of the ball, and the substitute plays only after he is on', () => {
    const passes = path.filter((k) => k.kind === 'pass')
    const firstHalf = passes.filter((k) => k.t < 45)
    const secondHalf = passes.filter((k) => k.t >= 46)
    expect(firstHalf.filter((k) => k.side === 'home').length / firstHalf.length).toBeGreaterThan(0.55)
    expect(secondHalf.filter((k) => k.side === 'away').length / secondHalf.length).toBeGreaterThan(0.5)
    for (const k of path) {
      if (k.holder === 'h-sub') expect(k.t).toBeGreaterThanOrEqual(60)
      if (k.holder === 'h-st') expect(k.t).toBeLessThan(60)
    }
  })

  it('lays out only the requested minutes, so a replay from 71 picks up where the stop left off', () => {
    const late = buildBallPath({ from: 71, to: 90, momentum, events, home, away, seed: 'test' })
    expect(late[0].t).toBeGreaterThanOrEqual(71)
    expect(late.filter((k) => k.kind === 'shot')).toHaveLength(1)
    const first = buildBallPath({ from: 0, to: 45, momentum, events, home, away, seed: 'test' })
    expect(first[first.length - 1].t).toBeLessThan(46)
    expect(first.filter((k) => k.kind === 'shot')).toHaveLength(3)
    expect(buildBallPath({ from: 0, to: 90, momentum, events, home: [], away, seed: 'test' })).toEqual([])
  })

  it('interpolates between keyframes and jumps when motion is reduced', () => {
    for (let t = 0; t <= 94; t += 0.37) {
      const b = ballAt(path, t)!
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x).toBeLessThanOrEqual(100)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeLessThanOrEqual(100)
    }
    const k = path[40]
    expect(ballAt(path, k.t)).toMatchObject({ x: k.x, y: k.y, kind: k.kind })
    const mid = ballAt(path, (k.t + path[41].t) / 2)!
    expect(mid.x).toBeCloseTo((k.x + path[41].x) / 2, 5)
    expect(ballAt(path, (k.t + path[41].t) / 2, true)).toMatchObject({ x: k.x, y: k.y })
    expect(ballAt([], 10)).toBeNull()
    expect(ballAt(path, -5)).toMatchObject({ x: path[0].x, y: path[0].y })
  })
})

describe('pitch geometry', () => {
  it('mirrors the away side and keeps every man on the pitch', () => {
    for (const p of [...home, ...away]) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(100)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(100)
    }
    expect(home.find((p) => p.position === 'GK')!.x).toBeLessThan(10)
    expect(away.find((p) => p.position === 'GK')!.x).toBeGreaterThan(90)
    expect(toShared({ x: 90, y: 30 }, 'away')).toEqual({ x: 10, y: 70 })
    expect(toShared({ x: 90, y: 30 }, 'home')).toEqual({ x: 90, y: 30 })
  })

  it('moves the block with the instructions: a high line lifts the defenders, width spreads the wide men, mentality shifts everyone', () => {
    const cb = getFormation('4-3-3').slots.find((s) => s.id === 'cb1')!
    const lw = getFormation('4-3-3').slots.find((s) => s.id === 'lw')!
    const gk = getFormation('4-3-3').slots.find((s) => s.id === 'gk')!
    const t = (patch: Partial<Tactics>): Tactics => ({ ...homeT, ...patch })
    expect(slotPoint(cb, t({ defensiveLine: 'high' }), 'home').x).toBeGreaterThan(slotPoint(cb, homeT, 'home').x)
    expect(slotPoint(cb, t({ defensiveLine: 'deep' }), 'home').x).toBeLessThan(slotPoint(cb, homeT, 'home').x)
    expect(slotPoint(lw, t({ width: 'wide' }), 'home').y).toBeLessThan(slotPoint(lw, homeT, 'home').y)
    expect(slotPoint(lw, t({ width: 'narrow' }), 'home').y).toBeGreaterThan(slotPoint(lw, homeT, 'home').y)
    expect(slotPoint(lw, t({ mentality: 'attacking' }), 'home').x).toBeGreaterThan(slotPoint(lw, homeT, 'home').x)
    expect(slotPoint(lw, t({ mentality: 'attacking' }), 'away').x).toBeLessThan(slotPoint(lw, homeT, 'away').x)
    expect(slotPoint(gk, t({ mentality: 'attacking', defensiveLine: 'high' }), 'home')).toEqual(slotPoint(gk, homeT, 'home'))
  })

  it('knows who is on the pitch at a minute', () => {
    expect(onPitchAt(home, 30).map((p) => p.psId)).toContain('h-st')
    expect(onPitchAt(home, 30).map((p) => p.psId)).not.toContain('h-sub')
    expect(onPitchAt(home, 60).map((p) => p.psId)).toContain('h-sub')
    expect(onPitchAt(home, 60).map((p) => p.psId)).not.toContain('h-st')
    expect(onPitchAt(home, 60)).toHaveLength(11)
    expect(onPitchAt(home, 94)).toHaveLength(11)
    const sentOff = home.map((p) => (p.psId === 'h-cb1' ? { ...p, red: true, offAt: 70 } : p))
    expect(onPitchAt(sentOff, 69)).toHaveLength(11)
    expect(onPitchAt(sentOff, 70)).toHaveLength(10)
    expect(onPitchAt(sentOff, 90)).toHaveLength(10)
  })

  it('makes initials and picks a kit that does not clash', () => {
    expect(initials('Erling Haaland')).toBe('EH')
    expect(initials('Rodri')).toBe('RO')
    expect(initials('Kevin De Bruyne')).toBe('KB')
    expect(initials(undefined)).toBe('?')
    expect(kitColour({ primary: '#6caddf', secondary: '#ffffff' }, '#6caddf', '#999')).toBe('#ffffff')
    expect(kitColour({ primary: '#da020e', secondary: '#ffffff' }, '#6caddf', '#999')).toBe('#da020e')
    expect(kitColour(undefined, '#6caddf', '#999')).toBe('#999')
  })
})
