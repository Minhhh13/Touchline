/**
 * The transfer window's comparison (r8 Season play): for each listing, whether the club can pay the fee and his wage,
 * and what he would be at his position against the men already in the squad. The manager no longer has to hold the
 * budget, the wage room and his own depth chart in his head while reading a list of thirty names.
 *
 * Display only, pure and draw-free: what it reads about the listed man is what the market shows, the scouted range's
 * midpoint until he is known exactly, and nothing when blind mode hides the market's ratings.
 */
import type { LoadedUniverse } from '@engine/universe'
import type { Listing } from '@engine/market'
import type { PlayerSeason, Position } from '@engine/types'
import type { Game } from '../types'
import { wageRoom } from './board'
import { playerLookup, squadPlayers } from './players'
import { maskedView } from './scouting'
import { ratingHidden } from './ratingVisibility'

export interface ListingFit {
  /** The asking fee is within the transfer budget. */
  fee: boolean
  /** His wage fits under the wage cap with what is paid now. */
  wages: boolean
  /** His main position. */
  position: Position
  /**
   * His overall (or the scouted estimate) against the best man in the squad at that position: above zero an
   * upgrade. Null while the market's ratings are hidden, or with nobody there to compare.
   */
  upgrade: number | null
  /** Where he would stand at the position, 1 for first choice; null while ratings are hidden. */
  rank: number | null
  /** The overall compared is an estimate from a scouting range. */
  estimate: boolean
}

/** The overall the market shows for a man: exact once known, else his scouted range's midpoint. */
function shownOverall(game: Game, u: LoadedUniverse, p: PlayerSeason): { value: number; estimate: boolean } {
  const view = maskedView(game, u, p)
  return view.exact ? { value: p.overall, estimate: false } : { value: Math.round((view.overall.lo + view.overall.hi) / 2), estimate: true }
}

/** One listing measured against the budget, the wage room and the squad. */
export function listingFit(game: Game, u: LoadedUniverse, listing: Pick<Listing, 'playerSeasonId' | 'asking'>): ListingFit | null {
  const p = playerLookup(game, u)(listing.playerSeasonId)
  if (!p) return null
  const position = p.positions[0]
  const fee = listing.asking <= game.finances.budget + 1e-9
  const wages = p.wage <= wageRoom(game, u) + 1e-9
  if (ratingHidden(game.settings.rules, 'market')) return { fee, wages, position, upgrade: null, rank: null, estimate: false }
  const shown = shownOverall(game, u, p)
  const mates = squadPlayers(game, u)
    .filter((x) => x.p.positions[0] === position && !game.contracts[x.p.id]?.expired)
    .map((x) => x.p.overall)
    .sort((a, b) => b - a)
  const upgrade = mates.length ? shown.value - mates[0] : null
  const rank = mates.filter((o) => o >= shown.value).length + 1
  return { fee, wages, position, upgrade, rank, estimate: shown.estimate }
}

export type ListingSort = 'overall' | 'upgrade'

/**
 * The listings the window shows, by the manager's choice: only the ones the club can afford (fee and wage) when
 * `affordable`, by overall or by how much each improves his position. Ties keep the market's own order.
 */
export function sortListings<L extends Pick<Listing, 'playerSeasonId' | 'asking'>>(game: Game, u: LoadedUniverse, listings: L[], opts: { affordable?: boolean; sort?: ListingSort } = {}): L[] {
  const fits = new Map(listings.map((l) => [l.playerSeasonId, listingFit(game, u, l)]))
  const kept = opts.affordable ? listings.filter((l) => fits.get(l.playerSeasonId)?.fee && fits.get(l.playerSeasonId)?.wages) : listings
  if (opts.sort !== 'upgrade') return kept
  const key = (l: L) => fits.get(l.playerSeasonId)?.upgrade ?? -Infinity
  return kept.map((l, i) => ({ l, i })).sort((a, b) => key(b.l) - key(a.l) || a.i - b.i).map((x) => x.l)
}
