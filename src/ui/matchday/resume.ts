/**
 * A reload in the middle of a live match picks the clock up where the viewer left it. The engine has already decided
 * the segment (1-45, 46-70 or 71-90) before the dashboard plays it, so a reload used to replay it from its first
 * minute, which read as a restart. The dashboard now remembers, per viewer (`localStorage`, so it outlives the tab: iOS
 * may kill a backgrounded web view, which loses `sessionStorage`; O-7 in docs/QA.md), the minute its clock has reached
 * in this segment; mounting the same segment again starts there, or at the stop if it was reached. A per-viewer
 * convenience: the game and its save are untouched, and anything unreadable means a start from the segment's start.
 */

/** Storage key: one record, the segment on screen and the minute its clock reached (localStorage; sessionStorage when that refuses it). */
export const RESUME_KEY = 'touchline-match-resume'

export interface ResumeMark {
  /** The segment: the game, the match, the minute it is decided to, where its clock starts and how many events it holds. */
  key: string
  /** The whole minute the clock reached; `stopAt + 1` once the stretch played out. */
  at: number
}

/** The segment's identity: a change in play (a new start, new events) or the next segment is another segment. */
export function segmentKey(gameId: string, feedKey: string, decidedTo: number, start: number, events: number): string {
  return `${gameId}|${feedKey}|${decidedTo}|${start}|${events}`
}

/** Where the clock starts on mounting a segment: the remembered minute for this same segment, never before `start` nor past the stop. */
export function resumeFrom(mark: ResumeMark | null, key: string, start: number, stopAt: number): number {
  if (!mark || mark.key !== key || !Number.isFinite(mark.at)) return start
  return Math.max(start, Math.min(Math.floor(mark.at), stopAt + 1))
}

/** The line a resumed match shows: where it picked up. Null when it starts from the segment's start. */
export function resumeLine(at: number, start: number, stopAt: number): string | null {
  if (at <= start) return null
  if (at > stopAt) return stopAt === 45 ? 'Back at half time, where you left the match' : stopAt === 70 ? 'Back at 70 minutes, where you left the match' : 'Back at full time, where you left the match'
  return `Back at ${at}', where you left the match`
}

export function parseMark(raw: string | null): ResumeMark | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<ResumeMark>
    return typeof v.key === 'string' && typeof v.at === 'number' ? { key: v.key, at: v.at } : null
  } catch {
    return null
  }
}

type MarkStore = Pick<Storage, 'getItem' | 'setItem'>

/** The stores a mark lives in, in order: this viewer's localStorage, then the tab's sessionStorage (an earlier build's mark, or a full localStorage). */
function markStores(): (() => MarkStore | undefined)[] {
  return [() => (typeof localStorage === 'undefined' ? undefined : localStorage), () => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage)]
}

/** The mark these stores hold for this segment, else the first well-formed one; a store that throws is skipped. */
export function readMarkFrom(stores: (() => MarkStore | undefined)[], key?: string): ResumeMark | null {
  let first: ResumeMark | null = null
  for (const store of stores) {
    try {
      const mark = parseMark(store()?.getItem(RESUME_KEY) ?? null)
      if (mark && (key === undefined || mark.key === key)) return mark
      first ??= mark
    } catch {
      // Private window or blocked storage: try the next
    }
  }
  return first
}

/** Write the mark to the first store that takes it; true when one did. */
export function writeMarkTo(stores: (() => MarkStore | undefined)[], mark: ResumeMark): boolean {
  const raw = JSON.stringify(mark)
  for (const store of stores) {
    try {
      const s = store()
      if (!s) continue
      s.setItem(RESUME_KEY, raw)
      return true
    } catch {
      // Full or blocked: try the next
    }
  }
  return false
}

export function readMark(key?: string): ResumeMark | null {
  return readMarkFrom(markStores(), key)
}

export function writeMark(mark: ResumeMark): void {
  // Nowhere to write (a private window, blocked storage): a reload replays the segment, as before
  writeMarkTo(markStores(), mark)
}
