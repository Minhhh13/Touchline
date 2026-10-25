/**
 * Happiness: why each player's morale moved. Every place that already changes
 * a squad player's morale (results, playing time against his status, the
 * captain's lift, promises, events, one-to-one talks, a status change, the
 * summer) records the change it actually made, after the clamp, here. Pure
 * bookkeeping: no draws and no effect on the morale itself.
 */
import type { MoraleEntry, MoraleReason, SquadPlayer } from '@engine/types'
import { STATUS_LABEL, type SquadStatus } from '@engine/status'
import { TALK_LABEL, type TalkKind } from './talks'

/** Changes kept per player, newest last. The cap lives here, where the list grows. */
export const MORALE_LOG_CAP = 6

/**
 * Record a morale change on `s`: `before` is his morale before the change and
 * `s.morale` after it, so the entry holds what was applied. A change that
 * rounds to nothing is not recorded.
 */
export function logMorale(s: SquadPlayer, week: number, before: number, r: MoraleReason, n?: string): void {
  const d = Math.round((s.morale - before) * 10) / 10
  if (d === 0) return
  const log = (s.moraleLog ??= [])
  const e: MoraleEntry = { w: week, d, r }
  if (n) e.n = n
  log.push(e)
  if (log.length > MORALE_LOG_CAP) log.splice(0, log.length - MORALE_LOG_CAP)
}

/** Apply `fn` (which changes morale) to `s` and record what it did. */
export function withMoraleLog<T>(s: SquadPlayer, week: number, r: MoraleReason, n: string | undefined, fn: () => T): T {
  const before = s.morale
  const out = fn()
  logMorale(s, week, before, r, n)
  return out
}

const RESULT_WORD: Record<string, string> = { W: 'Win', D: 'Draw', L: 'Defeat' }

/** One entry as a short line for the Happiness views: "Win, rated 7.4", "Playing time 30% (expects 85%)". */
export function describeMorale(e: MoraleEntry): string {
  switch (e.r) {
    case 'result':
    case 'cup': {
      const [res, rating] = (e.n ?? '').split(' ')
      const word = RESULT_WORD[res] ?? 'Result'
      return `${e.r === 'cup' ? 'Cup ' + word.toLowerCase() : word}${rating ? `, rated ${rating}` : ''}`
    }
    case 'minutes': {
      const [got, want] = (e.n ?? '').split('/')
      return got && want ? `Playing time ${got}% (expects ${want}%)` : 'Playing time'
    }
    case 'captain':
      return 'Lifted by the captain'
    case 'promise':
      return e.n === 'kept' ? 'Promise kept' : 'Promise broken'
    case 'event':
      return e.n ?? 'Club news'
    case 'talk':
      return e.n && e.n in TALK_LABEL ? TALK_LABEL[e.n as TalkKind].label : 'A word from you'
    case 'status':
      return e.n && e.n in STATUS_LABEL ? `New status: ${STATUS_LABEL[e.n as SquadStatus].toLowerCase()}` : 'Status change'
    case 'summer':
      return 'A fresh start in the summer'
  }
}

export interface HappinessLine {
  week: number
  delta: number
  text: string
}

export interface Happiness {
  morale: number
  /** Newest first. */
  lines: HappinessLine[]
  /** Sum of the recorded changes. */
  net: number
  /** The biggest single cause in the direction of the net change (the biggest fall when he is down, the biggest lift when he is up). */
  main?: HappinessLine
}

/** A player's happiness: his morale and the recorded reasons, newest first. */
export function happinessOf(s: SquadPlayer): Happiness {
  const lines = [...(s.moraleLog ?? [])].reverse().map((e) => ({ week: e.w, delta: e.d, text: describeMorale(e) }))
  const net = Math.round(lines.reduce((a, l) => a + l.delta, 0) * 10) / 10
  const sameWay = lines.filter((l) => (net < 0 ? l.delta < 0 : l.delta > 0))
  const main = [...(sameWay.length ? sameWay : lines)].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.week - a.week)[0]
  return { morale: Math.round(s.morale), lines, net, main }
}
