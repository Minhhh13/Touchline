import { useEffect, useState, type ReactNode } from 'react'
import type { Game } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import type { Rng } from '@engine/rng'
import { barFill, chanceLabel, emptyTally, ODDS_SEASONS, ODDS_STEP, oddsFrom, oddsKey, oddsLeague, oddsRng, sampleSeasons, squadBreakdown, type OddsLeague, type OddsTally, type PreSeasonOdds } from '@game/logic/odds'
import { ordinal, seasonLabel } from '../format'
import { isSuperLeague, SUPER_LEAGUE_LINE } from '@game/logic/superLeague'

/** Odds already worked out this visit, by what they depend on: going back to a squad shows its odds at once. */
const cache = new Map<string, PreSeasonOdds>()
const CACHE_MAX = 24

type Cancel = () => void

/**
 * Seasons sampled between two checks of the clock, and the main-thread time one idle slice may take. A 4x-throttled
 * phone samples about one season a millisecond, so a slice stays well under a frame and never shows as a long task;
 * a slice runs to the end of the browser's idle period when it says how long that is. The partition never changes the
 * odds: `sampleSeasons` over any split of the 2,000 seasons draws the same stream (odds.test.ts).
 */
const ODDS_BATCH = 5
const SLICE_MS = 12

/** Run `fn` when the browser is idle (or on the next turn where it cannot say), with the time it may take, so sampling never blocks a frame for long. */
function whenIdle(fn: (budgetMs: number) => void, delay = 0): Cancel {
  const w = window as Window & { requestIdleCallback?: (cb: (d: { timeRemaining: () => number }) => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
  let idle: number | null = null
  const t = window.setTimeout(() => {
    if (w.requestIdleCallback) idle = w.requestIdleCallback((d) => fn(Math.max(SLICE_MS, Math.min(d.timeRemaining(), 30))), { timeout: 250 })
    else fn(SLICE_MS)
  }, delay)
  return () => {
    window.clearTimeout(t)
    if (idle !== null) w.cancelIdleCallback?.(idle)
  }
}

/**
 * The pre-season odds of the squad on show, sampled a slice at a time in idle moments and cached by `oddsKey`. Null
 * while they are being worked out; a change of tactics starts again after a short pause, so a run of taps samples once.
 * Display only: the odds never feed the season.
 */
export function usePreSeasonOdds(game: Game | null, u: LoadedUniverse | null): { odds: PreSeasonOdds | null; progress: number } {
  const key = game && u ? oddsKey(game) : ''
  const [state, setState] = useState<{ key: string; odds: PreSeasonOdds | null; progress: number }>(() => ({ key, odds: cache.get(key) ?? null, progress: cache.has(key) ? 1 : 0 }))
  useEffect(() => {
    if (!game || !u) return
    const hit = cache.get(key)
    if (hit) {
      setState({ key, odds: hit, progress: 1 })
      return
    }
    setState({ key, odds: null, progress: 0 })
    let league: OddsLeague | null = null
    let rng: Rng | null = null
    let tally: OddsTally | null = null
    let cancel: Cancel = () => {}
    let shown = 0
    const step = (budgetMs: number) => {
      if (!league || !rng || !tally) {
        league = oddsLeague(game, u)
        rng = oddsRng(game)
        tally = emptyTally(league.ids.length)
      } else {
        const until = performance.now() + budgetMs
        while (tally.seasons < ODDS_SEASONS && performance.now() < until) sampleSeasons(league, rng, Math.min(ODDS_BATCH, ODDS_SEASONS - tally.seasons), tally)
      }
      if (tally.seasons >= ODDS_SEASONS) {
        const odds = oddsFrom(tally)
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
        cache.set(key, odds)
        setState({ key, odds, progress: 1 })
      } else {
        // The percentage moves in whole steps of ODDS_STEP seasons, so the panel re-renders a handful of times, not every slice
        const progress = Math.floor(tally.seasons / ODDS_STEP) * ODDS_STEP
        if (progress !== shown) {
          shown = progress
          setState({ key, odds: null, progress: progress / ODDS_SEASONS })
        }
        cancel = whenIdle(step)
      }
    }
    cancel = whenIdle(step, 180)
    return () => cancel()
    // The key holds everything the odds depend on; the game object itself changes identity on every store write
  }, [key, u])
  return state.key === key ? { odds: state.odds, progress: state.progress } : { odds: cache.get(key) ?? null, progress: cache.has(key) ? 1 : 0 }
}

/**
 * The "Squad complete" panel before a quick season: the pre-season odds (projected finish, expected points, the chance
 * of the title, a top-four, top-six and top-ten finish, and of going down) and the XI's unit ratings as bars. With the
 * ratings hidden the bars show without their numbers.
 */
export function SquadComplete({ game, u, hideRatings, children }: { game: Game; u: LoadedUniverse; hideRatings: boolean; children?: ReactNode }) {
  const { odds, progress } = usePreSeasonOdds(game, u)
  const b = squadBreakdown(game, u)
  const superLeague = isSuperLeague(game.settings)
  const units: Array<{ key: string; label: string; value: number }> = [
    { key: 'overall', label: 'Overall', value: b.overall },
    { key: 'attack', label: 'Attack', value: b.attack },
    { key: 'midfield', label: 'Midfield', value: b.midfield },
    { key: 'defence', label: 'Defence', value: b.defence },
    { key: 'gk', label: 'Goalkeeper', value: b.goalkeeping },
  ]
  const chances: Array<{ key: string; label: string; value: number; bad?: boolean }> = odds
    ? [
        { key: 'perfect', label: 'Win every game', value: odds.perfect },
        { key: 'unbeaten', label: 'Go unbeaten', value: odds.unbeaten },
        { key: 'title', label: superLeague ? 'Win the Super League' : 'Win the league', value: odds.title },
        { key: 'top4', label: 'Finish top 4', value: odds.top4 },
        { key: 'top6', label: 'Finish top 6', value: odds.top6 },
        { key: 'top10', label: 'Finish top 10', value: odds.top10 },
        { key: 'releg', label: superLeague ? 'Finish bottom three' : 'Go down', value: odds.relegation, bad: true },
      ]
    : []
  return (
    <div className="panel col squad-complete" data-testid="squad-complete">
      <div className="sc-head">
        <span className="sc-kicker">Before a ball is kicked</span>
        <h2>Pundits' prediction</h2>
      </div>
      <div className="sc-grid">
        <div className="col" style={{ gap: 10 }}>
          <div className="sc-big">
            <div className="sc-big-box" data-testid="odds-finish">
              <span className="sc-big-num">{odds ? ordinal(odds.projectedFinish) : '…'}</span>
              <span className="tally-label">Projected finish</span>
            </div>
            <div className="sc-big-box" data-testid="odds-points">
              <span className="sc-big-num">{odds ? odds.expectedPoints : '…'}</span>
              <span className="tally-label">Expected points</span>
            </div>
          </div>
          {odds ? (
            <div className="sc-chances" data-testid="odds-chances">
              {chances.map((c) => (
                <div key={c.key} className={`sc-chance ${c.bad ? 'bad' : ''}`} data-testid={`odds-${c.key}`}>
                  <span>{c.label}</span>
                  <div className="bar">
                    <span style={{ width: `${Math.round(c.value * 100)}%` }} />
                  </div>
                  <b>{chanceLabel(c.value)}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="sc-working small muted" data-testid="odds-working" aria-live="polite">
              Playing out {ODDS_SEASONS.toLocaleString('en-GB')} seasons… {Math.round(progress * 100)}%
            </div>
          )}
        </div>
        <div className="sc-units" data-testid="squad-breakdown">
          {units.map((x) => (
            <div key={x.key} className={`sc-unit ${x.key === 'overall' ? 'overall' : ''}`} data-testid={`unit-${x.key}`}>
              <span>{x.label}</span>
              <div className={`bar ${x.key === 'overall' ? 'thick' : ''}`}>
                <span style={{ width: `${Math.round(barFill(x.value) * 100)}%` }} />
              </div>
              <b>{hideRatings ? '' : Math.round(x.value)}</b>
            </div>
          ))}
        </div>
      </div>
      <p className="help" style={{ margin: 0 }}>
        The pundits' call, from {ODDS_SEASONS.toLocaleString('en-GB')} trial runs of this XI against {superLeague ? `the Super League: ${SUPER_LEAGUE_LINE.toLowerCase()}` : game.settings.mode === 'quick' ? 'this league' : `the ${seasonLabel(game.settings.leagueSeason)} league`}. The real season is played once.
      </p>
      {children}
    </div>
  )
}
