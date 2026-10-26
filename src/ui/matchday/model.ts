/**
 * Pure helpers behind the match-day dashboard: where the clock starts and
 * stops, the scoreboard's clock text, the stats flanks, the xG step chart's
 * points, momentum spells, who stands in each formation slot, the key events
 * and the goals elsewhere. No React, no DOM.
 */
import type { MatchClock, MatchInProgress, TimelineEntry } from '@engine/match'
import { appearancesAt, type FeedAppearance, type MatchFeed } from '@engine/matchFeed'
import { MOMENTUM_BINS } from '@engine/matchDetail'
import { statsAt, type StatsSeries, type TeamStatLine, type XgStep } from '@engine/matchStats'
import type { Formation, MatchEvent, Position, Tactics } from '@engine/types'
import type { LatestScore } from '@game/logic/matchday'
import { minuteLabel } from '../format'
import { slotPoint } from '../match/pitchGeometry'
import { upright } from './VerticalPitch'

/** The first minute the clock shows for the segment a paused match has decided: 0, 46 or 71. */
export function segmentStart(clock: MatchClock | undefined): number {
  const c = clock ?? 45
  return c === 45 ? 0 : c === 70 ? 46 : 71
}

/**
 * Where the clock picks up on a reload: the later of the segment's start and
 * the manager's last change with the ball in play, so what was shown before a
 * change is never played again with a different ending.
 */
export function resumeMinute(mp: Pick<MatchInProgress, 'clock' | 'timeline' | 'segment'>): number {
  const start = segmentStart(mp.clock)
  const decided = mp.clock ?? 45
  let at = start
  for (const e of mp.timeline ?? []) if (e.by === 'manager' && e.minute > at && e.minute < decided) at = e.minute
  return at
}

/** Where this stretch of the clock stops: the stop the engine has decided to, or the whistle once it has decided the ninety. */
export function stopTarget(feed: Pick<MatchFeed, 'decidedTo' | 'lastMinute'>): number {
  return feed.decidedTo < 90 ? feed.decidedTo : feed.lastMinute
}

export function skipLabel(stopAt: number): string {
  return stopAt === 45 ? 'Skip to half time' : stopAt === 70 ? 'Skip to 70 minutes' : 'Skip to full time'
}

/** The scoreboard's clock: KICK-OFF, the minute, HALF TIME or 70 MINUTES at a stop, FULL TIME at the whistle; "(+n)" once the board is up. */
export function clockText(clock: number, s: { atStop: boolean; stopAt: number; finished: boolean; final: boolean; addedTime: number }): string {
  if (s.atStop) return s.stopAt === 45 ? 'HALF TIME' : `${s.stopAt} MINUTES`
  if (s.finished && s.final) return 'FULL TIME'
  if (clock <= 0) return 'KICK-OFF'
  const added = clock >= 90 && s.addedTime > 0 ? ` (+${s.addedTime})` : ''
  return `${minuteLabel(clock)}${added}`
}

export interface FlankRow {
  key: keyof TeamStatLine
  label: string
  value: string
}

const FLANK: Array<{ key: keyof TeamStatLine; label: string; fmt: (v: number) => string }> = [
  { key: 'shots', label: 'Shots', fmt: (v) => String(v) },
  { key: 'onTarget', label: 'On target', fmt: (v) => String(v) },
  { key: 'xg', label: 'xG', fmt: (v) => v.toFixed(2) },
  { key: 'distanceKm', label: 'Distance', fmt: (v) => `${v.toFixed(1)} km` },
  { key: 'passPct', label: 'Pass %', fmt: (v) => `${Math.round(v)}%` },
  { key: 'corners', label: 'Corners', fmt: (v) => String(v) },
  { key: 'tackles', label: 'Tackles', fmt: (v) => String(v) },
  { key: 'fouls', label: 'Fouls', fmt: (v) => String(v) },
  { key: 'yellows', label: 'Yellow cards', fmt: (v) => String(v) },
  { key: 'possession', label: 'Possession', fmt: (v) => `${Math.round(v)}%` },
]

/** The ten rows of a stats flank, formatted. */
export function flankRows(line: TeamStatLine): FlankRow[] {
  return FLANK.map((f) => ({ key: f.key, label: f.label, value: f.fmt(line[f.key]) }))
}

export interface StatRow {
  label: string
  home: string
  away: string
  /** Home share of the pair, 0..1, for the bar (0.5 when both are nothing). */
  share: number
}

const FULL: Array<{ label: string; get: (l: TeamStatLine) => number; fmt: (v: number) => string }> = [
  { label: 'Possession', get: (l) => l.possession, fmt: (v) => `${Math.round(v)}%` },
  { label: 'Territory', get: (l) => l.territory, fmt: (v) => `${Math.round(v)}%` },
  { label: 'Shots', get: (l) => l.shots, fmt: String },
  { label: 'Shots on target', get: (l) => l.onTarget, fmt: String },
  { label: 'Expected goals', get: (l) => l.xg, fmt: (v) => v.toFixed(2) },
  { label: 'Passes attempted', get: (l) => l.passes, fmt: String },
  { label: 'Passes completed', get: (l) => l.passesCompleted, fmt: String },
  { label: 'Pass completion', get: (l) => l.passPct, fmt: (v) => `${Math.round(v)}%` },
  { label: 'Distance covered', get: (l) => l.distanceKm, fmt: (v) => `${v.toFixed(1)} km` },
  { label: 'Tackles', get: (l) => l.tackles, fmt: String },
  { label: 'Fouls', get: (l) => l.fouls, fmt: String },
  { label: 'Corners', get: (l) => l.corners, fmt: String },
  { label: 'Offsides', get: (l) => l.offsides, fmt: String },
  { label: 'Yellow cards', get: (l) => l.yellows, fmt: String },
  { label: 'Red cards', get: (l) => l.reds, fmt: String },
]

/** The full two-column table of the Match stats widget. */
export function statRows(home: TeamStatLine, away: TeamStatLine): StatRow[] {
  return FULL.map((f) => {
    const h = f.get(home)
    const a = f.get(away)
    return { label: f.label, home: f.fmt(h), away: f.fmt(a), share: h + a > 0 ? h / (h + a) : 0.5 }
  })
}

export interface ReportFigures {
  shots: number
  onTarget: number
  xg: number
  possession: number
}

/** The report's Shots, On target, xG and Possession: the dashboard's numbers at the whistle. */
export function reportFigures(series: StatsSeries, lastMinute: number): { home: ReportFigures; away: ReportFigures } {
  const at = statsAt(series, lastMinute)
  const fig = (l: TeamStatLine): ReportFigures => ({ shots: l.shots, onTarget: l.onTarget, xg: l.xg, possession: Math.round(l.possession) })
  const home = fig(at.home)
  const away = fig(at.away)
  // Rounded shares still add up to a hundred
  away.possession = 100 - home.possession
  return { home, away }
}

/**
 * The points of one side's xG step line up to `upTo`: a point at every minute
 * (the running total after it), and two at each attempt (the total before and
 * after it, at its minute), so the line runs flat and steps up at each shot.
 */
export function xgStepPoints(steps: XgStep[], upTo: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let i = 0
  let acc = 0
  for (let m = 0; m <= upTo; m++) {
    while (i < steps.length && steps[i].minute <= m) {
      const s = steps[i++]
      out.push([m, acc], [m, s.cumulative])
      acc = s.cumulative
    }
    out.push([m, acc])
  }
  return out
}

export interface MomentumSpell {
  side: 'home' | 'away'
  /** First and last minute of the spell. */
  from: number
  to: number
  /** Mean share of the pressure for the side on top, 0.5..1. */
  strength: number
}

/** Spells of two or more five-minute bins in a row with one side clearly on top (60 per cent or more), up to the clock. */
export function momentumSpells(momentum: number[], upTo: number, threshold = 0.6): MomentumSpell[] {
  const out: MomentumSpell[] = []
  const bins = Math.min(MOMENTUM_BINS, momentum.length, Math.floor(Math.min(90, upTo) / 5))
  let run: { side: 'home' | 'away'; start: number; sum: number; n: number } | null = null
  const close = () => {
    if (run && run.n >= 2) out.push({ side: run.side, from: run.start * 5 + 1, to: (run.start + run.n) * 5, strength: run.sum / run.n })
    run = null
  }
  for (let b = 0; b < bins; b++) {
    const m = momentum[b]
    const side: 'home' | 'away' | null = m >= threshold ? 'home' : 1 - m >= threshold ? 'away' : null
    const share = side === 'home' ? m : 1 - m
    if (side && run && run.side === side) {
      run.sum += share
      run.n++
    } else {
      close()
      if (side) run = { side, start: b, sum: share, n: 1 }
    }
  }
  close()
  return out
}

export interface SlotView {
  slotId: string
  position: Position
  /** The man in the slot at the minute (or the last man who played there, greyed when he is off). */
  psId: string | null
  onAt: number
  /** Came on as a substitute. */
  subbedOn: boolean
  /** Sent off, or injured with no one to replace him: the slot stands empty. */
  out: boolean
  yellow: boolean
  red: boolean
}

/** Who is in each formation slot at a minute, in slot order, with the marks the panels draw. */
export function slotViews(formation: Formation, appearances: FeedAppearance[], events: MatchEvent[], minute: number): SlotView[] {
  const on = new Set(appearancesAt(appearances, minute).map((a) => a.psId))
  const yellows = new Set(events.filter((e) => e.type === 'yellow' && e.minute <= minute && e.playerId).map((e) => e.playerId!))
  const reds = new Set(events.filter((e) => e.type === 'red' && e.minute <= minute && e.playerId).map((e) => e.playerId!))
  return formation.slots.map((slot) => {
    const here = appearances.filter((a) => a.slotId === slot.id && a.onAt <= minute).sort((a, b) => a.onAt - b.onAt)
    const current = here.find((a) => on.has(a.psId)) ?? here[here.length - 1]
    if (!current) return { slotId: slot.id, position: slot.position, psId: null, onAt: 0, subbedOn: false, out: false, yellow: false, red: false }
    return { slotId: slot.id, position: slot.position, psId: current.psId, onAt: current.onAt, subbedOn: current.onAt > 0, out: !on.has(current.psId), yellow: yellows.has(current.psId), red: reds.has(current.psId) }
  })
}

/** The deepest an outfield man stands in a formation panel, in per cent of its height: clear of the keeper's shirt (a back three on a deep line stands at 90 otherwise, on top of him). */
export const PANEL_DEEPEST = 80

/** Where each man of a shape stands in a formation panel (per cent of its box, attacking up): his slot as the live pitch places it, outfield men no deeper than `PANEL_DEEPEST`. */
export function panelPoints(formation: Formation, tactics: Tactics): Array<{ id: string; left: number; top: number }> {
  return formation.slots.map((slot) => {
    const pt = slotPoint(slot, tactics, 'home')
    const { left, top } = upright(pt.x, pt.y)
    return { id: slot.id, left, top: slot.position === 'GK' ? top : Math.min(top, PANEL_DEEPEST) }
  })
}

/**
 * How wide each man's name may be in a formation panel, in per cent of the
 * pitch's width: the gap to the nearest team-mate standing level with him
 * (within `band` per cent of the height, about a name line), so two centred
 * names never run into each other (a back four's centre-halves at 1280 px);
 * null for a man with nobody level with him, whose name keeps the panel's cap.
 */
export function labelRoom(points: Array<{ id: string; left: number; top: number }>, band = 6): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const p of points) {
    let gap: number | null = null
    for (const q of points) {
      if (q === p || Math.abs(q.top - p.top) >= band) continue
      const d = Math.abs(q.left - p.left)
      if (gap === null || d < gap) gap = d
    }
    out[p.id] = gap
  }
  return out
}

const KEY_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal', 'yellow', 'red', 'injury', 'substitution', 'half_time', 'full_time'])

export type KeyItem = { kind: 'event'; minute: number; event: MatchEvent } | { kind: 'change'; minute: number; entry: TimelineEntry }

/** The Match events list to a minute: goals, cards, injuries, substitutions, the whistles and every change of instructions. */
export function keyItems(feed: Pick<MatchFeed, 'events' | 'timeline'>, minute: number): KeyItem[] {
  const items: Array<{ item: KeyItem; seq: number }> = []
  feed.events.forEach((e, i) => {
    if (e.minute <= minute && KEY_TYPES.has(e.type)) items.push({ item: { kind: 'event', minute: e.minute, event: e }, seq: e.type === 'half_time' || e.type === 'full_time' ? 1e6 + i : i })
  })
  feed.timeline.forEach((t, i) => {
    if (t.by !== 'kickoff' && t.minute <= minute && (t.instructions || t.setPieces || t.shout)) items.push({ item: { kind: 'change', minute: t.minute, entry: t }, seq: 5e5 + i })
  })
  return items.sort((a, b) => a.item.minute - b.item.minute || a.seq - b.seq).map((x) => x.item)
}

/** A line for every goal elsewhere, with the score it made: "Elsewhere: ARS 1-0 TOT, Saka 23'." */
export function elsewhereLines(scores: LatestScore[]): Array<{ minute: number; text: string }> {
  const out: Array<{ minute: number; text: string }> = []
  for (const s of scores) {
    let h = 0
    let a = 0
    for (const g of s.goals) {
      if (g.side === 'home') h++
      else a++
      out.push({ minute: g.minute, text: `Elsewhere: ${s.homeName} ${h}-${a} ${s.awayName}${g.scorer ? `, ${g.scorer} ${minuteLabel(g.minute)}` : ''}.` })
    }
  }
  return out.sort((x, y) => x.minute - y.minute)
}

/** A new goal in the last minute of the clock: the latest-scores row flashes. */
export function freshGoal(score: LatestScore, minute: number): boolean {
  return score.status !== 'FT' && score.goals.some((g) => g.minute <= minute && g.minute >= minute - 1)
}

/** A running xG total for the share card's 0..90 axis: stoppage-time attempts land on the ninetieth minute. */
export function cardSeries(perMinute: number[]): number[] {
  if (!perMinute.length) return [0]
  const out = perMinute.slice(0, 91)
  out[out.length - 1] = perMinute[perMinute.length - 1]
  return out
}

/**
 * What the play since a stop has produced for both sides (the "since the shout" read-out): expected goals and shots
 * between minute `from` and the clock, read from the decided series up to the clock only. Null until the clock passes `from`.
 */
export function sinceMinute(series: StatsSeries, from: number, minute: number): { home: { xg: number; shots: number }; away: { xg: number; shots: number } } | null {
  if (minute <= from) return null
  const a = statsAt(series, from)
  const b = statsAt(series, minute)
  const side = (x: TeamStatLine, y: TeamStatLine) => ({ xg: Math.max(0, Math.round((y.xg - x.xg) * 100) / 100), shots: Math.max(0, y.shots - x.shots) })
  return { home: side(a.home, b.home), away: side(a.away, b.away) }
}
