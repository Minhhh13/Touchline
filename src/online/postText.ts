/**
 * The player's words for ranked posts filed on this device (`touchline-online-v1`'s `posts`): the Summary's line ends
 * with `sentence`, and the Account screen lists every recent one (`devicePosts`), so a run that waited, closed or could
 * not rank is always explained somewhere, even after the player has moved on to another game. Pure.
 */
import type { PostState } from './state'
import { weekStartOf } from './weekly'

/** A reason as the end of a sentence: one full stop, never two. */
export const sentence = (reason: string): string => {
  const r = reason.trim()
  return /[.!?…]$/.test(r) ? r : `${r}.`
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

export interface DevicePost {
  key: string
  /** "Daily 2026-10-25", "Weekly 2026-W43", "38-0 chase K7Q2MX9A3B". */
  label: string
  line: string
  tone: 'good' | 'wait' | 'bad' | 'muted'
}

/** The board a post key names, in words; null for a key this build does not know. */
export function postLabel(key: string): string | null {
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
  if (!id) return null
  if (kind === 'daily') return `Daily ${id}`
  if (kind === 'weekly') return `Weekly ${id}`
  if (kind === 'chase') return `38-0 chase ${id}`
  return null
}

export function postLine(p: PostState, signedIn: boolean): Pick<DevicePost, 'line' | 'tone'> {
  if (p.state === 'waiting') {
    const pts = p.points !== undefined ? ` ${p.points} pts` : ''
    if (p.reason === 'sign_in') return { line: signedIn ? `Waiting to post${pts} under the account that played it.` : `Sign in to post${pts} to the board.`, tone: 'wait' }
    if (p.reason === 'retry') return { line: `Waiting to post${pts}: the server did not answer, so this device tries again shortly.`, tone: 'wait' }
    return { line: 'Posting…', tone: 'wait' }
  }
  if (p.state === 'posted') return { line: `Posted ${p.points} pts: ${ordinal(p.position)} of ${p.total.toLocaleString()}.`, tone: 'good' }
  if (p.state === 'unranked') return { line: `Unranked: ${sentence(p.reason)}`, tone: 'bad' }
  if (p.state === 'rejected') return { line: `Not ranked: ${sentence(p.reason)}`, tone: 'bad' }
  return { line: 'Not posted: the board closed before this device could post it.', tone: 'muted' }
}

/** The newest posts on this device first (keys sort by date within a kind; the chase codes after), at most `limit`. */
export function devicePosts(posts: Record<string, PostState>, signedIn: boolean, limit = 8): DevicePost[] {
  const out: DevicePost[] = []
  for (const [key, p] of Object.entries(posts)) {
    const label = postLabel(key)
    if (!label || !p) continue
    out.push({ key, label, ...postLine(p, signedIn) })
  }
  // Dailies by their date and weeks by their Monday, newest first; chase codes (no date) after them
  const when = (k: string) => {
    const id = k.slice(k.indexOf(':') + 1)
    if (k.startsWith('daily:')) return Date.parse(`${id}T00:00:00Z`) || 0
    if (k.startsWith('weekly:')) return weekStartOf(id)?.getTime() ?? 0
    return -1
  }
  out.sort((a, b) => when(b.key) - when(a.key) || (a.key < b.key ? -1 : 1))
  return out.slice(0, limit)
}
