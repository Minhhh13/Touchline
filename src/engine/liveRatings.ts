/**
 * Match ratings and condition as the match goes, for the match-day dashboard.
 *
 * In play the rating is the engine's own formula (`playerStats` in match.ts)
 * worked out on the events so far, without its noise term (the noise is drawn
 * only by `finishMatch`). A finished match leans each man's line towards the
 * engine's final rating as his minutes pass, so at his last minute it shows
 * exactly the report's number.
 */
import type { MatchFeed, FeedAppearance } from './matchFeed'
import type { MatchEvent, PlayerSeason } from './types'

const DEFENSIVE = new Set(['GK', 'CB', 'LB', 'RB', 'DM'])

interface Tally {
  goals: number
  assists: number
  saves: number
  yellow: boolean
  red: boolean
}

function tallyFor(events: MatchEvent[], side: 'home' | 'away', psId: string, minute: number): Tally {
  const t: Tally = { goals: 0, assists: 0, saves: 0, yellow: false, red: false }
  for (const e of events) {
    if (e.minute > minute) continue
    if (e.side === side) {
      if ((e.type === 'goal' || e.type === 'penalty') && e.playerId === psId) t.goals++
      if (e.type === 'goal' && e.secondaryId === psId) t.assists++
      if (e.type === 'yellow' && e.playerId === psId) t.yellow = true
      if (e.type === 'red' && e.playerId === psId) t.red = true
    } else if (e.type === 'save' && e.secondaryId === psId) t.saves++
  }
  return t
}

function goalsAt(events: MatchEvent[], minute: number): { home: number; away: number } {
  const s = { home: 0, away: 0 }
  for (const e of events) if (e.minute <= minute && (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal')) s[e.side]++
  return s
}

/** The last minute a man is on the pitch: when he went off, or the end of the match for a man who saw it out. */
function lastMinuteOf(feed: MatchFeed, a: FeedAppearance): number {
  return a.red || a.offAt < 90 ? a.offAt : feed.lastMinute
}

/** Minutes played by `minute`, as the engine counts them (the ninety at most). */
function playedBy(a: FeedAppearance, minute: number): number {
  return Math.max(0, Math.min(minute, a.offAt, 90) - a.onAt)
}

/** The engine's rating formula at `minute`, unrounded and without noise; `quality` adds the effective-rating term. */
function formula(feed: MatchFeed, side: 'home' | 'away', a: FeedAppearance, minute: number, quality: boolean): number {
  const score = goalsAt(feed.events, minute)
  const gf = side === 'home' ? score.home : score.away
  const ga = side === 'home' ? score.away : score.home
  const t = tallyFor(feed.events, side, a.psId, minute)
  const played = playedBy(a, minute)
  let r = 6.6 + clamp((gf - ga) * 0.22, -0.8, 0.8)
  r += t.goals * 0.9 + t.assists * 0.5
  if (DEFENSIVE.has(a.position)) r += ga === 0 ? 0.5 * Math.min(1, played / 90) : -Math.min(0.6, ga * 0.14)
  if (a.position === 'GK') r += Math.min(0.9, t.saves * 0.12) + (ga >= 3 ? -0.3 : 0)
  if (quality && a.effective !== undefined) r += ((a.effective - 75) / 100) * 1.2
  if (t.red) r -= 1.2
  else if (t.yellow) r -= 0.15
  // Damped as the engine damps a short appearance: a substitute under thirty minutes, or anyone whose match ended inside thirty
  const ended = minute >= lastMinuteOf(feed, a)
  if (!t.red && played < 30 && (a.onAt > 0 || ended)) r = 6.4 + (r - 6.6) * 0.5
  return r
}

/** Ratings at a minute: every man who has played by then (never before he comes on), one decimal. */
export function ratingsAt(feed: MatchFeed, minute: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const side of ['home', 'away'] as const) {
    const finals = new Map((feed.finalStats?.[side] ?? []).map((s) => [s.playerSeasonId, s.rating]))
    for (const a of (side === 'home' ? feed.home : feed.away).appearances) {
      if (a.onAt >= minute) continue
      const final = finals.get(a.psId)
      let r: number
      if (final !== undefined) {
        const last = lastMinuteOf(feed, a)
        if (minute >= last) r = final
        else {
          const w = last > a.onAt ? clamp((minute - a.onAt) / (last - a.onAt), 0, 1) : 1
          r = formula(feed, side, a, minute, false) + w * (final - formula(feed, side, a, last, false))
        }
      } else r = formula(feed, side, a, minute, true)
      out[a.psId] = Math.round(clamp(r, 4.5, 10) * 10) / 10
    }
  }
  return out
}

/**
 * Condition at a minute: what he started with, less the engine's condition
 * loss for the minutes played so far (equal to it at the whistle).
 */
export function liveCondition(feed: MatchFeed, side: 'home' | 'away', psId: string, minute: number, startCondition: number, getPlayer: (id: string) => PlayerSeason | undefined): number {
  const s = side === 'home' ? feed.home : feed.away
  const a = s.appearances.find((x) => x.psId === psId)
  const ps = getPlayer(psId)
  if (!a || !ps) return startCondition
  const played = Math.min(90, Math.max(0, Math.min(minute, a.offAt) - a.onAt))
  const base = 26 + s.modifiers.fatigue + (ps.age >= 33 ? 5 : ps.age >= 30 ? 2 : 0) + (100 - ps.attributes.physical) / 10 + (s.tactics.tempo === 'fast' ? 2 : 0)
  return startCondition - Math.round((base * played) / 90)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
