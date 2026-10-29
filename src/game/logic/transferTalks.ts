/**
 * Transfer talks (Football Manager depth, round 8), beside the market's plain
 * bid (`marketOps.ts`), which stays as it was.
 *
 * Buying, in two stages:
 * 1. The fee, with the selling club: offer a fee, optionally with a sell-on
 *    share (worth `sellOnValue` to them now) and in two or three instalments
 *    (worth a little less to them: 94% or 90% of the fee, but only half or 40%
 *    is paid now, the rest as each later window opens). Their lowest price is
 *    a fixed share of the asking price, from a pure hash of the listing; they
 *    accept at it, counter close to it, and three turned-down rounds end the
 *    talks for the window. Walk away at any time.
 * 2. Personal terms, with the player and his agent: a wage, the years, the
 *    squad status and a signing-on fee (the agent wants his cut of the fee).
 *    What he asks follows his value, age, the status and his agent's mood
 *    (`agentMood` in contracts.ts). Three turned-down offers and he stays put.
 *    Agreed terms complete the deal through the market's own bid at the agreed
 *    price, which is accepted with no draw.
 *
 * Selling: answer an AI club's bid with a counter. Each club has a ceiling, a
 * pure hash of the offer: ask within it and they pay; a little over and they
 * come back once with a final offer at the ceiling; far over and they walk.
 *
 * Nothing here draws from the stream.
 */
import type { FeeTalk, Game, Instalment } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { Listing, Offer } from '@engine/market'
import { acceptsStatus, STATUS_LABEL, WAGE_MULT, type SquadStatus } from '@engine/status'
import { playerLookup } from './players'
import { squadWages } from './squad'
import { hashUnit } from './scouting'
import { agentMood, marketWage, type AgentMood } from './contracts'
import { acceptOffer, bidFor, ownedHumans, sellOnValue, SQUAD_CAP, squadOveralls, suggestedStatus } from './marketOps'
import { officeOf, postOfficeNews, roundM, shiftMorale, weekOf, windowKey } from './officeCore'

export type Instalments = 1 | 2 | 3
/** What an instalment deal is worth to the selling club, and the share of the fee paid now. */
export const INSTALMENT_VALUE: Record<Instalments, number> = { 1: 1, 2: 0.94, 3: 0.9 }
export const UPFRONT: Record<Instalments, number> = { 1: 1, 2: 0.5, 3: 0.4 }
/** Rounds the club will sit through before it ends talks for the window (a low-ball counts as two). */
export const MAX_FEE_ROUNDS = 3
/** Offers of personal terms the player turns down before he stays where he is. */
export const MAX_TERMS_OFFERS = 3
/** A deal worth less than this share of their price is not worth a counter. */
export const COUNTER_FLOOR = 0.75
/** The agent's cut of the fee he asks as a signing-on fee, by mood. */
export const AGENT_FEE: Record<AgentMood, number> = { greedy: 0.08, fair: 0.05, loyal: 0.03 }
/** A move is worth more to him than staying: his wage ask over the market rate. */
export const MOVE_PREMIUM = 1.1

export interface FeeDeal {
  fee: number
  /** A sell-on share for the selling club: 0, 0.1 or 0.2. */
  sellOn: number
  instalments: Instalments
}

function listingOf(game: Game, listingId: string): Listing | undefined {
  return game.window?.listings.find((l) => l.playerSeasonId === listingId)
}

/** The selling club's lowest price, GBP millions: 86% to 98% of the asking price by a hash of the listing, 5% more with rivals in. */
export function clubValuation(game: Game, listing: Listing): number {
  const h = hashUnit(`fee|${listing.playerSeasonId}|${windowKey(game) ?? ''}`)
  return roundM(listing.asking * (0.86 + 0.12 * h) * (listing.suitors > 0 ? 1.05 : 1))
}

/** What a deal is worth to the selling club now, GBP millions. */
export function dealValue(p: { value: number }, deal: FeeDeal): number {
  return roundM(deal.fee * INSTALMENT_VALUE[deal.instalments] + sellOnValue(p, deal.sellOn))
}

/** What is paid now and at each later window. */
export function paymentPlan(deal: Pick<FeeDeal, 'fee' | 'instalments'>): { now: number; later: number; payments: number } {
  const now = roundM(deal.fee * UPFRONT[deal.instalments])
  const payments = deal.instalments - 1
  return { now, later: payments ? roundM((deal.fee - now) / payments) : 0, payments }
}

/** The fee talks for a listing in the open window, if any. */
export function feeTalkOf(game: Game, listingId: string): FeeTalk | undefined {
  const t = game.office?.feeTalks?.[listingId]
  return t && t.window === windowKey(game) ? t : undefined
}

/** Why fee talks for this listing cannot go on now, or null. */
export function feeTalksProblem(game: Game, u: LoadedUniverse, listingId: string): string | null {
  const listing = listingOf(game, listingId)
  const p = u.index[listingId]
  if (!game.window || !listing || !p) return 'The window is closed.'
  if (listing.status === 'gone' || listing.status === 'signed') return `${p.name} is no longer available.`
  if (ownedHumans(game, u).has(p.playerId)) return `${p.name} is already in your squad.`
  if (Object.keys(game.squad).length >= SQUAD_CAP) return `Squad is full (${SQUAD_CAP}). Sell someone first.`
  if (feeTalkOf(game, listingId)?.closed) return `${u.clubById[p.clubId]?.name ?? 'The club'} will not talk again this window.`
  return null
}

export interface FeeAnswer {
  ok: boolean
  outcome?: 'agreed' | 'counter' | 'rejected' | 'closed'
  message: string
  counter?: number
}

/** Put a fee to the selling club. Agreed, personal terms come next (`offerTerms`). */
export function proposeFee(game: Game, u: LoadedUniverse, listingId: string, deal: FeeDeal): FeeAnswer {
  const problem = feeTalksProblem(game, u, listingId)
  if (problem) return { ok: false, message: problem }
  const listing = listingOf(game, listingId)!
  const p = u.index[listingId]
  const club = u.clubById[p.clubId]?.shortName ?? 'The club'
  const fee = roundM(Math.max(0.1, deal.fee))
  const sellOn = deal.sellOn >= 0.2 ? 0.2 : deal.sellOn >= 0.1 ? 0.1 : 0
  const instalments: Instalments = deal.instalments === 3 ? 3 : deal.instalments === 2 ? 2 : 1
  const clean: FeeDeal = { fee, sellOn, instalments }
  const plan = paymentPlan(clean)
  if (plan.now > game.finances.budget) return { ok: false, message: `You cannot afford £${plan.now}M now. Budget: £${game.finances.budget}M.` }
  const o = officeOf(game)
  const talks = (o.feeTalks ??= {})
  const talk: FeeTalk = (talks[listingId] = feeTalkOf(game, listingId) ?? { window: windowKey(game)!, rounds: 0 })
  if (talk.agreed) return { ok: false, message: `The fee is agreed: personal terms with ${p.name} are next.` }
  talk.last = clean
  const min = clubValuation(game, listing)
  const value = dealValue(p, clean)
  if (value >= min) {
    talk.agreed = clean
    delete talk.counter
    return { ok: true, outcome: 'agreed', message: `${club} accept £${fee}M${sellOn ? ` with a ${Math.round(sellOn * 100)}% sell-on` : ''}${instalments > 1 ? ` in ${instalments} instalments` : ''}. Now agree personal terms with ${p.name}.` }
  }
  talk.rounds += value >= min * COUNTER_FLOOR ? 1 : 2
  if (talk.rounds >= MAX_FEE_ROUNDS) {
    talk.closed = true
    delete talk.counter
    return { ok: true, outcome: 'closed', message: `${club} have heard enough. They will not talk again this window.` }
  }
  if (value < min * COUNTER_FLOOR) return { ok: true, outcome: 'rejected', message: `${club} laugh it off. Come back with a serious offer (${MAX_FEE_ROUNDS - talk.rounds} more round${MAX_FEE_ROUNDS - talk.rounds === 1 ? '' : 's'}).` }
  // The cash fee that meets their price with the same structure, a little more each round
  const counter = roundM(Math.ceil((((min - sellOnValue(p, sellOn)) / INSTALMENT_VALUE[instalments]) * (1 + 0.03 * talk.rounds)) * 10) / 10)
  talk.counter = counter
  return { ok: true, outcome: 'counter', counter, message: `${club} want £${counter}M${sellOn ? ` with the sell-on` : ''}${instalments > 1 ? ` in ${instalments} instalments` : ''}.` }
}

/** Walk away from the fee talks (the listing stays on the market). */
export function walkAway(game: Game, listingId: string): void {
  const talks = game.office?.feeTalks
  if (talks) delete talks[listingId]
}

export interface TermsOffer {
  /** GBP thousands a week. */
  wage: number
  years: number
  status: SquadStatus
  /** A signing-on fee, GBP millions (his agent's cut is in it). */
  signingFee: number
}

export interface TermsDemand {
  mood: AgentMood
  /** Weekly wage he asks, GBP thousands: the score an offer must reach. */
  wage: number
  maxYears: number
  /** What his agent wants as a signing-on fee, GBP millions: a greedy agent will not go under it. */
  agentFee: number
  /** The status he would sign on, and why not when he would not. */
  statusOk: boolean
  statusWhy?: string
  counterStatus?: SquadStatus
  why: string[]
}

/** What he asks to join at `status`, once the fee is agreed. */
export function termsDemand(game: Game, u: LoadedUniverse, listingId: string, status: SquadStatus): TermsDemand | null {
  const p = u.index[listingId]
  const agreed = feeTalkOf(game, listingId)?.agreed
  if (!p || !agreed) return null
  const mood = agentMood(p.playerId)
  const why: string[] = []
  let wage = Math.max(p.wage, marketWage(p)) * WAGE_MULT[status] * MOVE_PREMIUM
  why.push('a move: 10% over what he earns')
  if (p.age >= 31) {
    wage *= 0.9
    why.push('at 31 or over he asks 10% less')
  } else if (p.age <= 23) {
    wage *= 1.05
    why.push('young: 5% more for his potential')
  }
  wage *= { greedy: 1.15, fair: 1, loyal: 0.9 }[mood]
  if (mood !== 'fair') why.push(mood === 'greedy' ? 'greedy agent: 15% more' : 'easy-going agent: 10% less')
  const answer = acceptsStatus(p, squadOveralls(game, u), status)
  return { mood, wage: Math.round(wage), maxYears: p.age >= 33 ? 2 : p.age >= 30 ? 3 : 5, agentFee: roundM(agreed.fee * AGENT_FEE[mood]), statusOk: answer.ok, statusWhy: answer.reason, counterStatus: answer.counter, why }
}

/** The status the terms open with: where he would rank in the squad. */
export function openingStatus(game: Game, u: LoadedUniverse, listingId: string): SquadStatus {
  const p = u.index[listingId]
  return p ? suggestedStatus(game, u, p) : 'rotation'
}

/** An offer's worth to him, GBP thousands a week: the wage and the signing-on fee spread over the contract. */
export function termsScore(offer: TermsOffer, demand: TermsDemand): number {
  const years = Math.max(1, offer.years)
  // A signing-on fee over his agent's cut is money in his pocket; under it, the agent takes the gap out of the deal
  return Math.round((offer.wage + ((offer.signingFee - demand.agentFee) * 1000) / (52 * years)) * 10) / 10
}

/** Would he sign on these terms? The reasons he would not. */
export function termsVerdict(game: Game, u: LoadedUniverse, listingId: string, offer: TermsOffer): { accepted: boolean; reasons: string[]; demand: TermsDemand } | null {
  const demand = termsDemand(game, u, listingId, offer.status)
  if (!demand) return null
  const reasons: string[] = []
  if (!demand.statusOk) reasons.push(demand.statusWhy ?? `He will not sign as ${STATUS_LABEL[offer.status].toLowerCase()}.`)
  if (offer.years < 1 || offer.years > demand.maxYears) reasons.push(`He will sign for 1 to ${demand.maxYears} seasons.`)
  if (demand.mood === 'greedy' && offer.signingFee < demand.agentFee) reasons.push(`His agent wants £${demand.agentFee}M to sign, not a penny less.`)
  const score = termsScore(offer, demand)
  if (score < demand.wage) reasons.push(`The package is worth £${Math.round(score)}k a week to him; he wants £${demand.wage}k.`)
  return { accepted: reasons.length === 0, reasons, demand }
}

/**
 * Offer him personal terms. Accepted, the deal is done: the market's bid at the agreed price (the first payment of
 * instalments), his wage, years, sell-on and signing-on fee written in, and any instalments booked.
 */
export function offerTerms(game: Game, u: LoadedUniverse, listingId: string, offer: TermsOffer): { ok: boolean; signed?: boolean; message: string } {
  const problem = feeTalksProblem(game, u, listingId)
  if (problem) return { ok: false, message: problem }
  const talk = feeTalkOf(game, listingId)
  const p = u.index[listingId]
  if (!talk?.agreed || !p) return { ok: false, message: 'Agree a fee with his club first.' }
  const wage = Math.max(1, Math.round(offer.wage))
  const signingFee = roundM(Math.max(0, offer.signingFee))
  const deal = talk.agreed
  const plan = paymentPlan(deal)
  if (plan.now + signingFee > game.finances.budget) return { ok: false, message: `£${roundM(plan.now + signingFee)}M now (the fee and his signing-on fee) is more than the £${game.finances.budget}M budget.` }
  if (squadWages(game, u) + wage > game.finances.wageCap) return { ok: false, message: `£${wage}k a week would break the wage cap (£${game.finances.wageCap}k a week).` }
  const v = termsVerdict(game, u, listingId, { ...offer, wage, signingFee })
  if (!v) return { ok: false, message: 'Agree a fee with his club first.' }
  if (!v.accepted) {
    talk.termsFailed = (talk.termsFailed ?? 0) + 1
    if (talk.termsFailed >= MAX_TERMS_OFFERS) {
      talk.closed = true
      delete talk.agreed
      return { ok: true, signed: false, message: `${v.reasons[0]} That is three: ${p.name} decides to stay where he is.` }
    }
    return { ok: true, signed: false, message: `${v.reasons[0]} (${MAX_TERMS_OFFERS - talk.termsFailed} more and he walks.)` }
  }
  const listing = listingOf(game, listingId)!
  // The market's own bid at the price now due: an amount at the asking price is accepted with no draw
  const { asking, opening } = listing
  listing.asking = plan.now
  listing.opening = roundM((opening * plan.now) / deal.fee)
  const out = bidFor(game, u, listingId, plan.now, { status: offer.status, years: Math.min(4, offer.years) })
  listing.opening = opening
  if (!out.accepted) {
    // Refused before any bid was placed (the market's own checks): the listing goes back as it was, its asking price the club's, not the agreed fee (r9)
    listing.asking = asking
    return { ok: false, message: out.message }
  }
  listing.asking = deal.fee
  listing.bid = deal.fee
  const c = game.contracts[p.id]
  if (c) {
    c.years = Math.max(1, Math.round(offer.years))
    if (deal.sellOn > 0) c.sellOn = { pct: deal.sellOn, clubId: p.clubId }
  }
  game.customPlayers[p.id] = { ...(game.customPlayers[p.id] ?? p), wage }
  if (signingFee > 0) {
    game.finances.budget = roundM(game.finances.budget - signingFee)
    game.finances.spent = roundM(game.finances.spent + signingFee)
  }
  if (plan.payments) {
    const inst: Instalment = { name: p.name, clubId: p.clubId, amount: plan.later, left: plan.payments, window: windowKey(game)! }
    ;(officeOf(game).instalments ??= []).push(inst)
  }
  delete officeOf(game).feeTalks![listingId]
  const s = game.squad[p.id]
  if (s) shiftMorale(s, weekOf(game), 4, 'Signed on the terms he wanted')
  const terms = [`£${deal.fee}M`, plan.payments ? `£${plan.now}M now and ${plan.payments} × £${plan.later}M at the next window${plan.payments > 1 ? 's' : ''}` : '', deal.sellOn ? `${Math.round(deal.sellOn * 100)}% sell-on` : '', `£${wage}k a week`, `${c?.years ?? offer.years} seasons as ${STATUS_LABEL[offer.status].toLowerCase()}`, signingFee ? `£${signingFee}M to sign` : ''].filter(Boolean).join(', ')
  if (game.season) postOfficeNews(game, { matchweek: weekOf(game), kind: 'transfer', title: `Terms agreed: ${p.name}`, body: `${terms}.`, playerId: p.id })
  return { ok: true, signed: true, message: `${p.name} signs: ${terms}.` }
}

/** An AI club's bid's key: the player, the club and the day it came. */
export function offerKey(o: Pick<Offer, 'playerSeasonId' | 'fromClubId' | 'day'>): string {
  return `${o.playerSeasonId}|${o.fromClubId}|${o.day}`
}

/** The most an AI club will pay after a counter, GBP millions: 8% to 30% over its bid, by a pure hash of the bid. */
export function clubCeiling(game: Game, o: Offer): number {
  return roundM(o.amount * (1.08 + 0.22 * hashUnit(`sell|${offerKey(o)}|${game.year}`)))
}

/** Our counter-talk on an open bid, if any (its final offer). */
export function sellTalkOf(game: Game, o: Offer) {
  const t = game.office?.sellTalks?.[offerKey(o)]
  return t && t.window === windowKey(game) ? t : undefined
}

/** Counter an AI club's bid for one of our men with `amount` (GBP millions). */
export function counterBid(game: Game, u: LoadedUniverse, index: number, amount: number): { ok: boolean; sold?: boolean; message: string } {
  const w = game.window
  const o = w?.offers[index]
  if (!w || !o || o.status !== 'open') return { ok: false, message: 'That offer is no longer on the table.' }
  const p = playerLookup(game, u)(o.playerSeasonId)
  if (!p || !game.squad[o.playerSeasonId]) return { ok: false, message: 'He is no longer yours to sell.' }
  if (game.contracts[o.playerSeasonId]?.loan) return { ok: false, message: `${p.name} is only on loan here.` }
  const club = u.clubById[o.fromClubId]?.shortName ?? 'They'
  if (sellTalkOf(game, o)?.final !== undefined) return { ok: false, message: `${club} have made their final offer: accept it or reject it.` }
  const ask = roundM(amount)
  if (ask <= o.amount) return { ok: false, message: `Ask for more than the £${o.amount}M they offer, or accept it.` }
  const ceiling = clubCeiling(game, o)
  const talks = (officeOf(game).sellTalks ??= {})
  const key = offerKey(o)
  if (ask <= ceiling) {
    o.amount = ask
    acceptOffer(game, u, index)
    return { ok: true, sold: true, message: `${club} meet your price: ${p.name} is sold for £${ask}M.` }
  }
  if (ask <= ceiling * 1.2) {
    o.amount = ceiling
    talks[key] = { window: windowKey(game)!, final: ceiling }
    return { ok: true, message: `${club} will not go to £${ask}M. Their final offer: £${ceiling}M.` }
  }
  o.status = 'withdrawn'
  talks[key] = { window: windowKey(game)!, walked: true }
  return { ok: true, message: `${club} walk away: £${ask}M is not a price they will pay.` }
}

/**
 * Instalments: one payment falls due as each window after the deal opens (in a Season, whatever is left is settled
 * at the final matchweek). Called by the office's tick; an empty list writes nothing.
 */
export function payInstalments(game: Game): void {
  const list = game.office?.instalments
  if (!list?.length) return
  const key = windowKey(game)
  const season = game.season
  const settleAll = game.settings.mode !== 'dynasty' && !!season && season.matchweek >= season.matchweeks
  for (let i = list.length - 1; i >= 0; i--) {
    const inst = list[i]
    let n = 0
    if (settleAll) n = inst.left
    else if (key && inst.window !== key) n = 1
    if (!n) continue
    const amount = roundM(inst.amount * n)
    game.finances.budget = roundM(game.finances.budget - amount)
    game.finances.spent = roundM(game.finances.spent + amount)
    inst.left -= n
    if (key) inst.window = key
    if (season) postOfficeNews(game, { matchweek: weekOf(game), kind: 'transfer', title: `Instalment paid: ${inst.name}`, body: `£${amount}M to his old club.${inst.left ? ` ${inst.left} more to come.` : ' The fee is paid off.'}` })
    if (inst.left <= 0) list.splice(i, 1)
  }
}

/** Fee talks and counters of a window that has closed are let go. */
export function closeStaleTalks(game: Game): void {
  const o = game.office
  if (!o) return
  const key = windowKey(game)
  for (const store of [o.feeTalks, o.sellTalks]) {
    if (!store) continue
    for (const [k, v] of Object.entries(store)) if (v.window !== key) delete store[k]
  }
}
