import { useEffect, useMemo, useRef, useState } from 'react'
import type { MatchEvent } from '@engine/types'
import type { FullMatchResult } from '@engine/match'
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

export function MatchTicker({ result, homeName, awayName, onDone, autoStart = true }: { result: FullMatchResult; homeName: string; awayName: string; onDone?: () => void; autoStart?: boolean }) {
  const [clock, setClock] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [running, setRunning] = useState(autoStart)
  const doneRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      setClock((c) => {
        const next = c + 1
        if (next >= 95) {
          setRunning(false)
          return 95
        }
        return next
      })
    }, 110 / speed)
    return () => clearInterval(id)
  }, [running, speed])

  useEffect(() => {
    if (clock >= 95 && !doneRef.current) {
      doneRef.current = true
      onDone?.()
    }
  }, [clock, onDone])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [clock])

  const shown = useMemo(() => result.events.filter((e) => e.minute <= clock && e.type !== 'kickoff'), [result.events, clock])
  const hg = shown.filter((e) => e.side === 'home' && (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal')).length
  const ag = shown.filter((e) => e.side === 'away' && (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal')).length
  const finished = clock >= 95

  return (
    <div className="col">
      <div className="scoreboard">
        <div className="team">{homeName}</div>
        <div className="col" style={{ alignItems: 'center', gap: 2 }}>
          <div className="score">
            {hg} - {ag}
          </div>
          <div className="clock">{finished ? 'FULL TIME' : clock === 0 ? 'KICK-OFF' : minuteLabel(Math.min(90, clock) + (clock > 90 ? clock - 90 : 0)).replace(/^(\d+)'$/, "$1'")}</div>
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
          <button className="btn sm" onClick={() => setClock(95)}>
            Skip to full time
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
