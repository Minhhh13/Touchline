import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { acceptOffer as acceptOfferEngine, placeBid, rejectOffer as rejectOfferEngine, advanceWindow, type Listing } from '@engine/market'
import { newSquadPlayer } from '@engine/season'
import { playerLookup, squadPlayers } from './players'
import { autoPick, squadWages } from './squad'

export const SQUAD_CAP = 23

function log(game: Game, text: string): void {
  if (game.window) game.window.log.unshift(text)
}

export function bidFor(game: Game, u: LoadedUniverse, listingId: string, amount: number): { accepted: boolean; message: string } {
  if (!game.window) return { accepted: false, message: 'The window is closed.' }
  const listing = game.window.listings.find((l) => l.playerSeasonId === listingId)
  if (!listing) return { accepted: false, message: 'Listing not found.' }
  if (Object.keys(game.squad).length >= SQUAD_CAP) return { accepted: false, message: `Squad is full (${SQUAD_CAP}). Sell someone first.` }
  const rng = Rng.fromState(game.rngState)
  const out = placeBid({ u, rng, ownedPlayerIds: new Set(squadPlayers(game, u).map((x) => x.p.playerId)), leagueSeason: game.season?.leagueSeason ?? game.settings.leagueSeason, priceLevel: 1 }, game.window, listing, amount, game.finances, squadWages(game, u))
  if (out.accepted) signListing(game, u, listing, amount)
  game.rngState = rng.getState()
  return out
}

function signListing(game: Game, u: LoadedUniverse, listing: Listing, amount: number): void {
  const get = playerLookup(game, u)
  const p = get(listing.playerSeasonId)
  if (!p) return
  game.finances.budget = Math.round((game.finances.budget - amount) * 10) / 10
  game.finances.spent += amount
  game.squad[p.id] = newSquadPlayer(p.id, { familiarity: 20, sharpness: 65 })
  game.contracts[p.id] = { years: p.age >= 32 ? 1 : 3 }
  if (!game.bench.includes(p.id)) game.bench.push(p.id)
  if (amount < listing.opening * 0.7 && !game.unlocked.includes('dealmaker')) game.unlocked.push('dealmaker')
  if (game.season) game.season.news.unshift({ matchweek: game.season.matchweek, kind: 'transfer', title: `${p.name} signs`, body: `£${amount}M from ${u.clubById[p.clubId]?.name ?? p.clubId} (${p.season}-${String((p.season + 1) % 100).padStart(2, '0')}). Contract: ${game.contracts[p.id].years} year${game.contracts[p.id].years > 1 ? 's' : ''}.` })
}

export function acceptOffer(game: Game, u: LoadedUniverse, index: number): void {
  if (!game.window) return
  const offer = game.window.offers[index]
  if (!offer || offer.status !== 'open') return
  const get = playerLookup(game, u)
  const p = get(offer.playerSeasonId)
  acceptOfferEngine(offer, game.finances)
  releasePlayer(game, u, offer.playerSeasonId)
  log(game, `${p?.name ?? 'Player'} sold to ${u.clubById[offer.fromClubId]?.name ?? 'a rival'} for £${offer.amount}M.`)
  if (game.season) game.season.news.unshift({ matchweek: game.season.matchweek, kind: 'transfer', title: `${p?.name} sold`, body: `£${offer.amount}M from ${u.clubById[offer.fromClubId]?.name ?? 'a rival'}.` })
  // Any other open offers for the same player are void
  for (const o of game.window.offers) if (o !== offer && o.playerSeasonId === offer.playerSeasonId && o.status === 'open') o.status = 'withdrawn'
}

export function rejectOffer(game: Game, index: number): void {
  if (!game.window) return
  const offer = game.window.offers[index]
  if (offer) rejectOfferEngine(offer)
}

/** Release a player (free transfer) and remove from lineup/bench. */
export function releasePlayer(game: Game, u: LoadedUniverse, playerSeasonId: string): void {
  delete game.squad[playerSeasonId]
  delete game.contracts[playerSeasonId]
  delete game.consecutiveMissed[playerSeasonId]
  for (const k of Object.keys(game.lineup)) if (game.lineup[k] === playerSeasonId) delete game.lineup[k]
  game.bench = game.bench.filter((id) => id !== playerSeasonId)
  if (game.captainId === playerSeasonId) game.captainId = undefined
  autoPick(game, u, true)
}

export function advanceDay(game: Game, u: LoadedUniverse): void {
  if (!game.window || !game.season) return
  const rng = Rng.fromState(game.rngState)
  advanceWindow({ u, rng, ownedPlayerIds: new Set(squadPlayers(game, u).map((x) => x.p.playerId)), leagueSeason: game.season.leagueSeason, priceLevel: 1.05 }, game.window, squadPlayers(game, u).map((x) => ({ ...x, listed: game.contracts[x.p.id]?.listed })), Object.keys(game.season.ai))
  if (game.window.day >= game.window.days) {
    game.season.news.unshift({ matchweek: game.season.matchweek, kind: 'transfer', title: 'Window closed', body: `The ${game.window.kind === 'summer' ? 'summer' : 'January'} window has shut.` })
    game.window = null
  }
  game.rngState = rng.getState()
}
