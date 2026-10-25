import type { Game, JanuaryDealKind, JanuaryListing } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { Rng } from '@engine/rng'
import type { Lineup, PlayerSeason, Position } from '@engine/types'
import { getFormation } from '@engine/formations'
import { ratingAt } from '@engine/positions'

/** How many players a January window offers: three to five, drawn per window. */
export const JANUARY_LISTINGS = { min: 3, max: 5 } as const
/** The budget is this share of the XI's value: 8% for the leaders rising evenly to 20% for the bottom side. */
export const JANUARY_BUDGET_SHARE = { top: 0.08, bottom: 0.2 } as const
/** The board always finds at least this much (GBP millions). */
export const JANUARY_BUDGET_FLOOR = 5
/** How many of the XI's weakest slots the window shops for. */
export const JANUARY_WEAK_SLOTS = 3
/** A signing is rated 3 to 15 points above the man he replaces in that slot; a swap 0 to 5. */
export const JANUARY_SIGN_GAIN = [3, 15] as const
export const JANUARY_SWAP_GAIN = [0, 5] as const
/** The listing is drawn from the best this many candidates for the slot, so the window is not always the same star. */
export const JANUARY_SHORTLIST = 25

/** £0.5M steps, as the rest of the market shows money. */
const half = (n: number) => Math.round(n * 2) / 2

/**
 * The January budget: the XI's combined value times a share that rises from 8% for the leaders to 20% for the bottom
 * side (a struggling board backs its manager), at least £5M, in £0.5M steps. Pure.
 */
export function januaryBudget(position: number, teams: number, xiValue: number): number {
  const t = teams > 1 ? Math.min(1, Math.max(0, (position - 1) / (teams - 1))) : 0
  const share = JANUARY_BUDGET_SHARE.top + (JANUARY_BUDGET_SHARE.bottom - JANUARY_BUDGET_SHARE.top) * t
  return Math.max(JANUARY_BUDGET_FLOOR, half(xiValue * share))
}

/** A player's January fee: his value in £0.5M steps, never under £0.5M. */
export function januaryFee(p: PlayerSeason): number {
  return Math.max(0.5, half(p.value))
}

/**
 * The XI's slots from weakest to strongest: each drafted player's rating at the slot's position (attributes and
 * position fit, through the game's lookup so Prime ratings count), ties in formation order.
 */
export function weakestSlots(game: Game, lineup: Lineup, get: (id: string) => PlayerSeason | undefined): Array<{ slotId: string; position: Position; outId: string; rating: number }> {
  const formation = getFormation(game.tactics.formationId)
  const rows = formation.slots.flatMap((s, i) => {
    const id = lineup[s.id]
    const p = id ? get(id) : undefined
    return p ? [{ slotId: s.id, position: s.position, outId: id, rating: ratingAt(p, s.position), i }] : []
  })
  return rows.sort((a, b) => a.rating - b.rating || a.i - b.i).map(({ slotId, position, outId, rating }) => ({ slotId, position, outId, rating }))
}

/**
 * Who could come in: every player-season the wheel could have offered (the wheel leagues, the era, one club or one
 * nation as the draft rules say) who plays `position` naturally, whose player is not already in the squad (the XI or
 * the bench, who can come on as a substitute).
 */
function candidatesFor(game: Game, u: LoadedUniverse, position: Position, inSquad: Set<string>): PlayerSeason[] {
  const r = game.settings.rules
  const leagues = r.leagues ?? game.settings.wheelLeagues
  const out: PlayerSeason[] = []
  for (const cs of u.clubSeasons) {
    if (!leagues.includes(cs.leagueId)) continue
    if (cs.classic && !r.classic) continue
    if (r.fromSeason !== undefined && cs.season < r.fromSeason) continue
    if (r.toSeason !== undefined && cs.season > r.toSeason) continue
    if (r.onlyClub && cs.clubId !== r.onlyClub) continue
    for (const p of cs.squad) {
      if (!p.positions.includes(position) || inSquad.has(p.playerId)) continue
      if (r.onlyNation && p.nationality !== r.onlyNation) continue
      out.push(p)
    }
  }
  return out
}

/**
 * The window's listings, three to five, for the XI's weakest slots: every listing but the last is a signing (a fee out
 * of the budget, rated 3 to 15 above the man he replaces), the last a straight swap (no fee, 0 to 5 above). The
 * slots cycle through the three weakest; a slot with no candidate passes to the next weakest, so a narrow wheel (one
 * club, one nation) can offer fewer. Each listing is drawn from the 25 best candidates for its slot, one season per
 * player (his best that fits the band and the budget). Every draw comes
 * from `rng`, which the caller forks off a copy of the season's stream so the season itself is untouched. Nobody already
 * in the squad is offered, bench included, so a substitute can never meet himself on the pitch.
 */
export function januaryListings(game: Game, u: LoadedUniverse, lineup: Lineup, budget: number, get: (id: string) => PlayerSeason | undefined, rng: Rng, bench: string[] = []): JanuaryListing[] {
  const slots = weakestSlots(game, lineup, get)
  if (!slots.length) return []
  const inSquad = new Set([...Object.values(lineup), ...bench].map((id) => get(id)?.playerId ?? id))
  const n = rng.int(JANUARY_LISTINGS.min, JANUARY_LISTINGS.max)
  const taken = new Set<string>()
  const cache = new Map<Position, PlayerSeason[]>()
  const out: JanuaryListing[] = []
  for (let i = 0; i < n; i++) {
    const kind: JanuaryDealKind = i === n - 1 ? 'swap' : 'sign'
    const first = i % Math.min(JANUARY_WEAK_SLOTS, slots.length)
    for (let k = 0; k < slots.length; k++) {
      const slot = slots[(first + k) % slots.length]
      if (!cache.has(slot.position)) cache.set(slot.position, candidatesFor(game, u, slot.position, inSquad))
      const pool = januaryShortlist(cache.get(slot.position)!, slot, kind, budget, get, taken)
      if (!pool.length) continue
      const chosen = rng.pick(pool)
      taken.add(chosen.p.playerId)
      out.push({ playerSeasonId: chosen.p.id, slotId: slot.slotId, outId: slot.outId, kind, fee: kind === 'sign' ? chosen.fee : 0 })
      break
    }
  }
  return out
}

export interface JanuaryCandidate {
  p: PlayerSeason
  /** His rating at the slot's position. */
  rating: number
  fee: number
}

/**
 * The shortlist one listing is drawn from: the candidates whose rating at the slot is inside the deal's band above the
 * man leaving (3 to 15 for a signing, 0 to 5 for a swap), a signing's fee within the budget, nobody in `taken`, best
 * first (ties by id), one season per player (his best that qualifies: otherwise one man's many seasons, all alike under
 * Prime, would fill it), at most `JANUARY_SHORTLIST`. Pure.
 */
export function januaryShortlist(candidates: PlayerSeason[], slot: { position: Position; rating: number }, kind: JanuaryDealKind, budget: number, get: (id: string) => PlayerSeason | undefined, taken: ReadonlySet<string> = new Set()): JanuaryCandidate[] {
  const [lo, hi] = kind === 'sign' ? JANUARY_SIGN_GAIN : JANUARY_SWAP_GAIN
  const ranked = candidates
    .flatMap((raw) => {
      if (taken.has(raw.playerId)) return []
      const p = get(raw.id) ?? raw
      const rating = ratingAt(p, slot.position)
      const gain = rating - slot.rating
      if (gain < lo || gain > hi) return []
      const fee = januaryFee(p)
      if (kind === 'sign' && fee > budget) return []
      return [{ p, rating, fee }]
    })
    .sort((a, b) => b.rating - a.rating || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0))
  const pool: JanuaryCandidate[] = []
  const seen = new Set<string>()
  for (const c of ranked) {
    if (pool.length >= JANUARY_SHORTLIST) break
    if (seen.has(c.p.playerId)) continue
    seen.add(c.p.playerId)
    pool.push(c)
  }
  return pool
}

/** The same deal: one player into one slot, paid the same way. */
export function sameListing(a: JanuaryListing, b: JanuaryListing): boolean {
  return a.playerSeasonId === b.playerSeasonId && a.slotId === b.slotId && a.outId === b.outId && a.kind === b.kind && a.fee === b.fee
}
