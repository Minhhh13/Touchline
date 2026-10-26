/**
 * The commentary feed: every event's own text at its minute (goals with the new
 * score), the managers' changes from the timeline, goals elsewhere, the added
 * time board, the whistles, and a line of play for every quiet minute read off
 * the ball path around the minute's start, so it describes what the pitch has
 * just shown: a corner or a free kick being taken, a switch, a ball in behind,
 * a cross headed clear, a tackle or the press winning it, or who found whom
 * and where. The quiet-minute template is picked
 * by a hash of the match key and the minute, so a replay reads the same.
 * Pure: no React, no DOM.
 */
import type { MatchFeed } from '@engine/matchFeed'
import { minutesInWords } from '@engine/matchFeed'
import { SHOUTS, type TimelineEntry } from '@engine/match'
import { hashString } from '@engine/rng'
import type { MatchEvent } from '@engine/types'
import type { MatchPath } from './epochs'
import type { BallKeyframe, PlayTag, SetPieceKind } from './possession'
import type { Side } from './pitchGeometry'

export type CommentaryKind = 'goal' | 'card' | 'sub' | 'injury' | 'chance' | 'change' | 'elsewhere' | 'whistle' | 'board' | 'play'

export interface CommentaryLine {
  minute: number
  text: string
  kind: CommentaryKind
  side?: Side
  /** Priority within a minute for the banner: goal highest, a line of play lowest. */
  weight: number
}

export const KIND_WEIGHT: Record<CommentaryKind, number> = { goal: 10, card: 9, injury: 8, sub: 7, change: 6, elsewhere: 5, chance: 4, whistle: 3, board: 2, play: 1 }

function kindOf(t: MatchEvent['type']): CommentaryKind {
  switch (t) {
    case 'goal':
    case 'penalty':
    case 'own_goal':
      return 'goal'
    case 'yellow':
    case 'red':
      return 'card'
    case 'substitution':
      return 'sub'
    case 'injury':
      return 'injury'
    case 'chance':
    case 'save':
      return 'chance'
    default:
      return 'whistle'
  }
}

const PHRASES: Record<string, Record<string, string>> = {
  mentality: { attacking: 'go attacking', defensive: 'sit back', balanced: 'settle into a balanced shape' },
  pressing: { high: 'press high', low: 'drop into a low block', mid: 'press in midfield' },
  tempo: { fast: 'up the tempo', slow: 'slow the game down', standard: 'play at a steady tempo' },
  width: { wide: 'stretch the play', narrow: 'narrow up', standard: 'play at a standard width' },
  defensiveLine: { high: 'push the line up', deep: 'drop the line deep', standard: 'hold a standard line' },
  passing: { short: 'keep it short', direct: 'go direct', mixed: 'mix up the passing' },
}

function joinAnd(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** "TXI go attacking and press high." for a change of instructions; null for a change of personnel only. */
export function changeText(e: TimelineEntry, team: string): string | null {
  const parts: string[] = []
  for (const [k, v] of Object.entries(e.instructions ?? {})) {
    const p = PHRASES[k]?.[String(v)]
    if (p) parts.push(p)
  }
  if (e.setPieces) parts.push('change the set-piece takers')
  const sentences: string[] = []
  if (parts.length) sentences.push(`${team} ${joinAnd(parts)}.`)
  if (e.shout) sentences.push(`${team} on the touchline: ${SHOUTS[e.shout].label.toLowerCase()}.`)
  return sentences.length ? sentences.join(' ') : null
}

/** "The fourth official holds up the board: four minutes of added time." */
export function boardText(n: number): string {
  return `The fourth official holds up the board: ${minutesInWords(n)} minute${n === 1 ? '' : 's'} of added time.`
}

const PASS_LINES = ['{a} finds {b} {zone}.', '{a} plays it into {b} {zone}.', 'Neat from {a}, and {b} carries it {zone}.', '{a} and {b} combine {zone}.', '{a} slides it across to {b} {zone}.']
const KEEPER_LINES = ['{a} plays it short to {b}.', '{a} rolls it out to {b}.', '{a} takes his time, then finds {b}.']
const TURNOVER_LINES = ['{b} wins it back {zone}.', '{b} nips in and takes it {zone}.', 'Loose ball, and {b} gets there first {zone}.']
const QUIET_LINES = ['{team} keep the ball {zone}.', '{team} probe {zone}.', 'Patient stuff from {team}.']

/** Lines for the plays the ball path tags (playbook.ts), `{a}` the man who played it, `{b}` the man it reached, `{team}` his side. */
export const PLAY_LINES: Partial<Record<PlayTag | SetPieceKind, string[]>> = {
  corner: ['Corner to {team}. {a} goes over to take it.', 'Corner to {team}: {a} stands over it as the box fills.'],
  freekick: ['Free kick to {team} {zone}, after a foul on {a}.', '{a} is brought down {zone}: free kick to {team}.'],
  goalkick: ['Goal kick. {a} goes to {b}.', '{a} takes the goal kick, and {team} start again.'],
  throw: ['Throw-in to {team}: {a} finds {b}.', 'A quick throw from {a}.'],
  switch: ['{a} switches the play out to {b}.', '{a} spreads it wide to {b}.', 'Big diagonal from {a} to {b}.'],
  through: ['{a} tries to slip {b} in behind.', '{a} looks for {b} over the top.'],
  cross: ['{a} whips in a cross, and {b} heads it clear.', 'In comes the cross from {a}, cleared by {b}.'],
  claim: ['{b} comes off his line to claim it.', '{b} gathers comfortably.'],
  press: ['{team} press high and force the turnover: {b} has it.', '{b} hunts it down {zone}.'],
  tackle: ['{b} wins it back with a tackle {zone}.', 'Strong challenge from {b} {zone}.'],
  interception: ['{b} reads it and cuts it out {zone}.', '{b} steps in to intercept {zone}.'],
  long: ['{a} goes long for {b}.', 'Long ball from {a}, and {b} brings it down.'],
  dribble: ['{a} drives forward {zone}.', '{a} runs at them {zone}.'],
  distribution: ['{a} plays it short to {b}.', '{a} rolls it out to {b}.'],
  back: ['{team} recycle it {zone}.', '{a} goes back to {b}.'],
}
/** Which play makes the line when several happen in the moment it describes (a set piece first). */
const PLAY_RANK: Array<PlayTag | SetPieceKind> = ['corner', 'freekick', 'throw', 'goalkick', 'switch', 'through', 'cross', 'claim', 'press', 'tackle', 'interception', 'long', 'dribble', 'distribution', 'back']

function zoneOf(k: BallKeyframe): string {
  const along = k.side === 'home' ? k.x : 100 - k.x
  if (along < 30) return 'at the back'
  if (along < 45) return 'in their own half'
  if (along < 62) return 'in midfield'
  if (along < 80) return 'between the lines'
  return 'on the edge of the box'
}

/** The stretch of the ball path a quiet minute's line describes: what the pitch has just shown as the minute ticks over (from `PLAY_LOOKBACK` before it to `PLAY_LOOKAHEAD` into it). */
export const PLAY_LOOKBACK = 0.5
export const PLAY_LOOKAHEAD = 0.2

/** One line of play for a minute with nothing on the log, from the keyframes around its start. */
export function playLine(feed: MatchFeed, mpath: MatchPath, minute: number, names: { home: string; away: string }, getName: (psId: string) => string | undefined): CommentaryLine {
  const h = hashString(`${feed.key}-${minute}`)
  const keepers = new Set<string>()
  for (const e of mpath.epochs) for (const p of [...e.home, ...e.away]) if (p.position === 'GK') keepers.add(p.psId)
  const name = (id: string | undefined) => (id ? getName(id) : undefined) ?? 'a team-mate'
  const tagged: Array<{ rank: number; text: string; side: Side }> = []
  const options: Array<{ text: string; side: Side }> = []
  const lo = minute - PLAY_LOOKBACK
  const hi = minute + PLAY_LOOKAHEAD
  // Binary search to the first keyframe of the window
  let a = 0
  let b = mpath.path.length
  while (a < b) {
    const mid = (a + b) >> 1
    if (mpath.path[mid].t < lo) a = mid + 1
    else b = mid
  }
  for (let i = Math.max(1, a); i < mpath.path.length; i++) {
    const k = mpath.path[i]
    if (k.t >= hi) break
    // A shot in the window (logged in its own minute): only what came after it is news
    if (k.kind === 'shot' || k.kind === 'goal' || k.kind === 'kickoff') {
      tagged.length = 0
      options.length = 0
      continue
    }
    const prev = mpath.path[i - 1]
    const team = names[k.side]
    const fill = (tpl: string, who: { a?: string; b?: string } = {}) => tpl.replace('{a}', who.a ?? name(prev.holder)).replace('{b}', who.b ?? name(k.holder)).replace('{zone}', zoneOf(k)).replace('{team}', team)
    // A set piece being taken: the man over the ball and where it goes next
    const sp = k.setPiece?.kind
    if (sp && sp !== 'kickoff' && sp !== 'penalty') {
      const lines = PLAY_LINES[sp]
      const after = mpath.path[i + 2]
      if (lines) {
        const fouled = sp === 'freekick' ? name(k.holder) : undefined
        tagged.push({ rank: PLAY_RANK.indexOf(sp), text: fill(lines[h % lines.length], { a: fouled ?? name(k.holder), b: name(after?.holder) }), side: k.side })
      }
      continue
    }
    if (k.play && k.holder && k.play !== 'short' && k.play !== 'forward' && k.play !== 'layoff') {
      const lines = PLAY_LINES[k.play]
      const rank = PLAY_RANK.indexOf(k.play)
      if (lines && rank >= 0) {
        // A cross into the box: the line names who put it in and who dealt with it
        tagged.push({ rank, text: fill(lines[h % lines.length]), side: k.play === 'cross' ? prev.side : k.side })
        continue
      }
    }
    if (k.kind !== 'pass' || !k.holder) continue
    if (prev.side !== k.side) options.push({ text: fill(TURNOVER_LINES[h % TURNOVER_LINES.length]), side: k.side })
    else if (prev.holder && prev.holder !== k.holder && (prev.kind === 'pass' || prev.kind === 'save' || prev.kind === 'carry')) {
      const tpl = keepers.has(prev.holder) ? KEEPER_LINES[h % KEEPER_LINES.length] : PASS_LINES[h % PASS_LINES.length]
      options.push({ text: fill(tpl), side: k.side })
    }
  }
  tagged.sort((x, y) => x.rank - y.rank)
  const pick = tagged.length ? tagged[0] : options.length ? options[Math.floor(h / 7) % options.length] : null
  if (pick) return { minute, text: capitalise(pick.text), kind: 'play', side: pick.side, weight: KIND_WEIGHT.play }
  const side: Side = (feed.momentum[Math.min(17, Math.max(0, Math.ceil(minute / 5) - 1))] ?? 0.5) >= 0.5 ? 'home' : 'away'
  const tpl = QUIET_LINES[h % QUIET_LINES.length]
  return { minute, text: tpl.replace('{team}', names[side]).replace('{zone}', 'in midfield'), kind: 'play', side, weight: KIND_WEIGHT.play }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Every line up to `minute`, in order: within a minute the play first, then the events, the whistles last. */
export function commentaryUpTo(feed: MatchFeed, mpath: MatchPath, minute: number, names: { home: string; away: string }, getName: (psId: string) => string | undefined, elsewhere: Array<{ minute: number; text: string }>): CommentaryLine[] {
  const lines: Array<CommentaryLine & { seq: number }> = []
  const score = { home: 0, away: 0 }
  const busy = new Set<number>()
  for (const e of feed.events) {
    if (e.minute > minute) continue
    const kind = kindOf(e.type)
    let text = e.text
    if (kind === 'goal') {
      score[e.side]++
      text = `${e.text} ${names.home} ${score.home}-${score.away} ${names.away}.`
    }
    const closing = e.type === 'half_time' || e.type === 'full_time'
    lines.push({ minute: e.minute, text, kind, side: kind === 'whistle' ? undefined : e.side, weight: KIND_WEIGHT[kind], seq: closing ? 3 : e.type === 'kickoff' ? 0 : 1 })
    if (e.type !== 'kickoff') busy.add(e.minute)
  }
  for (const t of feed.timeline) {
    if (t.by === 'kickoff' || t.minute > minute) continue
    const text = changeText(t, names[t.side])
    if (!text) continue
    lines.push({ minute: t.minute, text, kind: 'change', side: t.side, weight: KIND_WEIGHT.change, seq: 2 })
    busy.add(t.minute)
  }
  for (const x of elsewhere) if (x.minute <= minute) lines.push({ minute: x.minute, text: x.text, kind: 'elsewhere', weight: KIND_WEIGHT.elsewhere, seq: 2 })
  if (feed.addedTime > 0 && minute >= 90) lines.push({ minute: 90, text: boardText(feed.addedTime), kind: 'board', weight: KIND_WEIGHT.board, seq: 2 })
  const quietTo = Math.min(minute, feed.lastMinute)
  for (let m = 1; m <= quietTo; m++) if (!busy.has(m)) lines.push({ ...playLine(feed, mpath, m, names, getName), seq: -1 })
  return lines
    .map((l, i) => ({ l, i }))
    .sort((a, b) => a.l.minute - b.l.minute || a.l.seq - b.l.seq || a.i - b.i)
    .map(({ l }) => ({ minute: l.minute, text: l.text, kind: l.kind, side: l.side, weight: l.weight }))
}

/** The line for the banner: within the latest minute, the most important (goal > card > injury > substitution > change > elsewhere > chance > whistle > board > play). */
export function latestLine(lines: CommentaryLine[]): CommentaryLine | null {
  if (!lines.length) return null
  const last = Math.max(...lines.map((l) => l.minute))
  let best: CommentaryLine | null = null
  for (const l of lines) if (l.minute === last && (!best || l.weight >= best.weight)) best = l
  return best
}
