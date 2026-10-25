import { useEffect, useMemo, useRef, useState } from 'react'
import type { QuickGameResult } from '@game/types'
import { foldResults, nextReveal, outcomeOf, playbackDelay, scorersLabel, type PlaybackSpeed } from '@game/logic/gameByGame'
import { ClubBadge } from './bits'
import { ordinal } from '../format'

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

/**
 * The season replay is UI state only: the list shows everything by default,
 * "Play the season" hides it and reveals one game every REPLAY_STEP_MS, and
 * "Skip" shows the rest at once. Reduced motion never animates.
 */
export function useSeasonReplay(total: number): SeasonReplay {
  const reduced = useMemo(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const [revealed, setRevealed] = useState(total)
  const [playing, setPlaying] = useState(false)
  const [used, setUsed] = useState(false)
  useEffect(() => {
    if (!playing) return
    if (revealed >= total) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setRevealed((r) => Math.min(total, r + 1)), REPLAY_STEP_MS)
    return () => clearTimeout(t)
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

export interface SeasonPlayback extends SeasonReplay {
  speed: PlaybackSpeed
  setSpeed: (s: PlaybackSpeed) => void
  /** Pause or carry on. */
  toggle: () => void
  /** Every game up to the stop is shown. */
  done: boolean
}

/**
 * The season playback after kick-off: it starts on its own from game `from` and reveals one game every
 * `PLAYBACK_STEP_MS / speed` ms (700, 350 or 175) up to `stopAt` (the January pause, or the last game). Pause, speed
 * and skip are UI state only: the season itself was simulated before the first game is shown.
 */
export function useSeasonPlayback(total: number, from: number, stopAt = total): SeasonPlayback {
  const cap = Math.min(total, stopAt)
  const [revealed, setRevealed] = useState(() => Math.min(from, cap))
  const [playing, setPlaying] = useState(() => from < cap)
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)
  useEffect(() => {
    if (!playing) return
    if (revealed >= cap) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setRevealed((r) => nextReveal(r, total, cap)), playbackDelay(speed))
    return () => clearTimeout(t)
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
    done,
  }
}

/** One game of the season, large: the latest result of the playback. */
export function GameCard({ r, opponent }: { r: QuickGameResult; opponent: Opponent }) {
  const o = outcomeOf(r)
  const scorers = scorersLabel(r.scorers)
  const chip: Record<ReturnType<typeof outcomeOf>, string> = { W: 'chip good', D: 'chip warn', L: 'chip bad' }
  return (
    <div className={`gbg-card ${o}`} data-testid="playback-latest" data-outcome={o} key={r.matchweek}>
      <div className="row between wrap">
        <span className="small muted">
          Matchweek {r.matchweek} · {r.home ? 'Home' : 'Away'}
        </span>
        <span className={chip[o]}>{o === 'W' ? 'Win' : o === 'D' ? 'Draw' : 'Defeat'}</span>
      </div>
      <div className="gbg-card-main">
        <ClubBadge clubId={opponent.clubId} size={36} />
        <span className="gbg-card-opp">{r.home ? `v ${opponent.name}` : `at ${opponent.name}`}</span>
        <span className="gbg-card-score">
          {r.gf}-{r.ga}
        </span>
      </div>
      <div className="row between wrap small">
        <span className="muted">{scorers || 'No goals for you'}</span>
        <span>{ordinal(r.position)} in the table</span>
      </div>
    </div>
  )
}

export interface Opponent {
  /** The club whose badge and colours stand for the opponent. */
  clubId: string
  name: string
}

/** The running P W D L GF GA strip and the position after the last game counted. */
export function RunningStrip({ results, upTo }: { results: QuickGameResult[]; upTo: number }) {
  const t = foldResults(results, upTo)
  return (
    <div className="gbg-strip mono" data-testid="running-strip" aria-live="polite">
      <span>
        <b>P</b> {t.played}
      </span>
      <span className="w">
        <b>W</b> {t.won}
      </span>
      <span className="d">
        <b>D</b> {t.drawn}
      </span>
      <span className="l">
        <b>L</b> {t.lost}
      </span>
      <span>
        <b>GF</b> {t.goalsFor}
      </span>
      <span>
        <b>GA</b> {t.goalsAgainst}
      </span>
      <span>
        <b>Pts</b> {t.points}
      </span>
      <span className="pos">{t.played ? ordinal(t.position) : '—'}</span>
    </div>
  )
}

export function GameByGame({ results, opponent, replay, title = 'Season, game by game', compact = false, strip = true }: { results: QuickGameResult[]; opponent: (teamId: string) => Opponent; replay?: SeasonReplay; title?: string; compact?: boolean; /** Off where the screen shows its own running strip. */ strip?: boolean }) {
  const revealed = replay ? replay.revealed : results.length
  const playing = replay?.playing ?? false
  const lastRef = useRef<HTMLLIElement | null>(null)
  const listRef = useRef<HTMLOListElement | null>(null)
  useEffect(() => {
    // A compact list scrolls inside itself, so the page never jumps under the reader; a full list brings the new game into view
    if (compact) {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
    } else if (playing && lastRef.current) lastRef.current.scrollIntoView({ block: 'nearest' })
  }, [playing, revealed, compact])
  const outcomeChip: Record<ReturnType<typeof outcomeOf>, string> = { W: 'chip good', D: 'chip warn', L: 'chip bad' }
  return (
    <div className={`panel gbg ${compact ? 'compact' : ''}`} data-testid="game-by-game">
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="small muted">{revealed < results.length ? `${revealed} of ${results.length}` : `${results.length} games`}</span>
      </div>
      {replay?.canReplay && (
        <div className="row between wrap" style={{ marginBottom: 8 }}>
          {playing ? (
            <button className="btn sm" onClick={replay.skip} data-testid="replay-skip">
              Skip
            </button>
          ) : (
            <button className="btn sm primary" onClick={replay.start} data-testid="replay-play">
              {replay.used ? 'Play the season again' : 'Play the season'}
            </button>
          )}
          <span className="small muted">{playing ? `Matchweek ${revealed} of ${results.length}` : 'One game every fifth of a second.'}</span>
        </div>
      )}
      {strip && <RunningStrip results={results} upTo={revealed} />}
      <ol className="gbg-list" aria-label={title} ref={listRef}>
        {results.slice(0, revealed).map((r, i) => {
          const opp = opponent(r.opponentId)
          const o = outcomeOf(r)
          const scorers = scorersLabel(r.scorers)
          return (
            <li key={r.matchweek} className={`gbg-game ${o}`} data-testid="gbg-game" data-outcome={o} ref={i === revealed - 1 ? lastRef : undefined}>
              <span className="gbg-mw">MW {r.matchweek}</span>
              <ClubBadge clubId={opp.clubId} size={22} />
              <span className="gbg-fix">{r.home ? `v ${opp.name} (H)` : `at ${opp.name}`}</span>
              <span className="gbg-score">
                {r.gf}-{r.ga}
              </span>
              <span className={outcomeChip[o]}>{o}</span>
              <span className="gbg-pos" title="League position after this matchweek">
                {ordinal(r.position)}
              </span>
              {scorers && <span className="gbg-scorers small muted">{scorers}</span>}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
