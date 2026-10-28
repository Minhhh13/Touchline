/*
 * The quick season playback's visual beats: the short celebratory or dramatic card over the playback when a result
 * brings a big moment (the title sealed, top of the league, the perfect run broken, relegation certain), the January
 * stop and the end of the season. Pure, and read from the same functions as the playback's sounds (`stingerAt`,
 * `finishOf` and the cue offsets in sound/seasonCues.ts), so the card lands on the sting it belongs to. Presentation
 * only: it reads what the screen already shows.
 */
import { playbackDelay, type PlaybackSpeed } from '@game/logic/gameByGame'
import { FAST_BELOW_MS, FINISH_AT, STINGER_AT, finishOf, stingerAt, type PlaybackCueInput } from './sound/seasonCues'
import type { SeasonFinish, StingerKind } from './sound/seasonScores'

/** The moments heavy enough for a card; the lighter ones (into the top four, still perfect) keep the moment chip. */
export const BEAT_KINDS: readonly StingerKind[] = ['title', 'relegated', 'perfect-broken', 'top']

export type PlaybackBeat =
  | { kind: StingerKind; game: number; delayMs: number }
  | { kind: 'halfway'; game: number; delayMs: number }
  | { kind: 'season-end'; game: number; delayMs: number; finish: SeasonFinish; perfect: boolean }

/** The tone a beat takes on screen: a celebration, a blow, or a plain stop. */
export function beatTone(b: PlaybackBeat): 'good' | 'bad' | 'plain' {
  if (b.kind === 'season-end') return b.finish === 'champion' || b.finish === 'top4' ? 'good' : b.finish === 'drop' ? 'bad' : 'plain'
  if (b.kind === 'halfway') return 'plain'
  return b.kind === 'relegated' || b.kind === 'perfect-broken' ? 'bad' : 'good'
}

/** The beat throws confetti: the title sealed, or the season ended as champions. */
export function beatConfetti(b: PlaybackBeat): boolean {
  return b.kind === 'title' || (b.kind === 'season-end' && b.finish === 'champion')
}

type BeatInput = Pick<PlaybackCueInput, 'results' | 'tables' | 'userId' | 'clinch' | 'total' | 'stopAt' | 'january' | 'finalPosition' | 'teams'>

/**
 * The beat a step of the playback brings, from `from` games shown to `to`, or null. As `playbackCues` does: one game
 * shows its heaviest moment a stinger's delay after the result (at once at speed), the last game before the stop shows
 * the stop (the January window, or the season's end) in its place, and a skip shows only the stop it reaches.
 */
export function playbackBeat(input: BeatInput, from: number, to: number, speed: PlaybackSpeed): PlaybackBeat | null {
  if (to <= from || to > input.results.length) return null
  const fast = playbackDelay(speed) < FAST_BELOW_MS
  const several = to - from > 1
  if (to >= input.stopAt) {
    const at = several ? FINISH_AT : fast ? 0.12 : FINISH_AT
    if (input.january) return { kind: 'halfway', game: to, delayMs: Math.round(at * 1000) }
    if (to >= input.total) {
      const perfect = to > 0 && input.results.slice(0, to).every((g) => g.gf > g.ga)
      return { kind: 'season-end', game: to, delayMs: Math.round(at * 1000), finish: finishOf(input.finalPosition, input.teams), perfect }
    }
  }
  if (several) return null
  const kind = stingerAt(input, to)
  if (!kind || !BEAT_KINDS.includes(kind)) return null
  return { kind, game: to, delayMs: fast ? 0 : Math.round(STINGER_AT * 1000) }
}

/** How long a beat's card stays up, ms: shorter at speed so it is gone before the next one could land. */
export function beatLength(b: PlaybackBeat, speed: PlaybackSpeed): number {
  if (b.kind === 'season-end') return 3200
  if (b.kind === 'halfway') return 1800
  return Math.max(900, Math.min(1800, playbackDelay(speed) * 1.6))
}
