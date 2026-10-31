import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { acceptOffer as acceptOfferEngine, askingPrice, placeBid, rejectOffer as rejectOfferEngine, advanceWindow, enquire, logLine, openWindow, signOnLoan, type AiSigning, type Listing, type MarketContext } from '@engine/market'
import { staffTier } from '@engine/staff'
import { newSquadPlayer, type AiClub } from '@engine/season'
import { playerLookup, squadPlayers } from './players'
import { autoPick, squadWages } from './squad'
import { naturalStatus, STATUS_LABEL, WAGE_MULT, type SquadStatus } from '@engine/status'
import { postNews } from './news'
import { focusFilter } from './scouting'
import { ageFloors, recordDeparture } from './departures'

export const SQUAD_CAP = 23

function log(game: Game, text: string): void {
  if (game.window) logLine(game.window, text)
}

/** Humans we hold: the squad, plus anyone picked in a draft still in progress (the summer wheel runs alongside the summer window), and the men who retired from it. */
export function ownedHumans(game: Game, u: LoadedUniverse): Set<string> {
  const owned = new Set(squadPlayers(game, u).map((x) => x.p.playerId))
  for (const id of game.draft?.takenPlayers ?? []) owned.add(id)
  for (const id of game.retiredPlayers ?? []) owned.add(id)
  return owned
}

function marketContext(game: Game, u: LoadedUniverse, rng: Rng, priceLevel: number): MarketContext {
  return { u, rng, ownedPlayerIds: ownedHumans(game, u), leagueSeason: game.season?.leagueSeason ?? game.settings.leagueSeason, priceLevel, fromSeason: game.settings.rules.fromSeason, toSeason: game.settings.rules.toSeason, leagues: game.settings.wheelLeagues, onlyNation: game.settings.rules.onlyNation, classic: game.settings.rules.classic, focus: focusFilter(game), ...withFloors(game) }
}

/** The market's `ageFloor` for a Dynasty with departures; nothing otherwise, so every other window is unchanged. */
export function withFloors(game: Game): { ageFloor?: Record<string, number> } {
  const floor = ageFloors(game)
  return floor ? { ageFloor: floor } : {}
}

/** Sell-on shares a bid can offer the selling club. */
export const SELL_ON_OPTIONS = [0, 0.1, 0.2] as const
/** What a sell-on clause is worth to the selling club now, GBP millions: the share of a future fee at 60% of his value. */
export function sellOnValue(p: { value: number }, pct: number): number {
  return Math.round(p.value * pct * 0.6 * 10) / 10
}
/** The agent's cut when a player he shopped round the clubs is sold. */
export const AGENT_CUT = 0.05

export interface BidOptions {
  /** One of our players offered in part-exchange. */
  exchangeId?: string
  /** Contract length in seasons (1-4). */
  years?: number
  /** Squad status offered; his natural rank in our squad when omitted. */
  status?: SquadStatus
  /** A sell-on share offered to the selling club (0.1 or 0.2): worth `sellOnValue` to them now, paid out of his next sale. */
  sellOn?: number
  /** A weekly wage agreed in personal terms (GBP thousands): the market's wage-cap check reads it, not his wage at the status. */
  wage?: number
}

/**
 * Overalls of the squad a signing measures himself against, developed ratings
 * included. A player going the other way in part-exchange is not part of that
 * squad, so he is left out when `excludeId` names him.
 */
export function squadOveralls(game: Game, u: LoadedUniverse, excludeId?: string): number[] {
  return squadPlayers(game, u)
    .filter((x) => x.p.id !== excludeId)
    .map((x) => x.p.overall)
    .sort((a, b) => b - a)
}

/** The status the market offers by default: where he would rank in our squad (without the part-exchange player, when there is one). */
export function suggestedStatus(game: Game, u: LoadedUniverse, p: { overall: number; age: number }, excludeId?: string): SquadStatus {
  return naturalStatus(p, squadOveralls(game, u, excludeId))
}

export function bidFor(game: Game, u: LoadedUniverse, listingId: string, amount: number, opts: BidOptions = {}): { accepted: boolean; message: string } {
  if (!game.window) return { accepted: false, message: 'The window is closed.' }
  const listing = game.window.listings.find((l) => l.playerSeasonId === listingId)
  if (!listing) return { accepted: false, message: 'Listing not found.' }
  const exchange = opts.exchangeId ? squadPlayers(game, u).find((x) => x.p.id === opts.exchangeId) : undefined
  if (opts.exchangeId && !exchange) return { accepted: false, message: 'That player is not in your squad.' }
  if (!exchange && Object.keys(game.squad).length >= SQUAD_CAP) return { accepted: false, message: `Squad is full (${SQUAD_CAP}). Sell someone first.` }
  const rng = Rng.fromState(game.rngState)
  const target = u.index[listing.playerSeasonId]
  // The player he would replace in part-exchange is not part of the squad he measures himself against
  const overalls = squadOveralls(game, u, exchange?.p.id)
  const status = opts.status ?? (target ? naturalStatus(target, overalls) : 'rotation')
  const pct = opts.sellOn && opts.sellOn > 0 && target ? Math.min(0.2, opts.sellOn) : 0
  const sweetener = pct && target ? { value: sellOnValue(target, pct), label: `a ${Math.round(pct * 100)}% sell-on` } : undefined
  const out = placeBid(marketContext(game, u, rng, 1), game.window, listing, amount, game.finances, squadWages(game, u), exchange, { status, squadOveralls: overalls, ...(opts.wage !== undefined ? { wage: opts.wage } : {}) }, sweetener)
  if (out.accepted) {
    if (exchange) {
      releasePlayer(game, u, exchange.p.id)
      if (game.season) postNews(game, { matchweek: game.season.matchweek, kind: 'transfer', title: `${exchange.p.name} leaves in part-exchange`, body: `Valued at £${out.credit ?? 0}M in the deal for ${u.index[listing.playerSeasonId]?.name ?? 'a new signing'}.` })
    }
    signListing(game, u, listing, amount, { years: clampYears(opts.years, target?.age ?? 27), status })
    if (pct && target && game.contracts[target.id]) game.contracts[target.id].sellOn = { pct, clubId: target.clubId }
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
  if (out.accepted) signListing(game, u, listing, listing.loanFee ?? 0, { years: 1, loan: true, status: 'rotation' })
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

function signListing(game: Game, u: LoadedUniverse, listing: Listing, amount: number, terms: { years: number; loan?: boolean; status: SquadStatus }): void {
  const get = playerLookup(game, u)
  const p = get(listing.playerSeasonId)
  if (!p) return
  game.finances.budget = Math.round((game.finances.budget - amount) * 10) / 10
  game.finances.spent += amount
  game.squad[p.id] = newSquadPlayer(p.id, { familiarity: 20, sharpness: 65 })
  game.contracts[p.id] = terms.loan ? { years: 1, loan: true, status: terms.status } : { years: terms.years, status: terms.status }
  // A permanent signing's wage follows the status he signed on; a loanee is paid what his club pays him
  const mult = terms.loan ? 1 : WAGE_MULT[terms.status]
  if (mult !== 1) game.customPlayers[p.id] = { ...p, wage: Math.round(p.wage * mult) }
  if (!game.bench.includes(p.id)) game.bench.push(p.id)
  // He leaves the league club that held him this season, and the wheel can no longer deal him again
  leaveAiSquads(game, u, p.playerId)
  if (game.draft && !game.draft.takenPlayers.includes(p.playerId)) game.draft.takenPlayers.push(p.playerId)
  if (!terms.loan && amount < listing.opening * 0.7 && !game.unlocked.includes('dealmaker')) game.unlocked.push('dealmaker')
  if (game.season) {
    const from = `${u.clubById[p.clubId]?.name ?? p.clubId} (${p.season}-${String((p.season + 1) % 100).padStart(2, '0')})`
    postNews(game, { matchweek: game.season.matchweek, kind: 'transfer', title: terms.loan ? `${p.name} joins on loan` : `${p.name} signs`, body: terms.loan ? `Season-long loan from ${from}, £${amount}M fee. He returns in the summer.` : `£${amount}M from ${from}. Contract: ${terms.years} year${terms.years > 1 ? 's' : ''} as ${STATUS_LABEL[terms.status].toLowerCase()}.` })
  }
}

export function acceptOffer(game: Game, u: LoadedUniverse, index: number): void {
  if (!game.window) return
  const offer = game.window.offers[index]
  if (!offer || offer.status !== 'open') return
  const get = playerLookup(game, u)
  const p = get(offer.playerSeasonId)
  if (!game.squad[offer.playerSeasonId]) {
    // Already sold, released or swapped: nothing to sell, and no money for it
    offer.status = 'withdrawn'
    return
  }
  if (game.contracts[offer.playerSeasonId]?.loan) {
    offer.status = 'withdrawn'
    log(game, `${p?.name ?? 'He'} is only on loan here; his parent club will not sell.`)
    return
  }
  const contract = game.contracts[offer.playerSeasonId]
  acceptOfferEngine(offer, game.finances)
  // A sell-on clause sends its share to the club he came from; an agent who found the buyer takes his cut
  const owed = Math.round(offer.amount * ((contract?.sellOn?.pct ?? 0) + (contract?.shopped ? AGENT_CUT : 0)) * 10) / 10
  if (owed > 0) {
    game.finances.budget = Math.round((game.finances.budget - owed) * 10) / 10
    game.finances.income -= owed
    const parts = [contract?.sellOn ? `£${Math.round(offer.amount * contract.sellOn.pct * 10) / 10}M sell-on to ${u.clubById[contract.sellOn.clubId]?.name ?? 'his old club'}` : '', contract?.shopped ? `£${Math.round(offer.amount * AGENT_CUT * 10) / 10}M to his agent` : ''].filter(Boolean)
    log(game, `Out of the fee: ${parts.join(' and ')}.`)
  }
  releasePlayer(game, u, offer.playerSeasonId)
  applyAiSignings(game, u, [{ playerSeasonId: offer.playerSeasonId, clubId: offer.fromClubId, fee: offer.amount }])
  log(game, `${p?.name ?? 'Player'} sold to ${u.clubById[offer.fromClubId]?.name ?? 'a rival'} for £${offer.amount}M.`)
  if (game.season) postNews(game, { matchweek: game.season.matchweek, kind: 'transfer', title: `${p?.name} sold`, body: `£${offer.amount}M from ${u.clubById[offer.fromClubId]?.name ?? 'a rival'}.` })
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
  // A Dynasty remembers the age he left at: he never comes back younger
  const gone = playerLookup(game, u)(playerSeasonId)
  if (gone && game.squad[playerSeasonId]) recordDeparture(game, gone)
  delete game.squad[playerSeasonId]
  delete game.contracts[playerSeasonId]
  delete game.consecutiveMissed[playerSeasonId]
  if (game.talks) delete game.talks[playerSeasonId]
  for (const k of Object.keys(game.lineup)) if (game.lineup[k] === playerSeasonId) delete game.lineup[k]
  game.bench = game.bench.filter((id) => id !== playerSeasonId)
  if (game.captainId === playerSeasonId) game.captainId = undefined
  if (game.promisedStart === playerSeasonId) game.promisedStart = undefined
  if (game.markTarget === playerSeasonId) game.markTarget = undefined
  // A set-piece duty goes with him (the match already skips a taker who is not on the pitch; the Tactics tab and the briefing read it)
  const sp = game.tactics.setPieces
  if (sp) for (const k of ['penalties', 'freeKicks', 'corners'] as const) if (sp[k] === playerSeasonId) delete sp[k]
  if (game.dataHub) delete game.dataHub[playerSeasonId]
  // Nobody can buy a player we no longer have
  for (const o of game.window?.offers ?? []) if (o.playerSeasonId === playerSeasonId && o.status === 'open') o.status = 'withdrawn'
  autoPick(game, u, true)
}

/** The human leaves every AI squad (league and Continental Cup) holding any of his player-seasons, except `keep`. */
export function leaveAiSquads(game: Game, u: LoadedUniverse, playerId: string, keep?: AiClub): void {
  const season = game.season
  if (!season) return
  for (const other of [...Object.values(season.ai), ...Object.values(season.continental?.clubs ?? {})]) {
    if (other === keep) continue
    const gone = other.squad.filter((id) => u.index[id]?.playerId === playerId)
    if (!gone.length) continue
    other.squad = other.squad.filter((id) => !gone.includes(id))
    for (const id of gone) delete other.state[id]
  }
}

/** Players AI clubs sign during the window really join their squads for the rest of the season. */
export function applyAiSignings(game: Game, u: LoadedUniverse, signings: AiSigning[]): void {
  const season = game.season
  if (!season) return
  for (const s of signings) {
    const club = season.ai[s.clubId]
    const p = u.index[s.playerSeasonId]
    if (!club || !p || club.squad.includes(s.playerSeasonId)) continue
    // He leaves whichever AI squad held him this season (a listing can be a current rival's player)
    leaveAiSquads(game, u, p.playerId, club)
    club.squad.push(s.playerSeasonId)
    club.state[s.playerSeasonId] = newSquadPlayer(s.playerSeasonId, { familiarity: 30, sharpness: 70 })
  }
}

/** Move the window on by one market day and let the league's clubs do their business. */
export function tickWindow(game: Game, u: LoadedUniverse, rng: Rng): void {
  if (!game.window || !game.season) return
  const { signings } = advanceWindow(marketContext(game, u, rng, 1.05), game.window, squadPlayers(game, u).map((x) => ({ ...x, listed: game.contracts[x.p.id]?.listed, loan: game.contracts[x.p.id]?.loan, shopped: game.contracts[x.p.id]?.shopped })), Object.keys(game.season.ai))
  applyAiSignings(game, u, signings)
  releaseClauses(game, u, rng)
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
    if (extra.length) logLine(game.window, `Your scouts flag ${extra.map((l) => u.index[l.playerSeasonId]?.name).join(' and ')}.`)
  }
}

/**
 * Release clauses: an AI club may pay one in a window and take the player, no
 * say. The rule runs only for a contract that carries a clause, and draws from
 * a fork of a copy of the stream, so the market's own draws never move.
 */
export function releaseClauses(game: Game, u: LoadedUniverse, rng: Rng): void {
  const w = game.window
  const season = game.season
  if (!w || !season) return
  const clubs = Object.keys(season.ai)
  for (const { p, s } of squadPlayers(game, u)) {
    const c = game.contracts[p.id]
    const clause = c?.clauses?.release
    if (!clause || c.loan || p.overall < 68 || !clubs.length) continue
    // The clause looks cheap against what he would fetch: the cheaper it is, the likelier someone pays it
    const price = askingPrice(p, { priceLevel: 1.05 }, s).price
    if (clause > price * 1.1) continue
    const roll = Rng.fromState(rng.getState()).fork(`release-${game.year}-${season.matchweek}-${w.day}-${p.id}`)
    if (!roll.chance(Math.min(0.45, 0.12 + 0.3 * (price / clause - 1)))) continue
    const fromClubId = roll.pick(clubs)
    w.offers.push({ playerSeasonId: p.id, fromClubId, amount: clause, day: w.day, status: 'open' })
    const name = p.name
    acceptOffer(game, u, w.offers.length - 1)
    logLine(w, `${u.clubById[fromClubId]?.name ?? 'A rival'} trigger ${name}'s £${clause}M release clause.`)
    postNews(game, { matchweek: season.matchweek, kind: 'transfer', title: `Release clause triggered: ${name}`, body: `${u.clubById[fromClubId]?.name ?? 'A rival'} paid the £${clause}M in his contract. He has gone.` })
  }
}

export function advanceDay(game: Game, u: LoadedUniverse): void {
  if (!game.window || !game.season) return
  const rng = Rng.fromState(game.rngState)
  tickWindow(game, u, rng)
  if (game.window.day >= game.window.days) {
    postNews(game, { matchweek: game.season.matchweek, kind: 'transfer', title: 'Window closed', body: `The ${game.window.kind === 'summer' ? 'summer' : 'January'} window has shut.` })
    game.window = null
  }
  game.rngState = rng.getState()
}

/** The Market tab's line while no window is open: January before the halfway point, then the summer (Dynasty) or nothing more this season. */
export function closedWindowLine(game: Game): string {
  const s = game.season
  if (!s || s.matchweek < Math.floor(s.matchweeks / 2)) return 'Window closed: January opens at the halfway point.'
  return game.settings.mode === 'dynasty' ? 'Window closed: the summer window opens after the last matchweek.' : 'Window closed: no more windows this season.'
}
