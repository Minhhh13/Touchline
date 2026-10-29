/**
 * "While you were away": what happened over a run of simulated matchweeks,
 * built from a plain snapshot taken before the simulation and the game after
 * it. Pure and RNG-free; the digest is transient UI state and never saved.
 */
import type { Game } from '../types'
import type { NewsItem, Competition } from '@engine/season'
import { positionOf, seasonTable, USER_TEAM } from '@engine/season'
import { userCupMatches } from './cupMatches'
import { newsTotal } from './news'

/** Title prefix of the inbox item recording a decision the assistant took during a simulation. */
export const ASSISTANT_DECIDED = 'Assistant decided: '
/** Each grouped list in the digest shows at most this many items, then "and N more". */
export const DIGEST_GROUP_CAP = 8

/** Plain numbers read from the game before `mutate`, never an Immer draft. */
export interface DigestSnapshot {
  matchweek: number
  newsTotal: number
  position: number
  confidence: number
}

export interface DigestResult {
  matchweek: number
  comp: 'league' | Competition
  roundLabel?: string
  opponentId: string
  home: boolean
  gf: number
  ga: number
  /** A cup tie level after ninety is settled on penalties. */
  penalties?: { gf: number; ga: number }
  /** A two-legged tie's second leg: goals over both legs (engine 7). */
  aggregate?: { gf: number; ga: number }
  /** W, D or L for the league and a Continental Cup group match or first leg; for a tie's deciding match, through (W) or out (L). */
  outcome: 'W' | 'D' | 'L'
}

export interface DigestDecision {
  title: string
  choice: string
  /** What came of it, from the event's own inbox item when it followed. */
  outcome?: string
  /** The same call with the same answer and outcome more than once in the run (a weekly press question): one line, counted. */
  count?: number
}

export interface SimDigest {
  /** Last matchweek played before the simulation (0 from pre-season). */
  fromMatchweek: number
  /** Last matchweek played by the end of it. */
  toMatchweek: number
  results: DigestResult[]
  positionFrom: number
  positionTo: number
  /** League points won over the simulated matchweeks. */
  points: number
  confidenceFrom: number
  confidenceTo: number
  decisions: DigestDecision[]
  injuries: NewsItem[]
  suspensions: NewsItem[]
  transfers: NewsItem[]
  development: NewsItem[]
  /** What the manager's office posted (requests handed in, promises kept or broken, a boast settled); its transfer items stay under transfers too. */
  office: NewsItem[]
  /** Every inbox item posted during the simulation, newest first (at most the feed's cap). */
  news: NewsItem[]
  /** More items were posted than the feed keeps, so the oldest of them are gone. */
  truncated: boolean
}

/** Read the plain values the digest compares against, or null without a season. */
export function digestSnapshot(game: Game | null): DigestSnapshot | null {
  if (!game?.season) return null
  const season = game.season
  const table = seasonTable(season)
  return { matchweek: season.matchweek, newsTotal: newsTotal(game), position: positionOf(table, USER_TEAM), confidence: season.confidence }
}

/** The digest of everything between the snapshot and the game as it stands, or null when no matchweek was played. */
export function buildDigest(before: DigestSnapshot, game: Game): SimDigest | null {
  const season = game.season
  if (!season || season.matchweek <= before.matchweek) return null
  const from = before.matchweek
  const to = season.matchweek
  const inRange = (mw: number) => mw > from && mw <= to

  const results: DigestResult[] = []
  let points = 0
  for (const f of season.fixtures) {
    if (!f.result || !inRange(f.matchweek) || (f.homeTeamId !== USER_TEAM && f.awayTeamId !== USER_TEAM)) continue
    const home = f.homeTeamId === USER_TEAM
    const gf = home ? f.result.homeGoals : f.result.awayGoals
    const ga = home ? f.result.awayGoals : f.result.homeGoals
    const outcome = gf > ga ? 'W' : gf === ga ? 'D' : 'L'
    points += outcome === 'W' ? 3 : outcome === 'D' ? 1 : 0
    results.push({ matchweek: f.matchweek, comp: 'league', opponentId: home ? f.awayTeamId : f.homeTeamId, home, gf, ga, outcome })
  }
  for (const m of userCupMatches(season)) {
    if (!m.played || !inRange(m.matchweek) || !m.outcome) continue
    results.push({ matchweek: m.matchweek, comp: m.comp, roundLabel: m.label, opponentId: m.opponentId, home: m.home, gf: m.gf, ga: m.ga, ...(m.penalties ? { penalties: m.penalties } : {}), ...(m.aggregate && m.leg === 2 ? { aggregate: m.aggregate } : {}), outcome: m.outcome })
  }
  // The league match of a week comes before the midweek tie played after it
  const order = { league: 0, cup: 1, continental: 2 }
  results.sort((a, b) => a.matchweek - b.matchweek || order[a.comp] - order[b.comp])

  const added = newsTotal(game) - before.newsTotal
  const news = season.news.slice(0, Math.max(0, Math.min(added, season.news.length)))
  const decisions: DigestDecision[] = []
  news.forEach((n, i) => {
    if (n.kind !== 'event' || !n.title.startsWith(ASSISTANT_DECIDED)) return
    const title = n.title.slice(ASSISTANT_DECIDED.length)
    // The event's own item is posted after the decision (a training setback may come between them) and before
    // that week's result, so it is the nearest matching event item above the record, short of a result
    let outcome: string | undefined
    for (let j = i - 1; j >= 0 && news[j].kind !== 'result'; j--) {
      if (news[j].kind === 'event' && news[j].title === title) {
        outcome = news[j].body
        break
      }
    }
    const same = decisions.find((d) => d.title === title && d.choice === n.body && d.outcome === outcome)
    if (same) same.count = (same.count ?? 1) + 1
    else decisions.push({ title, choice: n.body, ...(outcome !== undefined ? { outcome } : {}) })
  })
  const table = seasonTable(season)
  return {
    fromMatchweek: from,
    toMatchweek: to,
    results,
    positionFrom: before.position,
    positionTo: positionOf(table, USER_TEAM),
    points,
    confidenceFrom: before.confidence,
    confidenceTo: season.confidence,
    decisions,
    injuries: news.filter((n) => n.kind === 'injury'),
    suspensions: news.filter((n) => n.kind === 'suspension'),
    transfers: news.filter((n) => n.kind === 'transfer'),
    development: news.filter((n) => n.kind === 'training'),
    office: news.filter((n) => n.office === true && n.kind !== 'transfer'),
    news,
    truncated: added > news.length,
  }
}

/** "Matchweeks 12 to 16", or "Matchweek 16" for a single week. */
export function digestTitle(d: Pick<SimDigest, 'fromMatchweek' | 'toMatchweek'>): string {
  const first = d.fromMatchweek + 1
  return first === d.toMatchweek ? `Matchweek ${d.toMatchweek}` : `Matchweeks ${first} to ${d.toMatchweek}`
}
