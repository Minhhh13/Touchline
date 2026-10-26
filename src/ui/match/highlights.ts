/**
 * Highlight levels for the live match (FM's Full, Extended and Key highlights). Every minute still plays; the clock
 * runs `QUIET_BOOST` times faster through the quiet ones and at the chosen speed through the build-up to each moment
 * the engine has already decided. A UI clock change only: the match is decided per segment before it is shown, so
 * nothing draws differently. Pure, from the decided events.
 */
import { shotXg } from '@engine/matchStats'
import type { MatchEvent } from '@engine/types'

export type HighlightLevel = 'full' | 'extended' | 'key'
export const HIGHLIGHT_LEVELS: Array<{ id: HighlightLevel; label: string; hint: string }> = [
  { id: 'full', label: 'Full match', hint: 'Every minute at the chosen speed' },
  { id: 'extended', label: 'Extended', hint: 'Goals, chances, cards, injuries and changes at the chosen speed; the rest fast. Winds down to Key at three goals up or down' },
  { id: 'key', label: 'Key moments', hint: 'Goals, penalties, big chances, red cards and injuries at the chosen speed; the rest fast' },
]

/** How much faster the clock runs through a quiet minute. */
export const QUIET_BOOST = 10
/** Minutes shown at the chosen speed before a moment, and after it. */
export const BUILD_UP = 3
export const AFTER = 1
/** A chance this good is a key moment; a shot this good joins the extended highlights. */
export const BIG_CHANCE_XG = 0.25
export const SHOT_XG = 0.08
/** A margin this wide winds Extended down to Key. */
export const CRUISE_MARGIN = 3

const GOALS = new Set(['goal', 'penalty', 'own_goal'])

/** Whether an event is a moment worth watching at this level. */
export function isMoment(e: MatchEvent, level: HighlightLevel): boolean {
  if (level === 'full') return true
  if (GOALS.has(e.type) || e.type === 'red' || e.type === 'injury') return true
  if ((e.type === 'chance' || e.type === 'save') && shotXg(e) >= BIG_CHANCE_XG) return true
  if (level === 'key') return false
  if (e.type === 'yellow' || e.type === 'substitution') return true
  return (e.type === 'chance' || e.type === 'save') && shotXg(e) >= SHOT_XG
}

/** Minutes 0..`last` to play at the chosen speed: each moment's build-up, the moment and the minute after. */
export function watchedMinutes(events: MatchEvent[], level: HighlightLevel, last = 95): boolean[] {
  const out = Array.from({ length: last + 1 }, () => level === 'full')
  if (level === 'full') return out
  for (const e of events) {
    if (!isMoment(e, level)) continue
    for (let m = Math.max(0, e.minute - BUILD_UP); m <= Math.min(last, e.minute + AFTER); m++) out[m] = true
  }
  // Kick-off and the restarts read at normal speed for a moment, so the picture never starts in a blur
  for (const m of [0, 46, 71]) if (m <= last) out[m] = true
  return out
}

/** The score margin at the end of `minute`, from the decided goals. */
export function marginAt(events: MatchEvent[], minute: number): { home: number; away: number; margin: number } {
  let home = 0
  let away = 0
  for (const e of events) {
    if (e.minute > minute || !GOALS.has(e.type)) continue
    if (e.side === 'home') home++
    else away++
  }
  return { home, away, margin: Math.abs(home - away) }
}

/** The level in force at `minute`: Extended winds down to Key once a side is three clear. */
export function levelAt(events: MatchEvent[], chosen: HighlightLevel, minute: number): { level: HighlightLevel; wound: boolean } {
  if (chosen !== 'extended') return { level: chosen, wound: false }
  const m = marginAt(events, minute)
  return m.margin >= CRUISE_MARGIN ? { level: 'key', wound: true } : { level: chosen, wound: false }
}

/** The clock's boost for the minute now: 1 through watched minutes, `QUIET_BOOST` through the rest. */
export function boostAt(events: MatchEvent[], chosen: HighlightLevel, minute: number): number {
  const { level } = levelAt(events, chosen, minute)
  if (level === 'full') return 1
  const watched = watchedMinutes(events, level)
  return watched[Math.max(0, Math.min(watched.length - 1, minute))] ? 1 : QUIET_BOOST
}

/** The level is a per-viewer convenience, kept under its own key. */
export const HIGHLIGHTS_KEY = 'touchline-match-highlights'
export function parseLevel(raw: string | null): HighlightLevel {
  return raw === 'extended' || raw === 'key' ? raw : 'full'
}
