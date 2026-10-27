/**
 * The dashboard's top bar, as Football Manager lays it out: the manager's
 * controls on the left (Tactics, Instructions, the Mentality dropdown, Shouts,
 * Tweaks, and a chip saying where a change lands), the scoreboard in the
 * middle (club codes on club colours, the score at the clock, a running mm:ss
 * clock with the added time once the board is up, the stop or the whistle;
 * it flashes on a goal once the ball is over the line), and the playback on
 * the right: pause, speed, skip, and in a live match "Auto from here" (the
 * assistant takes the stops still to come) and Sim result (straight to the
 * report while a stop is still ahead).
 */
import { useEffect, useRef } from 'react'
import { Clapperboard } from 'lucide-react'
import type { Mentality } from '@engine/types'
import { scoreAt } from '@engine/matchFeed'
import { MENTALITY_HELP } from '@engine/tactics'
import { textColourFor } from '../format'
import { fractionalClock, useLiveClock } from '../match/clockStore'
import { barClock, SHOUTS_CLOSED, type DrawerId } from './controls'
import { HIGHLIGHT_LEVELS, type HighlightLevel } from '../match/highlights'
import { clockText, skipLabel } from './model'
import type { TopBarProps } from './types'
import type { ManagerHand } from './useManagerHand'
import { SPEEDS } from './useMatchClock'
import { useMediaQuery } from '../components/LivePitch'

const GOALS = new Set(['goal', 'penalty', 'own_goal'])

/**
 * The running clock, written straight into the text node every frame (no React render per frame).
 * Like the pitch, the loop runs only while the shared clock does: paused, under a drawer or at a
 * stop it paints once and sleeps until the clock store changes again.
 */
function ClockFace({ minute, state }: { minute: number; state: { atStop: boolean; stopAt: number; finished: boolean; final: boolean; addedTime: number } }) {
  const ref = useRef<HTMLSpanElement>(null)
  const { atStop, stopAt, finished, final, addedTime } = state
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const paint = () => {
      raf = 0
      const s = useLiveClock.getState()
      // The clock store is shared: read it only while it carries this match's minute
      const f = Math.abs(s.clock - minute) <= 1 ? Math.min(fractionalClock(s, performance.now()), minute + 1) : minute
      const text = barClock(Math.max(minute, f), { atStop, stopAt, finished, final, addedTime })
      if (el.textContent !== text) el.textContent = text
      if (s.running && !atStop && !finished) raf = requestAnimationFrame(paint)
    }
    const wake = () => {
      if (!raf) raf = requestAnimationFrame(paint)
    }
    paint()
    const unsubscribe = useLiveClock.subscribe(wake)
    return () => {
      unsubscribe()
      cancelAnimationFrame(raf)
    }
  }, [minute, atStop, stopAt, finished, final, addedTime])
  return <span ref={ref} className="clock mono" />
}

const TOOLS: Array<{ id: DrawerId; label: string }> = [
  { id: 'tactics', label: 'Tactics' },
  { id: 'instructions', label: 'Instructions' },
]
const TOOLS_AFTER: Array<{ id: DrawerId; label: string }> = [
  { id: 'shouts', label: 'Shouts' },
  { id: 'tweaks', label: 'Tweaks' },
]

function Tools({ hand }: { hand: ManagerHand }) {
  const can = hand.editable
  const tool = (t: { id: DrawerId; label: string }) => {
    // Tactics is read-only and opens on a replay too; the rest need a match to change
    const disabled = t.id !== 'tactics' && !can
    const title = t.id === 'shouts' && !hand.shoutsOpen ? SHOUTS_CLOSED : undefined
    return (
      <button key={t.id} type="button" className={`md-tool ${hand.drawer === t.id ? 'active' : ''}`} onClick={() => hand.open(t.id)} disabled={disabled} aria-haspopup="dialog" aria-expanded={hand.drawer === t.id} title={title}>
        {t.label}
      </button>
    )
  }
  const setMentality = (m: Mentality) => {
    if (m !== hand.tactics.mentality) hand.submit({ tactics: { ...hand.tactics, mentality: m } })
  }
  return (
    <div className="md-tools">
      <div className="md-tool-row">
        {TOOLS.map(tool)}
        <label className="md-ment" title={MENTALITY_HELP[hand.tactics.mentality]}>
          <span className="sr-only">Mentality</span>
          <select className="md-select" value={hand.tactics.mentality} onChange={(e) => setMentality(e.target.value as Mentality)} disabled={!can}>
            <option value="defensive">Defensive</option>
            <option value="balanced">Balanced</option>
            <option value="attacking">Attacking</option>
          </select>
        </label>
        {TOOLS_AFTER.map(tool)}
      </div>
      <span className={`md-chip ${hand.landing.kind}`} role="status">
        <i aria-hidden />
        {hand.landing.text}
      </span>
    </div>
  )
}

/** The live match's extra playback: the assistant at the stops still to come, and straight to the result. */
export interface LivePlayback {
  auto: boolean
  setAuto(on: boolean): void
  simResult?: () => void
}

/** The highlight level picker's state: the chosen level, and the score when Extended has wound down to Key. */
export interface HighlightsControl {
  level: HighlightLevel
  setLevel(l: HighlightLevel): void
  /** "3-0" while Extended plays as Key because a side is three clear. */
  wound: string | null
  /** The clock is fast-forwarding through a quiet minute. */
  fast: boolean
  /** Key moments on the pitch (the camera on big chances, goal replays): the viewer's setting. */
  keyMoments?: boolean
  setKeyMoments?(on: boolean): void
}

export function TopBar({ feed, clock, minute, home, away, label, hand, playback, highlights }: TopBarProps & { hand: ManagerHand; minute?: number; playback?: LivePlayback; highlights?: HighlightsControl }) {
  // The minute the panels show: a goal counts once the ball is over the line
  const t = minute ?? clock.clock
  const score = scoreAt(feed.events, t)
  const celebrating = useLiveClock((s) => s.celebrating >= 0)
  // The board lights up for the minute after a goal, and while one is celebrated
  const flash = celebrating || feed.events.some((e) => GOALS.has(e.type) && e.minute <= t && e.minute >= t - 1)
  const state = { atStop: clock.atStop, stopAt: clock.stopAt, finished: clock.finished, final: clock.final, addedTime: feed.addedTime }
  // On a phone the playback row scrolls sideways: Skip and Sim result come straight after Pause so they start in view
  const phone = useMediaQuery('(max-width: 720px)')
  const skip = !clock.finished && (
    <button className="btn sm" onClick={clock.skip} data-testid="skip-replay">
      {skipLabel(clock.stopAt)}
    </button>
  )
  const sim = playback?.simResult && (
    <button className="btn sm" onClick={playback.simResult} data-testid="sim-result" title="The assistant makes any remaining calls and the match goes straight to the whistle and the report">
      Sim result
    </button>
  )
  return (
    <div className="md-topbar" role="group" aria-label={label}>
      <Tools hand={hand} />
      <div className={`scoreboard ${flash ? 'flash' : ''}`} role="group" aria-label={`${home.name} ${score.home}, ${away.name} ${score.away}, ${clockText(t, state)}`}>
        <span className="md-sb-code" style={{ background: home.colour, color: textColourFor(home.colour) }} title={home.name}>
          {home.code}
        </span>
        <span className="score mono">
          {score.home} - {score.away}
        </span>
        <span className="md-sb-code" style={{ background: away.colour, color: textColourFor(away.colour) }} title={away.name}>
          {away.code}
        </span>
        <ClockFace minute={clock.clock} state={state} />
        {/* Said once each time the score changes (the GOAL! banner mounts with its text, which a screen reader may miss) */}
        <span className="sr-only" aria-live="polite" aria-atomic="true" data-testid="score-live">
          {score.home + score.away > 0 ? `${home.name} ${score.home}, ${away.name} ${score.away}` : ''}
        </span>
      </div>
      <div className="md-playback">
        {!clock.finished && (
          <button className="btn sm" onClick={clock.toggle} title="P pauses and resumes">
            {clock.running ? 'Pause' : 'Resume'}
          </button>
        )}
        {phone && skip}
        {phone && sim}
        <div className="segmented" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} className={clock.speed === s ? 'active' : ''} onClick={() => clock.setSpeed(s)} aria-pressed={clock.speed === s} data-testid={`speed-${s}`}>
              {s}x
            </button>
          ))}
        </div>
        {highlights && (
          <select className="input sm md-highlights" value={highlights.level} onChange={(e) => highlights.setLevel(e.target.value as HighlightLevel)} aria-label="Highlights" title={HIGHLIGHT_LEVELS.find((l) => l.id === highlights.level)?.hint} data-testid="highlights">
            {HIGHLIGHT_LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        )}
        {highlights?.setKeyMoments && (
          <button type="button" className={`btn sm md-moments ${highlights.keyMoments ? 'on' : ''}`} onClick={() => highlights.setKeyMoments?.(!highlights.keyMoments)} aria-pressed={!!highlights.keyMoments} aria-label="Key moments: the camera on big chances and goal replays" title={highlights.keyMoments ? 'Key moments on: the camera leans in on big chances and goals are replayed' : 'Key moments off: no camera moves or goal replays'} data-testid="key-moments">
            <Clapperboard size={15} aria-hidden="true" />
          </button>
        )}
        {highlights?.fast && !clock.finished && (
          <span className="chip info md-fast" data-testid="highlights-fast" title="A quiet spell: the clock runs fast to the next moment">
            ⏩
          </span>
        )}
        {highlights?.wound && (
          <span className="chip" data-testid="highlights-wound" title="Extended highlights wind down to Key while a side is three goals clear">
            Highlights wound down: {highlights.wound}
          </span>
        )}
        {!phone && skip}
        {playback && (
          <label className={`chip-toggle ${playback.auto ? 'on' : ''}`} title="The assistant makes the calls at the stops still to come">
            <input type="checkbox" checked={playback.auto} onChange={(e) => playback.setAuto(e.target.checked)} data-testid="auto-toggle" /> Auto from here
          </label>
        )}
        {!phone && sim}
      </div>
    </div>
  )
}
