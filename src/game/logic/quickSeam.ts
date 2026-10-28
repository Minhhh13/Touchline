/**
 * A quick season played by an earlier engine (r7 QA): a Quick Draft, Daily or Weekly kicked off on the site before an
 * engine release, and opened again after it, holds results this engine would not play. The January window and the
 * bench changes play the season again from where it kicked off, so on such a save they used to rewrite games the
 * player had already watched: a January deal from the old first half read "not on offer" and was blamed on the league
 * data, and a pass or a bench change replayed every game silently. These checks play a copy again and compare what
 * was shown; nothing on `game` moves and no draw is taken from its stream. Kept out of `quick.ts`, which the edge
 * verifier bundles. Pure.
 */
import type { LoadedUniverse } from '@engine/universe'
import type { Game, QuickGameResult } from '../types'
import { reopenJanuary, runQuickSeason } from './quick'

/** The words the store shows when an open January window was drawn again on this version. */
export const JANUARY_REDRAWN_NOTE = 'TouchLine was updated since this season kicked off, so its first half was played again on the new version and the window drawn again.'
/** The words the store shows when a bench change is refused on a season this version plays differently. */
export const CHANGES_CLOSED_NOTE = 'This season kicked off before TouchLine was updated, so it plays out as it kicked off: no more bench changes.'

const sameGames = (a: QuickGameResult[] | undefined, b: QuickGameResult[] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])

/**
 * Seasons found to replay as stored, keyed by everything the replay reads and the games it is compared with (an
 * imported save may hold the same game played by another engine): one that replays once always does on this page.
 */
const fresh = new Set<string>()
const keyOf = (game: Game, part: string, shown: QuickGameResult[] | undefined) => JSON.stringify([game.id, part, game.quickStartRng ?? game.rngState, game.quickChanges ?? [], shown ?? []])

/**
 * Whether the open January window's first half is not what this engine plays from the same start: the window was
 * drawn by an earlier engine. False when no window is open, or when the copy cannot be played (that path keeps its
 * own handling).
 */
export function januaryStale(game: Game, u: LoadedUniverse): boolean {
  const j = game.quickJanuary
  if (game.phase !== 'january' || !j) return false
  const key = keyOf(game, `jan:${JSON.stringify(j.firstHalfTactics)}:${j.firstHalfCaptainId ?? ''}`, j.firstHalf)
  if (fresh.has(key)) return false
  const copy: Game = JSON.parse(JSON.stringify(game))
  try {
    reopenJanuary(copy, u)
  } catch {
    return false
  }
  const stale = !sameGames(copy.quickJanuary?.firstHalf, j.firstHalf)
  if (!stale) fresh.add(key)
  return stale
}

/**
 * Whether the quick season on show (after the window, or with none) is not what this engine plays from the same start
 * and the same choices. False with no season on show, or when the copy cannot be played.
 */
export function quickSeasonStale(game: Game, u: LoadedUniverse): boolean {
  if (game.phase === 'january') return januaryStale(game, u)
  const q = game.quickResult
  if (!q || !game.quickStartRng) return false
  const key = keyOf(game, `season:${JSON.stringify(game.quickJanuary?.move ?? null)}`, q.results)
  if (fresh.has(key)) return false
  const copy: Game = JSON.parse(JSON.stringify(game))
  try {
    runQuickSeason(copy, u)
  } catch {
    return false
  }
  const stale = !sameGames(copy.quickResult?.results, q.results)
  if (!stale) fresh.add(key)
  return stale
}

/**
 * Note a quick season this page has just played (a kick-off, a bench change, the January window closed) as fresh, so
 * the next bench change's check does not play it all again before the change plays it once more.
 */
export function markQuickSeasonFresh(game: Game): void {
  const j = game.quickJanuary
  if (game.phase === 'january' && j) fresh.add(keyOf(game, `jan:${JSON.stringify(j.firstHalfTactics)}:${j.firstHalfCaptainId ?? ''}`, j.firstHalf))
  else if (game.quickResult && game.quickStartRng) fresh.add(keyOf(game, `season:${JSON.stringify(game.quickJanuary?.move ?? null)}`, game.quickResult.results))
}
