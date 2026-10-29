import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { MatchEvent } from '@engine/types'
import { GOAL_FLIGHT_MS, timeline, useLiveClock, type GoalHold, type TimelinePoint } from '../match/clockStore'
import { dueMatchSounds, matchSoundCues, mixKindOf, type MatchCueOptions } from './match'
import { admit, matchMix } from './mix'
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
 * before a gesture and without Web Audio, and shares the mix (mix.ts) with the ball's sounds; it decides nothing and reads nothing but the clock.
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
    // From the clock's anchor (the match clock has just taken it, before paint), so a kick-off in the first frame still sounds
    const s0 = useLiveClock.getState()
    let prev: TimelinePoint | null = s0.running ? { t: s0.at, hold: null } : null
    let raf = 0
    const hear = () => {
      const now = performance.now()
      const st = useLiveClock.getState()
      const cur = timeline(st, now)
      if (prev && liveAudio() && matchSoundOn()) {
        const m = model.current
        const speed = st.speed * (st.boost ?? 1)
        // One budget with the ball's sounds (mix.ts): a goal ducks the rest, the crowd keeps its gap, nothing stacks at 4x
        for (const req of dueMatchSounds(prev, cur, m.cues, m.holds, m.flight)) if (admit(matchMix, mixKindOf(req), now, speed)) playSound(req)
      }
      prev = cur
    }
    const step = () => {
      raf = requestAnimationFrame(step)
      hear()
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      // The whistle can end the match (and close the dashboard) between two frames: hear the last stretch on the way out
      hear()
    }
  }, [])
}
