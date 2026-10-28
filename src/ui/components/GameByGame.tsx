import { useEffect, useMemo, useRef, useState } from 'react'
import type { QuickGameResult } from '@game/types'
import { countUpValue, foldResults, gamesInOrder, goalDifferenceLabel, nextReveal, outcomeOf, parsePlaybackSpeed, playbackDelay, type GameOrder, type PlaybackSpeed } from '@game/logic/gameByGame'
import { ChevronDown, Play, SkipForward } from 'lucide-react'
import { runAfterPaint } from '../afterPaint'
import { ClubBadge } from './bits'
import { scorersText } from '../scorers'
import { shownGames } from '../screenText'
import { translator } from '../i18n'
import { season } from '../i18n/en/season'

const t = translator(season)

/** Milliseconds between two games revealed by the season replay. */
export const REPLAY_STEP_MS = 220

export interface SeasonReplay {
  /** Games currently shown, from the top of the list. */
  revealed: number
  /** The replay is running: the tier banner waits for the last game. */
  playing: boolean
  /** The replay has been run at least once on this screen. */
  used: boolean
  /** Reduced motion, or nothing to replay: everything is shown at once and no button is offered. */
  canReplay: boolean
  start: () => void
  skip: () => void
}

/** The viewer asked for reduced motion: lists appear without animation and the tally does not count up. */
function useReducedMotion(): boolean {
  return useMemo(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, [])
}

/**
 * The season replay is UI state only: the list shows everything by default,
 * "Play the season" hides it and reveals one game every REPLAY_STEP_MS, and
 * "Skip" shows the rest at once. Reduced motion never animates.
 */
export function useSeasonReplay(total: number): SeasonReplay {
  const reduced = useReducedMotion()
  const [revealed, setRevealed] = useState(total)
  const [playing, setPlaying] = useState(false)
  const [used, setUsed] = useState(false)
  useEffect(() => {
    if (!playing) return
    if (revealed >= total) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(() => setRevealed((r) => Math.min(total, r + 1)), REPLAY_STEP_MS)
    return () => clearTimeout(timer)
  }, [playing, revealed, total])
  const canReplay = !reduced && total > 0
  return {
    revealed: Math.min(revealed, total),
    playing,
    used,
    canReplay,
    start: () => {
      if (!canReplay) return
      setUsed(true)
      setRevealed(0)
      setPlaying(true)
    },
    skip: () => {
      setRevealed(total)
      setPlaying(false)
    },
  }
}

/** The season playback's speed, per viewer (not the match screen's speed, which has its own key). */
const SPEED_KEY = 'touchline-season-speed'

function readSpeed(): PlaybackSpeed {
  try {
    return parsePlaybackSpeed(localStorage.getItem(SPEED_KEY))
  } catch {
    return 1
  }
}

export interface SeasonPlayback extends SeasonReplay {
  speed: PlaybackSpeed
  setSpeed: (s: PlaybackSpeed) => void
  /** Pause or carry on. */
  toggle: () => void
  /** Stop on the game shown (a bench change is being made). */
  pause: () => void
  /** Every game up to the stop is shown. */
  done: boolean
}

/**
 * The season playback after kick-off: it starts on its own from game `from` and reveals one game every
 * `PLAYBACK_STEP_MS / speed` ms (3000, 1500, 750 or 375) up to `stopAt` (the January pause, or the last game). Pause, speed
 * and skip are UI state only: the season itself was simulated before the first game is shown.
 */
export function useSeasonPlayback(total: number, from: number, stopAt = total): SeasonPlayback {
  const cap = Math.min(total, stopAt)
  const [revealed, setRevealed] = useState(() => Math.min(from, cap))
  const [playing, setPlaying] = useState(() => from < cap)
  const [speed, setSpeedState] = useState<PlaybackSpeed>(readSpeed)
  const setSpeed = (v: PlaybackSpeed) => {
    setSpeedState(v)
    try {
      localStorage.setItem(SPEED_KEY, String(v))
    } catch {
      // Storage blocked: the speed lasts for this visit only
    }
  }
  useEffect(() => {
    if (!playing) return
    if (revealed >= cap) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(() => setRevealed((r) => nextReveal(r, total, cap)), playbackDelay(speed))
    return () => clearTimeout(timer)
  }, [playing, revealed, total, cap, speed])
  const done = revealed >= cap
  return {
    revealed: Math.min(revealed, cap),
    playing,
    used: true,
    canReplay: false,
    start: () => setPlaying(true),
    skip: () => {
      setRevealed(cap)
      setPlaying(false)
    },
    speed,
    setSpeed,
    toggle: () => setPlaying((p) => (done ? false : !p)),
    pause: () => setPlaying(false),
    done,
  }
}

export interface Opponent {
  /** The club whose badge and colours stand for the opponent. */
  clubId: string
  name: string
  /** The club's short name ("Wolves"), shown in place of the full one where the list is narrow (`.gbg-list` container). */
  short?: string
}

/** The running P W D L GF GA strip and the position after the last game counted. */
export function RunningStrip({ results, upTo }: { results: QuickGameResult[]; upTo: number }) {
  const f = foldResults(results, upTo)
  return (
    <div className="gbg-strip mono" data-testid="running-strip">
      <span>
        <b>{t('stripP')}</b> {f.played}
      </span>
      <span className="w">
        <b>{t('stripW')}</b> {f.won}
      </span>
      <span className="d">
        <b>{t('stripD')}</b> {f.drawn}
      </span>
      <span className="l">
        <b>{t('stripL')}</b> {f.lost}
      </span>
      <span>
        <b>{t('stripGF')}</b> {f.goalsFor}
      </span>
      <span>
        <b>{t('stripGA')}</b> {f.goalsAgainst}
      </span>
      <span>
        <b>{t('stripGD')}</b> {goalDifferenceLabel(f.goalsFor, f.goalsAgainst)}
      </span>
      <span>
        <b>{t('stripPts')}</b> {f.points}
      </span>
      <span className="pos">{f.played ? t('ordinal', { n: f.position }) : '—'}</span>
    </div>
  )
}

/** A number that counts up to `value` over about a third of a second whenever it changes; reduced motion shows it at once. */
function CountUp({ value }: { value: number }) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (reduced || typeof requestAnimationFrame !== 'function') {
      from.current = value
      setShown(value)
      return
    }
    const start = from.current
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const k = (now - t0) / 350
      const v = countUpValue(start, value, k)
      from.current = v
      setShown(v)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, reduced])
  return <>{shown}</>
}

/**
 * The running tally of a season as it plays: Won, Drawn, Lost and Points in boxes that count up as each result lands,
 * then goals for, against and the difference, and the league position after the last game shown.
 */
export function SeasonTally({ results, upTo }: { results: QuickGameResult[]; upTo: number }) {
  const f = foldResults(results, upTo)
  const boxes: Array<{ key: string; label: string; value: number }> = [
    { key: 'w', label: t('won'), value: f.won },
    { key: 'd', label: t('drawn'), value: f.drawn },
    { key: 'l', label: t('lost'), value: f.lost },
    { key: 'pts', label: t('points'), value: f.points },
  ]
  return (
    <div className="tally" data-testid="season-tally">
      <div className="tally-boxes">
        {boxes.map((b) => (
          <div key={b.key} className={`tally-box ${b.key}`} data-testid={`tally-${b.key}`}>
            <span className="tally-num">
              <CountUp value={b.value} />
            </span>
            <span className="tally-label">{b.label}</span>
          </div>
        ))}
      </div>
      <div className="tally-goals small" data-testid="tally-goals">
        <span>{t('tallyGF', { n: f.goalsFor })}</span>
        <span>{t('tallyGA', { n: f.goalsAgainst })}</span>
        <span>{t('tallyGD', { gd: goalDifferenceLabel(f.goalsFor, f.goalsAgainst) })}</span>
        {f.played > 0 && <span className="tally-pos">{t('inTheTable', { n: f.position })}</span>}
      </div>
    </div>
  )
}

const ORDER_KEY = 'touchline-gbg-order'

/** The order the reader last chose for the season list after the game, a per-viewer convenience. */
function readOrder(fallback: GameOrder): GameOrder {
  try {
    const v = localStorage.getItem(ORDER_KEY)
    return v === 'newest' || v === 'oldest' ? v : fallback
  } catch {
    return fallback
  }
}

export function GameByGame({ results, opponent, replay, title = t('seasonGbg'), compact = false, strip = true, onHighlights, order: fixedOrder, orderToggle = false, total = results.length, fold }: { results: QuickGameResult[]; opponent: (teamId: string) => Opponent; replay?: SeasonReplay; title?: string; compact?: boolean; /** Off where the screen shows its own running strip. */ strip?: boolean; /** Each game gets a Highlights button that calls this. */ onHighlights?: (r: QuickGameResult) => void; /** Newest game at the top, or matchweek 1 first (the default). */ order?: GameOrder; /** Offer a Newest / Oldest switch, remembered per viewer; starts newest first. */ orderToggle?: boolean; /** Games in the whole season, when `results` holds only part of it (the playback before January). */ total?: number; /** Show only this many games until "Show all" (the replay always shows every game it has revealed). */ fold?: number }) {
  const revealed = replay ? replay.revealed : results.length
  const playing = replay?.playing ?? false
  const [chosen, setChosen] = useState<GameOrder>(() => (orderToggle ? readOrder('newest') : 'oldest'))
  const order: GameOrder = orderToggle ? chosen : fixedOrder ?? 'oldest'
  const choose = (o: GameOrder) => {
    setChosen(o)
    try {
      localStorage.setItem(ORDER_KEY, o)
    } catch {
      // Storage blocked: the choice lasts for this screen only
    }
  }
  const newestRef = useRef<HTMLLIElement | null>(null)
  const listRef = useRef<HTMLOListElement | null>(null)
  const drawn = useRef(false)
  useEffect(() => {
    const first = !drawn.current
    drawn.current = true
    // Newest first, the new game lands at the top: a compact list scrolls back up to it, a full list never moves (a
    // list just drawn is at its top already; setting it would force the screen's first layout inside its mount).
    // Oldest first, while games are still arriving a compact list scrolls inside itself to the bottom and a full list
    // brings the new game into view; a finished season's list (the summary's) opens at matchweek 1
    if (order === 'newest') {
      if (compact && listRef.current && !first) listRef.current.scrollTop = 0
    } else if (compact) {
      // Only while games are still arriving (a finished season's list opens at matchweek 1)
      if (playing) {
        const toBottom = () => {
          if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
        }
        // A list just drawn goes to its bottom once the screen has painted, not by forcing the screen's first layout
        if (first) runAfterPaint(toBottom)
        else toBottom()
      }
    } else if (playing && newestRef.current) newestRef.current.scrollIntoView({ block: 'nearest' })
  }, [playing, revealed, compact, order])
  const [expanded, setExpanded] = useState(false)
  const shown = gamesInOrder(results, revealed, order).slice(0, shownGames(revealed, fold, expanded, playing))
  const newestWeek = revealed ? results[revealed - 1].matchweek : null
  return (
    <div className={`panel gbg ${compact ? 'compact' : ''} ${onHighlights ? 'with-hl' : ''}`} data-testid="game-by-game" data-order={order}>
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="row" style={{ gap: 8 }}>
          {orderToggle && (
            <span className="segmented seg-mini" role="group" aria-label={t('orderLabel')}>
              <button className={order === 'newest' ? 'active' : ''} aria-pressed={order === 'newest'} onClick={() => choose('newest')} data-testid="order-newest">
                {t('newest')}
              </button>
              <button className={order === 'oldest' ? 'active' : ''} aria-pressed={order === 'oldest'} onClick={() => choose('oldest')} data-testid="order-oldest">
                {t('oldest')}
              </button>
            </span>
          )}
          {replay?.canReplay ? (
            <span className="toolbar">
              {playing && <span className="small muted mono">{t('mwOf', { n: revealed, total: results.length })}</span>}
              {playing ? (
                <button className="btn sm" onClick={replay.skip} data-testid="replay-skip">
                  <SkipForward size={14} aria-hidden="true" /> {t('skip')}
                </button>
              ) : (
                <button className="btn sm" onClick={replay.start} data-testid="replay-play" title={t('replayTip')}>
                  <Play size={14} aria-hidden="true" /> {t(replay.used ? 'playAgain' : 'playSeason')}
                </button>
              )}
            </span>
          ) : (
            <span className="small muted">{revealed < total ? t('nOfTotal', { n: revealed, total }) : t('nGames', { total })}</span>
          )}
        </span>
      </div>
      {strip && <RunningStrip results={results} upTo={revealed} />}
      <ol className="gbg-list" aria-label={title} ref={listRef}>
        {shown.map((r) => {
          const opp = opponent(r.opponentId)
          const o = outcomeOf(r)
          const scorers = scorersText(r.scorers)
          const isNewest = r.matchweek === newestWeek
          return (
            <li key={r.matchweek} className={`gbg-game ${o} ${isNewest && order === 'newest' ? 'newest' : ''}`} data-testid="gbg-game" data-outcome={o} data-matchweek={r.matchweek} ref={isNewest ? newestRef : undefined}>
              <span className={`gbg-badge ${o}`} role="img" aria-label={t(o === 'W' ? 'won' : o === 'D' ? 'drawn' : 'lost')}>
                {o}
              </span>
              <ClubBadge clubId={opp.clubId} size={22} />
              <span className="gbg-fix">
                {opp.short && opp.short !== opp.name ? (
                  <span className="gbg-name has-short" title={opp.name}>
                    <span className="gbg-full">{opp.name}</span>
                    <span className="gbg-short">{opp.short}</span>
                  </span>
                ) : (
                  <span className="gbg-name">{opp.name}</span>
                )}{' '}
                <span className="gbg-ha">{t(r.home ? 'home' : 'away')}</span>
              </span>
              <span className="gbg-score">
                {r.gf}-{r.ga}
              </span>
              <span className="gbg-mw" title={t('mwTip')}>
                {t('mw', { n: r.matchweek })}
                <span className="gbg-pos">{t('mwPos', { n: r.position })}</span>
              </span>
              {onHighlights && (
                <button className="btn sm ghost gbg-hl" onClick={() => onHighlights(r)} title={t('highlights')} aria-label={t('highlightsOf', { n: r.matchweek })} data-testid="gbg-highlights">
                  <Play size={12} aria-hidden="true" />
                </button>
              )}
              {scorers && <span className="gbg-scorers small">⚽ {scorers}</span>}
            </li>
          )
        })}
      </ol>
      {fold !== undefined && !playing && revealed > fold && (
        <button type="button" className="btn ghost sm block gbg-more" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? t('showFewer') : t('showAll', { n: revealed })} <ChevronDown size={14} className={expanded ? 'flip' : ''} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
