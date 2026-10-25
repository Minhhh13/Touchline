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
import { QUICK_RULES, canSpin, capFits, isComplete, picksMade, pick, spin } from './draft'
import type { Rng } from './rng'
import { hashString } from './rng'
import type { SeasonTier } from './types'
import type { LoadedUniverse } from './universe'
import { FORMATIONS } from './formations'
import { FIT_ORDER, type Fit } from './positions'

/** Longest name carried in a link; longer names are cut, control characters dropped. */
export const CHALLENGE_NAME_MAX = 24

export interface ChallengeClaim {
  pts: number
  w: number
  d: number
  l: number
  t: SeasonTier
}

/** One spin of the challenger's draft: the real player id drafted (`s200458`) and the slot, or nulls for a spin that drafted no one. */
export type ChallengePick = [playerId: string | null, slotId: string | null]

/** A quick-draft link as every build since ghost drafts reads it. */
export interface ChallengePayloadV1 {
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
}

/** What an arena link fixes beside the draft; `isArenaLink` checks it (the arena itself arrives with a later item). */
export interface ChallengeArena {
  f: 'gauntlet' | 'cup'
  n?: number
  fd?: string
  dc?: number
  dl?: string
}

/**
 * Version 2: the v1 shape plus `kind` (a quick draft, or an arena run) and the
 * arena's settings. A quick link travels as v2 only when its rules use a key
 * v1 builds do not know (`payloadVersionFor`), so an older build says the link
 * is newer rather than calling it garbage.
 */
export interface ChallengePayloadV2 extends Omit<ChallengePayloadV1, 'v'> {
  v: 2
  kind: 'quick' | 'arena'
  arena?: ChallengeArena
}

export type ChallengePayload = ChallengePayloadV1 | ChallengePayloadV2

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

/** The rules as a diff against `QUICK_RULES`, without `leagues` (which the payload carries as `wl`). */
export function rulesDiff(rules: DraftRules, base: DraftRules = QUICK_RULES): Partial<DraftRules> {
  const out: Partial<DraftRules> = {}
  const b = base as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(rules) as Array<[keyof DraftRules, unknown]>) {
    if (key === 'leagues' || value === undefined) continue
    if (b[key] !== value) (out as Record<string, unknown>)[key] = value
  }
  return out
}

/** The full rules from a payload: `QUICK_RULES`, the diff, and the wheel leagues. */
export function rulesFromPayload(c: ChallengePayload): DraftRules {
  return { ...QUICK_RULES, ...c.s.r, leagues: c.s.wl }
}

/** A draft's history as payload rows: the real player id of each pick (or null) and its slot. */
export function picksFromHistory(history: DraftState['history'], playerIdOf: (playerSeasonId: string) => string | undefined): ChallengePick[] {
  return history.map((h) => [h.pickedId ? playerIdOf(h.pickedId) ?? null : null, h.pickedId ? h.slotId : null])
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
/** The salary caps a link may carry, £M: the custom cap's floor up to a big squad's scaled Big Spender and more. */
export const CHALLENGE_BUDGET_RANGE: readonly [number, number] = [50, 1000]

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
  // A v2 rule: a capped link travels as version 2 (`payloadVersionFor`), so a v1 build reads it as newer
  budget: (v) => isNumber(v) && v >= CHALLENGE_BUDGET_RANGE[0] && v <= CHALLENGE_BUDGET_RANGE[1],
}

/**
 * The rule keys a v1 link may carry: the `RULE_CHECKS` keys when the v2 gate
 * landed. Never add to this list (a v1 build would refuse the key); a new rule
 * goes in `RULE_CHECKS` only, and a link that uses it travels as v2. When
 * replica-setup merges, its four rules (difficulty, showRatings, draftMode,
 * ratings) join this list in that merge, because v1 builds with them exist.
 */
export const V1_RULE_KEYS: readonly (keyof DraftRules)[] = ['squadSize', 'respins', 'fromSeason', 'toSeason', 'onlyClub', 'onlyNation', 'minFit', 'hardMode', 'uniqueClubSeasons', 'twists']

/** The payload version a link needs: 1 for a quick link whose rules a v1 build knows, 2 otherwise. */
export function payloadVersionFor(diff: Partial<DraftRules>, kind: 'quick' | 'arena'): 1 | 2 {
  if (kind !== 'quick') return 2
  return Object.keys(diff).every((key) => (V1_RULE_KEYS as readonly string[]).includes(key)) ? 1 : 2
}

/** Whether a link's arena settings describe a run this build can replay; none yet, until the arena links item fills it in. */
export function isArenaLink(arena: unknown): arena is ChallengeArena {
  void arena
  return false
}

/** Top-level keys a v2 link may carry; anything else is from a newer build. */
const V2_KEYS: readonly string[] = ['v', 'kind', 'arena', 'data', 'engine', 'name', 's', 'p', 'c', 'k']

/** Whether an object is a rules diff made only of known rules holding sensible values (a salary cap never beside one club or one nation, `capFits`). */
export function isRulesDiff(r: unknown): r is Partial<DraftRules> {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false
  return Object.entries(r).every(([key, value]) => Object.prototype.hasOwnProperty.call(RULE_CHECKS, key) && RULE_CHECKS[key as keyof DraftRules](value)) && capFits(r as Partial<DraftRules>)
}

/** The reason a link from a later build gives. */
export const NEWER_LINK = 'This challenge link comes from a newer version of TouchLine'
/** The reason an arena link gives while this build has no arena to replay it in. */
export const ARENA_LINK = 'This challenge needs the arena, which this build does not have yet'

/**
 * Decode a `#c=` fragment; throws with a readable reason when it is not a challenge.
 * Version 1 reads as it always has (its rules limited to `V1_RULE_KEYS`). Version 2
 * adds `kind` (quick when missing) and refuses a kind or a top-level key it does not
 * know as coming from a newer build; an arena link is refused until `isArenaLink` accepts it.
 * Anything above version 2 is from a newer build.
 */
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
  if (typeof o.v === 'number' && o.v > 2) throw new Error(NEWER_LINK)
  if (o.v !== 1 && o.v !== 2) throw new Error('Not a Touchline challenge link')
  const kind = o.v === 2 && o.kind !== undefined ? o.kind : 'quick'
  if (o.v === 2) {
    // A kind this build does not know is a later build's mode; anything but a string is not a link
    if (typeof kind !== 'string') throw new Error('Not a Touchline challenge link')
    if (kind !== 'quick' && kind !== 'arena') throw new Error(NEWER_LINK)
    if (kind === 'arena' && !isArenaLink(o.arena)) throw new Error(ARENA_LINK)
    if (Object.keys(o).some((key) => !V2_KEYS.includes(key))) throw new Error(NEWER_LINK)
    if (kind === 'quick' && o.arena !== undefined) throw new Error('Not a Touchline challenge link')
  }
  const s = o.s as Record<string, unknown> | undefined
  const c = o.c as Record<string, unknown> | undefined
  if (!s || typeof s !== 'object' || !c || typeof c !== 'object') throw new Error('Not a Touchline challenge link')
  if (!isString(o.data) || !isString(o.engine) || !isString(o.name) || !isString(o.k)) throw new Error('Not a Touchline challenge link')
  if (!isString(s.seed) || !isString(s.f) || !isString(s.l) || !isString(s.h) || !isInt(s.ls)) throw new Error('Not a Touchline challenge link')
  if (!Array.isArray(s.wl) || !s.wl.every(isString) || !s.wl.length) throw new Error('Not a Touchline challenge link')
  if (s.d !== 'calibrated' && s.d !== 'realistic') throw new Error('Not a Touchline challenge link')
  if (!FORMATIONS.some((f) => f.id === s.f)) throw new Error('Not a Touchline challenge link')
  if (!isRulesDiff(s.r)) throw new Error('Not a Touchline challenge link')
  if (o.v === 1 && !Object.keys(s.r).every((key) => (V1_RULE_KEYS as readonly string[]).includes(key))) throw new Error('Not a Touchline challenge link')
  if (!Array.isArray(o.p) || !o.p.every((row) => Array.isArray(row) && row.length === 2 && (row[0] === null || isString(row[0])) && (row[1] === null || isString(row[1])))) throw new Error('Not a Touchline challenge link')
  if (!isNumber(c.pts) || !isNumber(c.w) || !isNumber(c.d) || !isNumber(c.l) || !TIERS.includes(c.t as SeasonTier)) throw new Error('Not a Touchline challenge link')
  const body: Omit<ChallengePayloadV1, 'v'> = {
    data: o.data,
    engine: o.engine,
    name: cleanName(o.name),
    s: { seed: s.seed, f: s.f, l: s.l, wl: s.wl, h: s.h, ls: s.ls, d: s.d, r: s.r },
    p: o.p as ChallengePick[],
    c: { pts: c.pts, w: c.w, d: c.d, l: c.l, t: c.t as SeasonTier },
    k: o.k,
  }
  return o.v === 1 ? { v: 1, ...body } : { v: 2, kind: 'quick', ...body }
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
  for (let i = 0; i < c.p.length; i++) {
    const [playerId, slotId] = c.p[i]
    const n = i + 1
    if (isComplete(d)) throw new Error(`Spin ${n} came after the squad was complete`)
    if (!canSpin(u, d)) throw new Error(`Spin ${n}: the wheel had run dry`)
    const cs = spin(u, d, rng)
    if (playerId === null) {
      d.respinsLeft = Math.max(0, d.respinsLeft - 1)
      d.history.push({ clubId: cs.clubId, season: cs.season, pickedId: null, slotId: null, ...(d.twist ? { twist: d.twist } : {}) })
      d.current = null
      d.twist = null
      out.push({ clubId: cs.clubId, season: cs.season, id: null, slotId: null })
      continue
    }
    const id = `${playerId}@${cs.season}@${cs.clubId}`
    if (!u.index[id]) throw new Error(`Spin ${n}: no player ${playerId} in the ${cs.clubId} ${cs.season} squad`)
    try {
      pick(u, d, id, slotId ?? 'bench')
    } catch (e) {
      throw new Error(`Spin ${n}: ${e instanceof Error ? e.message : String(e)}`)
    }
    out.push({ clubId: cs.clubId, season: cs.season, id, slotId })
  }
  if (!isComplete(d) && !(picksMade(d) >= 11 && !canSpin(u, d))) throw new Error(`The draft stopped after ${picksMade(d)} picks`)
  if (d.spins !== c.p.length || d.history.length !== c.p.length) throw new Error('The spins do not add up')
  if (historyKey(d.history) !== c.k) throw new Error('The wheel did not land on the same club-seasons')
  return out
}

/** The claim and a replayed result agree when every figure matches. */
export function sameClaim(a: ChallengeClaim, b: ChallengeClaim): boolean {
  return a.pts === b.pts && a.w === b.w && a.d === b.d && a.l === b.l && a.t === b.t
}
