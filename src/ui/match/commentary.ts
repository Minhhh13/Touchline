/**
 * The commentary feed: every event's own text at its minute (goals with the new
 * score), the managers' changes from the timeline, goals elsewhere, the added
 * time board, the whistles, and a line of play for every quiet minute read off
 * the ball path (who found whom, and where). The quiet-minute template is picked
 * by a hash of the match key and the minute, so a replay reads the same.
 * Pure: no React, no DOM.
 */
import type { MatchFeed } from '@engine/matchFeed'
import { minutesInWords } from '@engine/matchFeed'
import { SHOUTS, type TimelineEntry } from '@engine/match'
import { hashString } from '@engine/rng'
import type { MatchEvent } from '@engine/types'
import type { MatchPath } from './epochs'
import type { BallKeyframe } from './possession'
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

function zoneOf(k: BallKeyframe): string {
  const along = k.side === 'home' ? k.x : 100 - k.x
  if (along < 30) return 'at the back'
  if (along < 45) return 'in their own half'
  if (along < 62) return 'in midfield'
  if (along < 80) return 'between the lines'
  return 'on the edge of the box'
}

/** One line of play for a minute with nothing on the log, from that minute's keyframes. */
export function playLine(feed: MatchFeed, mpath: MatchPath, minute: number, names: { home: string; away: string }, getName: (psId: string) => string | undefined): CommentaryLine {
  const h = hashString(`${feed.key}-${minute}`)
  const keepers = new Set<string>()
  for (const e of mpath.epochs) for (const p of [...e.home, ...e.away]) if (p.position === 'GK') keepers.add(p.psId)
  const name = (id: string | undefined) => (id ? getName(id) : undefined) ?? 'a team-mate'
  const options: Array<{ text: string; side: Side }> = []
  for (let i = 0; i < mpath.path.length; i++) {
    const k = mpath.path[i]
    if (k.t < minute) continue
    if (k.t >= minute + 1) break
    const prev = mpath.path[i - 1]
    if (k.kind !== 'pass' || !k.holder || !prev) continue
    const fill = (tpl: string) => tpl.replace('{a}', name(prev.holder)).replace('{b}', name(k.holder)).replace('{zone}', zoneOf(k))
    if (prev.side !== k.side) options.push({ text: fill(TURNOVER_LINES[h % TURNOVER_LINES.length]), side: k.side })
    else if (prev.holder && prev.holder !== k.holder && (prev.kind === 'pass' || prev.kind === 'save')) {
      const tpl = keepers.has(prev.holder) ? KEEPER_LINES[h % KEEPER_LINES.length] : PASS_LINES[h % PASS_LINES.length]
      options.push({ text: fill(tpl), side: k.side })
    }
  }
  const pick = options.length ? options[Math.floor(h / 7) % options.length] : null
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
