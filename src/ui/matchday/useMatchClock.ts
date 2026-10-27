/**
 * The dashboard's match clock. It owns the shared live clock (clockStore):
 * a continuous anchor (the match stood at minute `at` at real time `since`)
 * that runs at `period / speed` ms a minute from `start` to the end of the
 * `stopAt` minute, holding at every goal for its celebration. The pitch reads
 * the fractional minute from the store every frame; React sees the whole
 * minute, the goals revealed and the celebration on, refreshed on a light
 * timer and only when one changes. Pause, speeds (remembered per browser),
 * skip; a hidden tab pauses the match until it is back.
 *
 * `stepClock` is the old minute-by-minute tick, kept pure for tests.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { GOAL_FLIGHT_MS, readout, reanchor, useLiveClock, type GoalHold } from '../match/clockStore'
import { PITCH_MS, type PaceSpan } from '../match/timing'
import type { MatchClockApi, Speed } from './types'

/**
 * Milliseconds per match minute at 1x: the bare ticker, and the ticker with the pitch to watch.
 * 1x is the pace of a console football match: a match minute takes 4.5 s (`PITCH_MS`), so a
 * 20-metre pass rolls for about two seconds, the man on the ball takes a touch and looks up
 * before he plays it, a corner stands three seconds while the box fills, and a half takes about
 * three and a half minutes plus the goals' celebrations. 0.5x is slower still (9 s a minute);
 * 2x, 3x and 4x are quicker (4x is about 1.1 s a minute).
 */
export const TICKER_PERIOD = 110
export const PITCH_PERIOD = PITCH_MS
/** The speeds on offer, slowest first. */
export const SPEEDS: Speed[] = [0.5, 1, 2, 3, 4]

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

/** The replay speed is a per-viewer convenience, remembered across matches and segments under its own key. */
export const SPEED_KEY = 'touchline-match-speed'
/** A stored speed, or 1x for anything else (nothing stored, an old value, blocked storage). */
export function parseSpeed(raw: string | null): Speed {
  const v = Number(raw)
  return SPEEDS.find((s) => s === v) ?? 1
}
function readSpeed(): Speed {
  try {
    return parseSpeed(localStorage.getItem(SPEED_KEY))
  } catch {
    return 1
  }
}
function saveSpeed(v: Speed): void {
  try {
    localStorage.setItem(SPEED_KEY, String(v))
  } catch {
    // Private window or blocked storage: the speed is simply not remembered
  }
}

export interface ClockOptions {
  start: number
  stopAt: number
  /** This stretch ends at the whistle. */
  final: boolean
  period?: number
  autoStart?: boolean
  /** The goal holds of the match (the celebration); none without the pitch. */
  holds?: GoalHold[]
  /** The moments the dashboard waits for (strikes and fouls, timing.ts `cueTimes`), sorted. */
  cues?: number[]
  /** The picture's pace (timing.ts `matchPace`): a crowded minute plays longer. */
  pace?: PaceSpan[]
  /** Reduced motion: the ball reaches the net at once. */
  reduced?: boolean
  /** Called once when the clock reaches the end of the `stopAt` minute. */
  onFinish?: () => void
}

const NO_HOLDS: GoalHold[] = []

export function useMatchClock({ start, stopAt, final, period = PITCH_PERIOD, autoStart = true, holds = NO_HOLDS, cues, pace, reduced = false, onFinish }: ClockOptions): MatchClockApi {
  const end = stopAt + 1
  const flight = reduced ? 0 : GOAL_FLIGHT_MS
  // Until this match has taken the shared store, report the start (the store may still hold the last match)
  const [armed, setArmed] = useState(false)
  const done = useRef(false)
  const finishRef = useRef(onFinish)
  const mounted = useRef({ start, autoStart })

  useLayoutEffect(() => {
    finishRef.current = onFinish
  })

  // Take the clock before paint, so a pitch mounting with a new match never shows the last one's minute
  useLayoutEffect(() => {
    const now = performance.now()
    const { start: from, autoStart: go } = mounted.current
    const anchor = { at: Math.min(from, end), since: now, spent: Infinity, running: go && from < end, speed: readSpeed(), boost: 1, period, stopAt, end, holds, cues, pace }
    useLiveClock.setState({ ...anchor, ...readout(anchor, now, flight) })
    done.current = false
    setArmed(true)
    // Mount only: later changes of the stop, the holds or the period re-anchor below
  }, [])

  // A change in play re-decides the rest of the match: new holds, maybe a new whistle. The picture stays where it is.
  useLayoutEffect(() => {
    if (!armed) return
    const s = useLiveClock.getState()
    if (s.holds === holds && s.cues === cues && s.pace === pace && s.stopAt === stopAt && s.end === end && s.period === period) return
    const now = performance.now()
    const next = { ...s, ...reanchor(s, now), holds, cues, pace, stopAt, end, period }
    useLiveClock.setState({ ...next, ...readout(next, now, flight), running: s.running && next.at < end })
  }, [armed, holds, cues, pace, stopAt, end, period, flight])

  const storeClock = useLiveClock((s) => s.clock)
  const speed = useLiveClock((s) => s.speed) as Speed
  const storeRunning = useLiveClock((s) => s.running)
  const storeDone = useLiveClock((s) => s.done)
  const clock = armed ? storeClock : Math.min(start, stopAt)
  const running = armed && storeRunning
  const finished = armed && storeDone

  // A light timer refreshes what React shows; the pitch animates on its own every frame
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      const s = useLiveClock.getState()
      const now = performance.now()
      const r = readout(s, now, flight)
      if (r.clock === s.clock && r.revealed === s.revealed && r.celebrating === s.celebrating && r.done === s.done && r.cued === s.cued) return
      useLiveClock.setState(r.done ? { ...r, running: false, at: s.end, since: now, spent: Infinity } : r)
    }, 40)
    return () => clearInterval(id)
  }, [running, flight])

  // Hidden tab: the match waits for you (the clock runs on real time, so it would otherwise play on unseen)
  useEffect(() => {
    if (typeof document === 'undefined') return
    let pausedByHide = false
    const onVisibility = () => {
      const s = useLiveClock.getState()
      const now = performance.now()
      if (document.visibilityState === 'hidden') {
        if (s.running) {
          pausedByHide = true
          useLiveClock.setState({ ...reanchor(s, now), running: false })
        }
      } else if (pausedByHide) {
        pausedByHide = false
        if (!s.running && !s.done) useLiveClock.setState({ since: now, running: true })
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    // Read the store, not the render: the first render of a new segment can still see the last one's finish
    if (finished && useLiveClock.getState().done && !done.current) {
      done.current = true
      finishRef.current?.()
    }
  }, [finished])

  const pause = () => {
    const s = useLiveClock.getState()
    if (s.running) useLiveClock.setState({ ...reanchor(s, performance.now()), running: false })
  }
  const resume = () => {
    const s = useLiveClock.getState()
    if (!s.running && !s.done) useLiveClock.setState({ since: performance.now(), running: true })
  }
  return {
    clock,
    speed,
    running: running && !finished,
    finished,
    atStop: finished && !final,
    stopAt,
    final,
    toggle: () => (useLiveClock.getState().running ? pause() : resume()),
    pause,
    resume,
    setSpeed: (v: Speed) => {
      const s = useLiveClock.getState()
      useLiveClock.setState({ ...reanchor(s, performance.now()), speed: v })
      saveSpeed(v)
    },
    setBoost: (b: number) => {
      const s = useLiveClock.getState()
      if ((s.boost ?? 1) === b) return
      useLiveClock.setState({ ...reanchor(s, performance.now()), boost: b })
    },
    skip: () => {
      const s = useLiveClock.getState()
      const now = performance.now()
      const at = { ...s, at: s.end, since: now, spent: Infinity, running: false }
      useLiveClock.setState({ at: s.end, since: now, spent: Infinity, running: false, ...readout(at, now, flight) })
    },
  }
}
