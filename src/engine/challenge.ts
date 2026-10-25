/**
 * Ghost drafts: a finished quick draft packed into a link a friend can open.
 *
 * The link carries everything the wheel needs to spin the same way (seed,
 * formation, league, host club, season, difficulty and the draft rules as a
 * diff against `QUICK_RULES`), every spin's outcome (the player drafted and his
 * slot, or null for a re-spin or a discarded spin), the claimed result and a
 * hash of the club-seasons the wheel landed on. Opening it replays the picks
 * through `spin`/`pick` and the quick season; the claim is verified when the
 * replay reproduces it, byte for byte, which the deterministic `Rng` makes
 * possible as long as the data stamp and the engine version match.
 *
 * Nothing here draws from the RNG on its own: `replayDraft` only drives the
 * draft the way the store does, one `spin` per history row.
 */
import type { DraftRules, DraftState } from './draft'
import { DIFFICULTIES, DRAFT_MODES, QUICK_BENCH_MAX, QUICK_MODES, QUICK_RULES, RATINGS_MODES, canCloseBench, canSpin, difficultyOf, isComplete, openSlots, picksMade, pick, positionFirst, spin, type DraftDifficulty, type DraftMode, type QuickMode, type RatingsMode } from './draft'
import type { Rng } from './rng'
import { hashString } from './rng'
import type { ClubSeason, DefensiveLine, Mentality, PassingStyle, Pressing, SeasonTier, Tempo, Width } from './types'
import type { LoadedUniverse } from './universe'
import { FORMATIONS } from './formations'
import { FIT_ORDER, type Fit } from './positions'
import { isIcons } from './icons'
import { isUpgradeBoost } from './upgrader'
import { POWER_UPS, rerollSeason, swapSlots, unpackPowerUp, usePeek, type PowerUp } from './powerups'

/** Longest name carried in a link; longer names are cut, control characters dropped. */
export const CHALLENGE_NAME_MAX = 24

/** How far a post-season cup run went: the round it ended in, W for winners. */
export type CupReach = 'R16' | 'QF' | 'SF' | 'F' | 'W'
export const CUP_REACHES: readonly CupReach[] = ['R16', 'QF', 'SF', 'F', 'W']

export interface ChallengeClaim {
  pts: number
  w: number
  d: number
  l: number
  t: SeasonTier
  /** The post-season domestic cup, when the challenger played it. Older builds ignore it. */
  cu?: CupReach
  /** The post-season Continental Cup, when the challenger played it. */
  eu?: CupReach
}

/**
 * One spin of the challenger's draft: the real player id drafted (`s200458`) and the slot, or nulls for a
 * spin that drafted no one. Under Position First a spin that drafted no one carries the slot it was filling.
 */
export type ChallengePick = [playerId: string | null, slotId: string | null]

/**
 * Team instructions a quick season was played with, only those off the defaults (`defaultTactics`), plus the captain
 * and the penalty taker as player-season ids.
 */
export interface ChallengeTactics {
  mentality?: Mentality
  pressing?: Pressing
  tempo?: Tempo
  width?: Width
  defensiveLine?: DefensiveLine
  passing?: PassingStyle
  captain?: string
  penalties?: string
}

/**
 * The quick season's own choices, carried only when something differs from a default season: `t` the tactics of the
 * first half (the whole season without a window), `t2` those of the second half when they were changed at the January
 * pause, `j` the January deal as `[incoming player-season id, slot id]`, `s` the bench changes of a Quick Draft with a
 * bench as `[first matchweek, slot id, incoming player-season id]`, in order, `m` the manager picked.
 */
export interface ChallengeSeason {
  t?: ChallengeTactics
  t2?: ChallengeTactics
  j?: [playerSeasonId: string, slotId: string]
  s?: Array<[from: number, slotId: string, playerSeasonId: string]>
  /** The manager picked for the season (a Wikidata id or an `arch-` archetype id), when the draft had one. */
  m?: string
  /**
   * The end-of-draft case's Icon (`src/engine/endCase.ts`) and the XI slot he took, when the challenger brought him in.
   * The case itself is not carried: a replay opens the same case (the same fork of the same stream after the same draft).
   */
  ic?: string
}

/** Most bench changes a link may carry: the three a quick season allows. */
export const CHALLENGE_CHANGES_MAX = 3

/** The values each instruction may take in a link. */
export const CHALLENGE_TACTIC_VALUES = {
  mentality: ['defensive', 'balanced', 'attacking'],
  pressing: ['low', 'mid', 'high'],
  tempo: ['slow', 'standard', 'fast'],
  width: ['narrow', 'standard', 'wide'],
  defensiveLine: ['deep', 'standard', 'high'],
  passing: ['short', 'mixed', 'direct'],
} as const satisfies Record<Exclude<keyof ChallengeTactics, 'captain' | 'penalties'>, readonly string[]>

export interface ChallengePayload {
  v: 1
  /** `LoadedUniverse.generatedAt` of the data the challenge was built on. */
  data: string
  /** `ENGINE_VERSION` the challenge was built with. */
  engine: string
  name: string
  s: {
    seed: string
    f: string
    l: string
    wl: string[]
    h: string
    ls: number
    d: 'calibrated' | 'realistic'
    /** The draft rules that differ from `QUICK_RULES`; `leagues` is always `wl`. */
    r: Partial<DraftRules>
  }
  /** One row per draft history row, in order. */
  p: ChallengePick[]
  c: ChallengeClaim
  /** `historyKey` of the challenger's draft history. */
  k: string
  /** The season's tactics and January deal, when they differ from a default season; absent on older links. */
  x?: ChallengeSeason
  /**
   * The Player Upgrader's gamble, when one was made: the index of the row in `p` whose pick was upgraded, and the boost.
   * The roll is the draft's own stream's, so a replay reproduces the outcome. Absent otherwise (and on older links).
   */
  g?: [row: number, boost: number]
  /**
   * The power-ups used, in order, when any were (`./powerups`): `['r', row]` re-rolled the season of that row's spin,
   * `['p', row]` peeked before it, `['s', row, from, to]` swapped two slots before it (row = the number of rows when the
   * draft ended for a swap after the last spin), `['a', row]` and `['l', row]` gave the armband and the lock to that
   * row's pick. Absent otherwise (and on older links).
   */
  w?: ChallengePowerUp[]
  /**
   * Power-ups the challenger unpacked from the locker into a draft without the tray (`unpackPowerUp`), in order. A replay
   * unpacks them before the first spin (their streams come from the seed alone), so `g` and `w` replay as they did.
   */
  i?: PowerUp[]
}

/** Whether an `i` block is well formed: known power-ups, each once. */
export function isChallengeLocker(i: unknown): i is PowerUp[] {
  return Array.isArray(i) && i.length <= POWER_UPS.length && i.every((k) => POWER_UPS.includes(k as PowerUp)) && new Set(i).size === i.length
}

export type ChallengePowerUp = ['r', number] | ['p', number] | ['s', number, string, string] | ['a', number] | ['l', number]

/** Whether a `w` block is well formed: known kinds, each once, rows inside the link's `rowCount` rows. */
export function isChallengePowerUps(w: unknown, rowCount: number): w is ChallengePowerUp[] {
  if (!Array.isArray(w) || w.length > 5) return false
  const kinds = new Set<string>()
  for (const x of w) {
    if (!Array.isArray(x) || !isString(x[0]) || kinds.has(x[0]) || !isInt(x[1]) || x[1] < 0) return false
    kinds.add(x[0])
    if (x[0] === 's') {
      if (x.length !== 4 || x[1] > rowCount || !isString(x[2]) || !isString(x[3])) return false
    } else if (x[0] === 'r' || x[0] === 'p' || x[0] === 'a' || x[0] === 'l') {
      if (x.length !== 2 || x[1] >= rowCount) return false
    } else return false
  }
  return true
}

const TIERS: readonly SeasonTier[] = ['PERFECT', 'INVINCIBLE', 'CHAMPIONS', 'TITLE_RACE', 'EUROPEAN', 'MID_TABLE', 'RELEGATION_BATTLE', 'RELEGATED']

/** A display name safe to carry in a link: control characters stripped, whitespace collapsed, at most 24 characters. */
export function cleanName(name: string): string {
  const cleaned = name
    .split('')
    .filter((ch) => {
      const c = ch.charCodeAt(0)
      return c >= 32 && c !== 127 && !(c >= 0x80 && c < 0xa0)
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, CHALLENGE_NAME_MAX).trim()
}

/** Base-36 hash of the club-seasons a draft's wheel landed on, in order. */
export function historyKey(history: Array<{ clubId: string; season: number }>): string {
  return hashString(history.map((h) => `${h.clubId}@${h.season}`).join(',')).toString(36)
}

/** Re-spins a quick draft had before difficulties existed; a link made then carries no `difficulty`. */
export const LEGACY_QUICK_RESPINS = 2

/**
 * The rules as a diff against `QUICK_RULES`, without `leagues` (which the payload carries as `wl`).
 * The difficulty and the manager rule are always written, even at the default, so a link made before
 * either existed (no `difficulty` or `managers` key) can be told apart and opened as its challenger played.
 */
export function rulesDiff(rules: DraftRules, base: DraftRules = QUICK_RULES): Partial<DraftRules> {
  // The manager rule is always written too: a link made before managers existed (no `managers` key) replays without one
  const out: Partial<DraftRules> = { difficulty: difficultyOf(rules), managers: rules.managers === true }
  const b = base as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(rules) as Array<[keyof DraftRules, unknown]>) {
    if (key === 'leagues' || key === 'difficulty' || key === 'managers' || value === undefined) continue
    if (b[key] !== value) (out as Record<string, unknown>)[key] = value
  }
  return out
}

/**
 * The full rules from a payload: `QUICK_RULES`, the diff, and the wheel leagues. A diff without a
 * difficulty comes from a link made before difficulties: its draft had `LEGACY_QUICK_RESPINS`
 * re-spins unless it says otherwise, and its hard mode reads as hard. A diff without `managers`
 * comes from a link made before managers, and reads as managers off.
 */
export function rulesFromPayload(c: ChallengePayload): DraftRules {
  const r = c.s.r
  const legacy: Partial<DraftRules> = r.difficulty === undefined ? { respins: LEGACY_QUICK_RESPINS, difficulty: r.hardMode ? 'hard' : 'normal', ...(r.hardMode ? { showRatings: false } : {}) } : {}
  // No `managers` key: the link predates managers, so its challenger played without one
  return { ...QUICK_RULES, ...legacy, managers: false, ...r, leagues: c.s.wl }
}

/** A draft's history as payload rows: the real player id of each pick (or null) and its slot. */
export function picksFromHistory(history: DraftState['history'], playerIdOf: (playerSeasonId: string) => string | undefined): ChallengePick[] {
  return history.map((h) => [h.pickedId ? playerIdOf(h.pickedId) ?? null : null, h.pickedId ? h.slotId : h.target ?? null])
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** The payload as the `#c=` fragment of a link: UTF-8 JSON in base64url. */
export function encodeChallenge(c: ChallengePayload): string {
  const payload: ChallengePayload = { ...c, name: cleanName(c.name) }
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
}

const isString = (x: unknown): x is string => typeof x === 'string'
const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isInt = (x: unknown): x is number => Number.isInteger(x)
const isBool = (x: unknown): x is boolean => typeof x === 'boolean'

/** Smallest and largest squad a draft rule may ask for: a quick XI up to a season squad. */
export const CHALLENGE_SQUAD_RANGE: readonly [number, number] = [11, 18]
/** Most re-spins a link may grant. */
export const CHALLENGE_RESPINS_MAX = 10

/** What each draft rule may hold when it travels in a link; `leagues` never does (it is `wl`). */
const RULE_CHECKS: Record<keyof DraftRules, (v: unknown) => boolean> = {
  squadSize: (v) => isInt(v) && v >= CHALLENGE_SQUAD_RANGE[0] && v <= CHALLENGE_SQUAD_RANGE[1],
  respins: (v) => isInt(v) && v >= 0 && v <= CHALLENGE_RESPINS_MAX,
  fromSeason: isInt,
  toSeason: isInt,
  onlyClub: isString,
  onlyNation: isString,
  leagues: () => false,
  minFit: (v) => FIT_ORDER.includes(v as Fit),
  hardMode: isBool,
  uniqueClubSeasons: isBool,
  twists: isBool,
  difficulty: (v) => DIFFICULTIES.includes(v as DraftDifficulty),
  showRatings: isBool,
  draftMode: (v) => DRAFT_MODES.includes(v as DraftMode),
  ratings: (v) => RATINGS_MODES.includes(v as RatingsMode),
  benchPicks: (v) => isInt(v) && v >= 0 && v <= QUICK_BENCH_MAX,
  // A list of known mode flags, each once (Hard travels as the difficulty)
  modes: (v) => Array.isArray(v) && v.length <= QUICK_MODES.length && v.every((m) => QUICK_MODES.includes(m as QuickMode)) && new Set(v).size === v.length,
  upgrader: isBool,
  powerUps: isBool,
  managers: isBool,
  managerSpin: isBool,
  endCase: isBool,
  classic: isBool,
  superLeague: isBool,
}

/** Whether an object is a rules diff made only of known rules holding sensible values. */
export function isRulesDiff(r: unknown): r is Partial<DraftRules> {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false
  return Object.entries(r).every(([key, value]) => Object.prototype.hasOwnProperty.call(RULE_CHECKS, key) && RULE_CHECKS[key as keyof DraftRules](value))
}

/** Whether an object is a set of instructions made only of known keys holding allowed values. */
export function isChallengeTactics(t: unknown): t is ChallengeTactics {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return false
  return Object.entries(t).every(([key, value]) => {
    if (key === 'captain' || key === 'penalties') return isString(value)
    const allowed = (CHALLENGE_TACTIC_VALUES as Record<string, readonly string[]>)[key]
    return !!allowed && allowed.includes(value as string)
  })
}

/** Whether an object is a well-formed `x` block: optional tactics for each half and an optional January deal. */
export function isChallengeSeason(x: unknown): x is ChallengeSeason {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false
  const o = x as Record<string, unknown>
  if (!Object.keys(o).every((k) => k === 't' || k === 't2' || k === 'j' || k === 's' || k === 'm' || k === 'ic')) return false
  if (o.ic !== undefined && !(isString(o.ic) && /^[A-Za-z0-9_-]{1,12}$/.test(o.ic))) return false
  if (o.m !== undefined && !(isString(o.m) && /^(Q\d{1,12}|arch-[a-z-]{1,20})$/.test(o.m))) return false
  if (o.t !== undefined && !isChallengeTactics(o.t)) return false
  if (o.t2 !== undefined && !isChallengeTactics(o.t2)) return false
  if (o.j !== undefined && !(Array.isArray(o.j) && o.j.length === 2 && o.j.every(isString))) return false
  if (o.s !== undefined && !(Array.isArray(o.s) && o.s.length <= CHALLENGE_CHANGES_MAX && o.s.every((c) => Array.isArray(c) && c.length === 3 && isInt(c[0]) && c[0] >= 1 && isString(c[1]) && isString(c[2])))) return false
  return true
}

/** Decode a `#c=` fragment; throws with a readable reason when it is not a challenge. */
export function decodeChallenge(text: string): ChallengePayload {
  let raw: unknown
  try {
    const trimmed = text.trim().replace(/^#?c=/, '')
    if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) throw new Error('bad characters')
    raw = JSON.parse(new TextDecoder().decode(fromBase64Url(trimmed)))
  } catch {
    throw new Error('Not a Touchline challenge link')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Not a Touchline challenge link')
  const o = raw as Record<string, unknown>
  if (typeof o.v === 'number' && o.v > 1) throw new Error('This challenge link comes from a newer version of Touchline')
  if (o.v !== 1) throw new Error('Not a Touchline challenge link')
  const s = o.s as Record<string, unknown> | undefined
  const c = o.c as Record<string, unknown> | undefined
  if (!s || typeof s !== 'object' || !c || typeof c !== 'object') throw new Error('Not a Touchline challenge link')
  if (!isString(o.data) || !isString(o.engine) || !isString(o.name) || !isString(o.k)) throw new Error('Not a Touchline challenge link')
  if (!isString(s.seed) || !isString(s.f) || !isString(s.l) || !isString(s.h) || !isInt(s.ls)) throw new Error('Not a Touchline challenge link')
  if (!Array.isArray(s.wl) || !s.wl.every(isString) || !s.wl.length) throw new Error('Not a Touchline challenge link')
  if (s.d !== 'calibrated' && s.d !== 'realistic') throw new Error('Not a Touchline challenge link')
  if (!FORMATIONS.some((f) => f.id === s.f)) throw new Error('Not a Touchline challenge link')
  if (!isRulesDiff(s.r)) throw new Error('Not a Touchline challenge link')
  if (!Array.isArray(o.p) || !o.p.every((row) => Array.isArray(row) && row.length === 2 && (row[0] === null || isString(row[0])) && (row[1] === null || isString(row[1])))) throw new Error('Not a Touchline challenge link')
  if (!isNumber(c.pts) || !isNumber(c.w) || !isNumber(c.d) || !isNumber(c.l) || !TIERS.includes(c.t as SeasonTier)) throw new Error('Not a Touchline challenge link')
  if (o.x !== undefined && !isChallengeSeason(o.x)) throw new Error('Not a Touchline challenge link')
  if (o.w !== undefined && !isChallengePowerUps(o.w, o.p.length)) throw new Error('Not a Touchline challenge link')
  if (o.i !== undefined && !isChallengeLocker(o.i)) throw new Error('Not a Touchline challenge link')
  if (o.g !== undefined && !(Array.isArray(o.g) && o.g.length === 2 && isInt(o.g[0]) && o.g[0] >= 0 && o.g[0] < o.p.length && isUpgradeBoost(o.g[1]))) throw new Error('Not a Touchline challenge link')
  if ((c.cu !== undefined && !CUP_REACHES.includes(c.cu as CupReach)) || (c.eu !== undefined && !CUP_REACHES.includes(c.eu as CupReach))) throw new Error('Not a Touchline challenge link')
  return {
    v: 1,
    data: o.data,
    engine: o.engine,
    name: cleanName(o.name),
    s: { seed: s.seed, f: s.f, l: s.l, wl: s.wl, h: s.h, ls: s.ls, d: s.d, r: s.r },
    p: o.p as ChallengePick[],
    c: { pts: c.pts, w: c.w, d: c.d, l: c.l, t: c.t as SeasonTier, ...(c.cu !== undefined ? { cu: c.cu as CupReach } : {}), ...(c.eu !== undefined ? { eu: c.eu as CupReach } : {}) },
    k: o.k,
    ...(o.x !== undefined ? { x: o.x as ChallengeSeason } : {}),
    ...(o.g !== undefined ? { g: o.g as [number, number] } : {}),
    ...(o.w !== undefined ? { w: o.w as ChallengePowerUp[] } : {}),
    ...(o.i !== undefined ? { i: o.i as PowerUp[] } : {}),
  }
}

/** One spin of a replayed draft, resolved against the universe it ran on. */
export interface ReplayedPick {
  clubId: string
  season: number
  /** Full player-season id drafted on this spin, or null for a re-spin or a discarded spin. */
  id: string | null
  slotId: string | null
}

/**
 * Drive a fresh draft through the challenger's spins. Every row costs one
 * `spin`; a null row is a re-spin or a discarded spin, logged as the store
 * logs them (`respin` is not called because it would spin again). Throws with
 * the spin number when a pick does not fit what the wheel landed on, when the
 * draft is left short, or when the wheel did not visit the same club-seasons.
 */
export function replayDraft(u: LoadedUniverse, d: DraftState, rng: Rng, c: ChallengePayload): ReplayedPick[] {
  const out: ReplayedPick[] = []
  const w = c.w ?? []
  // Power-ups from the challenger's locker, unpacked up front: their streams come from the seed, not from when they were unpacked
  try {
    for (const k of c.i ?? []) unpackPowerUp(d, k, c.s.seed)
  } catch (e) {
    throw new Error(`The locker: ${e instanceof Error ? e.message : String(e)}`)
  }
  // A swap made before this row's spin (or after the last one), as the challenger made it
  const swapAt = (row: number) => {
    for (const x of w) if (x[0] === 's' && x[1] === row) swapSlots(u, d, x[2], x[3])
  }
  for (let i = 0; i < c.p.length; i++) {
    const [playerId, slotId] = c.p[i]
    const n = i + 1
    if (isComplete(d)) throw new Error(`Spin ${n} came after the squad was complete`)
    try {
      swapAt(i)
    } catch (e) {
      throw new Error(`Spin ${n}: ${e instanceof Error ? e.message : String(e)}`)
    }
    // Position First: every spin of the XI fills the slot its row names, chosen before the spin as the player did
    if (positionFirst(d)) {
      if (!slotId || !openSlots(d).some((s) => s.id === slotId)) throw new Error(`Spin ${n}: no open slot ${slotId ?? ''} to fill`.trim())
      d.target = slotId
    }
    if (!canSpin(u, d)) throw new Error(`Spin ${n}: the wheel had run dry`)
    // Power-ups: a peek before the spin (it draws nothing), a season re-roll after it (from the draft's own stream)
    let cs: ClubSeason
    try {
      if (w.some((x) => x[0] === 'p' && x[1] === i)) usePeek(u, d, rng.getState())
      cs = spin(u, d, rng)
      if (w.some((x) => x[0] === 'r' && x[1] === i)) cs = rerollSeason(u, d)
    } catch (e) {
      throw new Error(`Spin ${n}: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (playerId === null) {
      d.respinsLeft = Math.max(0, d.respinsLeft - 1)
      d.history.push({ clubId: cs.clubId, season: cs.season, pickedId: null, slotId: null, ...(d.twist ? { twist: d.twist } : {}), ...(d.target ? { target: d.target } : {}) })
      d.current = null
      d.twist = null
      out.push({ clubId: cs.clubId, season: cs.season, id: null, slotId: null })
      continue
    }
    // An Icons spin's squad holds each icon at his own club and season, so the id is looked up there
    const id = isIcons(cs) ? cs.squad.find((p) => p.playerId === playerId)?.id ?? '' : `${playerId}@${cs.season}@${cs.clubId}`
    if (!u.index[id]) throw new Error(`Spin ${n}: no player ${playerId} in the ${isIcons(cs) ? 'Icons collection' : `${cs.clubId} ${cs.season} squad`}`)
    try {
      pick(u, d, id, slotId ?? 'bench')
    } catch (e) {
      throw new Error(`Spin ${n}: ${e instanceof Error ? e.message : String(e)}`)
    }
    out.push({ clubId: cs.clubId, season: cs.season, id, slotId })
  }
  swapAt(c.p.length)
  // A Quick Draft with a bench may stop once the XI is full, bench places to spare
  if (canCloseBench(d)) d.benchClosed = true
  if (!isComplete(d) && !(picksMade(d) >= 11 && !canSpin(u, d))) throw new Error(`The draft stopped after ${picksMade(d)} picks`)
  if (d.spins !== c.p.length || d.history.length !== c.p.length) throw new Error('The spins do not add up')
  if (historyKey(d.history) !== c.k) throw new Error('The wheel did not land on the same club-seasons')
  return out
}

/** The cup runs a claim names agree with a replay's: every cup the claim names went as far. */
export function sameCups(claim: ChallengeClaim, replay: ChallengeClaim): boolean {
  return (claim.cu === undefined || claim.cu === replay.cu) && (claim.eu === undefined || claim.eu === replay.eu)
}

/** The claim and a replayed result agree when every league figure matches (the cups are checked by `sameCups`). */
export function sameClaim(a: ChallengeClaim, b: ChallengeClaim): boolean {
  return a.pts === b.pts && a.w === b.w && a.d === b.d && a.l === b.l && a.t === b.t
}
