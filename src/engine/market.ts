/**
 * The transfer market. Football Manager's economics meet 38-0's time machine:
 * every window, a market of real player-seasons from any era opens with asking
 * prices that move with form, age, demand and the clock.
 */
import type { PlayerSeason, Position, SquadPlayer } from './types'
import type { Rng } from './rng'
import type { LoadedUniverse } from './universe'

export interface Listing {
  playerSeasonId: string
  /** Asking price now, GBP millions. */
  asking: number
  /** Price when the listing opened. */
  opening: number
  /** Number of rival clubs sniffing around; drives price up over time. */
  suitors: number
  /** Days left in the window when listed. */
  listedDay: number
  /** Why the price is where it is, for the UI. */
  tags: string[]
  /** Set once a bid has been accepted or the player has gone elsewhere. */
  status: 'available' | 'bidding' | 'signed' | 'gone'
  /** Our current bid, if any. */
  bid?: number
  /** Their response to our last bid. */
  response?: string
  /** Loan fee for the season when the club will lend him, GBP millions. */
  loanFee?: number
  /** Set when the deal done was a loan. */
  loan?: boolean
  /** How the listing came about: put up by the club, or an approach we made. */
  source?: 'listed' | 'enquiry'
  /** Player-season we gave in part-exchange, if any. */
  exchangeId?: string
}

/** A player from our squad offered in part-exchange. */
export interface Exchange {
  p: PlayerSeason
  s: SquadPlayer
}

/** A listed player an AI club signed during the window. */
export interface AiSigning {
  playerSeasonId: string
  clubId: string
  fee: number
}

export interface Window {
  kind: 'summer' | 'january'
  /** Day index 0..days-1; the window closes after the last day. */
  day: number
  days: number
  listings: Listing[]
  /** Offers from AI clubs for our players. */
  offers: Offer[]
  log: string[]
}

export interface Offer {
  playerSeasonId: string
  fromClubId: string
  amount: number
  day: number
  status: 'open' | 'accepted' | 'rejected' | 'withdrawn'
}

export interface Finances {
  /** Transfer budget available, GBP millions. */
  budget: number
  /** Weekly wage budget cap, GBP thousands. */
  wageCap: number
  /** Running totals for the season. */
  income: number
  spent: number
  wagesPaid: number
}

export interface MarketContext {
  u: LoadedUniverse
  rng: Rng
  /** Player ids already in our squad (human ids, not player-season ids). */
  ownedPlayerIds: Set<string>
  leagueSeason: number
  /** 1 = routine, >1 inflates prices (strong economy / big-club tax). */
  priceLevel: number
  fromSeason?: number
  toSeason?: number
  /** Leagues the market draws from; all loaded leagues when omitted. */
  leagues?: string[]
}

/** Opening asking price for a player-season in this market. */
export function askingPrice(p: PlayerSeason, ctx: Pick<MarketContext, 'priceLevel'>, state?: SquadPlayer): { price: number; tags: string[] } {
  const tags: string[] = []
  let price = p.value * ctx.priceLevel
  // Clubs charge a premium to part with elite players
  if (p.overall >= 88) {
    price *= 1.35
    tags.push('World class premium')
  } else if (p.overall >= 84) {
    price *= 1.15
    tags.push('Star premium')
  }
  if (p.age <= 22 && p.overall >= 75) {
    price *= 1.15
    tags.push('High potential')
  }
  if (p.age >= 33) {
    price *= 0.7
    tags.push('Veteran discount')
  }
  if (p.accolades.includes('Champion')) {
    price *= 1.08
    tags.push('Title winner')
  }
  if (state) {
    const recent = state.recentRatings.slice(-5)
    const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 7
    if (avg >= 7.6) {
      price *= 1.15
      tags.push('In form')
    } else if (avg <= 6.3 && recent.length >= 3) {
      price *= 0.85
      tags.push('Out of form')
    }
    if (state.injury && state.injury.weeksOut >= 6) {
      price *= 0.6
      tags.push('Long-term injury')
    } else if (state.injury) {
      price *= 0.9
      tags.push('Injured')
    }
  }
  return { price: roundM(Math.max(0.1, price)), tags }
}

/** Clubs lend out fringe players and youngsters, not their stars. */
export function loanable(p: PlayerSeason): boolean {
  return (p.age <= 23 && p.overall <= 83) || p.overall <= 76
}

function roundM(v: number): number {
  if (v >= 20) return Math.round(v)
  if (v >= 5) return Math.round(v * 2) / 2
  return Math.round(v * 10) / 10
}

/** Open a window with a fresh market of listings drawn from across the eras. */
export function openWindow(ctx: MarketContext, kind: Window['kind'], count = 36): Window {
  const { u, rng } = ctx
  const pool = u.clubSeasons.filter((cs) => (ctx.fromSeason === undefined || cs.season >= ctx.fromSeason) && (ctx.toSeason === undefined || cs.season <= ctx.toSeason) && (!ctx.leagues || ctx.leagues.includes(cs.leagueId)))
  const candidates: PlayerSeason[] = []
  const seenHumans = new Set<string>()
  // Sample club-seasons, then take a few players from each with a bias to quality so the market is interesting.
  let guard = 0
  while (candidates.length < count && guard++ < count * 20 && pool.length) {
    const cs = rng.pick(pool)
    const picks = rng.int(1, 3)
    const sorted = [...cs.squad].sort((a, b) => b.overall - a.overall)
    for (let i = 0; i < picks && candidates.length < count; i++) {
      // Weighted towards the top of the squad but not exclusively.
      const idx = Math.min(sorted.length - 1, Math.floor(Math.pow(rng.next(), 1.8) * sorted.length))
      const p = sorted[idx]
      if (!p || ctx.ownedPlayerIds.has(p.playerId) || seenHumans.has(p.playerId)) continue
      seenHumans.add(p.playerId)
      candidates.push(p)
    }
  }
  const days = kind === 'summer' ? 10 : 7
  const listings: Listing[] = candidates.map((p) => {
    const { price, tags } = askingPrice(p, ctx)
    const suitors = p.overall >= 85 ? rng.int(1, 3) : p.overall >= 78 ? rng.int(0, 2) : rng.int(0, 1)
    const l: Listing = { playerSeasonId: p.id, asking: price, opening: price, suitors, listedDay: 0, tags, status: 'available', source: 'listed' }
    if (loanable(p) && rng.chance(0.55)) {
      l.loanFee = roundM(Math.max(0.2, price * 0.12))
      l.tags.push('Loan available')
    }
    return l
  })
  return { kind, day: 0, days, listings, offers: [], log: [`The ${kind === 'summer' ? 'summer' : 'January'} window is open. ${listings.length} players are available.`] }
}

/**
 * Advance the window by one day: suitors push prices up, unwanted players get
 * cheaper near the deadline, some players sign elsewhere, and AI clubs may bid
 * for our players.
 */
export function advanceWindow(ctx: MarketContext, w: Window, ownSquad: Array<{ p: PlayerSeason; s: SquadPlayer; listed?: boolean }>, clubsInLeague: string[]): { signings: AiSigning[] } {
  const { rng, u } = ctx
  const signings: AiSigning[] = []
  w.day++
  const daysLeft = w.days - w.day
  for (const l of w.listings) {
    if (l.status !== 'available' && l.status !== 'bidding') continue
    const p = u.index[l.playerSeasonId]
    if (!p) continue
    // Suitor dynamics
    if (l.suitors > 0 && rng.chance(0.35)) {
      l.asking = roundM(l.asking * (1 + 0.04 * l.suitors))
      if (!l.tags.includes('Bidding war')) l.tags.push('Bidding war')
    }
    if (rng.chance(0.08) && p.overall >= 80) l.suitors++
    // Player signs elsewhere: a rival in our league takes him, and he really does join their squad
    if (l.status !== 'bidding' && l.source !== 'enquiry' && clubsInLeague.length && ((l.suitors >= 2 && rng.chance(0.12)) || (l.suitors === 1 && rng.chance(0.04)))) {
      l.status = 'gone'
      const club = rng.pick(clubsInLeague)
      signings.push({ playerSeasonId: l.playerSeasonId, clubId: club, fee: l.asking })
      w.log.unshift(`${p.name} has joined ${u.clubById[club]?.name ?? 'a rival'} for £${l.asking}M.`)
      continue
    }
    // Deadline day discounts for the unwanted
    if (daysLeft <= 1 && l.suitors === 0 && rng.chance(0.6)) {
      l.asking = roundM(l.asking * 0.85)
      if (!l.tags.includes('Deadline discount')) l.tags.push('Deadline discount')
    }
  }
  // New listings trickle in
  if (daysLeft >= 1 && rng.chance(0.6)) {
    const extra = openWindow({ ...ctx, ownedPlayerIds: new Set([...ctx.ownedPlayerIds, ...w.listings.map((l) => u.index[l.playerSeasonId]?.playerId ?? '')]) }, w.kind, rng.int(1, 3)).listings
    for (const l of extra) {
      l.listedDay = w.day
      l.tags.push('New listing')
    }
    w.listings.push(...extra)
    if (extra.length) w.log.unshift(`${extra.length} new player${extra.length > 1 ? 's' : ''} listed: ${extra.map((l) => u.index[l.playerSeasonId]?.name).join(', ')}.`)
  }
  // Offers for our players
  for (const { p, s: state, listed } of ownSquad) {
    const desirability = (p.overall - 72) / 20 + (p.age <= 25 ? 0.2 : 0) + (state.morale < 45 ? 0.3 : 0) + (listed ? 0.6 : 0)
    if (desirability <= 0) continue
    if (rng.chance((listed ? 0.12 : 0.05) * desirability)) {
      const { price } = askingPrice(p, ctx, state)
      const amount = roundM(price * rng.float(0.75, 1.1))
      const fromClubId = rng.pick(clubsInLeague)
      w.offers.push({ playerSeasonId: p.id, fromClubId, amount, day: w.day, status: 'open' })
      w.log.unshift(`${u.clubById[fromClubId]?.name ?? 'A club'} has offered £${amount}M for ${p.name}.`)
    }
  }
  return { signings }
}

/**
 * Approach a club for a player who is not on the market. They name a price with
 * a premium that grows with his standing in their squad, and sometimes refuse
 * outright for a star.
 */
export function enquire(ctx: MarketContext, w: Window, p: PlayerSeason): { listing?: Listing; message: string } {
  const { rng, u } = ctx
  const club = u.clubById[p.clubId]?.name ?? 'The club'
  if (ctx.ownedPlayerIds.has(p.playerId)) return { message: `${p.name} is already in your squad.` }
  const existing = w.listings.find((l) => l.playerSeasonId === p.id || u.index[l.playerSeasonId]?.playerId === p.playerId)
  if (existing && (existing.status === 'available' || existing.status === 'bidding')) return { listing: existing, message: `${p.name} is already on the market.` }
  if (existing) return { message: `${p.name} has already moved this window.` }
  const cs = u.clubSeasonByKey[`${p.clubId}@${p.season}`]
  const rank = cs ? [...cs.squad].sort((a, b) => b.overall - a.overall).findIndex((x) => x.id === p.id) : 10
  const standing = rank < 0 ? 10 : rank
  if (standing < 3 && p.overall >= 86 && rng.chance(p.accolades.includes('Champion') ? 0.5 : 0.3)) {
    w.log.unshift(`${club} refuse to discuss ${p.name}.`)
    return { message: `${club} refuse to discuss ${p.name}. Not for sale at any price.` }
  }
  const { price, tags } = askingPrice(p, ctx)
  const premium = standing < 3 ? 1.6 : standing < 8 ? 1.4 : standing < 14 ? 1.25 : 1.1
  const asking = roundM(price * premium)
  const listing: Listing = { playerSeasonId: p.id, asking, opening: asking, suitors: 0, listedDay: w.day, tags: ['Unsolicited approach', ...tags], status: 'available', source: 'enquiry' }
  if (loanable(p) && standing >= 8) {
    listing.loanFee = roundM(Math.max(0.2, asking * 0.12))
    listing.tags.push('Loan available')
  }
  w.listings.unshift(listing)
  w.log.unshift(`${club} would let ${p.name} go for £${asking}M.`)
  return { listing, message: `${club} name their price: £${asking}M for ${p.name}.` }
}

/**
 * What a selling club will knock off the price for one of our players in
 * part-exchange. Clubs only want someone near the level of the man they lose,
 * and they discount him: 80% of his value, 60% past thirty.
 */
export function exchangeCredit(ctx: MarketContext, target: PlayerSeason, offered: Exchange): { credit: number; reason?: string } {
  const { p, s } = offered
  if (p.overall < target.overall - 8) return { credit: 0, reason: `${p.name} is not the level they are after.` }
  if (p.age >= 34) return { credit: 0, reason: `${p.name} is too old for them to take on.` }
  if (s.injury && s.injury.weeksOut >= 4) return { credit: 0, reason: `${p.name} is injured; they will not take him.` }
  const { price } = askingPrice(p, ctx, s)
  return { credit: roundM(price * (p.age >= 31 ? 0.6 : 0.8)) }
}

/** Take a player on loan for the season: a small fee now, full wages, and he goes back in the summer. */
export function signOnLoan(ctx: MarketContext, w: Window, listing: Listing, finances: Finances, wageCommitment: number): BidOutcome {
  const { u } = ctx
  const p = u.index[listing.playerSeasonId]
  if (!p) return { accepted: false, message: 'Player not found.' }
  if (listing.loanFee === undefined) return { accepted: false, message: `${p.name} is not available on loan.` }
  if (listing.status === 'gone' || listing.status === 'signed') return { accepted: false, message: `${p.name} is no longer available.` }
  if (listing.loanFee > finances.budget) return { accepted: false, message: `You cannot afford the £${listing.loanFee}M loan fee. Budget: £${roundM(finances.budget)}M.` }
  if (wageCommitment + p.wage > finances.wageCap) return { accepted: false, message: `${p.name}'s wages (£${p.wage}k/wk) would break the wage cap (£${finances.wageCap}k/wk).` }
  listing.status = 'signed'
  listing.loan = true
  listing.bid = listing.loanFee
  listing.response = 'Loan agreed'
  w.log.unshift(`${p.name} joins on loan until the end of the season (£${listing.loanFee}M fee).`)
  return { accepted: true, message: `${u.clubById[p.clubId]?.shortName ?? 'The club'} agree. ${p.name} joins on loan for £${listing.loanFee}M.` }
}

export interface BidOutcome {
  accepted: boolean
  message: string
  /** Counter demand when rejected but negotiable. */
  counter?: number
  /** Value the selling club credited for a part-exchange player. */
  credit?: number
}

/**
 * Make a bid for a listed player, optionally with one of our players in
 * part-exchange. Clubs accept at or near asking; low-balls annoy them.
 */
export function placeBid(ctx: MarketContext, w: Window, listing: Listing, amount: number, finances: Finances, wageCommitment: number, exchange?: Exchange): BidOutcome {
  const { rng, u } = ctx
  const p = u.index[listing.playerSeasonId]
  if (!p) return { accepted: false, message: 'Player not found.' }
  if (listing.status === 'gone' || listing.status === 'signed') return { accepted: false, message: `${p.name} is no longer available.` }
  if (amount > finances.budget) return { accepted: false, message: `You cannot afford £${amount}M. Budget: £${roundM(finances.budget)}M.` }
  let credit = 0
  if (exchange) {
    const x = exchangeCredit(ctx, p, exchange)
    if (!x.credit) return { accepted: false, message: x.reason ?? `They do not want ${exchange.p.name}.` }
    credit = x.credit
  }
  const wagesAfter = wageCommitment - (exchange?.p.wage ?? 0) + p.wage
  if (wagesAfter > finances.wageCap) return { accepted: false, message: `${p.name}'s wages (£${p.wage}k/wk) would break the wage cap (£${finances.wageCap}k/wk).` }
  const total = amount + credit
  const ratio = total / listing.asking
  const dealText = exchange ? `£${amount}M plus ${exchange.p.name}` : `£${amount}M`
  listing.bid = amount
  listing.status = 'bidding'
  if (ratio >= 0.97) {
    listing.status = 'signed'
    listing.response = 'Accepted'
    listing.exchangeId = exchange?.p.id
    w.log.unshift(`Deal done: ${p.name} signs for ${dealText}.`)
    return { accepted: true, message: `${u.clubById[p.clubId]?.shortName ?? 'The club'} accept. ${p.name} is yours for ${dealText}.`, credit }
  }
  if (ratio >= 0.85) {
    const chance = (ratio - 0.85) / 0.12 * 0.7 + (listing.suitors === 0 ? 0.15 : 0)
    if (rng.chance(chance)) {
      listing.status = 'signed'
      listing.response = 'Accepted'
      listing.exchangeId = exchange?.p.id
      w.log.unshift(`Deal done: ${p.name} signs for ${dealText} after negotiation.`)
      return { accepted: true, message: `They take it. ${p.name} signs for ${dealText}.`, credit }
    }
    const counter = roundM(listing.asking * rng.float(0.94, 1.0))
    listing.asking = counter
    listing.response = `Rejected, will accept £${counter}M`
    const cashNeeded = roundM(Math.max(0.1, counter - credit))
    return { accepted: false, message: credit ? `Rejected. With ${exchange!.p.name} valued at £${credit}M they would accept £${cashNeeded}M in cash.` : `Rejected. They would accept £${counter}M.`, counter: cashNeeded, credit }
  }
  // Insulting bid: price goes up
  listing.asking = roundM(listing.asking * 1.05)
  listing.response = 'Rejected out of hand'
  if (!listing.tags.includes('Annoyed')) listing.tags.push('Annoyed')
  return { accepted: false, message: `Laughed out of the room. Asking price is now £${listing.asking}M.` }
}

/** Accept an incoming offer for one of our players. */
export function acceptOffer(offer: Offer, finances: Finances): void {
  offer.status = 'accepted'
  finances.budget = roundM(finances.budget + offer.amount)
  finances.income += offer.amount
}

export function rejectOffer(offer: Offer): void {
  offer.status = 'rejected'
}

/** Weekly wage bill in GBP thousands. */
export function wageBill(players: PlayerSeason[]): number {
  return players.reduce((s, p) => s + p.wage, 0)
}

/**
 * Starting finances from the host club's stature and the league era.
 * Budgets are deliberately tight for the top of the market so choices matter.
 */
export function startingFinances(u: LoadedUniverse, hostClubId: string, leagueSeason: number, squadWages = 0): Finances {
  const cs = u.clubSeasonByKey[`${hostClubId}@${leagueSeason}`]
  const squadValue = cs ? cs.squad.reduce((s, p) => s + p.value, 0) : 300
  const budget = roundM(Math.max(30, Math.min(250, squadValue * 0.3)))
  // The board underwrites the drafted squad's wages with 15% headroom, or the
  // club's natural wage bill if that is higher.
  const clubCap = Math.round(Math.max(900, Math.min(4500, squadValue * 5)))
  const wageCap = Math.round(Math.max(clubCap, squadWages * 1.15))
  return { budget, wageCap, income: 0, spent: 0, wagesPaid: 0 }
}

/**
 * Weekly cash flow: match-day and broadcast income roughly covers the wage
 * cap. Spending under the cap drips into the budget; over it drains.
 */
export function weeklyCashFlow(finances: Finances, wages: number): number {
  return (finances.wageCap - wages) / 1000
}

/** Prize money by final league position (GBP millions), roughly real-world shaped. */
export function prizeMoney(position: number, cupWon: boolean): number {
  const base = 100 - (position - 1) * 3.2
  return roundM(base + (cupWon ? 12 : 0))
}

export const POSITION_NEEDS: Record<Position, string> = {
  GK: 'a goalkeeper',
  CB: 'a centre-back',
  LB: 'a left-back',
  RB: 'a right-back',
  DM: 'a holding midfielder',
  CM: 'a central midfielder',
  AM: 'a creative midfielder',
  LW: 'a left winger',
  RW: 'a right winger',
  ST: 'a striker',
}
