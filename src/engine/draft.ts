/**
 * The wheel and the draft rules, straight from 38-0 with a few refinements:
 *  - spins never land on a club-season that cannot help you (no dead spins);
 *  - a human being can be drafted once, whatever the season;
 *  - squad drafts fill eleven starting slots first, then bench places;
 *  - optional filters: era, one club, one nation;
 *  - a difficulty (easy, normal, hard: 3, 1 or 0 re-spins, hard hiding ratings) and a ratings toggle;
 *  - two draft modes: Squad First (spin, then pick anyone and choose his slot) and
 *    Position First (choose a slot, then spin for a club that can fill it);
 *  - optional twists: every third spin is a golden, basement, blind or decade spin.
 */
import type { ClubSeason, Formation, PlayerSeason, Position } from './types'
import { Rng, type RngState } from './rng'
import { canCover, describeFit, type Fit } from './positions'
import type { LoadedUniverse } from './universe'
import { primeOf } from './prime'

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
  /**
   * Hide ratings in the UI (the engine ignores this). Kept beside `difficulty` for older saves and
   * links: `true` reads as hard; `withDifficulty` keeps the two in step.
   */
  hardMode: boolean
  /** Prevent the same club-season from appearing twice. */
  uniqueClubSeasons: boolean
  /** Every third spin carries a twist (section 5 of the design doc). Off when omitted, so older saves are unchanged. */
  twists?: boolean
  /** Easy, normal or hard: 3, 1 or 0 re-spins, hard hiding ratings. Read through `difficultyOf`; absent in older saves. */
  difficulty?: DraftDifficulty
  /** Show ratings while drafting (default true); off is blind mode. Always off on hard (`ratingsHidden`). */
  showRatings?: boolean
  /** Squad First (default) or Position First. Read through `draftModeOf`. */
  draftMode?: DraftMode
  /** Rate players as they were that season (default) or at their career best (`src/engine/prime.ts`). */
  ratings?: RatingsMode
  /**
   * Quick Draft bench places (0 to `QUICK_BENCH_MAX`, none when absent). Any Squad First pick may go to the bench while
   * it has room, the XI is still filled first-to-last by the wheel as without a bench, and the draft may close once the
   * XI is full with bench places to spare. Bench spins after the XI draw from their own stream (`DraftState.benchRng`).
   */
  benchPicks?: number
  /**
   * Quick Draft managers: once the draft is done the user picks a manager from the real managers of the club-seasons
   * drafted (`src/engine/managers.ts`), whose style gives a small edge. On in `QUICK_RULES`, off in the Daily; read as
   * off when absent, so older saves and every other mode are unchanged.
   */
  managers?: boolean
}

export type DraftDifficulty = 'easy' | 'normal' | 'hard'
/** Squad First: spin a club, pick any player, choose his slot. Position First: choose a slot, then spin for a club to fill it. */
export type DraftMode = 'squad' | 'position'
/** Season: rated as they were that season. Prime: every player at his career-best rating across the loaded leagues. */
export type RatingsMode = 'season' | 'prime'

/** Re-spins a whole draft gets at each difficulty. */
export const DIFFICULTY_RESPINS: Record<DraftDifficulty, number> = { easy: 3, normal: 1, hard: 0 }
export const DIFFICULTIES: readonly DraftDifficulty[] = ['easy', 'normal', 'hard']
export const DRAFT_MODES: readonly DraftMode[] = ['squad', 'position']
export const RATINGS_MODES: readonly RatingsMode[] = ['season', 'prime']

/** The difficulty a set of rules plays at; an older save without the field reads `hardMode: true` as hard and anything else as normal. */
export function difficultyOf(rules: DraftRules): DraftDifficulty {
  if (rules.hardMode) return 'hard'
  return rules.difficulty ?? 'normal'
}

/** The rules at a difficulty: its re-spin budget, hard mode in step and ratings forced off on hard. */
export function withDifficulty(rules: DraftRules, difficulty: DraftDifficulty): DraftRules {
  const hard = difficulty === 'hard'
  return { ...rules, difficulty, respins: DIFFICULTY_RESPINS[difficulty], hardMode: hard, showRatings: hard ? false : rules.showRatings ?? true }
}

/** Whether ratings are hidden while drafting: hard difficulty, an older hard-mode save, or the ratings toggle off. */
export function ratingsHidden(rules: DraftRules): boolean {
  return difficultyOf(rules) === 'hard' || rules.showRatings === false
}

export function draftModeOf(rules: DraftRules): DraftMode {
  return rules.draftMode ?? 'squad'
}

export function ratingsModeOf(rules: DraftRules): RatingsMode {
  return rules.ratings ?? 'season'
}

const DIFFICULTY_LABEL: Record<DraftDifficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' }

/**
 * The 38-0 options that differ from a base set of rules, as short labels for the share text and
 * the summary line: `['Hard', 'Position First', 'Prime ratings']`. Ratings hidden by the toggle
 * shows as `Blind` unless the difficulty is hard, which hides them anyway.
 */
export function rulesTags(rules: DraftRules, base: DraftRules = QUICK_RULES): string[] {
  const out: string[] = []
  const diff = difficultyOf(rules)
  if (diff !== difficultyOf(base)) out.push(DIFFICULTY_LABEL[diff])
  if (diff !== 'hard' && rules.showRatings === false) out.push('Blind')
  if (draftModeOf(rules) !== draftModeOf(base)) out.push(draftModeOf(rules) === 'position' ? 'Position First' : 'Squad First')
  if (ratingsModeOf(rules) !== ratingsModeOf(base)) out.push(ratingsModeOf(rules) === 'prime' ? 'Prime ratings' : 'Season ratings')
  return out
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

export const QUICK_RULES: DraftRules = { squadSize: 11, respins: DIFFICULTY_RESPINS.normal, minFit: 'accomplished', hardMode: false, uniqueClubSeasons: true, twists: true, difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', managers: true }
export const SEASON_RULES: DraftRules = { squadSize: 18, respins: DIFFICULTY_RESPINS.easy, minFit: 'accomplished', hardMode: false, uniqueClubSeasons: false, twists: false, difficulty: 'easy', showRatings: true, draftMode: 'squad', ratings: 'season' }

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
  history: Array<{ clubId: string; season: number; pickedId: string | null; slotId: string | null; twist?: Twist; skipped?: boolean; target?: string }>
  /** The twist on the spin currently showing; null (or absent, in an older save) when the spin is a plain one. */
  twist?: Twist | null
  /**
   * Position First: the open slot the player chose before spinning. The spin lands only on club-seasons
   * with someone usable there, the pick must go into it, and a re-spin keeps it. Null or absent otherwise.
   */
  target?: string | null
  /** Quick bench: the manager closed the draft with bench places to spare (`closeBench`). Absent otherwise. */
  benchClosed?: boolean
  /**
   * Quick bench: the stream the spins after the XI is full draw from, forked off a copy of the game's stream at the
   * first such spin, so the season (which starts from the game's stream) is the same however many bench spins follow.
   */
  benchRng?: RngState
}

export function newDraft(formation: Formation, rules: DraftRules): DraftState {
  return { rules, formation, lineup: {}, bench: [], takenPlayers: [], usedClubSeasons: [], respinsLeft: rules.respins, current: null, spins: 0, history: [], twist: null, target: null }
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
  if (hasQuickBench(d)) return !fillingXI(d) && (d.bench.length >= benchPlaces(d.rules) || !!d.benchClosed)
  return picksMade(d) >= d.rules.squadSize
}

/** Most bench places a Quick Draft may have. */
export const QUICK_BENCH_MAX = 5

/** The Quick Draft bench places a set of rules gives: `benchPicks` within 0 to 5. */
export function benchPlaces(rules: DraftRules): number {
  return Math.max(0, Math.min(QUICK_BENCH_MAX, Math.floor(rules.benchPicks ?? 0)))
}

function hasQuickBench(d: DraftState): boolean {
  return benchPlaces(d.rules) > 0
}

/**
 * Whether a pick may go to the bench right now. A squad draft (Season, Dynasty) benches only after the XI is full;
 * a Quick Draft with bench places benches at any point while there is room, except while a Position First spin is
 * filling the slot chosen for it.
 */
export function benchRoom(d: DraftState): boolean {
  if (isComplete(d)) return false
  if (hasQuickBench(d)) return d.bench.length < benchPlaces(d.rules) && !positionFirst(d)
  return !fillingXI(d)
}

/** Whether this player could be sent to the bench from the current spin. */
export function canBench(d: DraftState, p: PlayerSeason): boolean {
  return benchRoom(d) && !d.takenPlayers.includes(p.playerId) && nationAllows(d, p)
}

/** Quick bench: the XI is full and bench places are left, so the manager may stop drafting. */
export function canCloseBench(d: DraftState): boolean {
  return hasQuickBench(d) && !fillingXI(d) && !isComplete(d)
}

/**
 * Quick bench: close the draft with bench places to spare. A spin still showing is logged as a skipped row (it drew
 * from the bench stream, so a challenge replay spins it too). No RNG.
 */
export function closeBench(d: DraftState): void {
  if (!canCloseBench(d)) throw new Error(fillingXI(d) ? 'Fill your starting XI first' : 'The draft is already complete')
  if (d.current) d.history.push({ ...d.current, pickedId: null, slotId: null, skipped: true, ...(d.twist ? { twist: d.twist } : {}) })
  d.current = null
  d.twist = null
  d.benchClosed = true
}

/** Whether we are still filling the XI (true) or the bench (false). */
export function fillingXI(d: DraftState): boolean {
  return openSlots(d).length > 0
}

/** The nationality rule, when the draft has one. */
export function nationAllows(d: DraftState, p: PlayerSeason): boolean {
  return !d.rules.onlyNation || p.nationality === d.rules.onlyNation
}

/** Whether the draft is choosing a slot before each spin: Position First while the XI is being filled (bench picks are squad first). */
export function positionFirst(d: DraftState): boolean {
  return draftModeOf(d.rules) === 'position' && fillingXI(d)
}

/** The slot a Position First spin is filling, when one has been chosen and is still open. */
export function targetSlot(d: DraftState): Formation['slots'][number] | null {
  if (!positionFirst(d) || !d.target) return null
  return openSlots(d).find((s) => s.id === d.target) ?? null
}

/** The slots a pick may go into right now: the chosen slot under Position First, every open slot otherwise. */
function candidateSlots(d: DraftState): Formation['slots'] {
  const t = targetSlot(d)
  return t ? [t] : openSlots(d)
}

function usableFor(d: DraftState, p: PlayerSeason, slots: Formation['slots']): boolean {
  if (d.takenPlayers.includes(p.playerId)) return false
  if (!nationAllows(d, p)) return false
  if (fillingXI(d)) return slots.some((s) => canCover(p, s.position, d.rules.minFit))
  return true
}

export function canUse(d: DraftState, p: PlayerSeason): boolean {
  return usableFor(d, p, candidateSlots(d))
}

export function eligibleSlots(d: DraftState, p: PlayerSeason): Formation['slots'] {
  if (d.takenPlayers.includes(p.playerId) || !nationAllows(d, p)) return []
  return candidateSlots(d).filter((s) => canCover(p, s.position, d.rules.minFit))
}

/** A player's rating under the draft's ratings rule: his career best in the wheel leagues under Prime, that season's otherwise. */
export function draftRating(u: LoadedUniverse, d: DraftState, p: PlayerSeason): number {
  return ratingsModeOf(d.rules) === 'prime' ? Math.max(p.overall, primeOf(u, p.playerId, d.rules.leagues)?.overall ?? p.overall) : p.overall
}

/**
 * The club-seasons the era, club, nation and league rules admit that still hold
 * someone usable: the expensive pass (every `canUse` check), independent of the twist.
 */
function rulesPool(u: LoadedUniverse, d: DraftState, slots: Formation['slots'] = candidateSlots(d)): ClubSeason[] {
  return u.clubSeasons.filter((cs) => rulesAdmit(d, cs) && cs.squad.some((p) => usableFor(d, p, slots)))
}

/** The era, club and league rules for one club-season (the cheap half of `rulesPool`). */
function rulesAdmit(d: DraftState, cs: ClubSeason): boolean {
  const r = d.rules
  if (r.fromSeason !== undefined && cs.season < r.fromSeason) return false
  if (r.toSeason !== undefined && cs.season > r.toSeason) return false
  if (r.onlyClub && cs.clubId !== r.onlyClub) return false
  if (r.leagues && !r.leagues.includes(cs.leagueId)) return false
  return true
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
  if (positionFirst(d) && !targetSlot(d)) return spinnableSlots(u, d).length > 0
  return wheelPool(u, d).length > 0
}

/** Whether some club-season the rules admit holds a player usable in this slot (the wheel would not be empty). */
function slotSpinnable(u: LoadedUniverse, d: DraftState, slot: Formation['slots'][number]): boolean {
  return u.clubSeasons.some((cs) => rulesAdmit(d, cs) && cs.squad.some((p) => usableFor(d, p, [slot])))
}

/**
 * Position First: the open slots a spin could fill. A slot drops out only when no club-season in the
 * era, club, nation and league rules has an undrafted player who can cover it; the one-club-season-once
 * rule never empties a slot's wheel, because it reopens used club-seasons as `wheelPool` does.
 */
export function spinnableSlots(u: LoadedUniverse, d: DraftState): Formation['slots'] {
  if (!positionFirst(d)) return []
  return openSlots(d).filter((s) => slotSpinnable(u, d, s))
}

/**
 * Position First: choose the open slot the next spin fills. No RNG. Throws when a spin is showing
 * (the slot is locked until the pick), when the slot is not open, or when no club left can fill it.
 */
export function chooseSlot(u: LoadedUniverse, d: DraftState, slotId: string): void {
  if (!positionFirst(d)) throw new Error('Choosing a slot first is a Position First rule')
  if (d.current) throw new Error('Pick a player for the slot you chose first')
  const slot = openSlots(d).find((s) => s.id === slotId)
  if (!slot) throw new Error('That slot is not open')
  if (!slotSpinnable(u, d, slot)) throw new Error(`No club left on the wheel can fill ${slot.position}`)
  d.target = slot.id
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
export function spin(u: LoadedUniverse, d: DraftState, main: Rng): ClubSeason {
  if (positionFirst(d) && !targetSlot(d)) throw new Error('Choose a slot first')
  // Quick bench spins after the XI draw from the draft's own bench stream and leave the game's stream where the XI left it
  const benchSpin = hasQuickBench(d) && !fillingXI(d)
  const rng = benchSpin ? (d.benchRng ? Rng.fromState(d.benchRng) : Rng.fromState(main.getState()).fork('bench')) : main
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
  if (benchSpin) d.benchRng = rng.getState()
  return chosen
}

export function respin(u: LoadedUniverse, d: DraftState, rng: Rng): ClubSeason {
  if (d.respinsLeft <= 0) throw new Error('No re-spins left')
  d.respinsLeft--
  // Position First: the re-spin keeps the chosen slot, logged on the skipped row so a replay can set it again
  if (d.current) d.history.push({ ...d.current, pickedId: null, slotId: null, ...(d.twist ? { twist: d.twist } : {}), ...(targetSlot(d) ? { target: d.target! } : {}) })
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
    if (isComplete(d)) throw new Error('Squad complete')
    if (!benchRoom(d)) throw new Error(!hasQuickBench(d) ? 'Fill your starting XI first' : positionFirst(d) ? 'This spin fills the slot you chose' : 'The bench is full: this pick goes into the XI')
    d.bench.push(p.id)
  } else {
    const slot = d.formation.slots.find((s) => s.id === slotId)
    if (!slot) throw new Error('Unknown slot')
    if (d.lineup[slot.id]) throw new Error('Slot already filled')
    const t = targetSlot(d)
    if (t && t.id !== slot.id) throw new Error(`This spin fills the ${t.position} slot you chose`)
    if (!canCover(p, slot.position, d.rules.minFit)) throw new Error(`${p.name} cannot play ${slot.position}`)
    d.lineup[slot.id] = p.id
  }
  d.takenPlayers.push(p.playerId)
  d.usedClubSeasons.push(`${d.current.clubId}@${d.current.season}`)
  d.history.push({ ...d.current, pickedId: p.id, slotId: slotId === 'bench' ? null : slotId, ...(d.twist ? { twist: d.twist } : {}) })
  d.current = null
  d.twist = null
  d.target = null
}

/** Best slot suggestion for a player given what is open. */
export function suggestSlot(d: DraftState, p: PlayerSeason): string | 'bench' | null {
  const slots = eligibleSlots(d, p)
  if (slots.length) {
    const natural = slots.find((s) => describeFit(p, s.position) === 'natural')
    return (natural ?? slots[0]).id
  }
  if (canBench(d, p)) return 'bench'
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
    // Position First: keep a slot already chosen, otherwise take the first open slot (formation order) the wheel can fill. No RNG.
    if (positionFirst(d) && !targetSlot(d)) d.target = spinnableSlots(u, d)[0].id
    const cs = spin(u, d, rng)
    const candidates = cs.squad.filter((p) => canUse(d, p))
    if (!candidates.length) {
      d.current = null
      d.twist = null
      continue
    }
    // Prefer natural fits for the scarcest open slot, otherwise highest rating (career best under Prime).
    const open = candidateSlots(d)
    let best: { p: PlayerSeason; slot: string | 'bench'; score: number } | null = null
    for (const p of candidates) {
      if (open.length) {
        for (const s of open) {
          if (!canCover(p, s.position, d.rules.minFit)) continue
          const fit = describeFit(p, s.position)
          const score = draftRating(u, d, p) * (fit === 'natural' ? 1 : 0.92)
          if (!best || score > best.score) best = { p, slot: s.id, score }
        }
      } else {
        const score = draftRating(u, d, p)
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
