/**
 * The inbox feed. Every item goes through `postNews` so the feed is capped in
 * one place and `game.newsTotal` counts items ever posted: the unread count and
 * the "while you were away" digest are measured against that counter, not the
 * feed's length, which stops growing at the cap.
 */
import type { NewsItem } from '@engine/season'
import type { Game } from '../types'

/** The feed keeps this many items, newest first. */
export const NEWS_CAP = 120

/** Items ever posted to this season's feed; a save from before the counter starts from the feed's length. */
export function newsTotal(game: Pick<Game, 'newsTotal' | 'season'>): number {
  return game.newsTotal ?? game.season?.news.length ?? 0
}

/** Post an item to the top of the feed, trim the feed to the cap and count it. */
export function postNews(game: Game, item: NewsItem): void {
  const season = game.season
  if (!season) return
  game.newsTotal = newsTotal(game) + 1
  season.news.unshift(item)
  if (season.news.length > NEWS_CAP) season.news.length = NEWS_CAP
}

/** Items posted since the inbox was last opened; a save from before `newsSeen` existed counts as read. */
export function unseenNews(game: Pick<Game, 'newsTotal' | 'newsSeen' | 'season'>): number {
  if (game.newsSeen === undefined) return 0
  return Math.max(0, newsTotal(game) - game.newsSeen)
}
