/**
 * The highlights of one quick-season game: its key moments (goals, big chances,
 * saves, cards) played one after another on the live pitch, each from a short
 * build-up to the moment itself, with the scoreline and a line of commentary.
 * The reel drives the shared live clock the pitch reads; it decides nothing:
 * the moments come from `quickHighlights`, rebuilt from the season's seeds.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Game } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import type { HighlightKind } from '@engine/highlights'
import { buildUpFrom, quickHighlights } from '@game/logic/highlights'
import { playerLookup } from '@game/logic/players'
import { LivePitch } from './LivePitch'
import { Modal } from './bits'
import { publishClock } from '../match/clockStore'
import { kitColours } from '../match/pitchGeometry'
import { minuteLabel } from '../format'

/** Milliseconds per match minute of a moment's build-up. */
export const HIGHLIGHT_MINUTE_MS = 300
/** Milliseconds a moment stays on screen once it has happened. */
export const HIGHLIGHT_HOLD_MS = 1700

const LABEL: Record<HighlightKind, string> = { goal: 'Goal', penalty: 'Penalty', own_goal: 'Own goal', chance: 'Chance', save: 'Save', yellow: 'Booked', red: 'Sent off' }
const CHIP: Record<HighlightKind, string> = { goal: 'chip good', penalty: 'chip good', own_goal: 'chip good', chance: 'chip', save: 'chip', yellow: 'chip warn', red: 'chip bad' }

type HighlightsProps = { game: Game; u: LoadedUniverse; matchweek: number; onClose: () => void }

/**
 * The reel in a modal (a bottom sheet on a phone). Rebuilding a late game replays most of the season, a second on a
 * slow phone, so the sheet opens at once with a holding line and the game is rebuilt after that first paint.
 */
export function HighlightsModal(props: HighlightsProps) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const f = requestAnimationFrame(() => {
      t = setTimeout(() => setReady(true), 0)
    })
    return () => {
      cancelAnimationFrame(f)
      if (t) clearTimeout(t)
    }
  }, [])
  if (ready) return <HighlightsReel {...props} />
  return (
    <Modal open onClose={props.onClose} title={`Highlights · matchweek ${props.matchweek}`} sheet testId="highlights">
      <p className="muted" data-testid="highlights-loading">
        Rebuilding the game…
      </p>
    </Modal>
  )
}

function HighlightsReel({ game, u, matchweek, onClose }: HighlightsProps) {
  const hl = useMemo(() => quickHighlights(game, u, matchweek), [game, u, matchweek])
  const get = useMemo(() => playerLookup(game, u), [game, u])
  const moments = useMemo(() => hl?.moments ?? [], [hl])
  // Full time is after the last event: a goal in stoppage time (90+) must still be on the pitch at the end
  const end = useMemo(() => Math.max(90, ...(hl?.events ?? []).map((e) => e.minute)), [hl])
  const [index, setIndex] = useState(0)
  const [tick, setTick] = useState(() => buildUpFrom(moments, 0))
  const [paused, setPaused] = useState(false)
  const m = moments[index]
  const go = (i: number) => {
    setIndex(i)
    setTick(buildUpFrom(moments, i))
    setPaused(false)
  }
  // The clock runs through the build-up to the moment's minute, holds on it, then moves to the next moment
  useEffect(() => {
    if (!m) {
      publishClock({ clock: end, running: false, speed: 1, period: HIGHLIGHT_MINUTE_MS })
      return
    }
    const building = tick <= m.minute
    publishClock({ clock: tick, running: building && !paused, speed: 1, period: HIGHLIGHT_MINUTE_MS })
    if (paused) return
    const t = setTimeout(() => {
      if (building) setTick(tick + 1)
      else {
        setIndex(index + 1)
        setTick(buildUpFrom(moments, index + 1))
      }
    }, building ? HIGHLIGHT_MINUTE_MS : HIGHLIGHT_HOLD_MS)
    return () => clearTimeout(t)
  }, [m, tick, paused, index, moments, end])
  // The live match screen starts its own clock; leave this one stopped
  useEffect(() => () => publishClock({ clock: 0, running: false, speed: 1, period: 110 }), [])

  const title = `Highlights · matchweek ${matchweek}`
  if (!hl) {
    return (
      <Modal open onClose={onClose} title={title} sheet testId="highlights">
        <p className="muted" data-testid="highlights-unavailable">
          This game cannot be replayed on this save: it was played before highlights were kept, or the league data has changed since.
        </p>
        <button className="btn" onClick={onClose} data-testid="highlights-close">
          Close
        </button>
      </Modal>
    )
  }
  const kit = kitColours(u, game.settings.hostClubId, hl.homeTeamId, hl.awayTeamId)
  const done = !m
  const happened = !!m && tick > m.minute
  const shown = done ? { home: hl.homeGoals, away: hl.awayGoals } : happened ? m.score : moments[index - 1]?.score ?? { home: 0, away: 0 }
  return (
    <Modal open onClose={onClose} title={title} sheet testId="highlights">
      <div className="col hl" style={{ gap: 10 }}>
        <div className="hl-score" data-testid="highlights-score" data-score={`${shown.home}-${shown.away}`}>
          <span className="hl-team">{hl.homeName}</span>
          <span className="hl-goals">
            {shown.home}-{shown.away}
          </span>
          <span className="hl-team right">{hl.awayName}</span>
        </div>
        <LivePitch
          home={{ name: hl.homeName, shortName: hl.homeShort, colour: kit.home, tactics: hl.homeTactics, appearances: hl.home.appearances }}
          away={{ name: hl.awayName, shortName: hl.awayShort, colour: kit.away, tactics: hl.awayTactics, appearances: hl.away.appearances }}
          events={hl.events}
          momentum={hl.momentum}
          from={done ? end : buildUpFrom(moments, index)}
          to={done ? end : m.minute}
          seed={`hl-${matchweek}-${hl.homeTeamId}-${hl.awayTeamId}`}
          getPlayer={get}
        />
        {m ? (
          <div className="hl-line" data-testid="highlights-line" data-kind={happened ? m.kind : 'build-up'} aria-live="polite">
            <span className="small muted">
              Moment {index + 1} of {moments.length} · {minuteLabel(happened ? m.minute : Math.min(tick, m.minute))}
            </span>
            {happened ? (
              <span>
                <span className={CHIP[m.kind]}>{LABEL[m.kind]}</span> {m.text}
              </span>
            ) : (
              <span className="muted">{m.kind === 'yellow' || m.kind === 'red' ? 'A challenge flies in…' : m.side === (hl.userHome ? 'home' : 'away') ? 'Your side on the ball…' : 'They come forward…'}</span>
            )}
          </div>
        ) : (
          <div className="col" data-testid="highlights-end" style={{ gap: 6 }}>
            <b>Full time: {hl.homeName} {hl.homeGoals}-{hl.awayGoals} {hl.awayName}</b>
            {moments.length ? (
              <ol className="hl-list">
                {moments.map((x, i) => (
                  <li key={i}>
                    <button className="hl-moment" onClick={() => go(i)} data-testid="highlights-moment">
                      <span className="mono small muted">{minuteLabel(x.minute)}</span>
                      <span className={CHIP[x.kind]}>{LABEL[x.kind]}</span>
                      <span className="hl-moment-text">{x.text}</span>
                      <span className="mono small">
                        {x.score.home}-{x.score.away}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <span className="muted small">A quiet afternoon: nothing worth a replay.</span>
            )}
          </div>
        )}
        <div className="row wrap hl-controls" style={{ gap: 8 }}>
          {!done && (
            <>
              <button className="btn sm" onClick={() => setPaused((p) => !p)} data-testid="highlights-pause">
                {paused ? 'Play' : 'Pause'}
              </button>
              <button className="btn sm" onClick={() => go(index + 1)} data-testid="highlights-next">
                Next moment
              </button>
              <button className="btn sm ghost" onClick={() => go(moments.length)} data-testid="highlights-skip">
                Skip to full time
              </button>
            </>
          )}
          {done && moments.length > 0 && (
            <button className="btn sm" onClick={() => go(0)} data-testid="highlights-again">
              Watch again
            </button>
          )}
          <button className="btn sm primary" onClick={onClose} data-testid="highlights-close" style={{ marginLeft: 'auto' }}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
