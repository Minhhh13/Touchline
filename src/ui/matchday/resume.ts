/**
 * A reload in the middle of a live match picks the clock up where the viewer left it. The engine has already decided
 * the segment (1-45, 46-70 or 71-90) before the dashboard plays it, so a reload used to replay it from its first
 * minute, which read as a restart. The dashboard now remembers, per tab (`sessionStorage`), the minute its clock has
 * reached in this segment; mounting the same segment again starts there, or at the stop if it was reached. A per-viewer
 * convenience: the game and its save are untouched, and anything unreadable means a start from the segment's start.
 */

/** sessionStorage key: one record, the segment on screen and the minute its clock reached. */
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

export function readMark(): ResumeMark | null {
  try {
    return parseMark(sessionStorage.getItem(RESUME_KEY))
  } catch {
    return null
  }
}

export function writeMark(mark: ResumeMark): void {
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify(mark))
  } catch {
    // Private window or blocked storage: a reload replays the segment, as before
  }
}
