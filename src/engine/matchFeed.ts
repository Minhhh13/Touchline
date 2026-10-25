/**
 * One shape for a match in play and a finished one, so every match-day panel
 * has a single input: the decided events sorted for display, the momentum, the
 * timeline of instructions, both sides with everyone who has appeared, and the
 * key that names the match's decoration streams. Pure: nothing here draws.
 */
import type { Appearance, FullMatchResult, Instructions, LivePlayer, MatchInProgress, Substitution, TeamSnapshot, TimelineEntry } from './match'
import { INSTRUCTION_KEYS } from './match'
import type { TacticalModifiers } from './tactics'
import { defaultTactics } from './tactics'
import type { MatchEvent, PlayerMatchStats, Tactics, TeamStrength } from './types'

export interface FeedAppearance extends Appearance {
  /** Effective rating in role (a match in play only). */
  effective?: number
}

export interface FeedSide {
  teamId: string
  name: string
  shortName: string
  /** As it stands (in play) or at the whistle (a result). */
  tactics: Tactics
  /** Everyone the decided minutes put on the pitch (may run ahead of the clock). */
  appearances: FeedAppearance[]
  subs: Substitution[]
  /** In play: the bench at kick-off; a result: empty (not stored). */
  bench: string[]
  strength: TeamStrength
  modifiers: TacticalModifiers
  talkText: string
  halfTimeText?: string
  lateText?: string
}

export interface MatchFeed {
  key: string
  source: 'live' | 'result'
  /** The last minute the engine has decided: 45, 70 or 90 (a result: 90). */
  decidedTo: number
  /** Minutes added at the end of the second half: 0 until the last segment is decided. */
  addedTime: number
  /** `decidedTo`, or 90 plus the added time once the match is decided to the whistle. */
  lastMinute: number
  neutral: boolean
  importance: number
  importanceLabel?: string
  /** A sorted copy: by minute, kick-off first, half and full time last in their minute; the full-time whistle at `lastMinute`. */
  events: MatchEvent[]
  momentum: number[]
  /** Kick-off entries synthesised from the tactics when the match keeps none. */
  timeline: TimelineEntry[]
  xgPreMatch: { home: number; away: number }
  home: FeedSide
  away: FeedSide
  /** The engine's own player numbers (results only). */
  finalStats?: { home: PlayerMatchStats[]; away: PlayerMatchStats[] }
}

const ADDED_TIME_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal', 'substitution', 'yellow', 'red', 'injury'])
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/** Minutes added at the end: two, plus one for every three stoppages in the second half, at most six, and always enough to reach the last event. */
export function addedTime(events: MatchEvent[]): number {
  const c = events.filter((e) => ADDED_TIME_TYPES.has(e.type) && e.minute >= 46 && e.minute <= 90).length
  const n = 2 + Math.floor(c / 3)
  const last = events.filter((e) => e.type !== 'full_time').reduce((m, e) => Math.max(m, e.minute), 90)
  return Math.max(Math.min(n, 6), last - 90)
}

/** "four" for 4: the added-time board in words. */
export function minutesInWords(n: number): string {
  return NUMBER_WORDS[n] ?? String(n)
}

function order(t: MatchEvent['type']): number {
  return t === 'kickoff' ? -1 : t === 'half_time' || t === 'full_time' ? 1 : 0
}

/** A sorted copy of the log: by minute, kick-off first, the whistles last in their minute; otherwise as logged. */
export function sortEvents(events: MatchEvent[]): MatchEvent[] {
  return events.map((e, i) => ({ e, i })).sort((x, y) => x.e.minute - y.e.minute || order(x.e.type) - order(y.e.type) || x.i - y.i).map((x) => x.e)
}

function liveAppearances(live: LivePlayer[]): FeedAppearance[] {
  return live.map((p) => ({ psId: p.psId, slotId: p.slotId, position: p.position, onAt: p.onAt, offAt: p.offAt, red: p.red, injured: !!p.injury, effective: p.effective }))
}

/**
 * The timeline with both kick-off entries first (home, then away) and whole, as
 * the engine writes them: a result keeps only the kick-off instructions that
 * changed later (or no entry at all), and an older result none, so whatever is
 * missing is read off the side's final tactics, which those instructions never
 * left.
 */
function withKickOff(timeline: TimelineEntry[] | undefined, home: Tactics, away: Tactics): TimelineEntry[] {
  const all = timeline ?? []
  const kick = (side: 'home' | 'away', t: Tactics): TimelineEntry => {
    const own = all.find((e) => e.side === side && e.by === 'kickoff')
    const instructions: Partial<Instructions> = {}
    for (const k of INSTRUCTION_KEYS) (instructions as Record<string, string>)[k] = own?.instructions?.[k] ?? t[k]
    return own ? { ...own, instructions } : { minute: 0, side, by: 'kickoff', instructions }
  }
  return [kick('home', home), kick('away', away), ...all.filter((e) => e.by !== 'kickoff')]
}

function sideFromSnapshot(s: TeamSnapshot, live: LivePlayer[], subs: Substitution[]): FeedSide {
  return { teamId: s.teamId, name: s.teamName, shortName: s.shortName, tactics: s.tactics, appearances: liveAppearances(live), subs, bench: s.bench, strength: s.strength, modifiers: s.modifiers, talkText: s.talkText, halfTimeText: s.halfTimeText, lateText: s.lateText }
}

/** The feed of a match in play, decided to the stop it stands at (or held to the whistle). */
export function feedFromLive(mp: MatchInProgress, fallbackKey: string): MatchFeed {
  const decidedTo = mp.clock ?? 45
  const events = sortEvents(mp.events)
  const added = decidedTo >= 90 ? addedTime(events) : 0
  return {
    key: mp.seedKey ?? fallbackKey,
    source: 'live',
    decidedTo,
    addedTime: added,
    lastMinute: decidedTo >= 90 ? 90 + added : decidedTo,
    neutral: mp.neutral,
    importance: mp.importance,
    importanceLabel: mp.importanceLabel,
    events,
    momentum: mp.momentum ?? [],
    timeline: withKickOff(mp.timeline, mp.home.tactics, mp.away.tactics),
    xgPreMatch: { home: mp.lamH, away: mp.lamA },
    home: sideFromSnapshot(mp.home, mp.hLive, mp.hSubs),
    away: sideFromSnapshot(mp.away, mp.aLive, mp.aSubs),
  }
}

/** The feed of a finished match. `short` names the sides compactly (a result stores only the full names). */
export function feedFromResult(res: FullMatchResult, fallbackKey: string, short?: { home: string; away: string }): MatchFeed {
  const sorted = sortEvents(res.events)
  const added = addedTime(sorted)
  // The whistle blows when the added time is up (the engine logs it at the ninetieth or the last event)
  const events = sorted.map((e) => (e.type === 'full_time' ? { ...e, minute: Math.max(e.minute, 90 + added) } : e))
  const side = (which: 'home' | 'away'): FeedSide => {
    const r = which === 'home' ? res.homeReport : res.awayReport
    return {
      teamId: which === 'home' ? res.homeTeamId : res.awayTeamId,
      name: which === 'home' ? res.homeName : res.awayName,
      shortName: short?.[which] ?? (which === 'home' ? res.homeName : res.awayName),
      tactics: r.tactics ?? defaultTactics(),
      appearances: r.appearances ?? [],
      subs: r.substitutions,
      bench: [],
      strength: r.strength,
      modifiers: r.modifiers,
      talkText: r.teamTalkEffect,
      halfTimeText: r.halfTimeEffect,
      lateText: r.lateEffect,
    }
  }
  const home = side('home')
  const away = side('away')
  return {
    key: res.seedKey ?? fallbackKey,
    source: 'result',
    decidedTo: 90,
    addedTime: added,
    lastMinute: 90 + added,
    neutral: !!res.neutral,
    importance: res.importance,
    importanceLabel: res.importanceLabel,
    events,
    momentum: res.momentum ?? [],
    timeline: withKickOff(res.timeline, home.tactics, away.tactics),
    xgPreMatch: { home: res.xg.home, away: res.xg.away },
    home,
    away,
    finalStats: { home: res.homeStats, away: res.awayStats },
  }
}

/**
 * A side's tactics at a minute: formation and roles as the side stands (they
 * never change mid-match), instructions from the kick-off entry and every
 * later entry before the minute (an entry at k applies from k + 1), set-piece
 * takers likewise.
 */
export function tacticsAt(feed: MatchFeed, side: 'home' | 'away', minute: number): Tactics {
  const base = side === 'home' ? feed.home.tactics : feed.away.tactics
  const entries = feed.timeline.filter((e) => e.side === side)
  const kick = entries.find((e) => e.by === 'kickoff')
  const out: Tactics = { ...base, ...(kick?.instructions ?? {}), setPieces: kick?.setPieces ?? base.setPieces }
  for (const e of entries) {
    if (e.by === 'kickoff' || e.minute >= minute) continue
    Object.assign(out, e.instructions ?? {})
    if (e.setPieces) out.setPieces = e.setPieces
  }
  return out
}

/** The score after `minute`'s events. */
export function scoreAt(events: MatchEvent[], minute: number): { home: number; away: number } {
  let home = 0
  let away = 0
  for (const e of events) {
    if (e.minute > minute || (e.type !== 'goal' && e.type !== 'penalty' && e.type !== 'own_goal')) continue
    if (e.side === 'home') home++
    else away++
  }
  return { home, away }
}

/**
 * Who is on the pitch at a minute: on by then, not yet off, and not sent off;
 * a man who saw out the ninety stays on through added time unless he was
 * replaced at the whistle.
 */
export function appearancesAt<T extends Appearance>(players: T[], minute: number): T[] {
  return players.filter((p) => p.onAt <= minute && (minute < p.offAt || (p.offAt >= 90 && !p.red && !players.some((q) => q !== p && q.slotId === p.slotId && q.onAt >= p.offAt && q.onAt <= minute))))
}

/**
 * Who played (part of) minute m: a man coming on at k plays from k + 1, the
 * man he replaced (or a man sent off at k) plays minute k. So a change at k
 * never alters who played minute k.
 */
export function playedMinute<T extends Appearance>(players: T[], p: T, m: number): boolean {
  if (p.onAt >= m) return false
  if (m <= 90) return p.offAt >= m
  return p.offAt >= 90 && !p.red && !players.some((q) => q !== p && q.slotId === p.slotId && q.onAt >= p.offAt && q.onAt < m)
}
