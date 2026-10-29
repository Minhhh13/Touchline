import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { timeline, useLiveClock, type TimelinePoint } from '../match/clockStore'
import type { BallKeyframe } from '../match/possession'
import type { Side } from '../match/pitchGeometry'
import { ALWAYS, ballCues, dueBallCues, dueGoals, dueSwells, speedScale, swellCues } from './ball'
import { admit, bedLevel, crowdMood, ducked, matchMix } from './mix'
import { matchSoundOn } from './prefs'
import { liveAudio, playSound, stopAll } from './synth'

/** A new crowd bed this often while the clock runs, ms (each lasts 4.6 s, so they overlap and never leave a gap). */
export const BED_EVERY_MS = 3600

export interface BallSoundOptions {
  path: readonly BallKeyframe[]
  /** Off: nothing at all (reduced motion, where the ball does not travel, or a still pitch). */
  enabled: boolean
  /**
   * The highlights reel, which has no goal holds: a goal's net and roar as the ball arrives, toned for the user's side
   * (null: neither side is the user's). Absent on the match day, whose goals `useMatchSounds` plays from the holds.
   */
  goals?: { userSide: Side | null }
  /** The crowd's bed under the play, quieter in the reel. */
  bed: number
}

/**
 * The ball's sounds on the live pitch: each frame reads the shared live clock (the `timeline` the pitch draws from)
 * and plays the kicks, saves, woodwork and swells `ball.ts` says passed since the last frame, with the crowd's bed
 * under them while the clock runs, rising and falling with the match (`crowdMood`) and hushed under a goal's roar. Silent and free with sound or match sounds off, before a gesture and without Web
 * Audio; it decides nothing and reads nothing but the clock and the drawn path.
 */
export function useBallSounds(o: BallSoundOptions): void {
  const cues = useMemo(() => ballCues(o.path), [o.path])
  const swells = useMemo(() => swellCues(o.path), [o.path])
  const model = useRef({ cues, swells, path: o.path, goals: o.goals, bed: o.bed })
  useLayoutEffect(() => {
    model.current = { cues, swells, path: o.path, goals: o.goals, bed: o.bed }
  })
  const enabled = o.enabled
  useEffect(() => {
    if (!enabled || typeof requestAnimationFrame !== 'function' || typeof performance === 'undefined') return
    let prev: TimelinePoint | null = null
    const last: { at?: number } = {}
    const bed = new Set<AudioScheduledSourceNode>()
    let bedAt = -Infinity
    let raf = 0
    const hush = () => {
      stopAll(bed)
      bed.clear()
      bedAt = -Infinity
    }
    const step = () => {
      raf = requestAnimationFrame(step)
      const now = performance.now()
      const st = useLiveClock.getState()
      const cur = timeline(st, now)
      const live = liveAudio() && matchSoundOn()
      if (!live || !st.running) hush()
      if (prev && live) {
        const m = model.current
        const speed = st.speed * (st.boost ?? 1)
        const k = speedScale(speed)
        if (m.goals) for (const g of dueGoals(prev, cur, m.path)) if (admit(matchMix, 'goal', now, speed)) playSound({ id: 'goal', tone: m.goals.userSide ? (g.side === m.goals.userSide ? 'ours' : 'theirs') : 'neutral', seed: `reel-${g.t.toFixed(2)}` })
        for (const c of dueBallCues(prev, cur, m.cues, speed, now, last)) if (admit(matchMix, ALWAYS.has(c.touch) ? 'strike' : 'ball', now, speed)) playSound({ id: 'ball', touch: c.touch, power: Math.round(c.power * k * 10) / 10 })
        for (const s of dueSwells(prev, cur, m.swells)) if (admit(matchMix, 'swell', now, speed)) playSound({ id: 'crowd-swell', danger: Math.round(s.danger * 10) / 10 })
        // A goal's roar has the stadium: the bed goes quiet under it and comes back, roused, once it has passed
        if (ducked(matchMix, now)) {
          if (bed.size) hush()
        } else if (st.running && m.bed > 0 && now - bedAt >= BED_EVERY_MS) {
          bedAt = now
          for (const n of playSound({ id: 'crowd-bed', level: bedLevel(m.bed, crowdMood(m.path, cur.t), speed) })) {
            bed.add(n)
            n.addEventListener('ended', () => bed.delete(n))
          }
        }
      }
      prev = cur
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      hush()
    }
  }, [enabled])
}
