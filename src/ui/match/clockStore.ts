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
  /** `performance.now()` when `clock` last changed. */
  tickAt: number
  /** Milliseconds per minute at 1x. */
  period: number
}

export const useLiveClock = create<LiveClockState>(() => ({ clock: 0, speed: 1, running: false, tickAt: 0, period: 110 }))

/** Publish the ticker's state; `tickAt` is stamped now. */
export function publishClock(state: Pick<LiveClockState, 'clock' | 'speed' | 'running' | 'period'>): void {
  const prev = useLiveClock.getState()
  const now = typeof performance !== 'undefined' ? performance.now() : 0
  useLiveClock.setState({ ...state, tickAt: state.clock === prev.clock && state.running === prev.running ? prev.tickAt : now })
}

/** The clock as a fraction of a minute into the current tick, for smooth motion. */
export function fractionalClock(s: LiveClockState, now: number): number {
  if (!s.running) return s.clock
  return s.clock + Math.min(1, Math.max(0, (now - s.tickAt) / (s.period / s.speed)))
}
