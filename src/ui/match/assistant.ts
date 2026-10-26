/**
 * The assistant's live line during play (FM26's staff advice on the match screen): at 15, 30, 60 and 80 minutes the
 * commentary banner gives one line from the assistant for a few minutes. Pure, and spoiler-free: it reads the stats
 * and ratings at the checkpoint, never later minutes of the decided segment.
 */
import { statsAt, type StatsSeries } from '@engine/matchStats'
import { appearancesAt, type MatchFeed } from '@engine/matchFeed'
import { ratingsAt } from '@engine/liveRatings'
import { surname } from './shirts'

export const ASSISTANT_MINUTES = [15, 30, 60, 80]
/** Minutes a line stays up after its checkpoint (unless a key moment takes the banner). */
export const ASSISTANT_HOLD = 4
/** An xG gap this wide is worth a word. */
export const XG_GAP = 0.5
export const STRUGGLING = 6.2
export const DANGER = 7.5

/** The checkpoint whose line is up at `minute`, or null. */
export function assistantCheckpoint(minute: number): number | null {
  for (const cp of ASSISTANT_MINUTES) if (minute >= cp && minute < cp + ASSISTANT_HOLD) return cp
  return null
}

export interface AssistantInput {
  xg: { ours: number; theirs: number }
  /** Ratings of the men on the pitch at the checkpoint. */
  ours: Array<{ name: string; rating: number }>
  theirs: Array<{ name: string; rating: number }>
}

/** The line itself: a clear xG gap first, then a starter struggling, then their danger man, else the state of play. */
export function assistantText(x: AssistantInput, cp: number): string {
  const o = x.xg.ours.toFixed(2)
  const t = x.xg.theirs.toFixed(2)
  if (x.xg.ours - x.xg.theirs >= XG_GAP) return `We're on top: xG ${o} to ${t}. Keep the tempo up.`
  if (x.xg.theirs - x.xg.ours >= XG_GAP) return `They're making more chances: xG ${t} to ${o}. We need more of the ball.`
  const worst = [...x.ours].sort((a, b) => a.rating - b.rating)[0]
  if (cp >= 30 && worst && worst.rating <= STRUGGLING) return `${surname(worst.name)} is struggling (${worst.rating.toFixed(1)}): one to think about${cp < 70 ? ' at 70' : ''}.`
  const best = [...x.theirs].sort((a, b) => b.rating - a.rating)[0]
  if (best && best.rating >= DANGER) return `Their ${surname(best.name)} (${best.rating.toFixed(1)}) is the one causing problems.`
  return `Tight so far: xG ${o} to ${t}. Stay patient.`
}

/** The assistant's line for `minute` (null outside a checkpoint's few minutes), read at the checkpoint only. */
export function assistantLine(feed: MatchFeed, series: StatsSeries, userSide: 'home' | 'away', minute: number, name: (psId: string) => string | undefined): { minute: number; text: string } | null {
  const cp = assistantCheckpoint(minute)
  if (cp === null || cp > feed.lastMinute) return null
  const at = statsAt(series, cp)
  const ratings = ratingsAt(feed, cp)
  const side = (s: 'home' | 'away') =>
    appearancesAt((s === 'home' ? feed.home : feed.away).appearances, cp)
      .filter((a) => ratings[a.psId] !== undefined)
      .map((a) => ({ name: name(a.psId) ?? '', rating: ratings[a.psId] }))
      .filter((p) => p.name)
  const them = userSide === 'home' ? 'away' : 'home'
  const text = assistantText({ xg: { ours: at[userSide].xg, theirs: at[them].xg }, ours: side(userSide), theirs: side(them) }, cp)
  return { minute: cp, text }
}
