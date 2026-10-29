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
import { matchPace, toPicture } from '../match/timing'
import { kitColours } from '../match/shirts'
import { minuteLabel } from '../format'
import { keyMomentsPref, usePref } from '../viewerPrefs'
import { translator } from '../i18n'
import { summary } from '../i18n/en/summary'
import { eventLine } from '../i18n/commentaryText'

const t = translator(summary)

/** Milliseconds per match minute of a moment's build-up. */
export const HIGHLIGHT_MINUTE_MS = 300
/** The minute before the moment and the moment's own minute play slower, so the move that makes it reads (about 2x and 1.5x the live 1x). */
export const HIGHLIGHT_LEAD_MS = 1800
export const HIGHLIGHT_MOMENT_MS = 2600

/** How long the reel spends on minute `tick` of a moment at `minute`. */
export function highlightMinuteMs(tick: number, minute: number): number {
  return tick >= minute ? HIGHLIGHT_MOMENT_MS : tick === minute - 1 ? HIGHLIGHT_LEAD_MS : HIGHLIGHT_MINUTE_MS
}
/** Milliseconds a moment stays on screen once it has happened. */
export const HIGHLIGHT_HOLD_MS = 1700

const CHIP: Record<HighlightKind, string> = { goal: 'chip good', penalty: 'chip good', own_goal: 'chip good', chance: 'chip', save: 'chip', yellow: 'chip warn', red: 'chip bad' }

type HighlightsProps = { game: Game; u: LoadedUniverse; matchweek: number; onClose: () => void }

/**
 * The reel in a modal (a bottom sheet on a phone). Rebuilding a late game replays most of the season, a second on a
 * slow phone, so the sheet opens at once with a holding line and the game is rebuilt after that first paint.
 */
export function HighlightsModal(props: HighlightsProps) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const f = requestAnimationFrame(() => {
      timer = setTimeout(() => setReady(true), 0)
    })
    return () => {
      cancelAnimationFrame(f)
      if (timer) clearTimeout(timer)
    }
  }, [])
  if (ready) return <HighlightsReel {...props} />
  return (
    <Modal open onClose={props.onClose} title={t('highlightsTitle', { week: props.matchweek })} sheet testId="highlights">
      <p className="muted" data-testid="highlights-loading">
        {t('rebuilding')}
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
  // A crowded minute plays longer, as on the live pitch (the ball path is laid out the same way)
  const pace = useMemo(() => (hl ? matchPace(hl.events) : undefined), [hl])
  const [index, setIndex] = useState(0)
  // The camera leans in on each moment (Key moments, the viewer's setting); the reel's clock never holds, so it has no replays
  const [keyMoments] = usePref(keyMomentsPref)
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
    const period = highlightMinuteMs(tick, m.minute)
    const length = pace?.length ? period * (toPicture(pace, tick + 1) - toPicture(pace, tick)) : period
    publishClock({ clock: tick, running: building && !paused, speed: 1, period, pace })
    if (paused) return
    const timer = setTimeout(() => {
      if (building) setTick(tick + 1)
      else {
        setIndex(index + 1)
        setTick(buildUpFrom(moments, index + 1))
      }
    }, building ? length : HIGHLIGHT_HOLD_MS)
    return () => clearTimeout(timer)
  }, [m, tick, paused, index, moments, end, pace])
  // The live match screen starts its own clock; leave this one stopped
  useEffect(() => () => publishClock({ clock: 0, running: false, speed: 1, period: 110 }), [])

  const title = t('highlightsTitle', { week: matchweek })
  if (!hl) {
    return (
      <Modal open onClose={onClose} title={title} sheet testId="highlights">
        <p className="muted" data-testid="highlights-unavailable">
          {t('cannotReplay')}
        </p>
        <button className="btn" onClick={onClose} data-testid="highlights-close">
          {t('close')}
        </button>
      </Modal>
    )
  }
  const kit = kitColours(u, game.settings.hostClubId, hl.homeTeamId, hl.awayTeamId)
  const ourSide = hl.userHome ? 'home' : 'away'
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
          keyMoments={keyMoments}
          sounds={{ bed: 0.6, goals: { userSide: ourSide } }}
        />
        {m ? (
          <div className="hl-line" data-testid="highlights-line" data-kind={happened ? m.kind : 'build-up'} aria-live="polite">
            <span className="small muted">
              {t('momentOf', { i: index + 1, n: moments.length, minute: minuteLabel(happened ? m.minute : Math.min(tick, m.minute)) })}
            </span>
            {happened ? (
              <span>
                <span className={CHIP[m.kind]}>{t(`hl_${m.kind}`)}</span> {eventLine(m.text)}
              </span>
            ) : (
              <span className="muted">{t(m.kind === 'yellow' || m.kind === 'red' ? 'challengeFlies' : m.side === ourSide ? 'yourSideOnBall' : 'theyComeForward')}</span>
            )}
          </div>
        ) : (
          <div className="col" data-testid="highlights-end" style={{ gap: 6 }}>
            <b>{t('fullTime', { home: hl.homeName, score: `${hl.homeGoals}-${hl.awayGoals}`, away: hl.awayName })}</b>
            {moments.length ? (
              <ol className="hl-list">
                {moments.map((x, i) => (
                  <li key={i}>
                    <button className="hl-moment" onClick={() => go(i)} data-testid="highlights-moment">
                      <span className="mono small muted">{minuteLabel(x.minute)}</span>
                      <span className={CHIP[x.kind]}>{t(`hl_${x.kind}`)}</span>
                      <span className="hl-moment-text">{eventLine(x.text)}</span>
                      <span className="mono small">
                        {x.score.home}-{x.score.away}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <span className="muted small">{t('quietAfternoon')}</span>
            )}
          </div>
        )}
        <div className="row wrap hl-controls" style={{ gap: 8 }}>
          {!done && (
            <>
              <button className="btn sm" onClick={() => setPaused((p) => !p)} data-testid="highlights-pause">
                {t(paused ? 'play' : 'pause')}
              </button>
              <button className="btn sm" onClick={() => go(index + 1)} data-testid="highlights-next">
                {t('nextMoment')}
              </button>
              <button className="btn sm ghost" onClick={() => go(moments.length)} data-testid="highlights-skip">
                {t('skipToFullTime')}
              </button>
            </>
          )}
          {done && moments.length > 0 && (
            <button className="btn sm" onClick={() => go(0)} data-testid="highlights-again">
              {t('watchAgain')}
            </button>
          )}
          <button className="btn sm primary" onClick={onClose} data-testid="highlights-close" style={{ marginLeft: 'auto' }}>
            {t('close')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
