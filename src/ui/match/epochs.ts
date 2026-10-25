/**
 * The whole match as the pitch draws it: one placement of both XIs per spell
 * of unchanged instructions (an epoch), and one ball path through all of them.
 *
 * Epochs start at kick-off, at the restart (46), at 71 and at every change in
 * the timeline (the minute after it), so a change of instructions moves the
 * shape from the minute it was made. Each epoch's ball carries on from where
 * the last one left it (the second half kicks off from the centre spot).
 * Pure and deterministic for a feed: the heat maps, pass maps, action zones and
 * the commentary read the same path the live pitch shows.
 */
import { tacticsAt, type MatchFeed } from '@engine/matchFeed'
import { placeSide, separateSides, type PlacedPlayer } from './pitchGeometry'
import { buildBallPath, type BallKeyframe } from './possession'

export interface Epoch {
  from: number
  to: number
  home: PlacedPlayer[]
  away: PlacedPlayer[]
}

export interface MatchPath {
  epochs: Epoch[]
  path: BallKeyframe[]
}

/** The minutes the feed's epochs begin at, up to what the engine has decided. */
export function epochStarts(feed: MatchFeed): number[] {
  const starts = new Set<number>([0])
  if (feed.decidedTo >= 46) starts.add(46)
  if (feed.decidedTo >= 71) starts.add(71)
  for (const e of feed.timeline) if (e.by !== 'kickoff' && e.minute + 1 <= feed.decidedTo) starts.add(e.minute + 1)
  return [...starts].sort((a, b) => a - b)
}

export function matchPath(feed: MatchFeed): MatchPath {
  const starts = epochStarts(feed)
  const epochs: Epoch[] = []
  const path: BallKeyframe[] = []
  starts.forEach((from, i) => {
    const to = i + 1 < starts.length ? starts[i + 1] - 1 : feed.decidedTo
    const placed = separateSides(placeSide(feed.home.appearances, tacticsAt(feed, 'home', from), 'home'), placeSide(feed.away.appearances, tacticsAt(feed, 'away', from), 'away'))
    epochs.push({ from, to, ...placed })
    const last = path[path.length - 1]
    // The second half is a kick-off; any other epoch picks the ball up where it stood
    const start = from === 46 || !last ? undefined : { x: last.x, y: last.y, side: last.side, holder: last.holder }
    const part = buildBallPath({ from, to, momentum: feed.momentum, events: feed.events, home: placed.home, away: placed.away, seed: feed.key, start })
    for (const k of part) {
      const prevT = path.length ? path[path.length - 1].t : -1
      path.push(k.t > prevT ? k : { ...k, t: prevT + 0.01 })
    }
  })
  return { epochs, path }
}

/** The epoch in force at time T (a fractional minute). */
export function epochAt(mpath: MatchPath, T: number): Epoch {
  let found = mpath.epochs[0]
  for (const e of mpath.epochs) if (e.from <= T) found = e
  return found
}
