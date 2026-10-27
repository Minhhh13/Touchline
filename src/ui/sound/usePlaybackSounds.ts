import { useEffect, useLayoutEffect, useRef } from 'react'
import type { PlaybackSpeed } from '@game/logic/gameByGame'
import { prefersReducedMotion } from '../motion'
import { playbackCues, type PlaybackCueInput } from './seasonCues'
import { seasonScoreFor } from './seasonScores'
import { liveAudio, playScore, stopAll } from './synth'

export interface PlaybackSoundOptions extends Omit<PlaybackCueInput, 'clinch' | 'reduced'> {
  /** Games shown. */
  revealed: number
  playing: boolean
  /** Every game up to the stop is shown: the playback stopping there is not a pause, so the fanfare rings out. */
  done: boolean
  speed: PlaybackSpeed
  /** The clinch weeks, worked out only when a cue first needs them (null in the first half). */
  clinch: () => PlaybackCueInput['clinch']
}

/**
 * The quick season playback's sounds: each time a game (or a skip's worth) is revealed it plays what `playbackCues`
 * says, on the season's own scores. Pausing, a closed screen or a new step silences what is still sounding (the crowd
 * bed above all), so a paused playback is quiet. Silent and free with sound off, before a gesture and without Web
 * Audio: nothing is built then, not even the clinch weeks. Presentation only: it reads what the screen shows.
 */
export function usePlaybackSounds(o: PlaybackSoundOptions): void {
  const model = useRef(o)
  useLayoutEffect(() => {
    model.current = o
  })
  const seen = useRef(o.revealed)
  const lastAt = useRef(-Infinity)
  const pending = useRef(new Set<AudioScheduledSourceNode>())
  // The crowd bed lasts until the next result: the next step cuts it, and only it
  const bed = useRef(new Set<AudioScheduledSourceNode>())
  const clinch = useRef<{ value: PlaybackCueInput['clinch'] } | null>(null)
  const hush = (sets: Array<Set<AudioScheduledSourceNode>>) => {
    for (const s of sets) {
      stopAll(s)
      s.clear()
    }
  }
  useEffect(() => {
    const from = seen.current
    seen.current = o.revealed
    if (o.revealed === from) {
      if (!o.playing && !o.done) hush([pending.current, bed.current])
      return
    }
    hush([bed.current])
    if (!liveAudio() || typeof performance === 'undefined') return
    const m = model.current
    clinch.current ??= { value: m.clinch() }
    const now = performance.now()
    const { cues, lastResultAt } = playbackCues({ ...m, clinch: clinch.current.value, reduced: prefersReducedMotion() }, { from, to: o.revealed, speed: o.speed, lastResultAt: lastAt.current, now })
    lastAt.current = lastResultAt
    for (const c of cues) {
      const into = c.req.id === 'tension' ? bed.current : pending.current
      for (const n of playScore(seasonScoreFor(c.req), c.at)) {
        into.add(n)
        n.addEventListener('ended', () => into.delete(n))
      }
    }
  }, [o.revealed, o.playing, o.done])
  useEffect(() => () => hush([pending.current, bed.current]), [])
}
