/*
 * When the match-day dashboard makes a sound: the referee's whistle at the
 * kick-off, half time and full time, the crowd's "ooh" at a near miss, a save,
 * the whistle and the card at a booking, the chime of a substitution, all at
 * the moments the live pitch shows them (the same strike and foul times,
 * timing.ts); and a goal's net and roar as the ball crosses the line in its
 * hold (clockStore.ts `GOAL_FLIGHT_MS`), again as it hits the net in the
 * replay (keyMoments.ts). Pure: functions of the events, the holds and two
 * readings of the clock (`timeline`), so the hook only plays what this says.
 */
import type { MatchEvent } from '@engine/types'
import { shotXg } from '@engine/matchStats'
import type { GoalHold, TimelinePoint } from '../match/clockStore'
import { REPLAY, replayMs } from '../match/keyMoments'
import type { Side } from '../match/pitchGeometry'
import { foulTimes, inRange, strikeTimes } from '../match/timing'
import type { SoundRequest } from './scores'

/** A chance this good gets the crowd's "ooh"; a save always gets its gloves. */
export const OOH_XG = 0.08
/** A chance this good gets the full "ooh". */
export const FULL_OOH_XG = 0.35
/** A clock step longer than this (match minutes) is a skip, not play: only the whistles in it sound. */
export const MAX_STEP = 1
/** The crowd's sounds never come closer than this, ms (a fast-forward through a busy spell). */
export const CROWD_GAP_MS = 350

export interface MatchSoundCue {
  /** Match time (fractional minute) when it sounds. */
  t: number
  key: string
  req: SoundRequest
}

export interface MatchCueOptions {
  userSide: Side | null
  /** Where this stretch of the clock starts: a kick-off at 0 or 46 blows the whistle. */
  start: number
  /** Where it stops (the last minute shown). */
  stopAt: number
  /** It ends at the whistle. */
  final: boolean
}

function strength(e: MatchEvent, userSide: Side | null): number {
  const xg = Math.min(1, shotXg(e) / FULL_OOH_XG)
  // The home crowd is the bigger one; for the user's side the crowd is with you either way
  const crowd = userSide ? (e.side === userSide ? 1 : 0.8) : e.side === 'home' ? 1 : 0.8
  return Math.min(1, xg) * crowd
}

/** Every sound but the goals' in the ranges the pitch plays (its epochs), by match time. */
export function matchSoundCues(events: MatchEvent[], ranges: ReadonlyArray<{ from: number; to: number }>, o: MatchCueOptions): MatchSoundCue[] {
  const out = new Map<string, MatchSoundCue>()
  const add = (c: MatchSoundCue) => out.set(c.key, c)
  if (o.start === 0 || o.start === 46) add({ t: o.start + 0.002, key: `whistle-kickoff-${o.start}`, req: { id: 'whistle', call: 'kickoff' } })
  if (o.stopAt >= 45 && ranges.some((r) => r.from <= 45)) add({ t: 46, key: 'whistle-half', req: { id: 'whistle', call: 'half' } })
  if (o.final) add({ t: o.stopAt + 1, key: 'whistle-full', req: { id: 'whistle', call: 'full' } })
  for (const r of ranges) {
    for (const [idx, t] of strikeTimes(events, r.from, r.to)) {
      const e = events[idx]
      if (e.type === 'save') add({ t, key: `shot-${idx}`, req: { id: 'save', strength: strength(e, o.userSide), seed: String(idx) } })
      else if (e.type === 'chance' && shotXg(e) >= OOH_XG) add({ t, key: `shot-${idx}`, req: { id: 'near-miss', strength: strength(e, o.userSide), seed: String(idx) } })
    }
    // The cards of one minute share their foul: one whistle, red when any is red
    const fouls = new Map<number, boolean>()
    for (const [idx, f] of foulTimes(events, r.from, r.to)) fouls.set(f.t, (fouls.get(f.t) ?? false) || events[idx].type === 'red')
    for (const [t, red] of fouls) add({ t, key: `card-${t.toFixed(3)}`, req: { id: 'card', red } })
    for (const e of events) {
      if (e.type !== 'substitution' || !inRange(e, r.from, r.to)) continue
      add({ t: e.minute + 0.12, key: `sub-${e.minute}-${e.side}`, req: { id: 'sub', ours: !o.userSide || e.side === o.userSide } })
    }
  }
  return [...out.values()].sort((a, b) => a.t - b.t)
}

/** Milliseconds into a goal's hold when the replay's ball hits the net (null without a replay): the frame where `replayFrame(...).landed` reaches 0. */
export function replayNetAt(h: Pick<GoalHold, 'ms' | 'replay'>): number | null {
  const total = replayMs(h)
  if (total <= 0) return null
  const pre = Math.max(1, total - REPLAY.flight - REPLAY.rest)
  return h.ms - total + pre + REPLAY.flight
}

/** A goal's sounds in its hold: the net and the roar as the ball crosses the line (`flight` ms in), and a smaller one at the replay's net. */
export function goalMoments(h: GoalHold, flight: number): Array<{ at: number; req: SoundRequest }> {
  const out: Array<{ at: number; req: SoundRequest }> = [{ at: Math.min(flight, h.ms), req: { id: 'goal', tone: h.tone, seed: h.key } }]
  const replay = replayNetAt(h)
  if (replay !== null) out.push({ at: replay, req: { id: 'goal', tone: h.tone, replay: true, seed: h.key } })
  return out
}

/**
 * What sounds between two readings of the clock (`timeline` at the last frame and now): the cues passed, and the
 * goal moments passed inside the hold the clock is in. Nothing when the clock went back (a change in play
 * re-anchoring it); only the last whistle when it jumped (a skip), so a skipped stretch never plays all at once.
 */
export function dueMatchSounds(prev: TimelinePoint, cur: TimelinePoint, cues: readonly MatchSoundCue[], holds: readonly GoalHold[], flight: number): SoundRequest[] {
  if (cur.t < prev.t - 1e-9) return []
  const jumped = cur.t - prev.t > MAX_STEP
  const out: SoundRequest[] = []
  const passed = cues.filter((c) => c.t > prev.t && c.t <= cur.t)
  // A skip blows only the last whistle it passes (to half time, or to full time)
  if (jumped) {
    const whistle = passed.filter((c) => c.req.id === 'whistle').at(-1)
    if (whistle) out.push(whistle.req)
  } else for (const c of passed) out.push(c.req)
  if (cur.hold && !jumped) {
    const i = cur.hold.index
    const h = holds[i]
    if (h) {
      const before = prev.hold && prev.hold.index === i ? prev.hold.elapsed : -1
      for (const m of goalMoments(h, flight)) if (m.at > before && m.at <= cur.hold.elapsed) out.push(m.req)
    }
  }
  return out
}

/** Drops a crowd sound that comes within `CROWD_GAP_MS` of the last (`last` holds when each kind last played, and is updated). */
export function throttleCrowd(reqs: SoundRequest[], last: Partial<Record<string, number>>, now: number): SoundRequest[] {
  return reqs.filter((r) => {
    if (r.id !== 'near-miss' && r.id !== 'save') return true
    const prev = last.crowd
    if (prev !== undefined && now - prev < CROWD_GAP_MS) return false
    last.crowd = now
    return true
  })
}
