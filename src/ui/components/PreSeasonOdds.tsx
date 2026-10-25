import { useEffect, useState, type ReactNode } from 'react'
import type { Game } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import type { Rng } from '@engine/rng'
import { barFill, chanceLabel, emptyTally, ODDS_SEASONS, ODDS_STEP, oddsFrom, oddsKey, oddsLeague, oddsRng, sampleSeasons, squadBreakdown, type OddsLeague, type OddsTally, type PreSeasonOdds } from '@game/logic/odds'
import { ordinal, seasonLabel } from '../format'

/** Odds already worked out this visit, by what they depend on: going back to a squad shows its odds at once. */
const cache = new Map<string, PreSeasonOdds>()
const CACHE_MAX = 24

type Cancel = () => void

/** Run `fn` when the browser is idle (or on the next turn where it cannot say), so sampling never blocks a frame for long. */
function whenIdle(fn: () => void, delay = 0): Cancel {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
  let idle: number | null = null
  const t = window.setTimeout(() => {
    if (w.requestIdleCallback) idle = w.requestIdleCallback(fn, { timeout: 250 })
    else fn()
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
    const step = () => {
      if (!league || !rng || !tally) {
        league = oddsLeague(game, u)
        rng = oddsRng(game)
        tally = emptyTally(league.ids.length)
      } else sampleSeasons(league, rng, ODDS_STEP, tally)
      if (tally.seasons >= ODDS_SEASONS) {
        const odds = oddsFrom(tally)
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
        cache.set(key, odds)
        setState({ key, odds, progress: 1 })
      } else {
        setState({ key, odds: null, progress: tally.seasons / ODDS_SEASONS })
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
        { key: 'title', label: 'Win the league', value: odds.title },
        { key: 'top4', label: 'Finish top 4', value: odds.top4 },
        { key: 'top6', label: 'Finish top 6', value: odds.top6 },
        { key: 'top10', label: 'Finish top 10', value: odds.top10 },
        { key: 'releg', label: 'Go down', value: odds.relegation, bad: true },
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
        The pundits' call, from {ODDS_SEASONS.toLocaleString('en-GB')} trial runs of this XI against {game.settings.mode === 'quick' ? 'this' : `the ${seasonLabel(game.settings.leagueSeason)}`} league. The real season is played once.
      </p>
      {children}
    </div>
  )
}
