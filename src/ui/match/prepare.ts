/**
 * The match day's first build, ahead of its first render. The dashboard's heaviest memos (the feed's ball path,
 * `matchPath`, and the players' positions sampled from it, `samplePlayers`) are pure functions of a decided segment,
 * so they can be built in tasks of their own between playing the week and showing it, and the dashboard's first
 * render then finds them made. Presentation only: each cached value is exactly what the dashboard would build, from
 * the same inputs, and nothing here touches the game.
 */
import { feedFromLive, feedFromResult, type MatchFeed } from '@engine/matchFeed'
import type { FullMatchResult, MatchInProgress } from '@engine/match'
import type { LoadedUniverse } from '@engine/universe'
import type { Game, LiveMatch, MatchContext } from '@game/types'
import { teamCode } from './shirts'
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

const resultFeeds = new WeakMap<FullMatchResult, Map<string, MatchFeed>>()

/** A finished match's replay: the dashboard's feed key and the sides' codes. */
export function replayKey(res: FullMatchResult, ctx: Pick<MatchContext, 'matchweek'>): string {
  return `${res.homeTeamId}-${res.awayTeamId}-${ctx.matchweek}`
}
export function replayCodes(u: LoadedUniverse, res: FullMatchResult, userShortName: string): { home: string; away: string } {
  return { home: teamCode(u, res.homeTeamId, res.homeName, userShortName), away: teamCode(u, res.awayTeamId, res.awayName, userShortName) }
}

/** `feedFromResult(res, key, codes)`, once per result, key and codes. */
export function resultFeed(res: FullMatchResult, key: string, codes: { home: string; away: string }): MatchFeed {
  let byKey = resultFeeds.get(res)
  if (!byKey) resultFeeds.set(res, (byKey = new Map()))
  const k = `${key}|${codes.home}|${codes.away}`
  let feed = byKey.get(k)
  if (!feed) byKey.set(k, (feed = feedFromResult(res, key, codes)))
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
  await prepareFeed(liveFeed(live.mp, liveFeedKey(live)), step)
}

/**
 * The same for a match screen that opens on the replay of a finished match (the arena's matches): the replay's
 * feed, ball path and samples, or the live segment's when the match is live.
 */
export async function prepareMatchScreen(game: Game, u: LoadedUniverse, step: () => Promise<void> = task): Promise<void> {
  if (game.live) return prepareMatchDay(game, step)
  const res = game.lastMatch
  const ctx = game.lastMatchContext
  if (!res || !ctx) return
  await prepareFeed(resultFeed(res, replayKey(res, ctx), replayCodes(u, res, game.settings.shortName)), step)
}

async function prepareFeed(feed: MatchFeed, step: () => Promise<void>): Promise<void> {
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
