import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { PlaybackSpeed } from '@game/logic/gameByGame'
import { beatConfetti, beatLength, beatTone, playbackBeat, type PlaybackBeat } from '../seasonBeats'
import { confettiPieces, prefersReducedMotion } from '../motion'
import type { PlaybackCueInput } from '../sound/seasonCues'
import { translator } from '../i18n'
import { season } from '../i18n/en/season'
import '../motionSeason.css'

const t = translator(season)

type BeatInput = Pick<PlaybackCueInput, 'results' | 'tables' | 'userId' | 'clinch' | 'total' | 'stopAt' | 'january' | 'finalPosition' | 'teams'>

/**
 * The beat the playback is showing: each step of `revealed` asks `playbackBeat` (the same moments and offsets as the
 * sounds), and the card clears itself once it has played. Reduced motion shows no card: the head and the moment chip
 * already say it. Presentation only.
 */
export function usePlaybackBeat(input: BeatInput, revealed: number, speed: PlaybackSpeed): { beat: PlaybackBeat | null; length: number } {
  const [beat, setBeat] = useState<PlaybackBeat | null>(null)
  const seen = useRef(revealed)
  const model = useRef(input)
  model.current = input
  useEffect(() => {
    const from = seen.current
    seen.current = revealed
    if (revealed <= from || prefersReducedMotion()) return
    const b = playbackBeat(model.current, from, revealed, speed)
    if (b) setBeat(b)
  }, [revealed, speed])
  const length = beat ? beatLength(beat, speed) : 0
  useEffect(() => {
    if (!beat) return
    const id = setTimeout(() => setBeat(null), beat.delayMs + length + 80)
    return () => clearTimeout(id)
  }, [beat, length])
  return { beat, length }
}

const CONFETTI = confettiPieces(18)

/** The beat's card over the playback: a kicker, the moment and, at the season's end, where it finished. */
export function SeasonBeatCard({ beat, length, detail }: { beat: PlaybackBeat; length: number; detail?: string }) {
  const tone = beatTone(beat)
  const headline =
    beat.kind === 'season-end'
      ? beat.perfect
        ? t('beatEndPerfect', { n: beat.game })
        : t(beat.finish === 'champion' ? 'beatEndChampion' : beat.finish === 'top4' ? 'beatEndTop4' : beat.finish === 'drop' ? 'beatEndDrop' : 'beatEndMid')
      : beat.kind === 'halfway'
        ? t('beatHalfway')
        : t(beat.kind === 'title' ? 'beatTitle' : beat.kind === 'relegated' ? 'beatRelegated' : beat.kind === 'perfect-broken' ? 'beatPerfectBroken' : 'beatTop')
  const kicker = beat.kind === 'season-end' ? t('beatEndKicker') : t('beatKicker', { n: beat.game })
  const style = { '--beat-delay': `${beat.delayMs}ms`, '--beat-k': String(length / 400) } as CSSProperties
  return (
    <div key={`${beat.kind}-${beat.game}`} className={`pb-beat ${tone} ${beat.kind === 'season-end' ? 'end' : ''}`} style={style} aria-hidden="true" data-testid="playback-beat" data-beat={beat.kind}>
      {beatConfetti(beat) && (
        <div className="pb-beat-confetti">
          {CONFETTI.map((c, i) => (
            <span key={i} className={`c${c.colour}`} style={{ '--dx': `${c.dx}px`, '--dy': `${c.dy}px`, '--rot': `${c.rot}deg`, '--d': `${c.delay}ms` } as CSSProperties} />
          ))}
        </div>
      )}
      <div className="pb-beat-card">
        <span className="pb-beat-kicker">{kicker}</span>
        <b className="pb-beat-head">{headline}</b>
        {detail && <span className="pb-beat-detail">{detail}</span>}
      </div>
    </div>
  )
}
