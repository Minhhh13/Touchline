/**
 * The match day's first build, ahead of its first render. The dashboard's heaviest memos (the feed's ball path,
 * `matchPath`, and the players' positions sampled from it, `samplePlayers`) are pure functions of a decided segment,
 * so they can be built in tasks of their own between playing the week and showing it, and the dashboard's first
 * render then finds them made. Presentation only: each cached value is exactly what the dashboard would build, from
 * the same inputs, and nothing here touches the game.
 */
import { feedFromLive, type MatchFeed } from '@engine/matchFeed'
import type { MatchInProgress } from '@engine/match'
import type { Game, LiveMatch } from '@game/types'
import { matchPath, type MatchPath } from './epochs'
import { sampledMinutes, samplePlayers, samplePlayersIn, type PlayerSample } from './heat'

/** The key the dashboard gives a live segment's feed when the engine has none. */
export function liveFeedKey(live: Pick<LiveMatch, 'opponentId' | 'ctx' | 'kind'>): string {
  return `${live.opponentId}-${live.ctx.matchweek}-${live.kind}`
}

// Keyed by the frozen objects the store holds: a new segment or a change in play is a new object, and the memo goes
// with the match (WeakMap), so nothing here grows across a season
const feeds = new WeakMap<MatchInProgress, Map<string, MatchFeed>>()
const paths = new WeakMap<MatchFeed, MatchPath>()
const sampled = new WeakMap<MatchPath, Map<number, PlayerSample[]>>()

/** `feedFromLive(mp, key)`, once per segment. */
export function liveFeed(mp: MatchInProgress, key: string): MatchFeed {
  let byKey = feeds.get(mp)
  if (!byKey) feeds.set(mp, (byKey = new Map()))
  let feed = byKey.get(key)
  if (!feed) byKey.set(key, (feed = feedFromLive(mp, key)))
  return feed
}

/** `matchPath(feed)`, once per feed. */
export function pathOf(feed: MatchFeed): MatchPath {
  let p = paths.get(feed)
  if (!p) paths.set(feed, (p = matchPath(feed)))
  return p
}

/** `samplePlayers(mpath, upTo)`, once per path and minute. */
export function samplesOf(mpath: MatchPath, upTo: number): PlayerSample[] {
  let byMinute = sampled.get(mpath)
  if (!byMinute) sampled.set(mpath, (byMinute = new Map()))
  let s = byMinute.get(upTo)
  if (!s) byMinute.set(upTo, (s = samplePlayers(mpath, upTo)))
  return s
}

const task = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Minutes of sampled positions built per task. */
export const SAMPLE_SLICE = 25

/**
 * Builds the live segment's feed and ball path, then (a task each) the sampled positions a slice of minutes at a time,
 * so the match screen's first render does neither. Nothing to do when the game has no live match (Sim result).
 */
export async function prepareMatchDay(game: Game, step: () => Promise<void> = task): Promise<void> {
  const live = game.live
  if (!live) return
  const feed = liveFeed(live.mp, liveFeedKey(live))
  const mpath = pathOf(feed)
  const upTo = feed.lastMinute
  let byMinute = sampled.get(mpath)
  if (!byMinute) sampled.set(mpath, (byMinute = new Map()))
  if (byMinute.has(upTo)) return
  const last = sampledMinutes(mpath, upTo)
  const parts: PlayerSample[][] = []
  for (let from = 1; from <= last; from += SAMPLE_SLICE) {
    await step()
    parts.push(samplePlayersIn(mpath, upTo, from, from + SAMPLE_SLICE - 1))
  }
  if (!byMinute.has(upTo)) byMinute.set(upTo, parts.flat())
}
