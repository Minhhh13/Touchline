/**
 * A reload in the middle of the quick season's playback picks it up at the game the viewer had reached (playtest round
 * 2, P6). The playback's place is UI state only (the season was simulated before the first game showed), so a reload
 * used to land on the January window, or the whole season, with every game shown: a viewer paused before game 1 to make
 * a bench change lost the moment. The place is kept per viewer in `localStorage` (like the match day's
 * `touchline-match-resume`), keyed by the game, its phase and the games the playback holds; anything unreadable, or a
 * mark for another game, means the old behaviour. The game and its save are untouched.
 */

/** Storage key: one record, the playback on screen and the game it reached. */
export const PLAYBACK_RESUME_KEY = 'touchline-playback-resume'

export interface PlaybackMark {
  /** The playback: the game, its phase (`january`, the first half; `summary`, the season) and how many games it holds. */
  key: string
  /** Games shown. */
  revealed: number
  /** Paused there (a bench change, a highlight). */
  paused: boolean
}

/** The playback's identity: the January half and the full season of one game are two playbacks. */
export function playbackKey(gameId: string, phase: string, games: number): string {
  return `${gameId}|${phase}|${games}`
}

export function parsePlaybackMark(raw: string | null): PlaybackMark | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<PlaybackMark>
    return typeof v.key === 'string' && typeof v.revealed === 'number' && Number.isFinite(v.revealed) ? { key: v.key, revealed: v.revealed, paused: v.paused === true } : null
  } catch {
    return null
  }
}

/**
 * Where a playback mounted with no place from the store (a reload) starts: the remembered game for this same playback,
 * within 0 and `games`, paused as it was left; null for no mark or another playback's (the caller keeps its default).
 */
export function resumePlayback(mark: PlaybackMark | null, key: string, games: number): { from: number; paused: boolean } | null {
  if (!mark || mark.key !== key) return null
  const from = Math.max(0, Math.min(Math.floor(mark.revealed), games))
  // A playback that had shown every game resumes as the default does: nothing to hold
  if (from >= games) return null
  return { from, paused: mark.paused }
}

export function readPlaybackMark(): PlaybackMark | null {
  try {
    return parsePlaybackMark(localStorage.getItem(PLAYBACK_RESUME_KEY))
  } catch {
    return null
  }
}

export function writePlaybackMark(mark: PlaybackMark): void {
  try {
    localStorage.setItem(PLAYBACK_RESUME_KEY, JSON.stringify(mark))
  } catch {
    // Storage blocked: a reload starts where it always did
  }
}
