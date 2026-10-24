import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { acceptOffer as acceptOfferEngine, placeBid, rejectOffer as rejectOfferEngine, advanceWindow, enquire, openWindow, signOnLoan, type AiSigning, type Listing, type MarketContext } from '@engine/market'
import { staffTier } from '@engine/staff'
import { newSquadPlayer } from '@engine/season'
import { playerLookup, squadPlayers } from './players'
import { autoPick, squadWages } from './squad'

export const SQUAD_CAP = 23

function log(game: Game, text: string): void {
  if (game.window) game.window.log.unshift(text)
}

function marketContext(game: Game, u: LoadedUniverse, rng: Rng, priceLevel: number): MarketContext {
  return { u, rng, ownedPlayerIds: new Set(squadPlayers(game, u).map((x) => x.p.playerId)), leagueSeason: game.season?.leagueSeason ?? game.settings.leagueSeason, priceLevel, fromSeason: game.settings.rules.fromSeason, toSeason: game.settings.rules.toSeason, leagues: game.settings.wheelLeagues }
}

export interface BidOptions {
  /** One of our players offered in part-exchange. */
  exchangeId?: string
  /** Contract length in seasons (1-4). */
  years?: number
}

export function bidFor(game: Game, u: LoadedUniverse, listingId: string, amount: number, opts: BidOptions = {}): { accepted: boolean; message: string } {
  if (!game.window) return { accepted: false, message: 'The window is closed.' }
  const listing = game.window.listings.find((l) => l.playerSeasonId === listingId)
  if (!listing) return { accepted: false, message: 'Listing not found.' }
  const exchange = opts.exchangeId ? squadPlayers(game, u).find((x) => x.p.id === opts.exchangeId) : undefined
  if (opts.exchangeId && !exchange) return { accepted: false, message: 'That player is not in your squad.' }
  if (!exchange && Object.keys(game.squad).length >= SQUAD_CAP) return { accepted: false, message: `Squad is full (${SQUAD_CAP}). Sell someone first.` }
  const rng = Rng.fromState(game.rngState)
  const out = placeBid(marketContext(game, u, rng, 1), game.window, listing, amount, game.finances, squadWages(game, u), exchange)
  if (out.accepted) {
    if (exchange) {
      releasePlayer(game, u, exchange.p.id)
      if (game.season) game.season.news.unshift({ matchweek: game.season.matchweek, kind: 'transfer', title: `${exchange.p.name} leaves in part-exchange`, body: `Valued at £${out.credit ?? 0}M in the deal for ${u.index[listing.playerSeasonId]?.name ?? 'a new signing'}.` })
    }
    signListing(game, u, listing, amount, { years: clampYears(opts.years, u.index[listing.playerSeasonId]?.age ?? 27) })
  }
  game.rngState = rng.getState()
  return out
}

function clampYears(years: number | undefined, age: number): number {
  const fallback = age >= 32 ? 1 : 3
  const y = Math.round(years ?? fallback)
  return Math.max(1, Math.min(age >= 33 ? 2 : 4, y))
}

export function loanFor(game: Game, u: LoadedUniverse, listingId: string): { accepted: boolean; message: string } {
  if (!game.window) return { accepted: false, message: 'The window is closed.' }
  const listing = game.window.listings.find((l) => l.playerSeasonId === listingId)
  if (!listing) return { accepted: false, message: 'Listing not found.' }
  if (Object.keys(game.squad).length >= SQUAD_CAP) return { accepted: false, message: `Squad is full (${SQUAD_CAP}). Sell someone first.` }
  const rng = Rng.fromState(game.rngState)
  const out = signOnLoan(marketContext(game, u, rng, 1), game.window, listing, game.finances, squadWages(game, u))
  if (out.accepted) signListing(game, u, listing, listing.loanFee ?? 0, { years: 1, loan: true })
  game.rngState = rng.getState()
  return out
}

/** Approach any club for any player in the loaded database. */
export function enquireFor(game: Game, u: LoadedUniverse, playerSeasonId: string): { ok: boolean; message: string } {
  if (!game.window) return { ok: false, message: 'The window is closed.' }
  const p = u.index[playerSeasonId]
  if (!p) return { ok: false, message: 'Player not found.' }
  const rng = Rng.fromState(game.rngState)
  const out = enquire(marketContext(game, u, rng, 1.05), game.window, p)
  game.rngState = rng.getState()
  return { ok: !!out.listing, message: out.message }
}

function signListing(game: Game, u: LoadedUniverse, listing: Listing, amount: number, terms: { years: number; loan?: boolean }): void {
  const get = playerLookup(game, u)
  const p = get(listing.playerSeasonId)
  if (!p) return
  game.finances.budget = Math.round((game.finances.budget - amount) * 10) / 10
  game.finances.spent += amount
  game.squad[p.id] = newSquadPlayer(p.id, { familiarity: 20, sharpness: 65 })
  game.contracts[p.id] = terms.loan ? { years: 1, loan: true } : { years: terms.years }
  if (!game.bench.includes(p.id)) game.bench.push(p.id)
  if (!terms.loan && amount < listing.opening * 0.7 && !game.unlocked.includes('dealmaker')) game.unlocked.push('dealmaker')
  if (game.season) {
    const from = `${u.clubById[p.clubId]?.name ?? p.clubId} (${p.season}-${String((p.season + 1) % 100).padStart(2, '0')})`
    game.season.news.unshift({ matchweek: game.season.matchweek, kind: 'transfer', title: terms.loan ? `${p.name} joins on loan` : `${p.name} signs`, body: terms.loan ? `Season-long loan from ${from}, £${amount}M fee. He returns in the summer.` : `£${amount}M from ${from}. Contract: ${terms.years} year${terms.years > 1 ? 's' : ''}.` })
  }
}

export function acceptOffer(game: Game, u: LoadedUniverse, index: number): void {
  if (!game.window) return
  const offer = game.window.offers[index]
  if (!offer || offer.status !== 'open') return
  const get = playerLookup(game, u)
  const p = get(offer.playerSeasonId)
  acceptOfferEngine(offer, game.finances)
  releasePlayer(game, u, offer.playerSeasonId)
  applyAiSignings(game, u, [{ playerSeasonId: offer.playerSeasonId, clubId: offer.fromClubId, fee: offer.amount }])
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
  if (game.talks) delete game.talks[playerSeasonId]
  for (const k of Object.keys(game.lineup)) if (game.lineup[k] === playerSeasonId) delete game.lineup[k]
  game.bench = game.bench.filter((id) => id !== playerSeasonId)
  if (game.captainId === playerSeasonId) game.captainId = undefined
  if (game.promisedStart === playerSeasonId) game.promisedStart = undefined
  autoPick(game, u, true)
}

/** Players AI clubs sign during the window really join their squads for the rest of the season. */
export function applyAiSignings(game: Game, u: LoadedUniverse, signings: AiSigning[]): void {
  const season = game.season
  if (!season) return
  for (const s of signings) {
    const club = season.ai[s.clubId]
    if (!club || !u.index[s.playerSeasonId] || club.squad.includes(s.playerSeasonId)) continue
    club.squad.push(s.playerSeasonId)
    club.state[s.playerSeasonId] = newSquadPlayer(s.playerSeasonId, { familiarity: 30, sharpness: 70 })
  }
}

/** Move the window on by one market day and let the league's clubs do their business. */
export function tickWindow(game: Game, u: LoadedUniverse, rng: Rng): void {
  if (!game.window || !game.season) return
  const { signings } = advanceWindow(marketContext(game, u, rng, 1.05), game.window, squadPlayers(game, u).map((x) => ({ ...x, listed: game.contracts[x.p.id]?.listed })), Object.keys(game.season.ai))
  applyAiSignings(game, u, signings)
  // Scouts turn up players the open market would not have shown
  const scout = staffTier(game.staff, 'scout')
  if (scout > 0 && game.window.day < game.window.days) {
    const ctx = marketContext(game, u, rng, 1)
    const known = new Set([...ctx.ownedPlayerIds, ...game.window.listings.map((l) => u.index[l.playerSeasonId]?.playerId ?? '')])
    const extra = openWindow({ ...ctx, ownedPlayerIds: known }, game.window.kind, scout).listings
    for (const l of extra) {
      l.listedDay = game.window.day
      l.tags.push('Scouted')
    }
    game.window.listings.push(...extra)
    if (extra.length) game.window.log.unshift(`Your scouts flag ${extra.map((l) => u.index[l.playerSeasonId]?.name).join(' and ')}.`)
  }
}

export function advanceDay(game: Game, u: LoadedUniverse): void {
  if (!game.window || !game.season) return
  const rng = Rng.fromState(game.rngState)
  tickWindow(game, u, rng)
  if (game.window.day >= game.window.days) {
    game.season.news.unshift({ matchweek: game.season.matchweek, kind: 'transfer', title: 'Window closed', body: `The ${game.window.kind === 'summer' ? 'summer' : 'January'} window has shut.` })
    game.window = null
  }
  game.rngState = rng.getState()
}
