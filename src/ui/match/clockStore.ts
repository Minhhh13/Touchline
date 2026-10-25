/**
 * The live match clock, shared between the ticker (which drives it) and the
 * pitch and charts (which read it). The ticker advances `clock` one minute at a
 * time every `period / speed` milliseconds; `tickAt` stamps the last advance so
 * an animation can interpolate between minutes without a React render per frame.
 */
import { create } from 'zustand'

export interface LiveClockState {
  /** The minute the ticker shows. */
  clock: number
  /** 1, 2 or 4. */
  speed: number
  running: boolean
  /** `performance.now()` when `clock` last changed (shifted back on a resume or a speed change, so the minute carries on from where it was). */
  tickAt: number
  /** Milliseconds per minute at 1x. */
  period: number
  /** Paused part-way through a minute: the fractional clock the picture froze at. */
  frozen?: number
}

export const useLiveClock = create<LiveClockState>(() => ({ clock: 0, speed: 1, running: false, tickAt: 0, period: 110 }))

/**
 * Publish the ticker's state. A new minute stamps `tickAt` now; a pause part-way
 * through a minute freezes the picture where it stands, and a resume or a speed
 * change carries on from there instead of jumping back to the start of the minute.
 */
export function publishClock(state: Pick<LiveClockState, 'clock' | 'speed' | 'running' | 'period'>): void {
  const prev = useLiveClock.getState()
  const now = typeof performance !== 'undefined' ? performance.now() : 0
  const sameMinute = state.clock === prev.clock
  // How far into the minute the picture stands now, 0..1
  const into = sameMinute ? fractionalClock(prev, now) - prev.clock : 0
  const minuteMs = state.period / state.speed
  if (!state.running) {
    useLiveClock.setState({ ...state, tickAt: sameMinute ? prev.tickAt : now, frozen: sameMinute && into > 0 ? state.clock + into : undefined })
    return
  }
  useLiveClock.setState({ ...state, tickAt: sameMinute ? now - into * minuteMs : now, frozen: undefined })
}

/** The clock as a fraction of a minute into the current tick, for smooth motion. */
export function fractionalClock(s: LiveClockState, now: number): number {
  if (!s.running) return s.frozen ?? s.clock
  return s.clock + Math.min(1, Math.max(0, (now - s.tickAt) / (s.period / s.speed)))
}
