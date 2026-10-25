import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import type { MatchEvent } from '@engine/types'
import { minuteLabel } from '../format'
import { GOAL_FLIGHT_MS, readout, reanchor, useLiveClock } from '../match/clockStore'
import { goalHolds } from '../match/possession'
import type { Side } from '../match/pitchGeometry'
import { useMediaQuery } from './LivePitch'

const ICON: Record<MatchEvent['type'], string> = {
  goal: '⚽',
  penalty: '⚽',
  own_goal: '⚽',
  yellow: '🟨',
  red: '🟥',
  injury: '🩹',
  substitution: '🔁',
  chance: '💨',
  save: '🧤',
  kickoff: '🏁',
  half_time: '⏸',
  full_time: '🏁',
}

const GOAL_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal'])

/** The label for a stop short of the whistle: half time, or the 70th-minute window. */
function stopLabel(stopAt: number): string {
  return stopAt === 45 ? 'half time' : `${stopAt} minutes`
}

/** Milliseconds per match minute at 1x: the bare ticker, and the ticker with the pitch to watch. */
export const TICKER_PERIOD = 110
export const PITCH_PERIOD = 330

/** The replay speed is a per-viewer convenience, remembered across matches and segments. */
const SPEED_KEY = 'touchline-ticker-speed'
function readSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY))
    return v === 2 || v === 4 ? v : 1
  } catch {
    return 1
  }
}
function saveSpeed(v: number): void {
  try {
    localStorage.setItem(SPEED_KEY, String(v))
  } catch {
    // Private window or blocked storage: the speed is simply not remembered
  }
}

/**
 * The minute-by-minute replay. It owns the shared live clock (clockStore):
 * the pitch and its charts read the continuous match time from there every
 * frame, and this component refreshes the whole minute, the goals revealed and
 * the celebration on a light timer, re-rendering only when one changes. With
 * the pitch on show a minute lasts three times as long, so the ball's passes
 * can be followed, and every goal holds the clock for its celebration; the
 * score changes when the ball crosses the line, not before.
 */
export function MatchTicker({ events, homeName, awayName, onDone, onStop, startClock = 0, stopAt = 95, autoStart = true, visuals, period, userSide, controls }: { events: MatchEvent[]; homeName: string; awayName: string; onDone?: () => void; onStop?: () => void; startClock?: number; stopAt?: number; autoStart?: boolean; visuals?: ReactNode; period?: number; userSide?: Side; controls?: ReactNode }) {
  const minuteMs = period ?? (visuals ? PITCH_PERIOD : TICKER_PERIOD)
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const end = stopAt < 95 ? stopAt + 1 : 95
  const withPitch = !!visuals
  const holds = useMemo(() => (withPitch ? goalHolds(events, startClock, stopAt, { userSide, reduced }) : []), [withPitch, events, startClock, stopAt, userSide, reduced])
  const flight = reduced ? 0 : GOAL_FLIGHT_MS
  const doneRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

  // Start the clock before paint, so a pitch mounting with a new match never shows the last one's minute
  useLayoutEffect(() => {
    doneRef.current = false
    const now = performance.now()
    useLiveClock.setState({ at: startClock, since: now, spent: Infinity, running: autoStart && startClock < end, speed: readSpeed(), period: minuteMs, stopAt, end, holds, clock: Math.min(stopAt, startClock), revealed: 0, celebrating: -1, done: startClock >= end })
  }, [startClock, stopAt, end, minuteMs, holds, autoStart])

  const clock = useLiveClock((s) => s.clock)
  const speed = useLiveClock((s) => s.speed)
  const running = useLiveClock((s) => s.running)
  const revealed = useLiveClock((s) => s.revealed)
  const celebrating = useLiveClock((s) => s.celebrating)
  const finished = useLiveClock((s) => s.done)

  // A light timer refreshes what React shows; the pitch animates on its own every frame
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      const s = useLiveClock.getState()
      const now = performance.now()
      const r = readout(s, now, flight)
      if (r.clock === s.clock && r.revealed === s.revealed && r.celebrating === s.celebrating && r.done === s.done) return
      useLiveClock.setState(r.done ? { ...r, running: false, at: s.end, since: now, spent: Infinity } : r)
    }, 40)
    return () => clearInterval(id)
  }, [running, flight])

  useEffect(() => {
    // Read the store, not the render: the first render of a new segment still sees the last one's finish
    if (finished && useLiveClock.getState().done && !doneRef.current) {
      doneRef.current = true
      if (stopAt < 95) onStop?.()
      else onDone?.()
    }
  }, [finished, onDone, onStop, stopAt])

  const hidden = useMemo(() => new Set(holds.slice(revealed).map((h) => +h.key)), [holds, revealed])
  const shown = useMemo(
    () =>
      events
        .map((e, i) => ({ e, i }))
        .filter(({ e, i }) => e.minute <= clock && e.type !== 'kickoff' && !hidden.has(i))
        .sort((a, b) => a.e.minute - b.e.minute || (a.e.type === 'half_time' || a.e.type === 'full_time' ? 1 : 0) - (b.e.type === 'half_time' || b.e.type === 'full_time' ? 1 : 0)),
    [events, clock, hidden],
  )
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [shown.length])

  const hg = shown.filter(({ e }) => e.side === 'home' && GOAL_TYPES.has(e.type)).length
  const ag = shown.filter(({ e }) => e.side === 'away' && GOAL_TYPES.has(e.type)).length
  const atStop = finished && stopAt < 95
  // The goal being celebrated, once the ball is over the line; without the pitch, the minute after a goal
  const live = celebrating >= 0 && revealed > celebrating ? holds[celebrating] : null
  const fresh = live ? +live.key : -1
  const flash = live ? true : !visuals && shown.some(({ e }) => GOAL_TYPES.has(e.type) && e.minute >= clock - 1)
  const firstScore = useRef(`${hg}-${ag}`)

  const setSpeed = (v: number) => {
    const s = useLiveClock.getState()
    const now = performance.now()
    useLiveClock.setState({ ...reanchor(s, now), speed: v })
    saveSpeed(v)
  }
  const toggle = () => {
    const s = useLiveClock.getState()
    const now = performance.now()
    if (s.running) useLiveClock.setState({ ...reanchor(s, now), running: false })
    else if (!s.done) useLiveClock.setState({ since: now, running: true })
  }
  const skip = () => {
    const s = useLiveClock.getState()
    const now = performance.now()
    const at = { ...s, at: s.end, since: now, spent: Infinity, running: false }
    useLiveClock.setState({ at: s.end, since: now, spent: Infinity, running: false, ...readout(at, now, flight) })
  }

  return (
    <div className="col">
      <div className={`scoreboard ${flash ? 'flash' : ''} ${live ? `goal-${live.tone}` : ''}`} data-testid="scoreboard">
        <div className="team">{homeName}</div>
        <div className="col" style={{ alignItems: 'center', gap: 2 }}>
          <div className="score" data-testid="live-score">
            <span key={`h${hg}`} className={`n ${firstScore.current !== `${hg}-${ag}` && live?.side === 'home' ? 'pop' : ''}`}>{hg}</span> - <span key={`a${ag}`} className={`n ${firstScore.current !== `${hg}-${ag}` && live?.side === 'away' ? 'pop' : ''}`}>{ag}</span>
          </div>
          <div className="clock">{atStop ? stopLabel(stopAt).toUpperCase() : finished ? 'FULL TIME' : clock === 0 ? 'KICK-OFF' : minuteLabel(clock)}</div>
        </div>
        <div className="team away">{awayName}</div>
      </div>
      <div className="row between wrap ticker-controls">
        <div className="row">
          {!finished && (
            <button className="btn sm" onClick={toggle} data-testid="pause">
              {running ? 'Pause' : 'Resume'}
            </button>
          )}
          <div className="segmented">
            {[1, 2, 4].map((s) => (
              <button key={s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)}>
                {s}x
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          {controls}
          {!finished && (
            <button className="btn sm" onClick={skip} data-testid="skip-replay">
              {stopAt < 95 ? `Skip to ${stopLabel(stopAt)}` : 'Skip to full time'}
            </button>
          )}
        </div>
      </div>
      {visuals}
      <div className="ticker" ref={listRef}>
        {shown.map(({ e, i }) => (
          <div key={i} className={`tick ${GOAL_TYPES.has(e.type) ? 'goal' : e.type} ${i === fresh ? 'fresh' : ''} ${e.side === 'away' && e.type !== 'half_time' && e.type !== 'full_time' ? 'away' : ''}`}>
            {e.side === 'away' && e.type !== 'half_time' && e.type !== 'full_time' ? (
              <>
                <span>
                  {e.text} {ICON[e.type]}
                </span>
                <span className="min">{minuteLabel(e.minute)}</span>
              </>
            ) : (
              <>
                <span className="min">{e.type === 'half_time' || e.type === 'full_time' ? '' : minuteLabel(e.minute)}</span>
                <span>
                  {ICON[e.type]} {e.text}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
