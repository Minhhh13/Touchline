import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fractionalClock, publishClock, useLiveClock } from '../match/clockStore'

describe('live clock store', () => {
  let now = 0
  beforeEach(() => {
    now = 10_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    useLiveClock.setState({ clock: 0, speed: 1, running: false, tickAt: 0, period: 300, frozen: undefined })
  })
  afterEach(() => vi.restoreAllMocks())

  const at = () => fractionalClock(useLiveClock.getState(), now)

  it('runs a minute over period / speed and holds at the end of it', () => {
    publishClock({ clock: 10, speed: 1, running: true, period: 300 })
    now += 150
    expect(at()).toBeCloseTo(10.5)
    now += 1000
    expect(at()).toBe(11)
  })

  it('a pause part-way through a minute freezes the picture there, and a resume carries on from it', () => {
    publishClock({ clock: 10, speed: 1, running: true, period: 300 })
    now += 210
    expect(at()).toBeCloseTo(10.7)
    publishClock({ clock: 10, speed: 1, running: false, period: 300 })
    now += 5000
    expect(at()).toBeCloseTo(10.7)
    publishClock({ clock: 10, speed: 1, running: true, period: 300 })
    expect(at()).toBeCloseTo(10.7)
    now += 30
    expect(at()).toBeCloseTo(10.8)
  })

  it('a speed change keeps the fraction of the minute already shown', () => {
    publishClock({ clock: 20, speed: 1, running: true, period: 300 })
    now += 150
    publishClock({ clock: 20, speed: 4, running: true, period: 300 })
    expect(at()).toBeCloseTo(20.5)
    now += 37.5
    expect(at()).toBeCloseTo(21)
  })

  it('a new minute starts from its beginning, and a stop at the end of a segment is not frozen part-way', () => {
    publishClock({ clock: 44, speed: 2, running: true, period: 300 })
    now += 100
    publishClock({ clock: 45, speed: 2, running: false, period: 300 })
    expect(useLiveClock.getState().frozen).toBeUndefined()
    expect(at()).toBe(45)
  })
})
