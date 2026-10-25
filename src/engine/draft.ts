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
  history: Array<{ clubId: string; season: number; pickedId: string | null; slotId: string | null; twist?: Twist }>
  /** The twist on the spin currently showing; null (or absent, in an older save) when the spin is a plain one. */
  twist?: Twist | null
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

/** The nationality rule, when the draft has one. */
export function nationAllows(d: DraftState, p: PlayerSeason): boolean {
  return !d.rules.onlyNation || p.nationality === d.rules.onlyNation
}

export function canUse(d: DraftState, p: PlayerSeason): boolean {
  if (d.takenPlayers.includes(p.playerId)) return false
  if (!nationAllows(d, p)) return false
  if (fillingXI(d)) return openSlots(d).some((s) => canCover(p, s.position, d.rules.minFit))
  return true
}

export function eligibleSlots(d: DraftState, p: PlayerSeason): Formation['slots'] {
  if (d.takenPlayers.includes(p.playerId) || !nationAllows(d, p)) return []
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
    const candidates = cs.squad.filter((p) => canUse(d, p))
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
