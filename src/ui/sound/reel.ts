import type { Tier } from '@game/logic/rarity'
import { tickTimes, type TickGeometry, type TickTiming } from './schedule'
import { liveAudio, playLanding, playPop, playTick, playWhoosh, stopAll } from './synth'

/** How far ahead of the strip the ticks are put on the audio clock, ms: a frame or three, so a busy frame never drops one. */
const LOOKAHEAD_MS = 60
/** A tick this late (a hidden tab coming back) is skipped rather than played out of place. */
const LATE_MS = 40
/** At the start the cards pass faster than this; closer ticks would smear into a buzz, so the rattle is capped here. */
export const MIN_TICK_GAP_MS = 15

export interface ReelSound {
  /** The strip landed (or the run was skipped): cut what is still to come and play the reveal. */
  land(tier: Tier): void
  /** The run is gone (unmounted or replaced): silence what is still to come. */
  stop(): void
}

export interface ReelSoundOptions {
  /** The strip's slide, whose `currentTime` (ms from the run's start, delay included) drives the ticks; null without a slide. */
  slide: Animation | null
  geometry: TickGeometry
  timing: TickTiming
  /** ms from the run's start when the season drum stops (the pop). */
  popAt: number
  /** prefers-reduced-motion: no slide, no ticks, no shimmer. */
  reduced: boolean
}

/**
 * The case reel's sound for one run: the whoosh at once and the pop when the drum
 * stops, then one tick per card as the strip passes the marker, read from the
 * slide's own clock each frame and scheduled a few ms ahead on the audio clock,
 * then the landing by tier. Silent and free when there is no audio.
 */
export function startReelSound(o: ReelSoundOptions): ReelSound {
  const pending = new Set<AudioScheduledSourceNode>()
  const keep = (n: AudioScheduledSourceNode | null) => {
    if (!n) return
    pending.add(n)
    n.addEventListener('ended', () => pending.delete(n))
  }
  let raf = 0
  let over = false
  const a = liveAudio()
  if (a) {
    const now = a.c.currentTime
    keep(playWhoosh(now))
    keep(playPop(now + o.popAt / 1000))
  }
  const times = o.reduced || !o.slide ? [] : tickTimes(o.geometry, o.timing)
  let next = 0
  let lastPlayed = -Infinity
  const slide = o.slide
  const step = () => {
    raf = 0
    if (over || !slide) return
    const at = typeof slide.currentTime === 'number' ? slide.currentTime : null
    const live = liveAudio()
    if (at !== null) {
      while (next < times.length && times[next] <= at + LOOKAHEAD_MS) {
        const due = times[next++]
        if (!live || due < at - LATE_MS || due - lastPlayed < MIN_TICK_GAP_MS) continue
        lastPlayed = due
        // UI-only randomness: a slight pitch wobble so the ticks do not sound machine-identical
        keep(playTick(live.c.currentTime + Math.max(0, due - at) / 1000, 0.92 + Math.random() * 0.16))
      }
    }
    if (next < times.length) raf = requestAnimationFrame(step)
  }
  if (times.length && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(step)
  const stop = () => {
    over = true
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    stopAll(pending)
    pending.clear()
  }
  return {
    land(tier) {
      if (over) return
      stop()
      playLanding(tier, o.reduced)
    },
    stop,
  }
}
