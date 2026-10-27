/**
 * The wheel and the draft rules, straight from 38-0 with a few refinements:
 *  - spins never land on a club-season that cannot help you (no dead spins);
 *  - a human being can be drafted once, whatever the season;
 *  - squad drafts fill eleven starting slots first, then bench places;
 *  - optional filters: era, one club, one nation;
 *  - a difficulty (easy, normal, hard: 3, 1 or 0 re-spins, hard hiding ratings) and a ratings toggle;
 *  - two draft modes: Squad First (spin, then pick anyone and choose his slot) and
 *    Position First (choose a slot, then spin for a club that can fill it);
 *  - optional twists: every third spin is a golden, basement, blind or decade spin;
 *  - Gamble mode: a rare Icons spin (`./icons`) and the Player Upgrader (`./upgrader`), both on their own streams;
 *  - casual modes: a salary cap (Moneyball) and the Teammate Chain (every pick after the first a former teammate of the one before).
 */
import type { ClubSeason, Formation, PlayerSeason, Position } from './types'
import { Rng, type RngState } from './rng'
import { canCover, positionFactor, type Fit } from './positions'
import type { LoadedUniverse } from './universe'
import { formerTeammates, sharedClubSeasons } from './teammates'
import { primeOf } from './prime'
import { ICONS_CHANCE, ICONS_CLUB, ICONS_SEASON, iconsCollection, isIcons } from './icons'

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
  /**
   * Salary cap in £M (the Moneyball wheel): every player carries an age-neutral price (`capPrice`) and the draft
   * may not spend more than this. Off when omitted, so a draft without it draws and plays exactly as before.
   */
  budget?: number
  /**
   * The Teammate Chain: from the second pick, the wheel only lands on club-seasons holding a usable former teammate
   * of the last pick, and only those teammates may be drafted. Off when omitted, so a draft without it is unchanged.
   */
  chain?: boolean
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
   * Quick Draft modes that change the wheel (`src/engine/modes.ts` has the cards): `crazy` (a twist on every spin and
   * surprises after picks), `underdog` (bottom-half sides only), `legends` (club-seasons with an 85+ player only) and
   * `speedrun` (a timer per pick in the UI, the assistant picking on expiry). Hard is the difficulty, not a flag here.
   * None when absent, so older saves and links read unchanged. Read through `modesOf`.
   */
  modes?: QuickMode[]
  /**
   * The Player Upgrader power-up: once per draft, gamble a drafted player's rating up by 2, 5 or 10 at an odds shown
   * first (`src/engine/upgrader.ts`). Also on with the `gamble` mode. Off when absent.
   */
  upgrader?: boolean
  /**
   * Power-ups (`src/engine/powerups.ts`): a tray of six one-use power-ups on the draft screen (the Player Upgrader,
   * Re-roll season, Peek, Swap, Captain's armband and Lock). Quick Draft only, never the Daily. Off when absent.
   */
  powerUps?: boolean
  /**
   * Quick Draft managers: once the draft is done the user picks a manager from the real managers of the club-seasons
   * drafted (`src/engine/managers.ts`), whose style gives a small edge. On in `QUICK_RULES`, off in the Daily; read as
   * off when absent, so older saves and every other mode are unchanged.
   */
  managers?: boolean
  /**
   * Quick Draft with managers: the manager is spun, not chosen from a list. Three reels land on three real managers of
   * the wheel's club-seasons at once (`spinManagers`, on a fork of the game's stream) and the user picks one of the three.
   * Off when absent (older saves and links pick from the drafted clubs' managers, as before); the Setup screen turns it on.
   */
  managerSpin?: boolean
  /**
   * Quick Draft: one case opened at the end of the draft (`src/engine/endCase.ts`), dropping a power-up for the locker or,
   * rarely, an Icon who may come into the XI. Off when absent and never in the Daily; the Setup screen turns it on.
   */
  endCase?: boolean
  /** The wheel may land on classic club-seasons (1992-93 to 2007-08, estimated ratings). Off when omitted, so older saves and links are unchanged. */
  classic?: boolean
  /**
   * Quick Draft: the season is the Super League (`src/engine/superLeague.ts`), a double round-robin against the
   * nineteen greatest club-seasons in the data at full strength, instead of a real league season. The wheel is not
   * changed by it. Off when omitted, so older saves, links and every other mode are unchanged.
   */
  superLeague?: boolean
}

/** The mode flags a set of draft rules may carry (Hard is the difficulty). */
export type QuickMode = 'crazy' | 'underdog' | 'legends' | 'speedrun' | 'gamble'
export const QUICK_MODES: readonly QuickMode[] = ['crazy', 'underdog', 'legends', 'speedrun', 'gamble']
/** A Legends wheel lands only on club-seasons holding at least one player rated this or more that season. */
export const LEGENDS_RATING = 85
/** Chance after each pick of a Crazy draft that a surprise lands on the next spin. */
export const CRAZY_SURPRISE_CHANCE = 0.3

/** The known mode flags of a set of rules, each once, in `QUICK_MODES` order. */
export function modesOf(rules: DraftRules): QuickMode[] {
  const on = rules.modes ?? []
  return QUICK_MODES.filter((m) => on.includes(m))
}

export function hasMode(rules: DraftRules, mode: QuickMode): boolean {
  return !!rules.modes?.includes(mode)
}

/** Whether a draft has the Player Upgrader: the power-up on its own or with Gamble mode. */
export function upgraderOn(rules: DraftRules): boolean {
  return !!rules.upgrader || !!rules.powerUps || hasMode(rules, 'gamble')
}

/** Whether a draft has the Player Upgrader: from its rules, or unpacked from the locker (`DraftState.locker`). */
export function upgraderAvailable(d: Pick<DraftState, 'rules' | 'locker'>): boolean {
  return upgraderOn(d.rules) || !!d.locker?.includes('upgrader')
}

/**
 * A surprise of a Crazy draft, rolled after a pick and applied to the next spin: a free re-spin (one more in the
 * budget), a forced position (the next pick must fill this open slot) or a golden spin (champions only, when any are left).
 */
export type Surprise = { kind: 'respin' } | { kind: 'forced'; slotId: string } | { kind: 'golden' }

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
  history: Array<{ clubId: string; season: number; pickedId: string | null; slotId: string | null; twist?: Twist; skipped?: boolean; target?: string; chainLink?: string; chainBroken?: true }>
  /** The twist on the spin currently showing; null (or absent, in an older save) when the spin is a plain one. */
  twist?: Twist | null
  /** £M spent under the salary cap; absent when the draft has no cap, or before its first pick. */
  spent?: number
  /** Teammate Chain: the player-season id of the pick the chain follows from (the last pick); absent before the first pick or without a chain. */
  chainFrom?: string
  /**
   * Teammate Chain: the real player ids who shared a club-season with the last pick, the only men the next pick may be;
   * null once the chain has broken for the next pick (no club-season on the wheel holds a usable one, so that spin is free).
   */
  chainMates?: string[] | null
  /**
   * Position First: the open slot the player chose before spinning. The spin lands only on club-seasons
   * with someone usable there, the pick must go into it, and a re-spin keeps it. Null or absent otherwise.
   */
  target?: string | null
  /** Quick bench: the manager closed the draft with bench places to spare (`closeBench`). Absent otherwise. */
  benchClosed?: boolean
  /**
   * Dynasty summer wheel: real player id -> the youngest age he may come back at (a man who left the club is never
   * drafted as his younger self). Absent everywhere else, and then nothing changes.
   */
  ageFloor?: Record<string, number>
  /**
   * Quick bench: the stream the spins after the XI is full draw from, forked off a copy of the game's stream at the
   * first such spin, so the season (which starts from the game's stream) is the same however many bench spins follow.
   */
  benchRng?: RngState
  /** Crazy: the surprise stream, seeded from the game seed by `newDraft` and drawn once after every pick. Absent otherwise. */
  crazyRng?: RngState
  /** Crazy: the slot a forced-position surprise says the next pick fills; cleared by that pick. */
  forcedSlot?: string | null
  /** Crazy: the twist a golden surprise sets for the next spin; cleared by that spin. */
  forcedTwist?: Twist | null
  /** Crazy: the latest surprise and the spin count when it landed, for the draft screen. */
  surprise?: (Surprise & { atSpin: number }) | null
  /** Gamble: the Icons stream, seeded from the game seed by `newDraft`, drawn once per spin until the Icons spin has come. Absent otherwise. */
  gambleRng?: RngState
  /** The Player Upgrader's stream, seeded from the game seed by `newDraft` and forked by the player and boost chosen (the same whenever it is made). Absent without the upgrader. */
  upgradeRng?: RngState
  /** The Player Upgrader's one gamble, once made: who, the boost, the chance shown, the roll and the change to his rating. */
  upgrade?: DraftUpgrade | null
  /** Power-ups: the stream Re-roll season draws from, seeded from the game seed by `newDraft`. Absent without power-ups. */
  powerRng?: RngState
  /** Power-ups: each one used, in the order used (the Upgrader's gamble is `upgrade`). Absent or empty when none. */
  powerUps?: PowerUpUse[]
  /**
   * Power-ups unpacked from the player's locker for this draft (`unpackPowerUp`), each kind once, in the order unpacked;
   * only in a draft without the tray. Each works exactly as the tray's. Absent when none.
   */
  locker?: LockerKind[]
}

/** The power-ups a locker holds (the tray's six; `PowerUp` in `./powerups`). */
export type LockerKind = 'upgrader' | 'reroll' | 'peek' | 'swap' | 'armband' | 'lock'

/**
 * One power-up used (`src/engine/powerups.ts`). `at` is the draft history row it belongs to: the row of the spin a
 * re-roll changed, the row of the spin a peek looked at or a swap came before (the history length when it was used).
 */
export type PowerUpUse =
  | { kind: 'reroll'; at: number; clubId: string; from: number; to: number; options: number }
  | { kind: 'peek'; at: number; season: number }
  | { kind: 'swap'; at: number; from: string; to: string }
  | { kind: 'armband'; at: number; id: string }
  | { kind: 'lock'; at: number; id: string }

/** Peek: whether a peek is showing, pinned to the next spin (no spin showing, none made since it was used). */
export function peekActive(d: DraftState): boolean {
  return !d.current && !!d.powerUps?.some((x) => x.kind === 'peek' && x.at === d.history.length && d.spins === x.at)
}

/** One Player Upgrader gamble (`src/engine/upgrader.ts`): `delta` is `+boost` on a win, minus half the boost (rounded up) on a loss. */
export interface DraftUpgrade {
  /** The drafted player-season id. */
  id: string
  boost: number
  /** Whole per cent shown before confirming; the gamble wins when `roll < chance`. */
  chance: number
  /** 0 to 99, from the upgrader's stream. */
  roll: number
  won: boolean
  delta: number
  /** A loss on a player under the Lock power-up: the rating stays, `delta` is 0. */
  locked?: boolean
}

/**
 * A fresh draft. A Crazy draft with a `seed` gets its own surprise stream, seeded from the game seed apart from the
 * game's stream, so the surprises never move a spin or a match of the main stream.
 */
export function newDraft(formation: Formation, rules: DraftRules, seed?: string): DraftState {
  const d: DraftState = { rules, formation, lineup: {}, bench: [], takenPlayers: [], usedClubSeasons: [], respinsLeft: rules.respins, current: null, spins: 0, history: [], twist: null, target: null }
  if (hasMode(rules, 'crazy') && seed !== undefined) d.crazyRng = new Rng(`${seed}:crazy-surprises`).getState()
  if (hasMode(rules, 'gamble') && seed !== undefined) d.gambleRng = new Rng(`${seed}:gamble-icons`).getState()
  if (upgraderOn(rules) && seed !== undefined) d.upgradeRng = new Rng(`${seed}:upgrader`).getState()
  if (rules.powerUps && seed !== undefined) d.powerRng = new Rng(`${seed}:powerups`).getState()
  return d
}

/** Whether the next spin of this draft is a twist spin: every third with twists on, every spin in Crazy mode. */
export function nextSpinTwisted(d: DraftState): boolean {
  if (hasMode(d.rules, 'crazy')) return true
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
  if (forcedSlotOf(d)) return false
  if (hasQuickBench(d)) return d.bench.length < benchPlaces(d.rules) && !positionFirst(d)
  return !fillingXI(d)
}

/** Drafted already, or (a Dynasty summer) a season of a man who left in which he is younger than he would be now. */
function isTaken(d: DraftState, p: PlayerSeason): boolean {
  if (d.takenPlayers.includes(p.playerId)) return true
  const floor = d.ageFloor?.[p.playerId]
  return floor !== undefined && p.age < floor
}

/** Whether this player could be sent to the bench from the current spin. */
export function canBench(d: DraftState, p: PlayerSeason): boolean {
  return benchRoom(d) && !isTaken(d, p) && nationAllows(d, p) && chainAllows(d, p) && affordable(d, p) && benchAffordable(d, p)
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

/**
 * The picks the cap keeps `BUDGET_FLOOR` for after the next one. A squad draft owes it to every pick up to its size. A
 * Quick Draft with a bench owes it to its open XI slots only (its bench may close once the XI is full), whatever the
 * bench already holds: counting bench picks against the XI's eleven let an early bench pick spend the money the last
 * XI slots needed, and the wheel ran dry with a keeper still to find (r7 QA; engine 6).
 */
function picksOwed(d: DraftState): number {
  if (hasQuickBench(d)) return Math.max(0, openSlots(d).length - 1)
  return Math.max(0, d.rules.squadSize - picksMade(d) - 1)
}

/** The most the next pick may cost: what is left of the cap after keeping `BUDGET_FLOOR` for every pick still to make after it. Infinite without a cap. */
export function capRoom(d: DraftState): number {
  const budget = d.rules.budget
  if (budget === undefined) return Infinity
  return round1(budget - capSpent(d) - BUDGET_FLOOR * picksOwed(d))
}

/**
 * A Quick Draft bench pick while XI slots are open fills none of them, so it keeps the floor for every one: one floor
 * more than an XI pick. Always true without a cap.
 */
function benchAffordable(d: DraftState, p: Pick<PlayerSeason, 'overall' | 'positions'>): boolean {
  if (d.rules.budget === undefined) return true
  return capPrice(p) <= capRoom(d) - (hasQuickBench(d) && fillingXI(d) ? BUDGET_FLOOR : 0) + 1e-9
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
  const after = picksOwed(d)
  // Within the cap itself, it is the money kept for the picks still to make that rules him out
  const reserve = d.rules.budget !== undefined && price <= d.rules.budget - capSpent(d) + 1e-9 && after > 0
  return `${p.name} (${capMoney(price)}) would take you ${capMoney(capOverBy(d, p))} over the cap${reserve ? `, keeping ${capMoney(BUDGET_FLOOR)} for each of the ${after} picks still to make` : ''}`
}

/** The chain's teammates as a set while the chain binds the next pick; null when it does not (off, before the first pick, or broken). */
function chainSet(d: DraftState): Set<string> | null {
  return d.rules.chain && d.chainMates ? new Set(d.chainMates) : null
}

/** The Teammate Chain rule: always true without a chain, before the first pick and on a free spin after a break. */
export function chainAllows(d: DraftState, p: Pick<PlayerSeason, 'playerId'>): boolean {
  return !d.rules.chain || !d.chainMates || d.chainMates.includes(p.playerId)
}

/** Whether the chain broke for the spin showing (or the next one): no club-season on the wheel held a usable teammate of the last pick. */
export function chainBroken(d: DraftState): boolean {
  return !!d.rules.chain && !!d.chainFrom && d.chainMates === null
}

/** The nationality rule, when the draft has one. */
export function nationAllows(d: DraftState, p: PlayerSeason): boolean {
  return !d.rules.onlyNation || p.nationality === d.rules.onlyNation
}

/** Whether the draft is choosing a slot before each spin: Position First while the XI is being filled (bench picks are squad first). */
export function positionFirst(d: DraftState): boolean {
  return draftModeOf(d.rules) === 'position' && fillingXI(d)
}

/** Crazy: the open slot a forced-position surprise says the next pick fills, while the XI is being filled. */
export function forcedSlotOf(d: DraftState): Formation['slots'][number] | null {
  if (!d.forcedSlot || !fillingXI(d)) return null
  return openSlots(d).find((s) => s.id === d.forcedSlot) ?? null
}

/** The slot this spin is filling: a Crazy forced position, or the slot a Position First spin chose, while it is still open. */
export function targetSlot(d: DraftState): Formation['slots'][number] | null {
  const forced = forcedSlotOf(d)
  if (forced) return forced
  if (!positionFirst(d) || !d.target) return null
  return openSlots(d).find((s) => s.id === d.target) ?? null
}

/** The slots a pick may go into right now: the chosen slot under Position First, every open slot otherwise. */
function candidateSlots(d: DraftState): Formation['slots'] {
  const t = targetSlot(d)
  return t ? [t] : openSlots(d)
}

/**
 * Whether a player is usable for one of `slots` (anyone undrafted for the bench once the XI is full). `mates` is the
 * Teammate Chain's set (null when the chain does not bind), passed in so a pass over the wheel builds it once.
 */
function usableFor(d: DraftState, p: PlayerSeason, slots: Formation['slots'], mates: Set<string> | null = chainSet(d)): boolean {
  if (isTaken(d, p)) return false
  if (!nationAllows(d, p)) return false
  if (mates && !mates.has(p.playerId)) return false
  if (!affordable(d, p)) return false
  if (fillingXI(d)) return slots.some((s) => canCover(p, s.position, d.rules.minFit))
  return true
}

export function canUse(d: DraftState, p: PlayerSeason): boolean {
  return usableFor(d, p, candidateSlots(d))
}

export function eligibleSlots(d: DraftState, p: PlayerSeason): Formation['slots'] {
  if (isTaken(d, p) || !nationAllows(d, p) || !chainAllows(d, p) || !affordable(d, p)) return []
  return candidateSlots(d).filter((s) => canCover(p, s.position, d.rules.minFit))
}

/** A player's rating under the draft's ratings rule: his career best in the wheel leagues under Prime, that season's otherwise. */
export function draftRating(u: LoadedUniverse, d: DraftState, p: PlayerSeason): number {
  return ratingsModeOf(d.rules) === 'prime' ? Math.max(p.overall, primeOf(u, p.playerId, d.rules.leagues, d.rules.classic)?.overall ?? p.overall) : p.overall
}

/**
 * The club-seasons the era, club, nation and league rules admit that still hold
 * someone usable (`mates` the chain's teammates, or null): the expensive pass, independent of the twist.
 */
function rulesPool(u: LoadedUniverse, d: DraftState, slots: Formation['slots'] = candidateSlots(d), mates: Set<string> | null = chainSet(d)): ClubSeason[] {
  return u.clubSeasons.filter((cs) => rulesAdmit(u, d, cs) && cs.squad.some((p) => usableFor(d, p, slots, mates)))
}

/** The era, club and league rules for one club-season (the cheap half of `rulesPool`). */
function rulesAdmit(u: LoadedUniverse, d: DraftState, cs: ClubSeason): boolean {
  const r = d.rules
  if (cs.classic && !r.classic) return false
  if (r.fromSeason !== undefined && cs.season < r.fromSeason) return false
  if (r.toSeason !== undefined && cs.season > r.toSeason) return false
  if (r.onlyClub && cs.clubId !== r.onlyClub) return false
  if (r.leagues && !r.leagues.includes(cs.leagueId)) return false
  if (r.modes?.length) {
    if (hasMode(r, 'underdog') && !bottomHalf(u, cs)) return false
    if (hasMode(r, 'legends') && !hasLegend(cs)) return false
  }
  return true
}

/** Legends: whether a club-season holds at least one player rated `LEGENDS_RATING` or more that season. */
export function hasLegend(cs: ClubSeason): boolean {
  return cs.squad.some((p) => p.overall >= LEGENDS_RATING)
}

/** Per universe, the club-seasons of league-seasons without a final table that rank in the bottom half by squad strength. */
const strengthBottomHalf = new WeakMap<LoadedUniverse, Set<string>>()

/** The mean of a club-season's eleven best ratings, the strength a league-season without a table is ranked by. */
function squadStrength(cs: ClubSeason): number {
  const best = cs.squad.map((p) => p.overall).sort((a, b) => b - a).slice(0, 11)
  return best.length ? best.reduce((s, x) => s + x, 0) / best.length : 0
}

/**
 * Underdog: whether a club-season finished in the bottom half of its league that season (below the halfway place of its
 * final table). A league-season without a table (France, the Netherlands, Portugal) ranks its clubs by the mean of their
 * eleven best ratings instead, ties by club id, so every league has underdogs. Pure: a cache per universe, never a change to it.
 */
export function bottomHalf(u: LoadedUniverse, cs: ClubSeason): boolean {
  const table = u.tables[cs.leagueId]?.[cs.season]
  if (table?.length && cs.position > 0) return cs.position > table.length / 2
  let set = strengthBottomHalf.get(u)
  if (!set) {
    set = new Set<string>()
    const groups = new Map<string, ClubSeason[]>()
    for (const x of u.clubSeasons) {
      if (u.tables[x.leagueId]?.[x.season]?.length && x.position > 0) continue
      const key = `${x.leagueId}@${x.season}`
      const g = groups.get(key)
      if (g) g.push(x)
      else groups.set(key, [x])
    }
    for (const g of groups.values()) {
      const ranked = g.map((x) => ({ x, s: squadStrength(x) })).sort((a, b) => b.s - a.s || a.x.clubId.localeCompare(b.x.clubId))
      ranked.forEach((r, i) => {
        if (i + 1 > ranked.length / 2) set!.add(`${r.x.clubId}@${r.x.season}`)
      })
    }
    strengthBottomHalf.set(u, set)
  }
  return set.has(`${cs.clubId}@${cs.season}`)
}

/**
 * The rules pool of the next spin. Under the Teammate Chain it holds only club-seasons with a usable former
 * teammate of the last pick; when there is none the chain breaks and the spin is free (`broken`), so the
 * wheel never runs dry because of the chain.
 */
function chainedPool(u: LoadedUniverse, d: DraftState): { pool: ClubSeason[]; broken: boolean } {
  const mates = chainSet(d)
  const pool = rulesPool(u, d, candidateSlots(d), mates)
  if (pool.length || !mates) return { pool, broken: false }
  return { pool: rulesPool(u, d, candidateSlots(d), null), broken: true }
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
  return narrowPool(u, d, d.twist, chainedPool(u, d).pool)
}

/** Whether the next spin breaks the chain: no club-season on the wheel holds a usable teammate of the last pick. */
export function chainBreakDue(u: LoadedUniverse, d: DraftState): boolean {
  return chainBroken(d) || (!!chainSet(d) && chainedPool(u, d).broken)
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
  return u.clubSeasons.some((cs) => rulesAdmit(u, d, cs) && cs.squad.some((p) => usableFor(d, p, [slot], null)))
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
  const forced = forcedSlotOf(d)
  if (forced) throw new Error(`A Crazy surprise: this pick fills ${forced.position}`)
  if (peekActive(d) && d.target !== slotId) throw new Error('You peeked at the spin for the slot you chose: spin for it')
  const slot = openSlots(d).find((s) => s.id === slotId)
  if (!slot) throw new Error('That slot is not open')
  if (!slotSpinnable(u, d, slot)) throw new Error(`No club left on the wheel can fill ${slot.position}`)
  d.target = slot.id
}

/**
 * How much a club-season weighs within its season on a spin: stronger club-seasons a little more (a title winner is
 * about twice as likely as a relegated side), and clubs with more useful players, so late picks are not hopeless.
 */
export function spinWeight(d: DraftState, cs: ClubSeason, mates: Set<string> | null = chainSet(d)): number {
  const quality = cs.position > 0 ? 1 + 0.06 * (21 - cs.position) : 1.6
  const slots = candidateSlots(d)
  return quality * (1 + Math.min(10, cs.squad.filter((p) => usableFor(d, p, slots, mates)).length) / 10)
}

/** Gamble: whether the Icons spin has come in this draft (landed on, re-spun or picked from). */
export function iconsUsed(d: DraftState): boolean {
  return isIcons(d.current) || d.history.some((h) => isIcons(h))
}

/** Whether some icon fits this spin (an open slot, the chosen slot, the nation rule; anyone undrafted for the bench). */
function iconsFit(u: LoadedUniverse, d: DraftState): boolean {
  const slots = candidateSlots(d)
  return iconsCollection(u, d.rules.leagues).squad.some((p) => usableFor(d, p, slots))
}

/** The squad a spin is showing: the club-season, or the Icons collection on an Icons spin; null between spins. */
export function spinClubSeason(u: LoadedUniverse, d: DraftState): ClubSeason | null {
  if (!d.current) return null
  if (isIcons(d.current)) return iconsCollection(u, d.rules.leagues)
  return u.clubSeasonByKey[`${d.current.clubId}@${d.current.season}`] ?? null
}

/** The exact chances of the next spin (or of a re-spin, while a spin is showing): the Icons chance and each club-season's. */
export interface SpinOdds {
  icons: number
  outcomes: Array<{ cs: ClubSeason; p: number }>
}

/**
 * The exact distribution `spin` draws from in this state, the same steps in the same order: the Icons roll (Gamble,
 * while unused and an icon fits), the twist (a Crazy golden surprise, or one of the twists whose wheel is not empty on
 * a twist spin, each equally likely), a season uniformly among the twisted pool's, then a club-season by `spinWeight`.
 * The chances sum to 1 whenever the wheel can spin (to 0 when it cannot). No RNG.
 */
export function spinOdds(u: LoadedUniverse, d: DraftState): SpinOdds {
  const chained = chainedPool(u, { ...d, twist: null })
  // A spin that breaks the chain draws from the free wheel, as `spin` does
  const view: DraftState = { ...d, twist: null, ...(chained.broken ? { chainMates: null } : {}) }
  const icons = d.gambleRng && !iconsUsed(d) && iconsFit(u, view) ? ICONS_CHANCE : 0
  const base = chained.pool
  const forced = view.forcedTwist && narrowPool(u, view, view.forcedTwist, base).length > 0 ? view.forcedTwist : null
  let twists: Array<Twist | null> = [null]
  if (forced) twists = [forced]
  else if (nextSpinTwisted(view)) {
    const candidates = TWISTS.filter((t) => narrowPool(u, view, t, base).length > 0)
    if (candidates.length) twists = candidates
  }
  const byKey = new Map<string, { cs: ClubSeason; p: number }>()
  let reachable = false
  for (const t of twists) {
    const pool = narrowPool(u, view, t, base)
    if (!pool.length) continue
    reachable = true
    const seasons = [...new Set(pool.map((cs) => cs.season))]
    for (const season of seasons) {
      const inSeason = pool.filter((cs) => cs.season === season)
      const weights = inSeason.map((cs) => Math.max(0, spinWeight(view, cs)))
      const total = weights.reduce((a, b) => a + b, 0)
      inSeason.forEach((cs, i) => {
        const share = total > 0 ? weights[i] / total : 1 / inSeason.length
        const p = (1 - icons) * (1 / twists.length) * (1 / seasons.length) * share
        const key = `${cs.clubId}@${cs.season}`
        const e = byKey.get(key)
        if (e) e.p += p
        else byKey.set(key, { cs, p })
      })
    }
  }
  if (!reachable) return { icons: 0, outcomes: [] }
  return { icons, outcomes: [...byKey.values()] }
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
  // Gamble: one draw from the Icons stream per spin until the Icons spin has come; it lands only when an icon fits.
  // The game's stream is untouched by the roll, and skipped entirely on an Icons spin
  if (d.gambleRng && !iconsUsed(d)) {
    const g = Rng.fromState(d.gambleRng)
    const hit = g.chance(ICONS_CHANCE)
    d.gambleRng = g.getState()
    if (hit && iconsFit(u, d)) {
      d.twist = null
      d.current = { clubId: ICONS_CLUB, season: ICONS_SEASON }
      d.spins++
      return iconsCollection(u, d.rules.leagues)
    }
  }
  // Quick bench spins after the XI draw from the draft's own bench stream and leave the game's stream where the XI left it
  const benchSpin = hasQuickBench(d) && !fillingXI(d)
  const rng = benchSpin ? (d.benchRng ? Rng.fromState(d.benchRng) : Rng.fromState(main.getState()).fork('bench')) : main
  d.twist = null
  // One expensive pass; each twist's wheel is that pool narrowed, exactly what `wheelPool` would return with the twist set
  const { pool: base, broken } = chainedPool(u, d)
  // The chain has no teammate of the last pick left on the wheel: it breaks, this spin is free and the next pick restarts it
  if (broken) d.chainMates = null
  const mates = chainSet(d)
  // Crazy: a golden surprise sets this spin's twist without a draw, when champions are still on the wheel
  const forcedTwist = d.forcedTwist && narrowPool(u, d, d.forcedTwist, base).length > 0 ? d.forcedTwist : null
  if (d.forcedTwist !== undefined) d.forcedTwist = null
  if (forcedTwist) d.twist = forcedTwist
  else if (nextSpinTwisted(d)) {
    const candidates = TWISTS.filter((twist) => narrowPool(u, d, twist, base).length > 0)
    if (candidates.length) d.twist = rng.pick(candidates)
  }
  const pool = narrowPool(u, d, d.twist, base)
  if (!pool.length) throw new Error('Nothing left on the wheel')
  const seasons = [...new Set(pool.map((cs) => cs.season))]
  const season = rng.pick(seasons)
  const inSeason = pool.filter((cs) => cs.season === season)
  const chosen = rng.pickWeighted(inSeason, (cs) => spinWeight(d, cs, mates))
  d.current = { clubId: chosen.clubId, season: chosen.season }
  d.spins++
  if (benchSpin) d.benchRng = rng.getState()
  return chosen
}

export function respin(u: LoadedUniverse, d: DraftState, rng: Rng): ClubSeason {
  if (d.respinsLeft <= 0) throw new Error('No re-spins left')
  d.respinsLeft--
  // Position First: the re-spin keeps the chosen slot, logged on the skipped row so a replay can set it again
  const t = targetSlot(d)
  if (d.current) d.history.push({ ...d.current, pickedId: null, slotId: null, ...(d.twist ? { twist: d.twist } : {}), ...(t ? { target: t.id } : {}) })
  d.twist = null
  return spin(u, d, rng)
}

/** Draft a player from the current club-season into a slot (or the bench). */
export function pick(u: LoadedUniverse, d: DraftState, playerSeasonId: string, slotId: string | 'bench'): void {
  if (!d.current) throw new Error('Spin first')
  const p = u.index[playerSeasonId]
  if (!p) throw new Error('Unknown player')
  if (isIcons(d.current) ? !iconsCollection(u, d.rules.leagues).squad.some((x) => x.id === p.id) : p.clubId !== d.current.clubId || p.season !== d.current.season) throw new Error('Player is not in the current squad')
  if (isTaken(d, p)) throw new Error('Already drafted that player')
  if (!nationAllows(d, p)) throw new Error(`${p.name} is not ${u.nations[d.rules.onlyNation ?? '']?.name ?? d.rules.onlyNation}`)
  if (!chainAllows(d, p)) throw new Error(`${p.name} is not a former teammate of ${u.index[d.chainFrom ?? '']?.name ?? 'your last pick'}`)
  const refusal = capRefusal(d, p)
  if (refusal) throw new Error(refusal)
  if (slotId === 'bench') {
    if (isComplete(d)) throw new Error('Squad complete')
    if (!benchRoom(d)) throw new Error(!hasQuickBench(d) ? 'Fill your starting XI first' : positionFirst(d) ? 'This spin fills the slot you chose' : 'The bench is full: this pick goes into the XI')
    if (!benchAffordable(d, p)) throw new Error(`${p.name} (${capMoney(capPrice(p))}) would leave too little for the ${openSlots(d).length} XI places still open: keep ${capMoney(BUDGET_FLOOR)} for each`)
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
  if (d.rules.budget !== undefined) d.spent = round1(capSpent(d) + capPrice(p))
  d.usedClubSeasons.push(`${d.current.clubId}@${d.current.season}`)
  d.history.push({ ...d.current, pickedId: p.id, slotId: slotId === 'bench' ? null : slotId, ...(d.twist ? { twist: d.twist } : {}), ...chainRow(u, d, p) })
  if (d.rules.chain) {
    // The chain now follows from this pick: the next one must have shared a club-season with him
    d.chainFrom = p.id
    d.chainMates = formerTeammates(u, d.rules.leagues, p.playerId)
  }
  d.current = null
  d.twist = null
  d.target = null
  if (d.forcedSlot !== undefined) d.forcedSlot = null
  if (d.crazyRng) rollSurprise(u, d)
}

/**
 * Crazy: after a pick, one draw from the surprise stream decides whether a surprise lands (`CRAZY_SURPRISE_CHANCE`), and
 * a second which: a free re-spin, a forced position (an open slot some club on the wheel can fill, offered only with two
 * or more open slots, so a choice is taken away) or a golden spin (only while champions are on the wheel). Nothing is
 * rolled once the draft is complete. Draws
 * only from `crazyRng`, never the game's stream.
 */
function rollSurprise(u: LoadedUniverse, d: DraftState): void {
  if (!d.crazyRng || isComplete(d)) return
  const rng = Rng.fromState(d.crazyRng)
  if (rng.chance(CRAZY_SURPRISE_CHANCE)) {
    const open = fillingXI(d) ? openSlots(d).filter((s) => slotSpinnable(u, d, s)) : []
    // A golden spin is offered only while champions are on the next wheel (never under Underdog, nor in a league
    // without tables), so a surprise that is announced always happens
    const golden = narrowPool(u, d, 'golden', chainedPool(u, d).pool).length > 0
    const kinds: Array<Surprise['kind']> = ['respin', ...(golden ? (['golden'] as const) : []), ...(open.length >= 2 ? (['forced'] as const) : [])]
    const kind = rng.pick(kinds)
    let s: Surprise
    if (kind === 'forced') {
      const slot = rng.pick(open)
      d.forcedSlot = slot.id
      // Position First: the forced slot is also the chosen one, so a re-spin row names it as a replay expects
      if (draftModeOf(d.rules) === 'position') d.target = slot.id
      s = { kind: 'forced', slotId: slot.id }
    } else if (kind === 'respin') {
      d.respinsLeft++
      s = { kind: 'respin' }
    } else {
      d.forcedTwist = 'golden'
      s = { kind: 'golden' }
    }
    d.surprise = { ...s, atSpin: d.spins }
  }
  d.crazyRng = rng.getState()
}

/** What a pick's history row records of the chain: the club-season it shares with the pick before, or that the chain broke before it. */
function chainRow(u: LoadedUniverse, d: DraftState, p: PlayerSeason): { chainLink?: string; chainBroken?: true } {
  if (!d.rules.chain || !d.chainFrom) return {}
  if (d.chainMates === null) return { chainBroken: true }
  const from = u.index[d.chainFrom]
  const link = from ? sharedClubSeasons(u, d.rules.leagues, from.playerId, p.playerId)[0] : undefined
  return link ? { chainLink: link } : {}
}

/**
 * The slot the assistant puts a player in, of the open slots he may take (`eligibleSlots`): his best positional fit
 * (`positionFactor` there, so a natural slot always beats a cover), then the position with the fewest open slots left
 * (the scarcest place in the remaining formation: a DM/CM fills the lone DM and leaves the two CMs for the many who
 * play there), then formation order. Null when he can take none. Pure, no RNG.
 *
 * ENGINE_VERSION 4 and before, the head-to-head assistant took the first eligible slot in formation order, so a DM/CM
 * went to centre-back while both central midfield slots were open (TL-04).
 */
export function bestSlotFor(d: DraftState, p: PlayerSeason): Formation['slots'][number] | null {
  const slots = eligibleSlots(d, p)
  if (!slots.length) return null
  const open = openSlots(d)
  const left = (position: Position) => open.filter((s) => s.position === position).length
  let best = slots[0]
  let bestFit = positionFactor(p, best.position)
  for (const s of slots.slice(1)) {
    const fit = positionFactor(p, s.position)
    if (fit > bestFit || (fit === bestFit && left(s.position) < left(best.position))) {
      best = s
      bestFit = fit
    }
  }
  return best
}

/** Best slot suggestion for a player given what is open: the assistant's (`bestSlotFor`), else the bench. */
export function suggestSlot(d: DraftState, p: PlayerSeason): string | 'bench' | null {
  const slot = bestSlotFor(d, p)
  if (slot) return slot.id
  if (canBench(d, p)) return 'bench'
  return null
}

/** Positions still needed, for the UI ("Need: GK, CB, ST"). */
export function neededPositions(d: DraftState): Position[] {
  return [...new Set(openSlots(d).map((s) => s.position))]
}

/**
 * The assistant's pick from a club-season: the man who would play best where he would go, his rating (career best under
 * Prime) times his `positionFactor` in the slot `bestSlotFor` gives him (natural first, then the scarcest open place);
 * the highest rating onto the bench once the XI is full. Null when no one can be used. No RNG.
 *
 * ENGINE_VERSION 4 and before charged every cover a flat 0.92 and took the first slot of a tie in formation order.
 */
/**
 * Keepers in an assistant-drafted squad (engine 6, item 3): at least `MIN_KEEPERS` in a squad of `FULL_SQUAD` places or
 * more (one keeper in 18 put an outfielder in goal when he was hurt), and never more than `MAX_KEEPERS` (Dynasty summer
 * drafts reached six or seven in 23). The XI's own keeper slot is filled as before; the rule only steers bench picks.
 */
export const MIN_KEEPERS = 2
export const MAX_KEEPERS = 3
export const FULL_SQUAD = 16

function isKeeper(p: PlayerSeason | undefined): boolean {
  return p?.positions[0] === 'GK'
}

/**
 * What the bench needs from this pick: `'keeper'` (only a keeper will do while one is on offer), `'outfield'` (no more
 * keepers), or null (anyone). `keeperShort` says the squad cannot afford to pass on the keeper it needs.
 */
function benchNeed(d: DraftState, get: (id: string) => PlayerSeason | undefined): { need: 'keeper' | 'outfield' | null; keeperShort: boolean } {
  const held = [...Object.values(d.lineup), ...d.bench].filter((id) => isKeeper(get(id))).length
  if (held >= MAX_KEEPERS) return { need: 'outfield', keeperShort: false }
  const min = d.rules.squadSize >= FULL_SQUAD ? MIN_KEEPERS : 1
  if (held >= min) return { need: null, keeperShort: false }
  // Picks still to make after this one
  const left = d.rules.squadSize - picksMade(d) - 1
  return { need: 'keeper', keeperShort: left < min - held }
}

export function assistantChoice(u: LoadedUniverse, d: DraftState, cs: ClubSeason, get: (id: string) => PlayerSeason | undefined = (id) => u.index[id]): { id: string; slot: string | 'bench' } | null {
  // Under a salary cap the assistant spreads the money (`capCandidates`); everyone is a candidate without one
  let candidates = capCandidates(d, cs.squad.filter((p) => canUse(d, p)))
  if (!candidates.length) return null
  const open = candidateSlots(d)
  if (!open.length) {
    const { need, keeperShort } = benchNeed(d, get)
    const keepers = candidates.filter(isKeeper)
    if (need === 'outfield') candidates = candidates.filter((p) => !isKeeper(p))
    else if (need === 'keeper' && keepers.length) candidates = keepers
    // Short of a keeper with no picks to spare: pass on this spin rather than fill the last place outfield
    else if (need === 'keeper' && keeperShort) return null
    if (!candidates.length) return null
  }
  let best: { p: PlayerSeason; slot: string | 'bench'; score: number } | null = null
  for (const p of candidates) {
    if (open.length) {
      const s = bestSlotFor(d, p)
      if (!s) continue
      const score = draftRating(u, d, p) * positionFactor(p, s.position)
      if (!best || score > best.score) best = { p, slot: s.id, score }
    } else {
      const score = draftRating(u, d, p)
      if (!best || score > best.score) best = { p, slot: 'bench', score }
    }
  }
  return best ? { id: best.p.id, slot: best.slot } : null
}

/**
 * Auto-draft the rest (used by "sim the rest" and for AI opponents in head-to-head).
 * Stops short of the squad size when the wheel has run dry (a one-nation draft).
 */
export function autoDraft(u: LoadedUniverse, d: DraftState, rng: Rng, get?: (id: string) => PlayerSeason | undefined): void {
  let guard = 0
  while (!isComplete(d) && guard++ < 200) {
    if (!canSpin(u, d)) break
    // Position First: keep a slot already chosen, otherwise take the first open slot (formation order) the wheel can fill. No RNG.
    if (positionFirst(d) && !targetSlot(d)) d.target = spinnableSlots(u, d)[0].id
    const cs = spin(u, d, rng)
    const best = assistantChoice(u, d, cs, get)
    if (best) pick(u, d, best.id, best.slot)
    else {
      // A spin the assistant passes on (nobody usable, or only a keeper the squad has no room for) is logged as a
      // discarded spin, as the store logs the one showing when Auto-complete starts: it drew from the stream, so a
      // challenge replay spins it too (engine 6; before, it left no row and the replay fell out of step)
      if (d.current) d.history.push({ ...d.current, pickedId: null, slotId: null, skipped: true, ...(d.twist ? { twist: d.twist } : {}), ...(targetSlot(d) ? { target: targetSlot(d)!.id } : {}) })
      d.current = null
      d.twist = null
    }
  }
}

/**
 * Speedrun: the pick clock ran out, so the assistant takes this pick: it chooses a slot under Position First when none is
 * chosen, spins when no spin is showing (from the game's stream, like any spin), then makes its pick (`assistantChoice`).
 * One pick at most; nothing when the draft is complete or the wheel has run dry.
 */
export function assistantTurn(u: LoadedUniverse, d: DraftState, rng: Rng): void {
  if (isComplete(d)) return
  if (!d.current) {
    if (!canSpin(u, d)) return
    if (positionFirst(d) && !targetSlot(d)) d.target = spinnableSlots(u, d)[0].id
    spin(u, d, rng)
  }
  const cs = spinClubSeason(u, d)
  const best = cs ? assistantChoice(u, d, cs) : null
  if (best) pick(u, d, best.id, best.slot)
}
