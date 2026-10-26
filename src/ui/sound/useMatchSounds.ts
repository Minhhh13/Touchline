import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { MatchEvent } from '@engine/types'
import { GOAL_FLIGHT_MS, timeline, useLiveClock, type GoalHold, type TimelinePoint } from '../match/clockStore'
import { dueMatchSounds, matchSoundCues, throttleCrowd, type MatchCueOptions } from './match'
import { matchSoundOn } from './prefs'
import { liveAudio, playSound } from './synth'

export interface MatchSoundOptions extends MatchCueOptions {
  events: MatchEvent[]
  /** The stretches the pitch plays (its epochs). */
  ranges: ReadonlyArray<{ from: number; to: number }>
  holds: GoalHold[]
  /** Reduced motion: the ball is in the net the moment the hold starts. */
  reduced: boolean
}

/**
 * The match-day dashboard's sounds: each frame reads the shared live clock (the same `timeline` the pitch draws
 * from) and plays what `dueMatchSounds` says passed since the last frame. Silent with sound or match sounds off,
 * before a gesture and without Web Audio; it decides nothing and reads nothing but the clock.
 */
export function useMatchSounds(o: MatchSoundOptions): void {
  const { events, ranges, holds, reduced, userSide, start, stopAt, final } = o
  const cues = useMemo(() => matchSoundCues(events, ranges, { userSide, start, stopAt, final }), [events, ranges, userSide, start, stopAt, final])
  const model = useRef({ cues, holds, flight: reduced ? 0 : GOAL_FLIGHT_MS })
  useLayoutEffect(() => {
    model.current = { cues, holds, flight: reduced ? 0 : GOAL_FLIGHT_MS }
  })
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function' || typeof performance === 'undefined') return
    let prev: TimelinePoint | null = null
    const last: Partial<Record<string, number>> = {}
    let raf = 0
    const step = () => {
      raf = requestAnimationFrame(step)
      const now = performance.now()
      const cur = timeline(useLiveClock.getState(), now)
      if (prev && liveAudio() && matchSoundOn()) {
        const m = model.current
        for (const req of throttleCrowd(dueMatchSounds(prev, cur, m.cues, m.holds, m.flight), last, now)) playSound(req)
      }
      prev = cur
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])
}
