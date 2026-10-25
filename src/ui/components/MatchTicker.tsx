import { useEffect, useMemo, useRef, useState } from 'react'
import type { MatchEvent } from '@engine/types'
import { minuteLabel } from '../format'

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

/** The label for a stop short of the whistle: half time, or the 70th-minute window. */
function stopLabel(stopAt: number): string {
  return stopAt === 45 ? 'half time' : `${stopAt} minutes`
}

export function MatchTicker({ events, homeName, awayName, onDone, onStop, startClock = 0, stopAt = 95, autoStart = true }: { events: MatchEvent[]; homeName: string; awayName: string; onDone?: () => void; onStop?: () => void; startClock?: number; stopAt?: number; autoStart?: boolean }) {
  const [clock, setClock] = useState(startClock)
  const [speed, setSpeed] = useState(1)
  const [running, setRunning] = useState(autoStart)
  const doneRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      setClock((c) => {
        const next = c + 1
        if (next >= stopAt) {
          setRunning(false)
          return stopAt
        }
        return next
      })
    }, 110 / speed)
    return () => clearInterval(id)
  }, [running, speed, stopAt])

  useEffect(() => {
    if (clock >= stopAt && !doneRef.current) {
      doneRef.current = true
      if (stopAt < 95) onStop?.()
      else onDone?.()
    }
  }, [clock, onDone, onStop, stopAt])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [clock])

  const shown = useMemo(() => events.filter((e) => e.minute <= clock && e.type !== 'kickoff').sort((a, b) => a.minute - b.minute || (a.type === 'half_time' || a.type === 'full_time' ? 1 : 0) - (b.type === 'half_time' || b.type === 'full_time' ? 1 : 0)), [events, clock])
  const hg = shown.filter((e) => e.side === 'home' && (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal')).length
  const ag = shown.filter((e) => e.side === 'away' && (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal')).length
  const finished = clock >= stopAt
  const atStop = finished && stopAt < 95

  return (
    <div className="col">
      <div className="scoreboard">
        <div className="team">{homeName}</div>
        <div className="col" style={{ alignItems: 'center', gap: 2 }}>
          <div className="score">
            {hg} - {ag}
          </div>
          <div className="clock">{atStop ? stopLabel(stopAt).toUpperCase() : finished ? 'FULL TIME' : clock === 0 ? 'KICK-OFF' : minuteLabel(clock)}</div>
        </div>
        <div className="team away">{awayName}</div>
      </div>
      <div className="row between wrap">
        <div className="row">
          {!finished && (
            <button className="btn sm" onClick={() => setRunning((r) => !r)}>
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
        {!finished && (
          <button className="btn sm" onClick={() => setClock(stopAt)}>
            {stopAt < 95 ? `Skip to ${stopLabel(stopAt)}` : 'Skip to full time'}
          </button>
        )}
      </div>
      <div className="ticker" ref={listRef}>
        {shown.map((e, i) => (
          <div key={i} className={`tick ${e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal' ? 'goal' : e.type} ${e.side === 'away' && e.type !== 'half_time' && e.type !== 'full_time' ? 'away' : ''}`}>
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
