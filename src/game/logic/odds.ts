import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng, type RngState } from '@engine/rng'
import { pairingExpectation, type MatchTeamInput } from '@engine/match'
import { aiRatingOffset, aiTeamInput, buildAiClubs, USER_TEAM } from '@engine/season'
import { computeTeamStrength } from '@engine/ratings'
import { playerLookup } from './players'
import { quickUserInput, quickXI } from './quick'

/** How many seasons the pre-season odds sample. */
export const ODDS_SEASONS = 2000
/** Seasons sampled per step when the odds are worked out a slice at a time (the UI runs one step per idle moment). */
export const ODDS_STEP = 250
/** Places that count as a top-four, top-six and top-ten finish; the bottom three go down. */
export const ODDS_RELEGATED = 3

/** One league fixture as the odds see it: who plays whom, at whose ground, and the goals each side is expected to score. */
export interface OddsPairing {
  home: number
  away: number
  lamH: number
  lamA: number
  sigmaH: number
  sigmaA: number
}

/** The league the odds sample: every club (the user first) and every home-and-away fixture. */
export interface OddsLeague {
  ids: string[]
  pairings: OddsPairing[]
}

/** The pre-season odds of the user's side: where it should finish, its points, and its chances, each 0 to 1. */
export interface PreSeasonOdds {
  seasons: number
  teams: number
  /** The median finishing place. */
  projectedFinish: number
  /** The mean points total, rounded. */
  expectedPoints: number
  title: number
  top4: number
  top6: number
  top10: number
  relegation: number
  /** How many sampled seasons ended in each place, 1st first. */
  finishes: number[]
}

/** The squad's unit ratings for the breakdown bars: the XI as the season kicks off, with the manager's tactics. */
export interface SquadBreakdown {
  overall: number
  attack: number
  midfield: number
  defence: number
  goalkeeping: number
}

/**
 * The league of the quick season about to kick off: the drafted XI with the manager's tactics and captain against the
 * real clubs of the chosen league season, the AI handicapped as the season handicaps them. Every pairing's expected
 * goals come from the match engine's own pre-match sums (`pairingExpectation`), so the odds move with the tactics.
 * Pure: no RNG.
 */
export function oddsLeague(game: Game, u: LoadedUniverse): OddsLeague {
  const s = game.settings
  const get = playerLookup(game, u)
  const { lineup, bench } = quickXI(game, u)
  const ai = buildAiClubs(u, s.leagueId, s.leagueSeason, s.hostClubId)
  const offset = aiRatingOffset(u, ai, s.difficulty ?? 'calibrated')
  const ids = [USER_TEAM, ...Object.keys(ai)]
  const inputs: MatchTeamInput[] = ids.map((id) => (id === USER_TEAM ? quickUserInput(game, lineup, bench, game.tactics, game.captainId, get) : aiTeamInput(u, ai[id], offset)))
  const pairings: OddsPairing[] = []
  for (let h = 0; h < ids.length; h++) {
    for (let a = 0; a < ids.length; a++) {
      if (h === a) continue
      pairings.push({ home: h, away: a, ...pairingExpectation(inputs[h], inputs[a]) })
    }
  }
  return { ids, pairings }
}

/** The running count of a sample of seasons, which `sampleSeasons` adds to and `oddsFrom` reads. */
export interface OddsTally {
  seasons: number
  points: number
  finishes: number[]
}

export function emptyTally(teams: number): OddsTally {
  return { seasons: 0, points: 0, finishes: new Array<number>(teams).fill(0) }
}

/**
 * Play `n` seasons of `league` from `rng` and add them to `tally`. Each fixture draws each side's match-day variance
 * (as the engine does) and its goals from a Poisson around the expected goals; the table is sorted on points, goal
 * difference, goals scored and then the club id, as `computeTable` sorts it.
 */
export function sampleSeasons(league: OddsLeague, rng: Rng, n: number, tally: OddsTally): OddsTally {
  const teams = league.ids.length
  const pts = new Float64Array(teams)
  const gd = new Float64Array(teams)
  const gf = new Float64Array(teams)
  const order = league.ids.map((_, i) => i)
  const cmp = (x: number, y: number) => pts[y] - pts[x] || gd[y] - gd[x] || gf[y] - gf[x] || league.ids[x].localeCompare(league.ids[y])
  for (let k = 0; k < n; k++) {
    pts.fill(0)
    gd.fill(0)
    gf.fill(0)
    for (const p of league.pairings) {
      const h = rng.poisson(clamp(p.lamH * Math.exp(rng.gaussian(0, p.sigmaH)), 0.12, 5.8))
      const a = rng.poisson(clamp(p.lamA * Math.exp(rng.gaussian(0, p.sigmaA)), 0.12, 5.8))
      gf[p.home] += h
      gf[p.away] += a
      gd[p.home] += h - a
      gd[p.away] += a - h
      if (h > a) pts[p.home] += 3
      else if (a > h) pts[p.away] += 3
      else {
        pts[p.home]++
        pts[p.away]++
      }
    }
    order.sort(cmp)
    tally.finishes[order.indexOf(0)]++
    tally.points += pts[0]
    tally.seasons++
  }
  return tally
}

/** The odds a tally gives. */
export function oddsFrom(tally: OddsTally): PreSeasonOdds {
  const n = Math.max(1, tally.seasons)
  const teams = tally.finishes.length
  const upTo = (place: number) => tally.finishes.slice(0, Math.min(place, teams)).reduce((a, b) => a + b, 0) / n
  let median = teams
  let seen = 0
  for (let i = 0; i < teams; i++) {
    seen += tally.finishes[i]
    if (seen * 2 >= tally.seasons) {
      median = i + 1
      break
    }
  }
  return {
    seasons: tally.seasons,
    teams,
    projectedFinish: median,
    expectedPoints: Math.round(tally.points / n),
    title: upTo(1),
    top4: upTo(4),
    top6: upTo(6),
    top10: upTo(10),
    relegation: tally.finishes.slice(Math.max(0, teams - ODDS_RELEGATED)).reduce((a, b) => a + b, 0) / n,
    finishes: [...tally.finishes],
  }
}

/**
 * The stream the odds draw from: a fork of a copy of the state the season will kick off from, so the same squad and
 * tactics always show the same odds and the season itself never moves.
 */
export function oddsRng(game: Game): Rng {
  const from: RngState = game.quickStartRng ?? game.rngState
  return Rng.fromState(from).fork('pre-season-odds')
}

/** The pre-season odds in one go: `seasons` sampled seasons of the league about to kick off. Pure: `game` is untouched. */
export function preSeasonOdds(game: Game, u: LoadedUniverse, seasons = ODDS_SEASONS): PreSeasonOdds {
  const league = oddsLeague(game, u)
  return oddsFrom(sampleSeasons(league, oddsRng(game), seasons, emptyTally(league.ids.length)))
}

/**
 * What the odds depend on: the game, the season's start state, the XI, the tactics and captain, the league and the draft
 * rules (which decide the ratings each pick plays at). Equal keys, equal odds.
 */
export function oddsKey(game: Game): string {
  const s = game.settings
  return JSON.stringify([game.id, game.quickStartRng ?? game.rngState, game.lineup, game.bench, game.tactics, game.captainId ?? null, s.leagueId, s.leagueSeason, s.hostClubId, s.difficulty ?? 'calibrated', s.rules])
}

/** The XI's unit ratings for the breakdown, as the season will field it. Pure. */
export function squadBreakdown(game: Game, u: LoadedUniverse): SquadBreakdown {
  const { lineup } = quickXI(game, u)
  const t = computeTeamStrength(game.tactics, lineup, playerLookup(game, u), () => undefined)
  return { overall: t.overall, attack: t.attack, midfield: t.midfield, defence: t.defence, goalkeeping: t.goalkeeping }
}

/** A chance as the panel prints it: "52.6%", "<0.1%" for a sliver, "0%" and "100%" only when it never or always happened. */
export function chanceLabel(p: number): string {
  if (p <= 0) return '0%'
  if (p >= 1) return '100%'
  if (p < 0.001) return '<0.1%'
  if (p > 0.999) return '>99.9%'
  return `${(Math.round(p * 1000) / 10).toFixed(1)}%`
}

/** Where a breakdown bar fills to, 0 to 1: a 50 rating is empty, a 95 full. */
export function barFill(rating: number): number {
  return clamp((rating - 50) / 45, 0, 1)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
