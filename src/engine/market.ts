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
    return { playerSeasonId: p.id, asking: price, opening: price, suitors, listedDay: 0, tags, status: 'available' }
  })
  return { kind, day: 0, days, listings, offers: [], log: [`The ${kind === 'summer' ? 'summer' : 'January'} window is open. ${listings.length} players are available.`] }
}

/**
 * Advance the window by one day: suitors push prices up, unwanted players get
 * cheaper near the deadline, some players sign elsewhere, and AI clubs may bid
 * for our players.
 */
export function advanceWindow(ctx: MarketContext, w: Window, ownSquad: Array<{ p: PlayerSeason; s: SquadPlayer; listed?: boolean }>, clubsInLeague: string[]): void {
  const { rng, u } = ctx
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
    // Player signs elsewhere
    if (l.suitors >= 2 && rng.chance(0.12) && l.status !== 'bidding') {
      l.status = 'gone'
      const club = rng.pick(clubsInLeague)
      w.log.push(`${p.name} has joined ${u.clubById[club]?.name ?? 'a rival'} for £${l.asking}M.`)
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
    if (extra.length) w.log.push(`${extra.length} new player${extra.length > 1 ? 's' : ''} listed: ${extra.map((l) => u.index[l.playerSeasonId]?.name).join(', ')}.`)
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
      w.log.push(`${u.clubById[fromClubId]?.name ?? 'A club'} has offered £${amount}M for ${p.name}.`)
    }
  }
}

export interface BidOutcome {
  accepted: boolean
  message: string
  /** Counter demand when rejected but negotiable. */
  counter?: number
}

/** Make a bid for a listed player. Clubs accept at or near asking; low-balls annoy them. */
export function placeBid(ctx: MarketContext, w: Window, listing: Listing, amount: number, finances: Finances, wageCommitment: number): BidOutcome {
  const { rng, u } = ctx
  const p = u.index[listing.playerSeasonId]
  if (!p) return { accepted: false, message: 'Player not found.' }
  if (listing.status === 'gone' || listing.status === 'signed') return { accepted: false, message: `${p.name} is no longer available.` }
  if (amount > finances.budget) return { accepted: false, message: `You cannot afford £${amount}M. Budget: £${roundM(finances.budget)}M.` }
  if (wageCommitment + p.wage > finances.wageCap) return { accepted: false, message: `${p.name}'s wages (£${p.wage}k/wk) would break the wage cap (£${finances.wageCap}k/wk).` }
  const ratio = amount / listing.asking
  listing.bid = amount
  listing.status = 'bidding'
  if (ratio >= 0.97) {
    listing.status = 'signed'
    listing.response = 'Accepted'
    w.log.push(`Deal done: ${p.name} signs for £${amount}M.`)
    return { accepted: true, message: `${u.clubById[p.clubId]?.shortName ?? 'The club'} accept. ${p.name} is yours for £${amount}M.` }
  }
  if (ratio >= 0.85) {
    const chance = (ratio - 0.85) / 0.12 * 0.7 + (listing.suitors === 0 ? 0.15 : 0)
    if (rng.chance(chance)) {
      listing.status = 'signed'
      listing.response = 'Accepted'
      w.log.push(`Deal done: ${p.name} signs for £${amount}M after negotiation.`)
      return { accepted: true, message: `They take it. ${p.name} signs for £${amount}M.` }
    }
    const counter = roundM(listing.asking * rng.float(0.94, 1.0))
    listing.asking = counter
    listing.response = `Rejected, will accept £${counter}M`
    return { accepted: false, message: `Rejected. They would accept £${counter}M.`, counter }
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
