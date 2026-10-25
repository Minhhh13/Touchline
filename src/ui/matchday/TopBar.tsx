/**
 * The dashboard's top bar: the scoreboard (club codes on club colours, the
 * score at the clock, the clock with the added time once the board is up, the
 * stop or the whistle), and the playback controls. The tactical controls in
 * play plug in on the left (`control`).
 */
import { scoreAt } from '@engine/matchFeed'
import { textColourFor } from '../format'
import { clockText, skipLabel } from './model'
import type { TopBarProps } from './types'

const GOALS = new Set(['goal', 'penalty', 'own_goal'])

export function TopBar({ feed, clock, home, away, label }: TopBarProps) {
  const t = clock.clock
  const score = scoreAt(feed.events, t)
  // The board lights up for the minute after a goal
  const flash = feed.events.some((e) => GOALS.has(e.type) && e.minute <= t && e.minute >= t - 1)
  const text = clockText(t, { atStop: clock.atStop, stopAt: clock.stopAt, finished: clock.finished, final: clock.final, addedTime: feed.addedTime })
  return (
    <div className="md-topbar" role="group" aria-label={label}>
      <div className="md-tools">{feed.source === 'result' && <span className="chip">Replay</span>}</div>
      <div className={`scoreboard ${flash ? 'flash' : ''}`} aria-live="off">
        <span className="md-sb-code" style={{ background: home.colour, color: textColourFor(home.colour) }} title={home.name}>
          {home.code}
        </span>
        <span className="score mono">
          {score.home} - {score.away}
        </span>
        <span className="md-sb-code" style={{ background: away.colour, color: textColourFor(away.colour) }} title={away.name}>
          {away.code}
        </span>
        <span className="clock mono">{text}</span>
      </div>
      <div className="md-playback">
        {!clock.finished && (
          <button className="btn sm" onClick={clock.toggle}>
            {clock.running ? 'Pause' : 'Resume'}
          </button>
        )}
        <div className="segmented">
          {([1, 2, 4] as const).map((s) => (
            <button key={s} className={clock.speed === s ? 'active' : ''} onClick={() => clock.setSpeed(s)}>
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
