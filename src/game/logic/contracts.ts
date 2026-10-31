/**
 * Contract talks and agents (FM-depth Batch 2). Open talks with any player in
 * the squad at any time. What he asks is a fixed function of his value, the
 * status offered, his age, his morale and his agent's mood (a hash of the
 * player: greedy, fair or loyal), and an offer is accepted when its weighted
 * score reaches the demand, with no dice. Each term is negotiable, locked (a
 * floor the agent will not go under) or excluded (off the table). A turned-down
 * offer annoys him; three end the talks for four weeks.
 *
 * Clauses: a signing fee (paid from the budget now), a release clause (an AI
 * club may pay it in a window: `releaseClauses` in marketOps.ts), appearance
 * and goal bonuses (paid with the weekly wages). The renewal event stays as it
 * was. Nothing here draws from the stream.
 */
import type { ContractClauses, Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { PlayerMatchStats, PlayerSeason, Position } from '@engine/types'
import { EXPECTED_SHARE, naturalStatus, STATUS_LABEL, STATUS_RANK, WAGE_MULT, type SquadStatus } from '@engine/status'
import { playerLookup } from './players'
import { squadWages } from './squad'
import { postNews } from './news'
import { logMorale } from './happiness'
import { hashUnit } from './scouting'
import { squadOveralls } from './marketOps'

export type AgentMood = 'greedy' | 'fair' | 'loyal'
export type TermKey = 'wage' | 'years' | 'signingFee' | 'release' | 'appearance' | 'goal'
export type Stance = 'negotiable' | 'locked' | 'excluded'

export const AGENT_MOOD_LABEL: Record<AgentMood, string> = { greedy: 'Greedy', fair: 'Fair', loyal: 'Loyal' }
export const AGENT_MOOD_HELP: Record<AgentMood, string> = {
  greedy: 'Wants top money: the wage is locked at 90% of his ask, and a signing fee or a low release clause count for more.',
  fair: 'Every term is open: the offer only has to add up.',
  loyal: 'Happy here: asks less, values a signing fee less and will not discuss a release clause.',
}
/** Offers turned down before the agent ends talks, and the matchweeks they stay closed. */
export const MAX_FAILED_OFFERS = 3
export const TALKS_CLOSED_WEEKS = 4
/** Morale a turned-down offer costs, and an agreed contract adds. */
export const REFUSAL_MORALE = -5
export const AGREED_MORALE = 4

/** An offer on the table. Money in GBP: the wage and bonuses in thousands, the fee and the release clause in millions. */
export interface ContractOffer {
  wage: number
  /** Seasons, this one included. */
  years: number
  status: SquadStatus
  signingFee: number
  /** Release clause, GBP millions; absent for none. */
  release?: number
  appearance: number
  goal: number
}

export interface ContractDemand {
  mood: AgentMood
  /** The weekly wage he asks for at the offered status, GBP thousands: the score an offer must reach. */
  wage: number
  maxYears: number
  stances: Record<TermKey, Stance>
  /** A locked wage: the lowest weekly wage the agent will accept. */
  wageFloor?: number
  /** Why he asks what he asks, for the talks screen. */
  why: string[]
}

/** The agent's mood, a pure hash of the player: about 30% greedy, 45% fair, 25% loyal. */
export function agentMood(playerId: string): AgentMood {
  const h = hashUnit(`agent|${playerId}`)
  return h < 0.3 ? 'greedy' : h < 0.75 ? 'fair' : 'loyal'
}

/** What his value earns on the open market, GBP thousands a week (the formula ageing prices wages with). */
export function marketWage(p: Pick<PlayerSeason, 'value'>): number {
  return Math.round(5 * Math.pow(Math.max(0.1, p.value), 0.85))
}

/** Goals a week a player in this position is expected to score, for valuing a goal bonus. */
const GOAL_RATE: Record<Position, number> = { GK: 0, CB: 0.04, LB: 0.04, RB: 0.04, DM: 0.06, CM: 0.12, AM: 0.3, LW: 0.3, RW: 0.3, ST: 0.45 }

const MOOD_WAGE: Record<AgentMood, number> = { greedy: 1.15, fair: 1, loyal: 0.9 }
const MOOD_FEE: Record<AgentMood, number> = { greedy: 1.2, fair: 1, loyal: 0.8 }
const MOOD_RELEASE: Record<AgentMood, number> = { greedy: 1.5, fair: 1, loyal: 0 }

function currentStatus(game: Game, id: string): SquadStatus {
  return game.contracts[id]?.status ?? 'rotation'
}

/** What the player asks for at `status`: a fixed function of his value, status, age, morale and his agent's mood. */
export function contractDemand(game: Game, u: LoadedUniverse, id: string, status: SquadStatus): ContractDemand | null {
  const p = playerLookup(game, u)(id)
  const s = game.squad[id]
  if (!p || !s) return null
  const mood = agentMood(p.playerId)
  const why: string[] = []
  const now = currentStatus(game, id)
  const statusRatio = WAGE_MULT[status] / WAGE_MULT[now]
  // He never asks for less than he earns (scaled to the status offered), nor less than the market pays his value
  let wage = Math.max(p.wage * statusRatio, marketWage(p) * WAGE_MULT[status])
  if (p.age >= 31) {
    wage *= 0.9
    why.push('at 31 or over he asks 10% less')
  } else if (p.age <= 23) {
    wage *= 1.05
    why.push('young: 5% more for his potential')
  }
  if (s.morale >= 75) {
    wage *= 0.95
    why.push('happy here: 5% less')
  } else if (s.morale < 45) {
    wage *= 1.15
    why.push('unhappy: 15% more to stay')
  }
  wage *= MOOD_WAGE[mood]
  if (mood !== 'fair') why.push(mood === 'greedy' ? 'greedy agent: 15% more' : 'loyal: 10% less')
  // A status beneath the one he holds hurts his pride: 10% more a step down
  const down = Math.max(0, STATUS_RANK[now] - STATUS_RANK[status])
  if (down) {
    wage *= 1 + 0.1 * down
    why.push(`a step down from ${STATUS_LABEL[now].toLowerCase()}: ${10 * down}% more`)
  }
  const ask = Math.round(wage)
  const stances: Record<TermKey, Stance> = { wage: mood === 'greedy' ? 'locked' : 'negotiable', years: 'negotiable', signingFee: 'negotiable', release: mood === 'loyal' ? 'excluded' : 'negotiable', appearance: 'negotiable', goal: 'negotiable' }
  return { mood, wage: ask, maxYears: p.age >= 33 ? 2 : 5, stances, wageFloor: mood === 'greedy' ? Math.round(ask * 0.9) : undefined, why }
}

/** An offer's weighted score in GBP thousands a week, the same unit as the demand. */
export function offerScore(game: Game, u: LoadedUniverse, id: string, offer: ContractOffer, demand: ContractDemand): number {
  const p = playerLookup(game, u)(id)
  if (!p) return 0
  const years = Math.max(1, offer.years)
  let score = offer.wage
  // A signing fee spread over the contract's weeks
  score += ((offer.signingFee * 1000) / (52 * years)) * MOOD_FEE[demand.mood]
  // Bonuses at the football his status expects
  score += offer.appearance * EXPECTED_SHARE[offer.status] * 0.8
  score += offer.goal * GOAL_RATE[p.positions[0]] * 0.7
  // A release clause buys him a way out: the lower it sits against his value, the more it is worth to him
  if (offer.release !== undefined && offer.release > 0) {
    const r = offer.release / Math.max(0.5, p.value)
    score += demand.wage * (r <= 1.5 ? 0.1 : r <= 3 ? 0.05 : 0.02) * MOOD_RELEASE[demand.mood]
  }
  // Past 30, every season of security beyond two is worth 4% of his ask
  if (p.age >= 30) score += Math.max(0, years - 2) * 0.04 * demand.wage
  return Math.round(score * 10) / 10
}

export interface OfferVerdict {
  accepted: boolean
  score: number
  demand: ContractDemand
  /** What stops it, when it is refused. */
  reasons: string[]
}

/** Would he sign this? Accepted when no excluded term is used, every locked term is met and the score reaches his ask. */
export function evaluateOffer(game: Game, u: LoadedUniverse, id: string, offer: ContractOffer): OfferVerdict | null {
  const demand = contractDemand(game, u, id, offer.status)
  if (!demand) return null
  const score = offerScore(game, u, id, offer, demand)
  const reasons: string[] = []
  if (demand.stances.release === 'excluded' && offer.release !== undefined && offer.release > 0) reasons.push('He will not discuss a release clause.')
  if (demand.wageFloor !== undefined && offer.wage < demand.wageFloor) reasons.push(`His agent will not go under £${demand.wageFloor}k a week.`)
  if (offer.years < 1 || offer.years > demand.maxYears) reasons.push(`He will sign for 1 to ${demand.maxYears} seasons.`)
  if (score < demand.wage) reasons.push(`The offer is worth £${Math.round(score)}k a week to him; he wants £${demand.wage}k.`)
  return { accepted: reasons.length === 0, score, demand, reasons }
}

/** Talks with this player are closed until a matchweek after three turned-down offers; null when they are open. */
export function talksClosedUntil(game: Game, u: LoadedUniverse, id: string): number | null {
  const p = playerLookup(game, u)(id)
  if (!p) return null
  const n = game.negotiations?.[p.playerId]
  const mw = game.season?.matchweek ?? 0
  return n?.closedUntil !== undefined && n.closedUntil > mw ? n.closedUntil : null
}

/** The offer the talks open with: his current terms, his wage raised to the ask at his current status. */
export function openingOffer(game: Game, u: LoadedUniverse, id: string): ContractOffer | null {
  const p = playerLookup(game, u)(id)
  const c = game.contracts[id]
  if (!p || !c) return null
  const status = currentStatus(game, id)
  const demand = contractDemand(game, u, id, status)
  return { wage: Math.max(p.wage, demand?.wage ?? p.wage), years: Math.min(demand?.maxYears ?? 3, Math.max(2, c.years + 1)), status, signingFee: 0, release: c.clauses?.release, appearance: c.clauses?.appearance ?? 0, goal: c.clauses?.goal ?? 0 }
}

/**
 * Put an offer to him. Accepted: the new terms replace the contract (a renewal
 * flag or a declined one is cleared), the wage goes into `customPlayers` and the
 * signing fee comes out of the budget. Refused: he is annoyed, and the third
 * refusal closes talks for four matchweeks.
 */
export function proposeContract(game: Game, u: LoadedUniverse, id: string, offer: ContractOffer, opts: { quiet?: boolean } = {}): { accepted: boolean; message: string } {
  const p = playerLookup(game, u)(id)
  const s = game.squad[id]
  const c = game.contracts[id]
  if (!p || !s || !c) return { accepted: false, message: 'He is not in your squad.' }
  if (c.loan) return { accepted: false, message: `${p.name} is on loan: his parent club holds his contract.` }
  const closed = talksClosedUntil(game, u, id)
  if (closed !== null) return { accepted: false, message: `His agent will not talk until after matchweek ${closed}.` }
  const fee = Math.max(0, Math.round(offer.signingFee * 10) / 10)
  if (fee > game.finances.budget) return { accepted: false, message: `You cannot afford a £${fee}M signing fee. Budget: £${game.finances.budget}M.` }
  const wage = Math.max(1, Math.round(offer.wage))
  if (squadWages(game, u) - p.wage + wage > game.finances.wageCap) return { accepted: false, message: `£${wage}k a week would break the wage cap (£${game.finances.wageCap}k a week).` }
  const v = evaluateOffer(game, u, id, { ...offer, wage, signingFee: fee })
  if (!v) return { accepted: false, message: 'He is not in your squad.' }
  const mw = game.season?.matchweek ?? 0
  const book = (game.negotiations ??= {})
  if (!v.accepted) {
    const n = (book[p.playerId] ??= { fails: 0 })
    n.fails += 1
    const before = s.morale
    s.morale = Math.max(10, Math.min(100, s.morale + REFUSAL_MORALE))
    logMorale(s, mw, before, 'talk', 'contract-no')
    if (n.fails >= MAX_FAILED_OFFERS) {
      n.fails = 0
      n.closedUntil = mw + TALKS_CLOSED_WEEKS
      return { accepted: false, message: `${v.reasons[0]} That is three offers: his agent ends talks until after matchweek ${n.closedUntil}.` }
    }
    return { accepted: false, message: `${v.reasons[0]} (${MAX_FAILED_OFFERS - n.fails} more and talks end.)` }
  }
  delete book[p.playerId]
  c.years = Math.max(1, Math.round(offer.years))
  c.status = offer.status
  // The agreed wage is for this status: the Club tab's earlier raises no longer stand above it
  delete c.paidStatus
  delete c.renewed
  delete c.declined
  delete c.expired
  const clauses: ContractClauses = {}
  if (offer.release !== undefined && offer.release > 0) clauses.release = Math.round(offer.release * 10) / 10
  if (offer.appearance > 0) clauses.appearance = Math.round(offer.appearance)
  if (offer.goal > 0) clauses.goal = Math.round(offer.goal)
  if (Object.keys(clauses).length) c.clauses = clauses
  else delete c.clauses
  if (wage !== p.wage) game.customPlayers[p.id] = { ...p, wage }
  if (fee > 0) {
    game.finances.budget = Math.round((game.finances.budget - fee) * 10) / 10
    game.finances.spent += fee
  }
  const before = s.morale
  s.morale = Math.max(10, Math.min(100, s.morale + AGREED_MORALE))
  logMorale(s, mw, before, 'talk', 'contract-yes')
  const terms = [`£${wage}k a week`, `${c.years} season${c.years === 1 ? '' : 's'}`, STATUS_LABEL[offer.status].toLowerCase(), fee ? `£${fee}M to sign` : '', clauses.release ? `£${clauses.release}M release clause` : '', clauses.appearance ? `£${clauses.appearance}k an appearance` : '', clauses.goal ? `£${clauses.goal}k a goal` : ''].filter(Boolean).join(', ')
  // `quiet`: the summer opener's renewals, which one "Contracts settled" item lists (r8: ten items at once were spam)
  if (game.season && !opts.quiet) postNews(game, { matchweek: mw, kind: 'transfer', title: `${p.name} signs a new contract`, body: `${terms}.`, playerId: id })
  return { accepted: true, message: `${p.name} signs: ${terms}.` }
}

/** Appearance and goal bonuses earned in one match, added to `game.bonusDue` (paid with the next weekly wages). */
export function accrueBonuses(game: Game, stats: PlayerMatchStats[]): void {
  let due = 0
  for (const st of stats) {
    const c = game.contracts[st.playerSeasonId]?.clauses
    if (!c || !game.squad[st.playerSeasonId]) continue
    due += (c.appearance ?? 0) + st.goals * (c.goal ?? 0)
  }
  if (due > 0) game.bonusDue = (game.bonusDue ?? 0) + due
}

/** The bonuses due this week, GBP thousands, cleared and booked in `finances.bonusesPaid`; 0 (and nothing written) with none. */
export function takeBonuses(game: Game): number {
  const due = game.bonusDue ?? 0
  if (due <= 0) return 0
  delete game.bonusDue
  game.finances.bonusesPaid = (game.finances.bonusesPaid ?? 0) + due / 1000
  return due
}

/** What his agent says: his mood, whether the player would welcome a move, and whether he is being shopped. */
export function agentView(game: Game, u: LoadedUniverse, id: string): { mood: AgentMood; wouldLeave: boolean; why: string; shopped: boolean } | null {
  const p = playerLookup(game, u)(id)
  const s = game.squad[id]
  const c = game.contracts[id]
  if (!p || !s || !c) return null
  const mood = agentMood(p.playerId)
  const natural = naturalStatus(p, squadOveralls(game, u, id))
  const reasons: string[] = []
  if (s.morale < 50) reasons.push('he is unhappy')
  if (STATUS_RANK[currentStatus(game, id)] < STATUS_RANK[natural]) reasons.push(`he sees himself as ${STATUS_LABEL[natural].toLowerCase()}`)
  if (c.listed) reasons.push('you have listed him')
  const wouldLeave = reasons.length > 0
  return { mood, wouldLeave, why: wouldLeave ? `He would listen: ${reasons.join(', ')}.` : 'He is settled and would rather stay.', shopped: !!c.shopped }
}

/**
 * Have his agent find a buyer (or stop): offers then come in the window as for
 * a listed player, and the agent takes 5% of the fee. A settled player resents
 * being shopped (−4 morale).
 */
export function setShopped(game: Game, u: LoadedUniverse, id: string, on: boolean): { ok: boolean; message: string } {
  const view = agentView(game, u, id)
  const c = game.contracts[id]
  const s = game.squad[id]
  const p = playerLookup(game, u)(id)
  if (!view || !c || !s || !p) return { ok: false, message: 'He is not in your squad.' }
  if (c.loan) return { ok: false, message: `${p.name} is on loan: he is not yours to sell.` }
  if (!on) {
    delete c.shopped
    return { ok: true, message: `His agent stops looking for a buyer.` }
  }
  c.shopped = true
  if (!view.wouldLeave) {
    const before = s.morale
    s.morale = Math.max(10, s.morale - 4)
    logMorale(s, game.season?.matchweek ?? 0, before, 'talk', 'shopped')
  }
  return { ok: true, message: `His agent is finding a buyer: offers come in the window as for a listed player, and he takes 5% of the fee.${view.wouldLeave ? '' : ' He is not pleased to be shopped.'}` }
}
