/**
 * The transfer market. Football Manager's economics meet 38-0's time machine:
 * every window, a market of real player-seasons from any era opens with asking
 * prices that move with form, age, demand and the clock.
 */
import type { PlayerSeason, SquadPlayer } from './types'
import type { Rng } from './rng'
import { poolClubSeasons, type LoadedUniverse } from './universe'
import { acceptsStatus, STATUS_LABEL, WAGE_MULT, type SquadStatus } from './status'

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

/** What an agent shopping a player round the clubs adds to his desirability in the daily offer check. */
export const SHOPPED_BOOST = 0.4

/** Lines a window's log keeps, newest first: the oldest drop off a long summer. */
export const WINDOW_LOG_CAP = 80

/** Add a line to the top of the window's log, keeping at most `WINDOW_LOG_CAP` lines. */
export function logLine(w: Pick<Window, 'log'>, text: string): void {
  w.log.unshift(text)
  if (w.log.length > WINDOW_LOG_CAP) w.log.length = WINDOW_LOG_CAP
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
  /** Wages paid this season, GBP millions, appearance and goal bonuses included. */
  wagesPaid: number
  /** Net steps moved on the wage-to-transfer slider this season (+1 is £10k a week of wage room turned into £2M of budget). Absent until used. */
  wageShift?: number
  /** Appearance and goal bonuses paid this season, GBP millions (already inside `wagesPaid`). Absent until one is paid. */
  bonusesPaid?: number
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
  /** One-nation draft: only players of this nationality are listed, and approaches for anyone else are refused. */
  onlyNation?: string
  /** The game opted in to classic seasons (`DraftRules.classic`): their players may be listed. */
  classic?: boolean
  /**
   * A recruitment focus (`src/game/logic/scouting.ts`): when set, new listings are drawn only from players it accepts.
   * Absent, the market lists and draws exactly as it always has.
   */
  focus?: (p: PlayerSeason) => boolean
  /**
   * Dynasty: real player id -> the youngest age a man who left may be listed at (never his younger self). Absent, or
   * with nobody in it, the market lists exactly as before.
   */
  ageFloor?: Record<string, number>
}

function nationNameOf(u: LoadedUniverse, nation: string): string {
  return u.nations[nation]?.name ?? nation
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
  const nation = ctx.onlyNation
  const focus = ctx.focus
  const eligible = (p: PlayerSeason): boolean => (!nation || p.nationality === nation) && (!focus || focus(p))
  // A one-nation market (or a recruitment focus) only samples club-seasons that hold someone it accepts, so a thin nation still fills the window
  const pool = poolClubSeasons(u, ctx.classic).filter((cs) => (ctx.fromSeason === undefined || cs.season >= ctx.fromSeason) && (ctx.toSeason === undefined || cs.season <= ctx.toSeason) && (!ctx.leagues || ctx.leagues.includes(cs.leagueId)) && ((!nation && !focus) || cs.squad.some(eligible)))
  const candidates: PlayerSeason[] = []
  const seenHumans = new Set<string>()
  // Sample club-seasons, then take a few players from each with a bias to quality so the market is interesting.
  // Rejections (already seen, already ours) are frequent for a small nation, so it gets a longer run.
  let guard = 0
  const maxTries = count * (nation || focus ? 60 : 20)
  while (candidates.length < count && guard++ < maxTries && pool.length) {
    const cs = rng.pick(pool)
    const picks = rng.int(1, 3)
    const sorted = cs.squad.filter(eligible).sort((a, b) => b.overall - a.overall)
    for (let i = 0; i < picks && candidates.length < count; i++) {
      // Weighted towards the top of the squad but not exclusively.
      const idx = Math.min(sorted.length - 1, Math.floor(Math.pow(rng.next(), 1.8) * sorted.length))
      const p = sorted[idx]
      if (!p || ctx.ownedPlayerIds.has(p.playerId) || seenHumans.has(p.playerId) || p.age < (ctx.ageFloor?.[p.playerId] ?? 0)) continue
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
export function advanceWindow(ctx: MarketContext, w: Window, ownSquad: Array<{ p: PlayerSeason; s: SquadPlayer; listed?: boolean; loan?: boolean; shopped?: boolean }>, clubsInLeague: string[]): { signings: AiSigning[] } {
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
      logLine(w, `${p.name} has joined ${u.clubById[club]?.name ?? 'a rival'} for £${l.asking}M.`)
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
    if (extra.length) logLine(w, `${extra.length} new player${extra.length > 1 ? 's' : ''} listed: ${extra.map((l) => u.index[l.playerSeasonId]?.name).join(', ')}.`)
  }
  // Offers for our players; an agent shopping him round the clubs (`shopped`) finds buyers as a listing does, on top of it
  for (const { p, s: state, listed, loan, shopped } of ownSquad) {
    if (loan) continue // not ours to sell
    const desirability = (p.overall - 72) / 20 + (p.age <= 25 ? 0.2 : 0) + (state.morale < 45 ? 0.3 : 0) + (listed ? 0.6 : 0) + (shopped ? SHOPPED_BOOST : 0)
    if (desirability <= 0) continue
    if (rng.chance((listed || shopped ? 0.12 : 0.05) * desirability)) {
      // No other club in the league, no buyer (the roll is still made, so every other day draws as it did)
      if (!clubsInLeague.length) continue
      const { price } = askingPrice(p, ctx, state)
      const amount = roundM(price * rng.float(0.75, 1.1))
      const fromClubId = rng.pick(clubsInLeague)
      w.offers.push({ playerSeasonId: p.id, fromClubId, amount, day: w.day, status: 'open' })
      logLine(w, `${u.clubById[fromClubId]?.name ?? 'A club'} has offered £${amount}M for ${p.name}.`)
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
  if (ctx.onlyNation && p.nationality !== ctx.onlyNation) return { message: `The board wants a ${nationNameOf(u, ctx.onlyNation)} squad. ${p.name} is not ${nationNameOf(u, ctx.onlyNation)}.` }
  const existing = w.listings.find((l) => l.playerSeasonId === p.id || u.index[l.playerSeasonId]?.playerId === p.playerId)
  if (existing && (existing.status === 'available' || existing.status === 'bidding')) return { listing: existing, message: `${p.name} is already on the market.` }
  if (existing) return { message: `${p.name} has already moved this window.` }
  const cs = u.clubSeasonByKey[`${p.clubId}@${p.season}`]
  const rank = cs ? [...cs.squad].sort((a, b) => b.overall - a.overall).findIndex((x) => x.id === p.id) : 10
  const standing = rank < 0 ? 10 : rank
  if (standing < 3 && p.overall >= 86 && rng.chance(p.accolades.includes('Champion') ? 0.5 : 0.3)) {
    logLine(w, `${club} refuse to discuss ${p.name}.`)
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
  logLine(w, `${club} would let ${p.name} go for £${asking}M.`)
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
  if (ctx.ownedPlayerIds.has(p.playerId)) return { accepted: false, message: `${p.name} is already in your squad.` }
  if (listing.loanFee > finances.budget) return { accepted: false, message: `You cannot afford the £${listing.loanFee}M loan fee. Budget: £${roundM(finances.budget)}M.` }
  if (wageCommitment + p.wage > finances.wageCap) return { accepted: false, message: `${p.name}'s wages (£${p.wage}k/wk) would break the wage cap (£${finances.wageCap}k/wk).` }
  listing.status = 'signed'
  listing.loan = true
  listing.bid = listing.loanFee
  listing.response = 'Loan agreed'
  logLine(w, `${p.name} joins on loan until the end of the season (£${listing.loanFee}M fee).`)
  return { accepted: true, message: `${u.clubById[p.clubId]?.shortName ?? 'The club'} agree. ${p.name} joins on loan for £${listing.loanFee}M.` }
}

export interface BidOutcome {
  accepted: boolean
  message: string
  /** Counter demand when rejected but negotiable. */
  counter?: number
  /** Value the selling club credited for a part-exchange player. */
  credit?: number
  /** The lowest squad status the player would sign on, when he refused the one offered. */
  counterStatus?: SquadStatus
  /** Weekly wage he signs on (the listed wage times the status multiplier), set on acceptance. */
  wage?: number
}

/** The squad status offered to a signing, and the buyer's squad overalls he measures himself against. */
export interface StatusTerms {
  status: SquadStatus
  squadOveralls: number[]
  /** A weekly wage already agreed with him (the office's personal terms), GBP thousands: the wage-cap check reads it in place of his wage at the status. */
  wage?: number
}

/**
 * Make a bid for a listed player, optionally with one of our players in
 * part-exchange. Clubs accept at or near asking; low-balls annoy them.
 */
export function placeBid(ctx: MarketContext, w: Window, listing: Listing, amount: number, finances: Finances, wageCommitment: number, exchange?: Exchange, terms?: StatusTerms, sweetener?: { value: number; label: string }): BidOutcome {
  const { rng, u } = ctx
  const p = u.index[listing.playerSeasonId]
  if (!p) return { accepted: false, message: 'Player not found.' }
  if (listing.status === 'gone' || listing.status === 'signed') return { accepted: false, message: `${p.name} is no longer available.` }
  if (ctx.ownedPlayerIds.has(p.playerId)) return { accepted: false, message: `${p.name} is already in your squad.` }
  if (amount > finances.budget) return { accepted: false, message: `You cannot afford £${amount}M. Budget: £${roundM(finances.budget)}M.` }
  // The role on offer: he refuses one beneath his standing in our squad, and his wage demand follows it
  if (terms) {
    const answer = acceptsStatus(p, terms.squadOveralls, terms.status)
    if (!answer.ok) return { accepted: false, message: answer.reason ?? `${p.name} will not sign as ${STATUS_LABEL[terms.status].toLowerCase()}.`, counterStatus: answer.counter }
  }
  const wage = terms?.wage ?? Math.round(p.wage * (terms ? WAGE_MULT[terms.status] : 1))
  let credit = 0
  if (exchange) {
    const x = exchangeCredit(ctx, p, exchange)
    if (!x.credit) return { accepted: false, message: x.reason ?? `They do not want ${exchange.p.name}.` }
    credit = x.credit
  }
  const wagesAfter = wageCommitment - (exchange?.p.wage ?? 0) + wage
  if (wagesAfter > finances.wageCap) return { accepted: false, message: `${p.name}'s wages (£${wage}k/wk${terms && wage !== p.wage ? ` as ${STATUS_LABEL[terms.status].toLowerCase()}` : ''}) would break the wage cap (£${finances.wageCap}k/wk).` }
  // A sell-on clause offered to the selling club is worth something to them now, without any cash
  const total = amount + credit + (sweetener?.value ?? 0)
  const ratio = total / listing.asking
  const dealText = `${exchange ? `£${amount}M plus ${exchange.p.name}` : `£${amount}M`}${sweetener ? ` with ${sweetener.label}` : ''}`
  listing.bid = amount
  listing.status = 'bidding'
  if (ratio >= 0.97) {
    listing.status = 'signed'
    listing.response = 'Accepted'
    listing.exchangeId = exchange?.p.id
    logLine(w, `Deal done: ${p.name} signs for ${dealText}.`)
    return { accepted: true, message: `${u.clubById[p.clubId]?.shortName ?? 'The club'} accept. ${p.name} is yours for ${dealText}.`, credit, wage }
  }
  if (ratio >= 0.85) {
    const chance = (ratio - 0.85) / 0.12 * 0.7 + (listing.suitors === 0 ? 0.15 : 0)
    if (rng.chance(chance)) {
      listing.status = 'signed'
      listing.response = 'Accepted'
      listing.exchangeId = exchange?.p.id
      logLine(w, `Deal done: ${p.name} signs for ${dealText} after negotiation.`)
      return { accepted: true, message: `They take it. ${p.name} signs for ${dealText}.`, credit, wage }
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
 * Weekly cash flow: match-day and broadcast income roughly covers the wage cap. A tenth of what the wages leave
 * under the cap drips into the budget (the rest runs the club); spending over it drains in full. Engine 6: the whole
 * headroom dripped before, so a Dynasty that signed nobody grew from £74M to £820M in four seasons (item 2).
 */
export const HEADROOM_SHARE = 0.1

export function weeklyCashFlow(finances: Finances, wages: number): number {
  const headroom = finances.wageCap - wages
  return (headroom > 0 ? headroom * HEADROOM_SHARE : headroom) / 1000
}

/**
 * The season's league money net of the club's running costs (GBP millions), by final position: +£20M for the
 * champions down to −£20M for last place in a straight line (0 at mid-table), plus £10M for the cup. Success grows
 * the budget modestly and failure shrinks it. Engine 6; before it a title paid £100M and last place £39M.
 */
export const PRIZE_SPREAD = 20
export const CUP_PRIZE = 10

export function prizeMoney(position: number, cupWon: boolean, clubs = 20): number {
  const frac = clubs > 1 ? Math.min(1, Math.max(0, (position - 1) / (clubs - 1))) : 0
  return roundM(PRIZE_SPREAD * (1 - 2 * frac) + (cupWon ? CUP_PRIZE : 0))
}

/** The board's least summer budget for a club not in debt, so a side that keeps finishing bottom can still sign a keeper */
export const SUMMER_FLOOR = 10

/**
 * The budget once a season's league money (`net`, which may be negative) lands: running costs beyond the money take it
 * down to nothing at worst; only a wage bill over the cap (the weekly cash flow) runs a club into debt. A club not in
 * debt starts the summer with at least `SUMMER_FLOOR`; one in debt keeps it. Rounded to £0.1M.
 */
export function afterSeasonMoney(budget: number, net: number): number {
  const after = Math.max(Math.min(budget, 0), budget + net)
  return Math.round((budget < 0 ? after : Math.max(SUMMER_FLOOR, after)) * 10) / 10
}

/** The Continental Cup's money by the stage reached (GBP millions); engine 6 (4, 8, 15, 25 and 45 before), and engine 7's group stage (G) pays as the round of 16 did. */
export const CONTINENTAL_PRIZE: Readonly<Record<string, number>> = { G: 2, R16: 2, QF: 4, SF: 7, F: 11, W: 18 }
