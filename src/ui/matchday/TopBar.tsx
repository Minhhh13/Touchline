/**
 * The dashboard's top bar, as Football Manager lays it out: the manager's
 * controls on the left (Tactics, Instructions, the Mentality dropdown, Shouts,
 * Tweaks, and a chip saying where a change lands), the scoreboard in the
 * middle (club codes on club colours, the score at the clock, a running mm:ss
 * clock with the added time once the board is up, the stop or the whistle;
 * it flashes on a goal), and the playback on the right.
 */
import { useEffect, useRef } from 'react'
import type { Mentality } from '@engine/types'
import { scoreAt } from '@engine/matchFeed'
import { MENTALITY_HELP } from '@engine/tactics'
import { textColourFor } from '../format'
import { fractionalClock, useLiveClock } from '../match/clockStore'
import { barClock, SHOUTS_CLOSED, type DrawerId } from './controls'
import { clockText, skipLabel } from './model'
import type { TopBarProps } from './types'
import type { ManagerHand } from './useManagerHand'

const GOALS = new Set(['goal', 'penalty', 'own_goal'])

/** The running clock, written straight into the text node every frame (no React render per frame). */
function ClockFace({ minute, state }: { minute: number; state: { atStop: boolean; stopAt: number; finished: boolean; final: boolean; addedTime: number } }) {
  const ref = useRef<HTMLSpanElement>(null)
  const { atStop, stopAt, finished, final, addedTime } = state
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const paint = () => {
      const s = useLiveClock.getState()
      // The clock store is shared: read it only while it carries this match's minute
      const f = Math.abs(s.clock - minute) <= 1 ? Math.min(fractionalClock(s, performance.now()), minute + 1) : minute
      const text = barClock(Math.max(minute, f), { atStop, stopAt, finished, final, addedTime })
      if (el.textContent !== text) el.textContent = text
      if (!atStop && !finished) raf = requestAnimationFrame(paint)
    }
    paint()
    return () => cancelAnimationFrame(raf)
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

export function TopBar({ feed, clock, home, away, label, hand }: TopBarProps & { hand: ManagerHand }) {
  const t = clock.clock
  const score = scoreAt(feed.events, t)
  // The board lights up for the minute after a goal
  const flash = feed.events.some((e) => GOALS.has(e.type) && e.minute <= t && e.minute >= t - 1)
  const state = { atStop: clock.atStop, stopAt: clock.stopAt, finished: clock.finished, final: clock.final, addedTime: feed.addedTime }
  return (
    <div className="md-topbar" role="group" aria-label={label}>
      <Tools hand={hand} />
      <div className={`scoreboard ${flash ? 'flash' : ''}`} aria-label={`${home.name} ${score.home}, ${away.name} ${score.away}, ${clockText(t, state)}`}>
        <span className="md-sb-code" style={{ background: home.colour, color: textColourFor(home.colour) }} title={home.name}>
          {home.code}
        </span>
        <span className="score mono">
          {score.home} - {score.away}
        </span>
        <span className="md-sb-code" style={{ background: away.colour, color: textColourFor(away.colour) }} title={away.name}>
          {away.code}
        </span>
        <ClockFace minute={t} state={state} />
      </div>
      <div className="md-playback">
        {!clock.finished && (
          <button className="btn sm" onClick={clock.toggle}>
            {clock.running ? 'Pause' : 'Resume'}
          </button>
        )}
        <div className="segmented" role="group" aria-label="Speed">
          {([1, 2, 4] as const).map((s) => (
            <button key={s} className={clock.speed === s ? 'active' : ''} onClick={() => clock.setSpeed(s)} aria-pressed={clock.speed === s}>
              {s}x
            </button>
          ))}
        </div>
        {!clock.finished && (
          <button className="btn sm" onClick={clock.skip}>
            {skipLabel(clock.stopAt)}
          </button>
        )}
      </div>
    </div>
  )
}
