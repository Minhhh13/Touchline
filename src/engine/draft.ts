/**
 * The wheel and the draft rules, straight from 38-0 with a few refinements:
 *  - spins never land on a club-season that cannot help you (no dead spins);
 *  - a human being can be drafted once, whatever the season;
 *  - squad drafts fill eleven starting slots first, then bench places;
 *  - optional filters: era, one club, one nation, hard mode (ratings hidden in the UI);
 *  - optional twists: every third spin is a golden, basement, blind or decade spin.
 */
import type { ClubSeason, Formation, PlayerSeason, Position } from './types'
import type { Rng } from './rng'
import { canCover, describeFit, type Fit } from './positions'
import type { LoadedUniverse } from './universe'

export interface DraftRules {
  /** Players to draft in total: 11 for a quick XI, 16-18 for a season squad. */
  squadSize: number
  /** Re-spins allowed over the whole draft. */
  respins: number
  /** Only club-seasons from this season onwards. */
  fromSeason?: number
  /** Only club-seasons up to this season. */
  toSeason?: number
  /** Restrict the wheel to one club's history. */
  onlyClub?: string
  /** Only players of this nationality may be drafted (ISO3 as stored in `PlayerSeason.nationality`). */
  onlyNation?: string
  /** Leagues the wheel may land on; all loaded leagues when omitted. */
  leagues?: string[]
  /** Minimum position fit required to draft into a starting slot. */
  minFit: Fit
  /** Hide ratings in the UI (engine ignores this). */
  hardMode: boolean
  /** Prevent the same club-season from appearing twice. */
  uniqueClubSeasons: boolean
  /** Every third spin carries a twist (section 5 of the design doc). Off when omitted, so older saves are unchanged. */
  twists?: boolean
  /**
   * Salary cap in £M (the Moneyball wheel): every player carries an age-neutral price (`capPrice`) and the draft
   * may not spend more than this. Off when omitted, so a draft without it draws and plays exactly as before.
   */
  budget?: number
}

/**
 * A twist narrows one spin of the wheel:
 *  - golden: only title-winning club-seasons;
 *  - basement: only the bottom three of their league that season;
 *  - blind: the wheel is normal but ratings are hidden for the pick;
 *  - decade: only club-seasons from the decade of your last pick.
 */
export type Twist = 'golden' | 'basement' | 'blind' | 'decade'
export const TWISTS: readonly Twist[] = ['golden', 'basement', 'blind', 'decade']
/** A twist arrives on every spin whose number is a multiple of this. */
export const TWIST_EVERY = 3

export const QUICK_RULES: DraftRules = { squadSize: 11, respins: 2, minFit: 'accomplished', hardMode: false, uniqueClubSeasons: true, twists: true }
export const SEASON_RULES: DraftRules = { squadSize: 18, respins: 3, minFit: 'accomplished', hardMode: false, uniqueClubSeasons: false, twists: false }

export interface DraftState {
  rules: DraftRules
  formation: Formation
  /** slot id -> player-season id */
  lineup: Record<string, string>
  bench: string[]
  /** Human ids already drafted (prevents drafting the same player twice). */
  takenPlayers: string[]
  usedClubSeasons: string[]
  respinsLeft: number
  /** The club-season currently showing, if a spin is pending a pick. */
  current: { clubId: string; season: number } | null
  spins: number
  /**
   * Every spin in order: the pick made on it, or nulls for a re-spin; `skipped` marks a pending spin
   * the assistant discarded on "Auto-complete" (it consumed the RNG like any other, so a replay needs it).
   */
  history: Array<{ clubId: string; season: number; pickedId: string | null; slotId: string | null; twist?: Twist; skipped?: boolean }>
  /** The twist on the spin currently showing; null (or absent, in an older save) when the spin is a plain one. */
  twist?: Twist | null
  /** £M spent under the salary cap; absent when the draft has no cap, or before its first pick. */
  spent?: number
}

export function newDraft(formation: Formation, rules: DraftRules): DraftState {
  return { rules, formation, lineup: {}, bench: [], takenPlayers: [], usedClubSeasons: [], respinsLeft: rules.respins, current: null, spins: 0, history: [], twist: null }
}

/** Whether the next spin of this draft is a twist spin. */
export function nextSpinTwisted(d: DraftState): boolean {
  return !!d.rules.twists && (d.spins + 1) % TWIST_EVERY === 0
}

/** The decade (2010 for 2010-2019) a decade twist is pinned to: that of the last pick, or null before any pick. */
export function twistDecade(d: DraftState): number | null {
  for (let i = d.history.length - 1; i >= 0; i--) {
    const h = d.history[i]
    if (h.pickedId) return Math.floor(h.season / 10) * 10
  }
  return null
}

/** Whether a club-season passes a twist. */
function twistAllows(u: LoadedUniverse, d: DraftState, twist: Twist | null | undefined, cs: ClubSeason): boolean {
  switch (twist) {
    case 'golden':
      return cs.champions
    case 'basement': {
      // Bottom three of the final table; leagues without tables (position 0) never qualify
      const clubsThatSeason = u.tables[cs.leagueId]?.[cs.season]?.length ?? 0
      return cs.position > 0 && clubsThatSeason > 0 && cs.position >= clubsThatSeason - 2
    }
    case 'decade': {
      const decade = twistDecade(d)
      return decade !== null && Math.floor(cs.season / 10) * 10 === decade
    }
    default:
      return true
  }
}

export function openSlots(d: DraftState): Formation['slots'] {
  return d.formation.slots.filter((s) => !d.lineup[s.id])
}

export function picksMade(d: DraftState): number {
  return Object.keys(d.lineup).length + d.bench.length
}

export function isComplete(d: DraftState): boolean {
  return picksMade(d) >= d.rules.squadSize
}

/** Whether we are still filling the XI (true) or the bench (false). */
export function fillingXI(d: DraftState): boolean {
  return openSlots(d).length > 0
}

/**
 * The salary cap's price of a player by his first position: the data pipeline's own model value
 * (`scripts/import/build.mjs`) at peak age, so it ignores age on purpose. On the real `value` an
 * 80+ player of 33 costs about a quarter of a younger one, and a quick season has no ageing, so
 * the oldest good man in every squad would be the only plan.
 */
export const POS_FACTOR: Record<Position, number> = { GK: 0.75, CB: 0.9, LB: 0.85, RB: 0.85, DM: 1, CM: 1, AM: 1.1, LW: 1.1, RW: 1.1, ST: 1.15 }
/** The cheapest price any player carries, £M. */
export const CAP_MIN_PRICE = 0.3
/** £M the cap keeps back for every pick still to make after this one, so the wheel never runs dry: every position has players at this price or less. */
export const BUDGET_FLOOR = 0.5
/** How much a preset grows for each pick beyond eleven: Moneyball's £180M is £252M for 16 picks. */
export const CAP_SQUAD_STEP = 0.08

const round1 = (x: number) => Math.round(x * 10) / 10

/** A player's price under the salary cap, £M to one decimal: `max(0.3, 0.25 × 1.21^(rating − 60) × POS_FACTOR)`. */
export function capPrice(p: Pick<PlayerSeason, 'overall' | 'positions'>, rating: number = p.overall): number {
  return Math.max(CAP_MIN_PRICE, round1(0.25 * Math.pow(1.21, rating - 60) * (POS_FACTOR[p.positions[0]] ?? 1)))
}

/** A cap set for an XI, scaled to a squad of `squadSize` picks, whole £M. */
export function capForSquad(xiCap: number, squadSize: number): number {
  return Math.round(xiCap * (1 + CAP_SQUAD_STEP * (squadSize - 11)))
}

/** The XI cap a squad's budget was scaled from (the inverse of `capForSquad`, before its rounding). */
export function xiCapOf(budget: number, squadSize: number): number {
  return budget / (1 + CAP_SQUAD_STEP * (squadSize - 11))
}

/** £M spent so far under the cap (0 without one). */
export function capSpent(d: DraftState): number {
  return d.spent ?? 0
}

/** The most the next pick may cost: what is left of the cap after keeping `BUDGET_FLOOR` for every pick still to make after it. Infinite without a cap. */
export function capRoom(d: DraftState): number {
  const budget = d.rules.budget
  if (budget === undefined) return Infinity
  const after = Math.max(0, d.rules.squadSize - picksMade(d) - 1)
  return round1(budget - capSpent(d) - BUDGET_FLOOR * after)
}

/**
 * Whether the salary cap can share a draft with its other rules. One club or one nation narrows the pool until a
 * position may have nobody at `BUDGET_FLOOR` (no Brazilian keeper in England is that cheap), so the floor could not
 * keep the wheel alive and a frugal-last draft would strand short of an XI: the cap goes with neither.
 */
export function capFits(r: Pick<DraftRules, 'budget' | 'onlyClub' | 'onlyNation'>): boolean {
  return r.budget === undefined || (!r.onlyClub && !r.onlyNation)
}

/** The one affordability rule every usability check shares: always true without a cap. */
export function affordable(d: DraftState, p: Pick<PlayerSeason, 'overall' | 'positions'>, price?: number): boolean {
  // Without a cap nothing is priced, so a cap-less draft costs no more than it did
  return d.rules.budget === undefined || (price ?? capPrice(p)) <= capRoom(d) + 1e-9
}

/** How far over the room a player's price is, £M (0 when affordable or without a cap). */
export function capOverBy(d: DraftState, p: Pick<PlayerSeason, 'overall' | 'positions'>): number {
  return affordable(d, p) ? 0 : round1(capPrice(p) - capRoom(d))
}

/**
 * Under a cap the assistant spreads the money: it drafts the best man priced at no more than this many
 * times an even share of what is left (the cheapest usable man when nobody is). Buying the best it can
 * afford on every spin spends the cap on the first two picks: over 60 seeds a £180M XI drafted that way
 * scored 42 points on average, spread at twice the share 61 (no cap: 69).
 */
export const CAP_AUTO_STRETCH = 2

/** The candidates the assistant weighs under a cap: those within `CAP_AUTO_STRETCH` shares, else the cheapest; everyone without a cap. */
function capCandidates(d: DraftState, candidates: PlayerSeason[]): PlayerSeason[] {
  if (d.rules.budget === undefined) return candidates
  const share = (d.rules.budget - capSpent(d)) / Math.max(1, d.rules.squadSize - picksMade(d))
  const within = candidates.filter((p) => capPrice(p) <= share * CAP_AUTO_STRETCH)
  if (within.length) return within
  const cheapest = Math.min(...candidates.map((p) => capPrice(p)))
  return candidates.filter((p) => capPrice(p) === cheapest)
}

/** £M with one decimal, as the cap's messages write it (`£52.0M`). */
export function capMoney(m: number): string {
  return `£${m.toFixed(1)}M`
}

/** Why a player cannot be afforded, or null when he can: `Rodri (£52.0M) would take you £14.0M over the cap`. */
export function capRefusal(d: DraftState, p: Pick<PlayerSeason, 'overall' | 'positions' | 'name'>): string | null {
  if (affordable(d, p)) return null
  const price = capPrice(p)
  const after = Math.max(0, d.rules.squadSize - picksMade(d) - 1)
  // Within the cap itself, it is the money kept for the picks still to make that rules him out
  const reserve = d.rules.budget !== undefined && price <= d.rules.budget - capSpent(d) + 1e-9 && after > 0
  return `${p.name} (${capMoney(price)}) would take you ${capMoney(capOverBy(d, p))} over the cap${reserve ? `, keeping ${capMoney(BUDGET_FLOOR)} for each of the ${after} picks still to make` : ''}`
}

/** The nationality rule, when the draft has one. */
export function nationAllows(d: DraftState, p: PlayerSeason): boolean {
  return !d.rules.onlyNation || p.nationality === d.rules.onlyNation
}

export function canUse(d: DraftState, p: PlayerSeason): boolean {
  if (d.takenPlayers.includes(p.playerId)) return false
  if (!nationAllows(d, p)) return false
  if (!affordable(d, p)) return false
  if (fillingXI(d)) return openSlots(d).some((s) => canCover(p, s.position, d.rules.minFit))
  return true
}

export function eligibleSlots(d: DraftState, p: PlayerSeason): Formation['slots'] {
  if (d.takenPlayers.includes(p.playerId) || !nationAllows(d, p) || !affordable(d, p)) return []
  return openSlots(d).filter((s) => canCover(p, s.position, d.rules.minFit))
}

/**
 * The club-seasons the era, club, nation and league rules admit that still hold
 * someone usable: the expensive pass (every `canUse` check), independent of the twist.
 */
function rulesPool(u: LoadedUniverse, d: DraftState): ClubSeason[] {
  const r = d.rules
  return u.clubSeasons.filter((cs) => {
    if (r.fromSeason !== undefined && cs.season < r.fromSeason) return false
    if (r.toSeason !== undefined && cs.season > r.toSeason) return false
    if (r.onlyClub && cs.clubId !== r.onlyClub) return false
    if (r.leagues && !r.leagues.includes(cs.leagueId)) return false
    return cs.squad.some((p) => canUse(d, p))
  })
}

/** Narrow a rules pool by a twist, then by the one-club-season-once rule. */
function narrowPool(u: LoadedUniverse, d: DraftState, twist: Twist | null | undefined, base: ClubSeason[]): ClubSeason[] {
  const allowed = twist ? base.filter((cs) => twistAllows(u, d, twist, cs)) : base
  if (!d.rules.uniqueClubSeasons) return allowed
  // Each club-season once, but when a narrow wheel (one club, a short era) has used them all,
  // the wheel reopens rather than stopping the draft with slots still to fill
  const fresh = allowed.filter((cs) => !d.usedClubSeasons.includes(`${cs.clubId}@${cs.season}`))
  return fresh.length ? fresh : allowed
}

/** The club-seasons the wheel may land on right now, the twist on the current spin applied. */
export function wheelPool(u: LoadedUniverse, d: DraftState): ClubSeason[] {
  return narrowPool(u, d, d.twist, rulesPool(u, d))
}

/**
 * Whether a spin can land anywhere. A one-nation wheel can run dry once every
 * usable player of that nation has been drafted; the UI checks this before
 * spinning instead of letting `spin` throw.
 */
export function canSpin(u: LoadedUniverse, d: DraftState): boolean {
  return wheelPool(u, d).length > 0
}

/**
 * Spin: pick a club-season uniformly across seasons first, then clubs, so no
 * era dominates just because it has more rows.
 *
 * On a twist spin (every third spin when `rules.twists` is on) one extra draw
 * chooses the twist among those whose wheel is not empty, so a league without
 * tables never gets a golden or basement spin, and the wheel is then filtered
 * by it. A blind spin is always possible, so a twist spin always has a twist.
 * The candidate check narrows one rules pool four times rather than rebuilding it.
 */
export function spin(u: LoadedUniverse, d: DraftState, rng: Rng): ClubSeason {
  d.twist = null
  // One expensive pass; each twist's wheel is that pool narrowed, exactly what `wheelPool` would return with the twist set
  const base = rulesPool(u, d)
  if (nextSpinTwisted(d)) {
    const candidates = TWISTS.filter((twist) => narrowPool(u, d, twist, base).length > 0)
    if (candidates.length) d.twist = rng.pick(candidates)
  }
  const pool = narrowPool(u, d, d.twist, base)
  if (!pool.length) throw new Error('Nothing left on the wheel')
  const seasons = [...new Set(pool.map((cs) => cs.season))]
  const season = rng.pick(seasons)
  const inSeason = pool.filter((cs) => cs.season === season)
  // Favour stronger club-seasons a little (a title winner is about twice as
  // likely as a relegated side) and clubs with more useful players, so late
  // picks are not hopeless.
  const chosen = rng.pickWeighted(inSeason, (cs) => {
    const quality = cs.position > 0 ? 1 + 0.06 * (21 - cs.position) : 1.6
    return quality * (1 + Math.min(10, cs.squad.filter((p) => canUse(d, p)).length) / 10)
  })
  d.current = { clubId: chosen.clubId, season: chosen.season }
  d.spins++
  return chosen
}

export function respin(u: LoadedUniverse, d: DraftState, rng: Rng): ClubSeason {
  if (d.respinsLeft <= 0) throw new Error('No re-spins left')
  d.respinsLeft--
  if (d.current) d.history.push({ ...d.current, pickedId: null, slotId: null, ...(d.twist ? { twist: d.twist } : {}) })
  d.twist = null
  return spin(u, d, rng)
}

/** Draft a player from the current club-season into a slot (or the bench). */
export function pick(u: LoadedUniverse, d: DraftState, playerSeasonId: string, slotId: string | 'bench'): void {
  if (!d.current) throw new Error('Spin first')
  const p = u.index[playerSeasonId]
  if (!p) throw new Error('Unknown player')
  if (p.clubId !== d.current.clubId || p.season !== d.current.season) throw new Error('Player is not in the current squad')
  if (d.takenPlayers.includes(p.playerId)) throw new Error('Already drafted that player')
  if (!nationAllows(d, p)) throw new Error(`${p.name} is not ${u.nations[d.rules.onlyNation ?? '']?.name ?? d.rules.onlyNation}`)
  const refusal = capRefusal(d, p)
  if (refusal) throw new Error(refusal)
  if (slotId === 'bench') {
    if (fillingXI(d)) throw new Error('Fill your starting XI first')
    if (isComplete(d)) throw new Error('Squad complete')
    d.bench.push(p.id)
  } else {
    const slot = d.formation.slots.find((s) => s.id === slotId)
    if (!slot) throw new Error('Unknown slot')
    if (d.lineup[slot.id]) throw new Error('Slot already filled')
    if (!canCover(p, slot.position, d.rules.minFit)) throw new Error(`${p.name} cannot play ${slot.position}`)
    d.lineup[slot.id] = p.id
  }
  d.takenPlayers.push(p.playerId)
  if (d.rules.budget !== undefined) d.spent = round1(capSpent(d) + capPrice(p))
  d.usedClubSeasons.push(`${d.current.clubId}@${d.current.season}`)
  d.history.push({ ...d.current, pickedId: p.id, slotId: slotId === 'bench' ? null : slotId, ...(d.twist ? { twist: d.twist } : {}) })
  d.current = null
  d.twist = null
}

/** Best slot suggestion for a player given what is open. */
export function suggestSlot(d: DraftState, p: PlayerSeason): string | 'bench' | null {
  const slots = eligibleSlots(d, p)
  if (slots.length) {
    const natural = slots.find((s) => describeFit(p, s.position) === 'natural')
    return (natural ?? slots[0]).id
  }
  if (!fillingXI(d) && !isComplete(d) && !d.takenPlayers.includes(p.playerId)) return 'bench'
  return null
}

/** Positions still needed, for the UI ("Need: GK, CB, ST"). */
export function neededPositions(d: DraftState): Position[] {
  return [...new Set(openSlots(d).map((s) => s.position))]
}

/**
 * Auto-draft the rest (used by "sim the rest" and for AI opponents in head-to-head).
 * Stops short of the squad size when the wheel has run dry (a one-nation draft).
 */
export function autoDraft(u: LoadedUniverse, d: DraftState, rng: Rng): void {
  let guard = 0
  while (!isComplete(d) && guard++ < 200) {
    if (!canSpin(u, d)) break
    const cs = spin(u, d, rng)
    const candidates = capCandidates(d, cs.squad.filter((p) => canUse(d, p)))
    if (!candidates.length) {
      d.current = null
      d.twist = null
      continue
    }
    // Prefer natural fits for the scarcest open slot, otherwise highest rating.
    const open = openSlots(d)
    let best: { p: PlayerSeason; slot: string | 'bench'; score: number } | null = null
    for (const p of candidates) {
      if (open.length) {
        for (const s of open) {
          if (!canCover(p, s.position, d.rules.minFit)) continue
          const fit = describeFit(p, s.position)
          const score = p.overall * (fit === 'natural' ? 1 : 0.92)
          if (!best || score > best.score) best = { p, slot: s.id, score }
        }
      } else {
        const score = p.overall
        if (!best || score > best.score) best = { p, slot: 'bench', score }
      }
    }
    if (best) pick(u, d, best.p.id, best.slot)
    else {
      d.current = null
      d.twist = null
    }
  }
}
