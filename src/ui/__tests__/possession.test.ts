import { describe, expect, it } from 'vitest'
import { getFormation } from '@engine/formations'
import { defaultTactics } from '@engine/tactics'
import type { MatchEvent, Tactics } from '@engine/types'
import type { Appearance } from '@engine/match'
import { arcHeight, ballAt, bentPoint, buildBallPath, easeInOut, easePass, goalHolds, MAX_HOP, strikeTimes, type BallKeyframe } from '../match/possession'
import { HOLD_MS } from '../match/clockStore'
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

const strikes = strikeTimes(events, 0, 90)

describe('ball path generator', () => {
  const path = buildBallPath({ from: 0, to: 90, momentum, events, home, away, seed: 'test' })

  it('is deterministic and keeps time strictly increasing', () => {
    expect(buildBallPath({ from: 0, to: 90, momentum, events, home, away, seed: 'test' })).toEqual(path)
    expect(buildBallPath({ from: 0, to: 90, momentum, events, home, away, seed: 'other' })).not.toEqual(path)
    expect(path.length).toBeGreaterThan(150)
    for (let i = 1; i < path.length; i++) expect(path[i].t).toBeGreaterThan(path[i - 1].t)
    expect(path[0]).toMatchObject({ t: 0, x: 50, y: 50, kind: 'kickoff', side: 'home' })
    expect(path[path.length - 1].t).toBeLessThan(95)
  })

  it('stays on the pitch and never teleports: only a kick-off or a high ball covers more than a hop', () => {
    for (let i = 0; i < path.length; i++) {
      const k = path[i]
      expect(k.x).toBeGreaterThanOrEqual(0)
      expect(k.x).toBeLessThanOrEqual(100)
      expect(k.y).toBeGreaterThanOrEqual(0)
      expect(k.y).toBeLessThanOrEqual(100)
      if (i > 0 && k.kind !== 'kickoff' && k.kind !== 'goal' && (k.loft ?? 0) < 0.5) expect(dist(path[i - 1], k)).toBeLessThanOrEqual(MAX_HOP + 1)
    }
  })

  it('strikes every shot at its event position on the strike moment the ticker holds for, and kicks off after a goal', () => {
    const shots = path.filter((k) => k.kind === 'shot')
    expect(shots).toHaveLength(6)
    // A lone shot a little past the middle of its minute; two in minute 67 (a penalty at one end, then a chance at the other) spread
    // apart within it, so the ball has the time to get from the kick-off to the second
    expect(strikes.get(0)).toBeCloseTo(12.55)
    expect(strikes.get(4)!).toBeGreaterThanOrEqual(67.05)
    expect(strikes.get(5)!).toBeLessThanOrEqual(67.95)
    expect(strikes.get(5)! - strikes.get(4)!).toBeGreaterThan(0.74)
    expect(strikes.has(3)).toBe(false)
    // The strike moment of every shot is exactly the one strikeTimes gives (the ticker holds the clock there for a goal)
    expect(shots.map((k) => k.t).sort((x, y) => x - y)).toEqual([...strikes.values()].sort((x, y) => x - y))
    const at = (minute: number, side: Side) => shots.find((k) => k.t >= minute && k.t < minute + 1 && k.side === side)!
    expect(at(12, 'home')).toMatchObject({ x: 88, y: 40, holder: 'h-lw' })
    expect(at(23, 'away')).toMatchObject({ x: 9, y: 45, holder: 'a-st' })
    expect(at(67, 'away')).toMatchObject({ x: 10.5, y: 50 })
    expect(at(92, 'home')).toMatchObject({ x: 95, y: 50, holder: 'h-sub' })
    // The shooter has it at his feet as he arrives at the spot
    for (const k of shots) expect(ballAt(path, k.t)!.holder ?? k.holder).toBe(k.holder)
    const goals = path.filter((k) => k.kind === 'goal')
    expect(goals).toHaveLength(3)
    for (const g of goals) {
      const i = path.indexOf(g)
      expect(path[i - 1].kind).toBe('shot')
      expect(path[i + 1]).toMatchObject({ kind: 'kickoff', x: 50, y: 50 })
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
    const passes = path.filter((k) => k.kind === 'pass' || k.kind === 'carry')
    const firstHalf = passes.filter((k) => k.t < 45)
    const secondHalf = passes.filter((k) => k.t >= 46)
    expect(firstHalf.filter((k) => k.side === 'home').length / firstHalf.length).toBeGreaterThan(0.55)
    expect(secondHalf.filter((k) => k.side === 'away').length / secondHalf.length).toBeGreaterThan(0.5)
    for (const k of path) {
      if (k.holder === 'h-sub') expect(k.t).toBeGreaterThanOrEqual(60)
      if (k.holder === 'h-st') expect(k.t).toBeLessThan(61)
    }
  })

  it('lays out only the requested minutes: the second half kicks off from the centre, a replay from 71 picks up where the stop left it', () => {
    const first = buildBallPath({ from: 0, to: 45, momentum, events, home, away, seed: 'test' })
    expect(first[first.length - 1].t).toBeLessThanOrEqual(46)
    expect(first.filter((k) => k.kind === 'shot')).toHaveLength(3)
    const second = buildBallPath({ from: 46, to: 70, momentum, events, home, away, seed: 'test' })
    expect(second[0]).toMatchObject({ t: 46, x: 50, y: 50, kind: 'kickoff', side: 'away' })
    const end = second[second.length - 1]
    const late = buildBallPath({ from: 71, to: 90, momentum, events, home, away, seed: 'test', startAt: { x: end.x, y: end.y, side: end.side, holder: end.holder } })
    expect(late[0]).toMatchObject({ t: 71, x: end.x, y: end.y })
    expect(late.filter((k) => k.kind === 'shot')).toHaveLength(1)
    expect(buildBallPath({ from: 0, to: 90, momentum, events, home: [], away, seed: 'test' })).toEqual([])
  })

  it('moves at a footballing pace: at 1x the ball rarely covers more than 4 SVG units in a 60 fps frame, and someone is on the ball much of the time', () => {
    const steps: number[] = []
    let held = 0
    let frames = 0
    const dt = 16.67 / 330
    let prev = ballAt(path, 0)!
    for (let t = dt; t < 90; t += dt) {
      const b = ballAt(path, t)!
      frames++
      if (b.holder) held++
      const goalHop = b.next?.kind === 'goal' || b.next?.kind === 'kickoff' || path[b.index].kind === 'goal'
      if (!goalHop) steps.push(Math.hypot((b.x - prev.x) * 1.05, (b.y - prev.y) * 0.68))
      prev = b
    }
    steps.sort((x, y) => x - y)
    expect(steps[Math.floor(steps.length * 0.95)]).toBeLessThan(4)
    expect(steps[Math.floor(steps.length * 0.5)]).toBeLessThan(2)
    expect(held / frames).toBeGreaterThan(0.3)
  })

  it('interpolates along each hop and jumps when motion is reduced', () => {
    for (let t = 0; t <= 94; t += 0.37) {
      const b = ballAt(path, t)!
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x).toBeLessThanOrEqual(100)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeLessThanOrEqual(100)
      expect(b.h).toBeGreaterThanOrEqual(0)
      expect(b.h).toBeLessThanOrEqual(1)
    }
    const i = path.findIndex((_, j) => j > 30 && !path[j + 1]?.bend && !path[j + 1]?.loft && path[j + 1]?.kind === 'pass')
    const k = path[i]
    const n = path[i + 1]
    expect(ballAt(path, k.t)).toMatchObject({ x: k.x, y: k.y, kind: k.kind })
    const mid = ballAt(path, (k.t + n.t) / 2)!
    expect(mid.x).toBeCloseTo((k.x + n.x) / 2, 5)
    expect(ballAt(path, (k.t + n.t) / 2, true)).toMatchObject({ x: k.x, y: k.y })
    expect(ballAt([], 10)).toBeNull()
    expect(ballAt(path, -5)).toMatchObject({ x: path[0].x, y: path[0].y })
    // A lofted hop is in the air half-way
    const hi = path.findIndex((x, j) => j > 0 && (x.loft ?? 0) >= 0.5)
    expect(ballAt(path, (path[hi - 1].t + path[hi].t) / 2)!.h).toBeGreaterThan(0.4)
  })
})

describe('ball motion helpers', () => {
  it('eases in and out: 0 to 1, never backwards, with no jolt at either end', () => {
    for (const ease of [easeInOut, easePass]) {
      expect(ease(0)).toBe(0)
      expect(ease(1)).toBe(1)
      expect(ease(0.5)).toBeCloseTo(0.5, 5)
      let last = 0
      for (let f = 0.01; f <= 1.0001; f += 0.01) {
        const v = ease(f)
        expect(v).toBeGreaterThanOrEqual(last - 1e-12)
        // Never faster than twice the mean speed
        expect(v - last).toBeLessThan(0.0201)
        last = v
      }
      expect(ease(0.01)).toBeLessThan(0.001)
      expect(1 - ease(0.99)).toBeLessThan(0.001)
    }
  })

  it('arcs a lofted ball and bends a curled one', () => {
    expect(arcHeight(0.8, 0)).toBe(0)
    expect(arcHeight(0.8, 1)).toBe(0)
    expect(arcHeight(0.8, 0.5)).toBeCloseTo(0.8)
    expect(arcHeight(0.8, 0.25)).toBeCloseTo(0.6)
    expect(arcHeight(0, 0.5)).toBe(0)
    const a = { x: 10, y: 50 }
    const b = { x: 50, y: 50 }
    expect(bentPoint(a, b, 0.1, 0)).toEqual(a)
    expect(bentPoint(a, b, 0.1, 1)).toEqual(b)
    expect(bentPoint(a, b, 0, 0.5)).toEqual({ x: 30, y: 50 })
    // Bent to one side half-way along, by about the bend times the length
    expect(bentPoint(a, b, 0.1, 0.5).y).toBeCloseTo(54)
    expect(bentPoint(a, b, -0.1, 0.5).y).toBeCloseTo(46)
  })

  it('holds the clock for each goal: the full celebration for ours, a short one for theirs, a still frame with reduced motion', () => {
    const ours = goalHolds(events, 0, 90, { userSide: 'home' })
    expect(ours.map((h) => h.tone)).toEqual(['ours', 'theirs', 'ours'])
    expect(ours.map((h) => h.ms)).toEqual([HOLD_MS.ours, HOLD_MS.theirs, HOLD_MS.ours])
    expect(ours.map((h) => events[+h.key].minute)).toEqual([31, 67, 92])
    for (const h of ours) expect(h.t).toBe(strikes.get(+h.key))
    expect(goalHolds(events, 0, 45, { userSide: 'away' }).map((h) => h.tone)).toEqual(['theirs'])
    expect(goalHolds(events, 0, 90, { reduced: true }).every((h) => h.ms === HOLD_MS.reduced && h.tone === 'neutral')).toBe(true)
    expect(goalHolds(events, 46, 70, {})).toHaveLength(1)
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
