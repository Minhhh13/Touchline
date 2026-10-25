/**
 * Team stats minute by minute for the match-day dashboard.
 *
 * Shots, shots on target and cards are exactly the log. Expected goals are
 * worked out per attempt from the engine's own shot positions. Possession and
 * territory come from the momentum series. Passes, tackles, fouls, corners,
 * offsides and distance covered are modelled per minute from the tactics in
 * force, the share of the ball and the men on the pitch, from a stream keyed by
 * the match and the minute, never the game's generator, so a minute's numbers
 * depend only on that minute: a change at minute k leaves every minute up to k
 * exactly as it was shown.
 */
import { Rng } from './rng'
import { binOf } from './matchDetail'
import { addedTime as feedAddedTime, playedMinute, tacticsAt, type FeedAppearance, type MatchFeed } from './matchFeed'
import type { MatchEvent, PlayerSeason, Tactics } from './types'

export interface TeamStatLine {
  shots: number
  onTarget: number
  xg: number
  /** Per cent; home and away add up to 100. */
  possession: number
  territory: number
  passes: number
  passesCompleted: number
  passPct: number
  distanceKm: number
  tackles: number
  fouls: number
  corners: number
  offsides: number
  yellows: number
  reds: number
}

/** Cumulative lines, index = minute 0..feed.lastMinute. */
export interface StatsSeries {
  home: TeamStatLine[]
  away: TeamStatLine[]
}

export interface XgStep {
  minute: number
  side: 'home' | 'away'
  xg: number
  cumulative: number
  goal: boolean
  playerId?: string
  playerName?: string
}

/**
 * Scales the shot-quality curve to the engine's conversion. Fitted on 400
 * seeded full-detail matches (seed 'xg-calibration'): the mean expected goals
 * of a side's attempts matches its mean goals (own goals aside).
 */
export const XG_KAPPA = 1.55

/** What an attempt logged without a position (an older save) is worth: the engine's mean conversion of a logged attempt. */
export const XG_NO_POSITION = 0.31
export const XG_PENALTY = 0.76

const ATTEMPTS = new Set<MatchEvent['type']>(['goal', 'penalty', 'chance', 'save'])
const ON_TARGET = new Set<MatchEvent['type']>(['goal', 'penalty', 'save'])

export const addedTime = feedAddedTime

/** Is this event an attempt on goal by its side (own goals are not)? */
export function isAttempt(e: MatchEvent): boolean {
  return ATTEMPTS.has(e.type)
}

/** The shot-quality curve before scaling: distance and the angle the goal mouth subtends, a header worth less. */
export function shotQuality(e: Pick<MatchEvent, 'type' | 'text' | 'position'>): number {
  if (!e.position) return 0
  const dx = (100 - e.position.x) * 1.05
  const dy = Math.abs(e.position.y - 50) * 0.68
  const d = Math.hypot(dx, dy)
  let theta = Math.atan2(7.32 * dx, dx * dx + dy * dy - 3.66 * 3.66)
  if (theta < 0) theta += Math.PI
  let q = 1 / (1 + Math.exp(1.1 + 0.11 * d - 1.6 * theta))
  if (e.text.toLowerCase().includes('head')) q *= 0.65
  return q
}

/** Expected goals of one logged event: a penalty 0.76, an own goal nothing, an attempt from where it was taken. */
export function shotXg(e: MatchEvent): number {
  if (e.type === 'penalty') return XG_PENALTY
  if (!ATTEMPTS.has(e.type)) return 0
  if (!e.position) return XG_NO_POSITION
  return Math.min(0.92, XG_KAPPA * shotQuality(e))
}

/** Every attempt as a step of cumulative expected goals, and the running total at every minute 0..lastMinute. */
export function xgStory(feed: MatchFeed): { home: XgStep[]; away: XgStep[]; perMinute: { home: number[]; away: number[] } } {
  const steps = { home: [] as XgStep[], away: [] as XgStep[] }
  const total = { home: 0, away: 0 }
  for (const e of feed.events) {
    if (!ATTEMPTS.has(e.type)) continue
    const xg = shotXg(e)
    total[e.side] += xg
    steps[e.side].push({ minute: e.minute, side: e.side, xg, cumulative: total[e.side], goal: e.type === 'goal' || e.type === 'penalty', playerId: e.playerId, playerName: e.playerName })
  }
  const perMinute = { home: [] as number[], away: [] as number[] }
  for (const side of ['home', 'away'] as const) {
    let i = 0
    let acc = 0
    for (let m = 0; m <= feed.lastMinute; m++) {
      while (i < steps[side].length && steps[side][i].minute <= m) acc = steps[side][i++].cumulative
      perMinute[side].push(acc)
    }
  }
  return { ...steps, perMinute }
}

const passBonus = (t: Tactics) => (t.passing === 'short' ? 4 : t.passing === 'direct' ? -4 : 0)

/** The home side's share of the ball before the run of play: the engine's possession formula without its noise, 28..72. */
export function possessionBase(feed: MatchFeed, minute: number): number {
  const h = tacticsAt(feed, 'home', minute)
  const a = tacticsAt(feed, 'away', minute)
  return clamp(50 + (feed.home.strength.midfield - feed.away.strength.midfield) * 1.1 + passBonus(h) - passBonus(a) + (feed.neutral ? 0 : 2), 28, 72)
}

/** The home side's pressure in a minute's bin (0.5 where no bin exists yet). */
function muAt(feed: MatchFeed, m: number): number {
  return feed.momentum[binOf(m)] ?? 0.5
}

/** The home side's share of the ball in minute m, 0.2..0.8. */
export function homeShareAt(feed: MatchFeed, m: number): number {
  return clamp(possessionBase(feed, m) + 35 * (muAt(feed, m) - 0.5), 20, 80) / 100
}

/** A depth attribute (stamina, work rate, aggression) when the data carries it. */
export function depthAttr(ps: PlayerSeason, key: 'stamina' | 'workRate' | 'aggression'): number | undefined {
  const v = (ps.attributes as unknown as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : undefined
}

const zero = (): TeamStatLine => ({ shots: 0, onTarget: 0, xg: 0, possession: 50, territory: 50, passes: 0, passesCompleted: 0, passPct: 0, distanceKm: 0, tackles: 0, fouls: 0, corners: 0, offsides: 0, yellows: 0, reds: 0 })

function mean(xs: number[], fallback: number): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback
}

/**
 * Both sides' lines minute by minute, cumulative, from kick-off (index 0, all
 * zeros) to `feed.lastMinute`.
 */
export function statsSeries(feed: MatchFeed, getPlayer: (id: string) => PlayerSeason | undefined): StatsSeries {
  const out: StatsSeries = { home: [zero()], away: [zero()] }
  const byMinute = new Map<number, MatchEvent[]>()
  for (const e of feed.events) {
    const list = byMinute.get(e.minute) ?? []
    list.push(e)
    byMinute.set(e.minute, list)
  }
  const run = { home: zero(), away: zero() }
  let shareSum = 0
  let muSum = 0
  let muMinutes = 0
  const derby = feed.importance >= 1.2 ? 1.15 : 1
  for (let m = 1; m <= feed.lastMinute; m++) {
    const rng = new Rng(`stats-${feed.key}-${m}`)
    const evs = byMinute.get(m) ?? []
    const pHome = homeShareAt(feed, m)
    const mu = muAt(feed, m)
    shareSum += pHome
    if (m <= 90) {
      muSum += mu
      muMinutes++
    }
    const t = { home: tacticsAt(feed, 'home', m), away: tacticsAt(feed, 'away', m) }
    const men = {
      home: feed.home.appearances.filter((p) => playedMinute(feed.home.appearances, p, m)),
      away: feed.away.appearances.filter((p) => playedMinute(feed.away.appearances, p, m)),
    }
    for (const side of ['home', 'away'] as const) {
      const opp = side === 'home' ? 'away' : 'home'
      const line = run[side]
      const own = t[side]
      const theirs = t[opp]
      const share = side === 'home' ? pHome : 1 - pHome
      const muSide = side === 'home' ? mu : 1 - mu
      const outfield = men[side].filter((p) => p.position !== 'GK').map((p) => getPlayer(p.psId)).filter((p): p is PlayerSeason => !!p)

      // Log-exact counts
      for (const e of evs) {
        if (e.side !== side) continue
        if (ATTEMPTS.has(e.type)) {
          line.shots++
          if (ON_TARGET.has(e.type)) line.onTarget++
          line.xg += shotXg(e)
        }
        if (e.type === 'yellow') line.yellows++
        if (e.type === 'red') line.reds++
      }

      // Passes
      const tempoP = own.tempo === 'slow' ? 1.12 : own.tempo === 'fast' ? 0.9 : 1
      const passingP = own.passing === 'short' ? 1.15 : own.passing === 'direct' ? 0.8 : 1
      const passes = rng.poisson(10.4 * share * tempoP * passingP)
      const passAttr = mean(outfield.map((p) => p.attributes.passing), 72)
      const pComplete = clamp(0.8 + (passAttr - 72) * 0.006 + (own.passing === 'short' ? 0.04 : own.passing === 'direct' ? -0.07 : 0) + (own.tempo === 'slow' ? 0.015 : own.tempo === 'fast' ? -0.025 : 0) - (theirs.pressing === 'high' ? 0.03 : theirs.pressing === 'low' ? -0.02 : 0), 0.55, 0.94)
      let completed = 0
      for (let i = 0; i < passes; i++) if (rng.chance(pComplete)) completed++
      line.passes += passes
      line.passesCompleted += completed

      // Tackles
      const pressT = own.pressing === 'high' ? 1.3 : own.pressing === 'low' ? 0.78 : 1
      const defAttr = mean(outfield.map((p) => p.attributes.defending), 65)
      line.tackles += rng.poisson(0.2 * ((1 - share) / 0.5) * pressT * clamp(0.85 + (defAttr - 65) * 0.006, 0.75, 1.15))

      // Fouls: one for every card and every penalty given away, plus the run of play
      const cards = evs.filter((e) => e.side === side && (e.type === 'yellow' || e.type === 'red')).length
      const pensConceded = evs.filter((e) => e.side === opp && e.type === 'penalty').length
      const pressF = own.pressing === 'high' ? 1.2 : own.pressing === 'low' ? 0.85 : 1
      const aggression = mean(
        outfield.map((p) => {
          const a = depthAttr(p, 'aggression')
          return a !== undefined ? 0.7 + (0.6 * a) / 100 : (1.15 - 0.3 * p.traits.professionalism) * (p.attributes.physical > 82 ? 1.1 : 1)
        }),
        1,
      )
      line.fouls += cards + pensConceded + rng.poisson(0.115 * pressF * aggression * derby * Math.sqrt(Math.max(0, 1 - share) / 0.5))

      // Corners: one for every attempt from a corner, plus the pressure
      const fromCorner = evs.filter((e) => e.side === side && ATTEMPTS.has(e.type) && e.text.toLowerCase().includes('corner')).length
      const mentC = own.mentality === 'attacking' ? 1.15 : own.mentality === 'defensive' ? 0.85 : 1
      const widthC = own.width === 'wide' ? 1.12 : own.width === 'narrow' ? 0.9 : 1
      line.corners += fromCorner + rng.poisson(0.05 * Math.pow(muSide / 0.5, 1.5) * mentC * widthC)

      // Offsides: caught by the other side's line
      const lineO = theirs.defensiveLine === 'high' ? 1.6 : theirs.defensiveLine === 'deep' ? 0.6 : 1
      const tempoO = own.tempo === 'fast' ? 1.2 : own.tempo === 'slow' ? 0.85 : 1
      const passingO = own.passing === 'direct' ? 1.15 : own.passing === 'short' ? 0.9 : 1
      line.offsides += rng.poisson(0.022 * lineO * tempoO * passingO * (muSide / 0.5))

      // Distance, man by man in appearance order
      const pressD = own.pressing === 'high' ? 1.06 : own.pressing === 'low' ? 0.96 : 1
      const tempoD = own.tempo === 'fast' ? 1.03 : own.tempo === 'slow' ? 0.98 : 1
      for (const p of men[side]) line.distanceKm += distanceFor(rng, p, getPlayer(p.psId), pressD, tempoD, m)

      line.passPct = line.passes ? Math.round((line.passesCompleted / line.passes) * 100) : 0
    }
    run.home.possession = Math.round((shareSum / m) * 1000) / 10
    run.away.possession = Math.round((100 - run.home.possession) * 10) / 10
    run.home.territory = Math.round((muSum / Math.max(1, muMinutes)) * 1000) / 10
    run.away.territory = Math.round((100 - run.home.territory) * 10) / 10
    out.home.push({ ...run.home, xg: round2(run.home.xg), distanceKm: round1(run.home.distanceKm) })
    out.away.push({ ...run.away, xg: round2(run.away.xg), distanceKm: round1(run.away.distanceKm) })
  }
  return out
}

function distanceFor(rng: Rng, p: FeedAppearance, ps: PlayerSeason | undefined, pressD: number, tempoD: number, m: number): number {
  if (p.position === 'GK') return 0.055
  const wr = ps ? depthAttr(ps, 'workRate') : undefined
  const workRate = clamp(wr !== undefined ? 0.9 + (wr - 65) * 0.004 : 0.92 + ((ps?.attributes.mentality ?? 70) - 70) * 0.004, 0.85, 1.12)
  const stamina = ps ? (depthAttr(ps, 'stamina') ?? ps.attributes.physical) : 70
  const fade = m <= 60 ? 1 : 1 - (1 - stamina / 100) * 0.14 * Math.min(1, (m - 60) / 30)
  return 0.113 * workRate * pressD * tempoD * fade * (1 + rng.gaussian(0, 0.03))
}

/** The lines as they stand after minute `minute` (clamped to the series). */
export function statsAt(series: StatsSeries, minute: number): { home: TeamStatLine; away: TeamStatLine } {
  const i = Math.max(0, Math.min(series.home.length - 1, Math.floor(minute)))
  return { home: series.home[i], away: series.away[i] }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
