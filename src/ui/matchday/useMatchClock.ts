/**
 * The dashboard's match clock: one minute every `period / speed` ms from
 * `start` to `stopAt`, with pause, speeds and skip, published to the shared
 * clock store before paint so the pitch never shows another match's minute.
 * `stepClock` is the pure tick, for tests.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { publishClock } from '../match/clockStore'
import type { MatchClockApi, Speed } from './types'

/** Milliseconds per match minute at 1x: the bare ticker, and the ticker with the pitch to watch. */
export const TICKER_PERIOD = 110
export const PITCH_PERIOD = 330

export interface ClockState {
  clock: number
  running: boolean
}

/** One tick: a minute on, stopping at `stopAt`. A clock already there (or stopped) stays put. */
export function stepClock(s: ClockState, stopAt: number): ClockState {
  if (!s.running || s.clock >= stopAt) return { clock: Math.min(s.clock, stopAt), running: false }
  const next = s.clock + 1
  return next >= stopAt ? { clock: stopAt, running: false } : { clock: next, running: true }
}

export interface ClockOptions {
  start: number
  stopAt: number
  /** This stretch ends at the whistle. */
  final: boolean
  period?: number
  autoStart?: boolean
  /** Called once when the clock reaches `stopAt`. */
  onFinish?: () => void
}

export function useMatchClock({ start, stopAt, final, period = PITCH_PERIOD, autoStart = true, onFinish }: ClockOptions): MatchClockApi {
  const [state, setState] = useState<ClockState>(() => ({ clock: Math.min(start, stopAt), running: autoStart && start < stopAt }))
  const [speed, setSpeed] = useState<Speed>(1)
  const done = useRef(false)
  const finishRef = useRef(onFinish)
  const { clock, running } = state

  useLayoutEffect(() => {
    finishRef.current = onFinish
  })

  useLayoutEffect(() => {
    publishClock({ clock, speed, running: running && clock < stopAt, period })
  }, [clock, speed, running, stopAt, period])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setState((s) => stepClock(s, stopAt)), period / speed)
    return () => clearInterval(id)
  }, [running, speed, stopAt, period])

  useEffect(() => {
    if (clock >= stopAt && !done.current) {
      done.current = true
      finishRef.current?.()
    }
  }, [clock, stopAt])

  const finished = clock >= stopAt
  return {
    clock,
    speed,
    running: running && !finished,
    finished,
    atStop: finished && !final,
    stopAt,
    final,
    toggle: () => setState((s) => ({ ...s, running: !s.running && s.clock < stopAt })),
    pause: () => setState((s) => ({ ...s, running: false })),
    resume: () => setState((s) => ({ ...s, running: s.clock < stopAt })),
    setSpeed,
    skip: () => setState({ clock: stopAt, running: false }),
  }
}
