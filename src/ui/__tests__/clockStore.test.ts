import { describe, expect, it } from 'vitest'
import { GOAL_FLIGHT_MS, hiddenGoal, publishClock, readout, reanchor, timeline, useLiveClock, type GoalHold, type LiveClockState } from '../match/clockStore'

const hold = (t: number, ms: number, key = String(t)): GoalHold => ({ t, ms, side: 'home', key, tone: 'ours' })

function clock(patch: Partial<LiveClockState> = {}): LiveClockState {
  return { clock: 0, speed: 1, running: true, period: 300, at: 10, since: 1000, spent: Infinity, stopAt: 45, end: 46, holds: [], revealed: 0, celebrating: -1, done: false, ...patch }
}

describe('live clock timeline', () => {
  it('runs continuously at period / speed and stops at the end of the segment', () => {
    const s = clock()
    expect(timeline(s, 1000).t).toBe(10)
    expect(timeline(s, 1150).t).toBeCloseTo(10.5)
    expect(timeline(s, 1000 + 300 * 7.25).t).toBeCloseTo(17.25)
    expect(timeline(s, 1000 + 300 * 100).t).toBe(46)
    expect(timeline({ ...s, speed: 4 }, 1150).t).toBeCloseTo(12)
    // Paused, it stands where the anchor says
    expect(timeline({ ...s, running: false }, 99_999).t).toBe(10)
  })

  it('plays a crowded minute longer and the quiet minute after it quicker (the pace), holding at a goal inside it exactly', () => {
    // Minute 12 takes two minutes of picture; minute 13 pays back a quarter
    const pace = [{ from: 12, to: 13, w: 2 }, { from: 13, to: 14, w: 0.75 }]
    const s = clock({ pace })
    expect(timeline(s, 1000 + 300 * 2).t).toBeCloseTo(12)
    expect(timeline(s, 1000 + 300 * 3).t).toBeCloseTo(12.5)
    expect(timeline(s, 1000 + 300 * 4).t).toBeCloseTo(13)
    expect(timeline(s, 1000 + 300 * 4.75).t).toBeCloseTo(14)
    expect(timeline(s, 1000 + 300 * 5.75).t).toBeCloseTo(15)
    // A goal at 12.5: reached after three minutes of picture, held there, then on
    const g = clock({ pace, holds: [hold(12.5, 2000)] })
    expect(timeline(g, 1000 + 900 + 10)).toEqual({ t: 12.5, hold: { index: 0, elapsed: 10 } })
    expect(timeline(g, 1000 + 900 - 30).t).toBeLessThan(12.5)
    expect(timeline(g, 1000 + 900 + 2000 + 300).t).toBeCloseTo(13)
    // A re-anchor keeps the picture where it stands
    const r = { ...g, ...reanchor(g, 1000 + 450) }
    expect(timeline(r, 1000 + 450).t).toBeCloseTo(timeline(g, 1000 + 450).t)
    expect(timeline(r, 1000 + 1200).t).toBeCloseTo(timeline(g, 1000 + 1200).t)
  })

  it('holds the clock at a goal for the hold, then carries on from the kick-off', () => {
    const s = clock({ holds: [hold(12.5, 2000)] })
    // 2.5 minutes to the strike
    expect(timeline(s, 1000 + 750 - 1).hold).toBeNull()
    expect(timeline(s, 1000 + 750 + 10)).toEqual({ t: 12.5, hold: { index: 0, elapsed: 10 } })
    expect(timeline(s, 1000 + 750 + 1999).t).toBe(12.5)
    expect(timeline(s, 1000 + 750 + 2000 + 150).t).toBeCloseTo(13)
    expect(timeline(s, 1000 + 750 + 2000 + 150).hold).toBeNull()
    // A goal past the end of the segment never holds it
    expect(timeline(clock({ holds: [hold(50, 2000)] }), 1000 + 300 * 100).t).toBe(46)
  })

  it('a pause mid-celebration keeps the picture, and resuming spends only what is left of the hold', () => {
    const s = clock({ holds: [hold(12.5, 2000)] })
    const pauseAt = 1000 + 750 + 800
    const paused = { ...s, ...reanchor(s, pauseAt), running: false }
    expect(paused).toMatchObject({ at: 12.5, spent: 800 })
    expect(timeline(paused, pauseAt + 60_000)).toEqual({ t: 12.5, hold: { index: 0, elapsed: 800 } })
    const resumed = { ...paused, running: true, since: 50_000 }
    expect(timeline(resumed, 50_000 + 1199).t).toBe(12.5)
    expect(timeline(resumed, 50_000 + 1200 + 300).t).toBeCloseTo(13.5)
    // Re-anchoring after the hold does not hold again
    const after = { ...s, ...reanchor(s, 1000 + 750 + 2000 + 300) }
    expect(after.spent).toBe(Infinity)
    expect(timeline(after, after.since + 3).t).toBeGreaterThan(13)
    // A speed change keeps the minute where it was
    const quick = { ...s, ...reanchor(s, 1300), speed: 4 }
    expect(timeline(quick, 1300).t).toBeCloseTo(11)
    expect(timeline(quick, 1375).t).toBeCloseTo(12)
  })

  it('reveals a goal only once the ball is over the line, and hides it until then', () => {
    const s = clock({ holds: [hold(12.5, 2000, 'a'), hold(30.2, 1500, 'b')] })
    const at = (ms: number) => readout(s, 1000 + ms)
    expect(at(0)).toEqual({ clock: 10, revealed: 0, celebrating: -1, done: false })
    expect(at(750 + 100)).toMatchObject({ clock: 12, revealed: 0, celebrating: 0 })
    expect(at(750 + GOAL_FLIGHT_MS + 1)).toMatchObject({ revealed: 1, celebrating: 0 })
    expect(at(750 + 2001)).toMatchObject({ revealed: 1, celebrating: -1 })
    expect(at(1e7)).toMatchObject({ clock: 45, revealed: 2, done: true })
    expect(hiddenGoal({ holds: s.holds, revealed: 1 }, 'a')).toBe(false)
    expect(hiddenGoal({ holds: s.holds, revealed: 1 }, 'b')).toBe(true)
    expect(hiddenGoal({ holds: s.holds, revealed: 1 }, 'zzz')).toBe(false)
    // Skipping to the stop passes every goal: all revealed, nothing held
    expect(readout({ ...s, at: 46, spent: Infinity, running: false }, 0)).toMatchObject({ revealed: 2, celebrating: -1, done: true, clock: 45 })
  })

  it('publishes a whole minute for the highlights reel: it runs to the end of the minute, and a pause keeps the picture', () => {
    publishClock({ clock: 30, speed: 1, running: true, period: 400 }, 1000)
    const s = useLiveClock.getState()
    expect(timeline(s, 1200).t).toBeCloseTo(30.5)
    expect(timeline(s, 9999).t).toBe(31)
    publishClock({ clock: 30, speed: 1, running: false, period: 400 }, 1100)
    expect(timeline(useLiveClock.getState(), 5000).t).toBeCloseTo(30.25)
    publishClock({ clock: 31, speed: 1, running: true, period: 400 }, 2000)
    expect(timeline(useLiveClock.getState(), 2000).t).toBe(31)
  })
})
