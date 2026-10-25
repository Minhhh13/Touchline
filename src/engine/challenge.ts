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
import type { TrainingFocus } from './training'
import type { ArenaField } from './knockout'
import { GAUNTLET_RUNGS } from './gauntlet'
import { cupRoundCount } from './cup'

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

/** What an arena link fixes beside the draft: the format, a Cup's size, its field and decade, and the Daily Arena's day it was played on. */
export interface ChallengeArena {
  f: 'gauntlet' | 'cup'
  n?: number
  fd?: ArenaField
  dc?: number
  dl?: string
}

/** One step of an arena claim: the score at 90, and the shoot-out (ours, theirs) when it was level. */
export type ArenaClaimStep = [gf: number, ga: number] | [gf: number, ga: number, pensUs: number, pensThem: number]

/** What an arena run claims: rounds won, whether it ended with the trophy (or the top of the ladder), and every step's score. */
export interface ArenaClaim {
  s: number
  w: boolean
  g: ArenaClaimStep[]
}

/**
 * Version 2: the v1 shape plus `kind`. A quick link travels as v2 only when
 * its rules use a key v1 builds do not know (`payloadVersionFor`), so an older
 * build says the link is newer rather than calling it garbage.
 */
export interface ChallengePayloadV2 extends Omit<ChallengePayloadV1, 'v'> {
  v: 2
  kind: 'quick'
}

/**
 * An arena run as a link (always version 2, `kind: 'arena'`): the v1 settings
 * and draft rows (bonus spins included, in order), the format, one training
 * letter per step, the rung the lifeline was used at, whether the assistant
 * played every match (`auto`; only such a run can verify) and the claim.
 */
export interface ArenaChallengePayload {
  v: 2
  kind: 'arena'
  data: string
  engine: string
  name: string
  s: ChallengePayloadV1['s']
  arena: ChallengeArena
  p: ChallengePick[]
  /** One `TRAINING_CODE` letter per step played. */
  t: string
  lf?: number
  auto: boolean
  ac: ArenaClaim
  k: string
  /** An arena link carries its claim in `ac`, never a quick claim. */
  c?: undefined
}

/** A quick-draft link, as `replayChallenge` and the quick Setup read it. */
export type QuickChallengePayload = ChallengePayloadV1 | ChallengePayloadV2
export type ChallengePayload = QuickChallengePayload | ArenaChallengePayload

/** True for an arena run's link. */
export function isArenaPayload(c: ChallengePayload): c is ArenaChallengePayload {
  return c.v === 2 && c.kind === 'arena'
}

/** The training focus of each arena step as one letter in a link. */
export const TRAINING_CODE: Record<TrainingFocus, string> = { balanced: 'b', attacking: 'a', defensive: 'd', 'set-pieces': 's', fitness: 'f', recovery: 'r', tactical: 't' }

/** The focus a link's letter stands for, or null for a letter this build does not know. */
export function trainingOfCode(letter: string): TrainingFocus | null {
  return (Object.keys(TRAINING_CODE) as TrainingFocus[]).find((f) => TRAINING_CODE[f] === letter) ?? null
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
  // A v2 rule too: a teammate chain link travels as version 2
  chain: isBool,
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

/** Most steps an arena claim may hold: a 15-rung Gauntlet with room to spare (a Cup has at most five). */
export const ARENA_LINK_STEPS_MAX = 20
/** Most goals (or shoot-out kicks) one side may claim in one arena step. */
export const ARENA_LINK_SCORE_MAX = 30
/** The Cup sizes and arena fields a link may name. */
const ARENA_SIZES: readonly number[] = [2, 8, 16, 32]
const ARENA_FIELDS: readonly ArenaField[] = ['wheel', 'champions', 'giants', 'decade', 'europe']
const ARENA_KEYS: readonly string[] = ['f', 'n', 'fd', 'dc', 'dl']

const isScore = (x: unknown): x is number => isInt(x) && x >= 0 && x <= ARENA_LINK_SCORE_MAX

/** One claimed step: `[gf, ga]` for a match decided at 90 (never level: a level arena match always goes to penalties), or `[gf, ga, pensUs, pensThem]` for a level match decided on penalties. */
function isClaimStep(x: unknown): x is ArenaClaimStep {
  if (!Array.isArray(x) || !x.every(isScore)) return false
  if (x.length === 2) return x[0] !== x[1]
  return x.length === 4 && x[0] === x[1] && x[2] !== x[3]
}

/**
 * Whether a claim is one a finished run could make: every step but the last
 * won (a defeat ends the run), `s` the steps won, and the trophy exactly when
 * the last step was won, which only the last round (the fifteenth rung, the
 * final) can be.
 */
function isRunClaim(ac: ArenaClaim, f: 'gauntlet' | 'cup', size: number): boolean {
  const won = ac.g.map((g) => g[0] > g[1] || (g.length === 4 && g[2] > g[3]))
  const last = won[won.length - 1]
  const rounds = f === 'gauntlet' ? GAUNTLET_RUNGS : cupRoundCount(size)
  if (won.slice(0, -1).some((w) => !w) || ac.s !== won.filter(Boolean).length || ac.g.length > rounds) return false
  return last ? ac.w && ac.g.length === rounds : !ac.w
}

/**
 * Whether a decoded object carries what an arena link needs beside the v1
 * settings and rows: a whitelisted format, size and field; a claim of at most
 * `ARENA_LINK_STEPS_MAX` steps with scores in range that a finished run could
 * make (`isRunClaim`); one known training letter
 * per step; a Gauntlet's lifeline rung; and the assistant flag.
 */
export function isArenaLink(o: unknown): o is Pick<ArenaChallengePayload, 'arena' | 't' | 'lf' | 'auto' | 'ac'> {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false
  const x = o as Record<string, unknown>
  const a = x.arena as Record<string, unknown> | undefined
  if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).some((key) => !ARENA_KEYS.includes(key))) return false
  if (a.f !== 'gauntlet' && a.f !== 'cup') return false
  if (a.f === 'gauntlet' && (a.n !== undefined || (a.fd !== undefined && a.fd !== 'wheel'))) return false
  if (a.n !== undefined && !ARENA_SIZES.includes(a.n as number)) return false
  if (a.fd !== undefined && !ARENA_FIELDS.includes(a.fd as ArenaField)) return false
  if (a.dc !== undefined && (!isInt(a.dc) || a.fd !== 'decade' || a.dc < 1900 || a.dc > 2100)) return false
  if (a.dl !== undefined && !(isString(a.dl) && /^\d{4}-\d{2}-\d{2}$/.test(a.dl))) return false
  const ac = x.ac as Record<string, unknown> | undefined
  if (!ac || typeof ac !== 'object' || Array.isArray(ac) || Object.keys(ac).some((key) => !['s', 'w', 'g'].includes(key))) return false
  if (!Array.isArray(ac.g) || !ac.g.length || ac.g.length > ARENA_LINK_STEPS_MAX || !ac.g.every(isClaimStep)) return false
  if (!isInt(ac.s) || ac.s < 0 || ac.s > ac.g.length || !isBool(ac.w)) return false
  if (!isRunClaim({ s: ac.s, w: ac.w, g: ac.g as ArenaClaimStep[] }, a.f, (a.n as number | undefined) ?? 2)) return false
  if (!isString(x.t) || x.t.length !== ac.g.length || !x.t.split('').every((ch) => trainingOfCode(ch) !== null)) return false
  if (x.lf !== undefined && (a.f !== 'gauntlet' || !isInt(x.lf) || x.lf < 1 || x.lf > ac.g.length)) return false
  return isBool(x.auto)
}

/** Top-level keys a v2 quick link may carry; anything else is from a newer build. */
const V2_KEYS: readonly string[] = ['v', 'kind', 'arena', 'data', 'engine', 'name', 's', 'p', 'c', 'k']
/** Top-level keys a v2 arena link may carry. */
const V2_ARENA_KEYS: readonly string[] = ['v', 'kind', 'arena', 'data', 'engine', 'name', 's', 'p', 't', 'lf', 'auto', 'ac', 'k']

/** Whether an object is a rules diff made only of known rules holding sensible values (a salary cap never beside one club or one nation, `capFits`). */
export function isRulesDiff(r: unknown): r is Partial<DraftRules> {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false
  return Object.entries(r).every(([key, value]) => Object.prototype.hasOwnProperty.call(RULE_CHECKS, key) && RULE_CHECKS[key as keyof DraftRules](value)) && capFits(r as Partial<DraftRules>)
}

/** The reason a link from a later build gives. */
export const NEWER_LINK = 'This challenge link comes from a newer version of TouchLine'

/**
 * Decode a `#c=` fragment; throws with a readable reason when it is not a challenge.
 * Version 1 reads as it always has (its rules limited to `V1_RULE_KEYS`). Version 2
 * adds `kind` (quick when missing) and refuses a kind or a top-level key it does not
 * know as coming from a newer build; an arena link must pass `isArenaLink` and carries
 * its claim in `ac` rather than `c`. Anything above version 2 is from a newer build.
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
    if (Object.keys(o).some((key) => !(kind === 'arena' ? V2_ARENA_KEYS : V2_KEYS).includes(key))) throw new Error(NEWER_LINK)
    if (kind === 'arena' && !isArenaLink(raw)) throw new Error('Not a Touchline challenge link')
    if (kind === 'quick' && o.arena !== undefined) throw new Error('Not a Touchline challenge link')
  }
  const arena = kind === 'arena'
  const s = o.s as Record<string, unknown> | undefined
  const c = o.c as Record<string, unknown> | undefined
  if (!s || typeof s !== 'object' || (!arena && (!c || typeof c !== 'object'))) throw new Error('Not a Touchline challenge link')
  if (!isString(o.data) || !isString(o.engine) || !isString(o.name) || !isString(o.k)) throw new Error('Not a Touchline challenge link')
  if (!isString(s.seed) || !isString(s.f) || !isString(s.l) || !isString(s.h) || !isInt(s.ls)) throw new Error('Not a Touchline challenge link')
  if (!Array.isArray(s.wl) || !s.wl.every(isString) || !s.wl.length) throw new Error('Not a Touchline challenge link')
  if (s.d !== 'calibrated' && s.d !== 'realistic') throw new Error('Not a Touchline challenge link')
  if (!FORMATIONS.some((f) => f.id === s.f)) throw new Error('Not a Touchline challenge link')
  if (!isRulesDiff(s.r)) throw new Error('Not a Touchline challenge link')
  if (o.v === 1 && !Object.keys(s.r).every((key) => (V1_RULE_KEYS as readonly string[]).includes(key))) throw new Error('Not a Touchline challenge link')
  if (!Array.isArray(o.p) || !o.p.every((row) => Array.isArray(row) && row.length === 2 && (row[0] === null || isString(row[0])) && (row[1] === null || isString(row[1])))) throw new Error('Not a Touchline challenge link')
  const settings: ChallengePayloadV1['s'] = { seed: s.seed, f: s.f, l: s.l, wl: s.wl as string[], h: s.h, ls: s.ls, d: s.d as 'calibrated' | 'realistic', r: s.r }
  if (arena && isArenaLink(raw)) {
    const a = raw.arena
    const ac = raw.ac
    return {
      v: 2,
      kind: 'arena',
      data: o.data,
      engine: o.engine,
      name: cleanName(o.name),
      s: settings,
      arena: { f: a.f, ...(a.n !== undefined ? { n: a.n } : {}), ...(a.fd !== undefined ? { fd: a.fd } : {}), ...(a.dc !== undefined ? { dc: a.dc } : {}), ...(a.dl !== undefined ? { dl: a.dl } : {}) },
      p: o.p as ChallengePick[],
      t: raw.t,
      ...(raw.lf !== undefined ? { lf: raw.lf } : {}),
      auto: raw.auto,
      ac: { s: ac.s, w: ac.w, g: ac.g.map((step) => [...step] as ArenaClaimStep) },
      k: o.k,
    }
  }
  if (!c || !isNumber(c.pts) || !isNumber(c.w) || !isNumber(c.d) || !isNumber(c.l) || !TIERS.includes(c.t as SeasonTier)) throw new Error('Not a Touchline challenge link')
  const body: Omit<ChallengePayloadV1, 'v'> = {
    data: o.data,
    engine: o.engine,
    name: cleanName(o.name),
    s: settings,
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
  for (let i = 0; i < c.p.length; i++) out.push(replayRow(u, d, rng, c.p[i], i + 1))
  if (!draftClosed(u, d)) throw new Error(`The draft stopped after ${picksMade(d)} picks`)
  if (d.spins !== c.p.length || d.history.length !== c.p.length) throw new Error('The spins do not add up')
  if (historyKey(d.history) !== c.k) throw new Error('The wheel did not land on the same club-seasons')
  return out
}

/** A draft the store would let close: complete, or a full XI on a wheel that has run dry. */
export function draftClosed(u: LoadedUniverse, d: DraftState): boolean {
  return isComplete(d) || (picksMade(d) >= 11 && !canSpin(u, d))
}

/**
 * One row of the challenger's draft, spin number `n` (1-based): one `spin`,
 * then the pick, or a re-spin or discarded spin logged as the store logs it.
 * Throws with the spin number when the row does not fit the wheel.
 */
export function replayRow(u: LoadedUniverse, d: DraftState, rng: Rng, row: ChallengePick, n: number): ReplayedPick {
  const [playerId, slotId] = row
  if (isComplete(d)) throw new Error(`Spin ${n} came after the squad was complete`)
  if (!canSpin(u, d)) throw new Error(`Spin ${n}: the wheel had run dry`)
  const cs = spin(u, d, rng)
  if (playerId === null) {
    d.respinsLeft = Math.max(0, d.respinsLeft - 1)
    d.history.push({ clubId: cs.clubId, season: cs.season, pickedId: null, slotId: null, ...(d.twist ? { twist: d.twist } : {}) })
    d.current = null
    d.twist = null
    return { clubId: cs.clubId, season: cs.season, id: null, slotId: null }
  }
  const id = `${playerId}@${cs.season}@${cs.clubId}`
  if (!u.index[id]) throw new Error(`Spin ${n}: no player ${playerId} in the ${cs.clubId} ${cs.season} squad`)
  try {
    pick(u, d, id, slotId ?? 'bench')
  } catch (e) {
    throw new Error(`Spin ${n}: ${e instanceof Error ? e.message : String(e)}`)
  }
  return { clubId: cs.clubId, season: cs.season, id, slotId }
}

/** The claim and a replayed result agree when every figure matches. */
export function sameClaim(a: ChallengeClaim, b: ChallengeClaim): boolean {
  return a.pts === b.pts && a.w === b.w && a.d === b.d && a.l === b.l && a.t === b.t
}
