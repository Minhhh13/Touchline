/**
 * The match engine.
 *
 * Expected goals for each side come from attack-vs-defence unit ratings,
 * shaped by tactics, home advantage, morale, fatigue and a dose of "any given
 * Saturday" variance. Goals are then drawn from a Poisson distribution and
 * dressed with scorers, assists, cards, injuries, substitutions and chances to
 * produce a readable minute-by-minute report in the Football Manager tradition.
 *
 * A match is played in three segments with two stops. `beginMatch` plays the
 * first half (1-45) and returns a serialisable `MatchInProgress`;
 * `advanceMatch` plays on to the 70th minute and then to the final whistle,
 * each time applying the human side's changes at the stop (a half-time talk,
 * instructions and substitutions at 45; instructions, substitutions and a
 * touchline shout at 70) and the AI side's reaction to the scoreline;
 * `finishMatch` plays whatever is left and writes the report. `simulateMatch`
 * runs the same three segments in one go, so a simmed week and a hand-played
 * one share one path.
 */
import type { Injury, Lineup, MatchEvent, MatchResult, PlayerMatchStats, PlayerSeason, Position, SquadPlayer, Tactics, TeamStrength } from './types'
import { Rng, type RngState } from './rng'
import { binOf, momentumBins, placeEvents } from './matchDetail'
import { autoPickLineup, computeTeamStrength, type SlotEvaluation } from './ratings'
import { tacticalModifiers, type TacticalModifiers } from './tactics'
import { getFormation } from './formations'
import { positionFactor } from './positions'
import { aerial, aggressionCardFactor, fatigueInjuryFactor, LATE_FADE, legs, mismatchFactor, staminaCostFactor } from './depth'

export type TeamTalk = 'calm' | 'encourage' | 'demand' | 'fire-up' | 'none'

export interface MatchTeamInput {
  teamId: string
  teamName: string
  shortName: string
  tactics: Tactics
  lineup: Lineup
  bench: string[]
  getPlayer: (id: string) => PlayerSeason | undefined
  getState: (id: string) => SquadPlayer | undefined
  teamTalk?: TeamTalk
  /** Rating points subtracted from every unit (difficulty calibration for AI clubs). */
  ratingOffset?: number
  /** Captain (player-season id): a leader on the pitch steadies the side in big games. */
  captainId?: string
  /** Multiplier on how strongly team talks land (an assistant manager raises it). */
  talkSkill?: number
  /** Opposition player-season id to man-mark: his influence drops, ours a little too. */
  markTarget?: string
}

export interface MatchOptions {
  rng: Rng
  home: MatchTeamInput
  away: MatchTeamInput
  /** Cup finals are played at a neutral venue. */
  neutral?: boolean
  /** 1 = routine league game, up to ~1.4 for finals and derbies. */
  importance?: number
  /** Why this match matters, for the report. */
  importanceLabel?: string
  /** 'full' produces chances and saves; 'summary' only the essentials. */
  detail?: 'full' | 'summary'
  /** External multipliers (training focus, one-off boosts) on expected goals. */
  boosts?: { home?: { attack: number; defence: number }; away?: { attack: number; defence: number } }
}

export interface Substitution {
  minute: number
  off: string
  on: string
  reason: string
}

export interface TeamReport {
  strength: TeamStrength
  modifiers: TacticalModifiers
  xg: number
  possession: number
  shots: number
  shotsOnTarget: number
  substitutions: Substitution[]
  finishedWith: number
  teamTalkEffect: string
  halfTimeEffect?: string
  /** What the touchline shout at 70 minutes did (human side only). */
  lateEffect?: string
  /** Everyone who took the pitch, with his slot and his minutes, for the pitch views. Absent on results written before them. */
  appearances?: Appearance[]
  /** The side's instructions at the final whistle, for the tactics overlay. Absent on older results. */
  tactics?: Tactics
}

/** A man who took the pitch: his formation slot, when he came on and went off (90 if he saw it out) and how he left. */
export interface Appearance {
  psId: string
  slotId: string
  position: Position
  onAt: number
  offAt: number
  red: boolean
  injured: boolean
}

/** A touchline shout for the last twenty minutes. */
export type Shout = 'all-out-attack' | 'shut-up-shop' | 'keep-shape'

/** Multipliers on expected goals from 71 to 90 for the shouting side (own) and its opponent (opp). */
export const SHOUTS: Record<Shout, { label: string; hint: string; ownAttack: number; oppAttack: number; fatigue: number; text: string }> = {
  'all-out-attack': { label: 'All-out attack', hint: 'Own chances ×1.3, theirs ×1.35, legs go', ownAttack: 1.3, oppAttack: 1.35, fatigue: 4, text: 'All-out attack from the 70th minute: everyone forward, and the back door left open.' },
  'shut-up-shop': { label: 'Shut up shop', hint: 'Own chances ×0.55, theirs ×0.72', ownAttack: 0.55, oppAttack: 0.72, fatigue: 0, text: 'Shut up shop from the 70th minute: two banks behind the ball, nothing committed forward.' },
  'keep-shape': { label: 'Keep shape', hint: 'No late gamble either way', ownAttack: 1, oppAttack: 1, fatigue: 0, text: 'Kept the shape for the last twenty minutes: no late gamble either way.' },
}

/** Where a paused match stands: after the first half, after the 70th minute, or finished. */
export type MatchClock = 45 | 70 | 90

/** The six instructions a manager can change while the ball is in play (formation and roles are fixed: the lineup is keyed by slot). */
export type Instructions = Pick<Tactics, 'mentality' | 'pressing' | 'tempo' | 'width' | 'defensiveLine' | 'passing'>
export const INSTRUCTION_KEYS = ['mentality', 'pressing', 'tempo', 'width', 'defensiveLine', 'passing'] as const

/** A change of instructions, set-piece takers, shout or personnel, as it happened. */
export interface TimelineEntry {
  /** The change applies from minute + 1; 0 is kick-off. */
  minute: number
  side: 'home' | 'away'
  by: 'kickoff' | 'manager' | 'ai'
  /** Only the fields that changed (all six at kick-off). */
  instructions?: Partial<Instructions>
  setPieces?: Tactics['setPieces']
  shout?: Shout
  /** Substitutions the manager made at this minute (a window unless the minute is 45). */
  subs?: number
}

/** The canonical segment last played (1-45, 46-70 or 71-90) and the index of its first event in `mp.events`. */
export interface SegmentInPlay {
  from: number
  to: number
  eventStart: number
}

/** Every change counts towards the five (routine, injury and the manager's). */
export const MAX_SUBS = 5
/** The manager's substitution windows while the ball is in play; half time is free. */
export const MAX_WINDOWS = 3

/** A change the manager makes with the ball in play, at `minute`: it applies from the next minute. */
export interface InPlayChange {
  side: 'home' | 'away'
  minute: number
  tactics?: Tactics
  substitutions?: Array<{ off: string; on: string }>
  shout?: Shout
}

export type InPlayRefusal = 'no-change' | 'no-segment' | 'outside-segment' | 'too-late' | 'in-the-past' | 'summary-match'

export interface InPlayOutcome {
  applied: boolean
  refusal?: InPlayRefusal
  made: Substitution[]
  /** `before-kick-off`: a substitution at minute 0 (the team is picked before the match, not changed in it). */
  refused: Array<{ off: string; on: string; why: 'no-window' | 'no-subs-left' | 'not-on-pitch' | 'unavailable' | 'already-played' | 'before-kick-off' }>
  /** A shout asked for before the 70th minute. */
  shoutRefused?: boolean
}

export interface InPlayCheck {
  ok: boolean
  refusal?: InPlayRefusal
  /** The stop a refused change can wait for instead (an old save), or null. */
  nextStop: 45 | 70 | null
}


export interface FullMatchResult extends MatchResult {
  homeName: string
  awayName: string
  homeReport: TeamReport
  awayReport: TeamReport
  /** Condition lost per player-season id. */
  conditionLoss: Record<string, number>
  importance: number
  importanceLabel?: string
  halfTimeScore: { home: number; away: number }
  /** The home side's share of the pressure in each five-minute bin (eighteen values, 0..1). Absent on results written before the pitch views. */
  momentum?: number[]
  /** Kick-off instructions and every change after them (full-detail matches only). */
  timeline?: TimelineEntry[]
  /** A key read off the match's own stream, for the match-day views' decoration streams (full-detail matches only). */
  seedKey?: string
  /** Played at a neutral venue (full-detail matches only, written only when true). */
  neutral?: boolean
}

/** Serialisable state of a player on the team sheet. */
export interface LivePlayer {
  psId: string
  slotId: string
  position: Position
  onAt: number
  offAt: number
  yellow: boolean
  red: boolean
  injury: Injury | null
  goals: number
  assists: number
  saves: number
  /** Effective rating in role, for match ratings. */
  effective: number
  shares: { gk: number; defence: number; midfield: number; attack: number }
  creativity: number
  /** Man-marked by the opposition: his attacking weights are cut while he is on. */
  marked?: boolean
  /** Minute of his booking, so a substitution or a red never predates it. */
  cardAt?: number
}

export interface TeamSnapshot {
  teamId: string
  teamName: string
  shortName: string
  tactics: Tactics
  lineup: Lineup
  bench: string[]
  ratingOffset: number
  teamTalk: TeamTalk
  captainId?: string
  talkSkill?: number
  markTarget?: string
  strength: TeamStrength
  modifiers: TacticalModifiers
  talkText: string
  /** Team-level "day" variance factor, kept across the whole match. */
  variance: number
  boost: { attack: number; defence: number }
  /** The human side's half-time talk, as it landed. */
  halfTimeText?: string
  /** The human side's touchline shout at 70 minutes, as it landed. */
  lateText?: string
  /** The shout in force from the 71st minute, so a change after 70 plays the rest under it. */
  shout?: Shout
  /** The late fade applied at 70 (full-detail matches), reused by a change in play after 70 so it never applies twice. */
  lateFadeAt70?: number
}

export interface MatchInProgress {
  home: TeamSnapshot
  away: TeamSnapshot
  hLive: LivePlayer[]
  aLive: LivePlayer[]
  events: MatchEvent[]
  hSubs: Substitution[]
  aSubs: Substitution[]
  rngState: RngState
  neutral: boolean
  importance: number
  importanceLabel?: string
  detail: 'full' | 'summary'
  halfTimeScore: { home: number; away: number }
  /** Full-match expected goals as computed before kick-off, for the report. */
  lamH: number
  lamA: number
  /** Minute the match is paused at. A paused match saved before the 70th-minute window existed has none and reads as 45. */
  clock?: MatchClock
  /** Routine changes drawn at the restart but due after the 70th minute; applied when the last segment is played. */
  pendingSubs?: { home: Substitution[]; away: Substitution[] }
  /** The home side's share of the pressure per five-minute bin, for the segments played so far. */
  momentum?: number[]
  /** The canonical segment last played, for a change with the ball in play (full detail; absent on older saves). */
  segment?: SegmentInPlay
  /** Kick-off instructions and every change since (full detail; absent on older saves). */
  timeline?: TimelineEntry[]
  /** Read off the match stream at half time, never drawn (full detail; absent on older saves). */
  seedKey?: string
}

export interface SecondHalfOptions {
  /** Which side the human manages, when they intervene at a stop. */
  side: 'home' | 'away'
  /** Half-time talk: read at the 45' stop only. */
  talk?: TeamTalk
  tactics?: Tactics
  substitutions?: Array<{ off: string; on: string }>
  /** Touchline shout for the last twenty minutes: read at the 70' stop only. */
  shout?: Shout
}

/** The human side's changes at a stop, without naming the side. */
export type LiveChanges = Omit<SecondHalfOptions, 'side'>

export interface TeamLookups {
  getPlayer: (id: string) => PlayerSeason | undefined
  getState: (id: string) => SquadPlayer | undefined
}

const BASE_XG = 1.32
const K = 0.055

// ---------------------------------------------------------------------------
// Public API

export function simulateMatch(opts: MatchOptions): FullMatchResult {
  const mp = beginMatch(opts)
  const lookups = { home: opts.home, away: opts.away }
  advanceMatch(mp, lookups, undefined, 70)
  return finishMatch(mp, lookups)
}

export function beginMatch(opts: MatchOptions): MatchInProgress {
  const { rng, home, away } = opts
  const detail = opts.detail ?? 'full'
  const importance = opts.importance ?? 1
  const neutral = !!opts.neutral

  const hs = withOffset(computeTeamStrength(home.tactics, home.lineup, home.getPlayer, home.getState), home.ratingOffset ?? 0)
  const as = withOffset(computeTeamStrength(away.tactics, away.lineup, away.getPlayer, away.getState), away.ratingOffset ?? 0)
  const hm = tacticalModifiers(home.tactics, hs.slots, away.tactics, as.slots)
  const am = tacticalModifiers(away.tactics, as.slots, home.tactics, hs.slots)
  const hLive = buildLive(hs.slots)
  const aLive = buildLive(as.slots)
  applyMarking(home, aLive, hm, away.getPlayer)
  applyMarking(away, hLive, am, home.getPlayer)
  const hTalk = scaleTalk(teamTalkEffect(rng, home.teamTalk ?? 'none', hs.overall, as.overall, hLive, home.getPlayer), home.talkSkill)
  const aTalk = scaleTalk(teamTalkEffect(rng, away.teamTalk ?? 'none', as.overall, hs.overall, aLive, away.getPlayer), away.talkSkill)

  const cons = (live: LivePlayer[], get: MatchTeamInput['getPlayer']) => avg(live.map((p) => get(p.psId)?.traits.consistency ?? 0.5))
  const sigma = (c: number) => 0.06 + 0.12 * (1 - c)
  const hVar = Math.exp(rng.gaussian(0, sigma(cons(hLive, home.getPlayer))))
  const aVar = Math.exp(rng.gaussian(0, sigma(cons(aLive, away.getPlayer))))

  const snap = (t: MatchTeamInput, strength: TeamStrength, modifiers: TacticalModifiers, talkText: string, variance: number, boost: { attack: number; defence: number } | undefined): TeamSnapshot => ({
    teamId: t.teamId,
    teamName: t.teamName,
    shortName: t.shortName,
    tactics: t.tactics,
    lineup: t.lineup,
    bench: t.bench,
    ratingOffset: t.ratingOffset ?? 0,
    teamTalk: t.teamTalk ?? 'none',
    captainId: t.captainId,
    talkSkill: t.talkSkill,
    markTarget: t.markTarget,
    strength: strip(strength),
    modifiers,
    talkText,
    variance,
    boost: boost ?? { attack: 1, defence: 1 },
  })
  const mp: MatchInProgress = {
    home: snap(home, hs, hm, hTalk.text, hVar * hTalk.factor, opts.boosts?.home),
    away: snap(away, as, am, aTalk.text, aVar * aTalk.factor, opts.boosts?.away),
    hLive,
    aLive,
    events: [{ minute: 0, type: 'kickoff', side: 'home', text: 'Kick-off.' }],
    hSubs: [],
    aSubs: [],
    rngState: rng.getState(),
    neutral,
    importance,
    importanceLabel: opts.importanceLabel,
    detail,
    halfTimeScore: { home: 0, away: 0 },
    lamH: 0,
    lamA: 0,
    clock: 45,
    pendingSubs: { home: [], away: [] },
  }
  const { lamH, lamA } = expectedGoals(mp, home, away)
  mp.lamH = lamH
  mp.lamA = lamA

  if (detail === 'full') {
    mp.timeline = [kickOffEntry('home', home.tactics), kickOffEntry('away', away.tactics)]
    mp.segment = { from: 1, to: 45, eventStart: mp.events.length }
  }
  playSegment(mp, rng, home, away, 1, 45, lamH, lamA)
  mp.halfTimeScore = score(mp.events)
  mp.events.push({ minute: 45, type: 'half_time', side: 'home', text: halfTimeText(home.shortName, away.shortName, mp.halfTimeScore) })
  // The second half draws from its own stream, so the caller's rng (which goes on to the
  // week's other fixtures) is never replayed when the paused match resumes.
  mp.rngState = rng.fork('second-half').getState()
  // A name for the match's decoration streams, read off that state (nothing is drawn)
  if (detail === 'full') mp.seedKey = [mp.rngState.a, mp.rngState.b, mp.rngState.c, mp.rngState.d].map((n) => (n >>> 0).toString(36)).join('-')
  return mp
}

function halfTimeText(home: string, away: string, s: { home: number; away: number }): string {
  return `Half time: ${home} ${s.home}-${s.away} ${away}.`
}

function kickOffEntry(side: 'home' | 'away', t: Tactics): TimelineEntry {
  return { minute: 0, side, by: 'kickoff', instructions: pickInstructions(t) }
}

function pickInstructions(t: Tactics): Instructions {
  return { mentality: t.mentality, pressing: t.pressing, tempo: t.tempo, width: t.width, defensiveLine: t.defensiveLine, passing: t.passing }
}

function instructionDiff(before: Tactics, after: Tactics): Partial<Instructions> {
  const out: Partial<Record<keyof Instructions, string>> = {}
  for (const k of INSTRUCTION_KEYS) if (before[k] !== after[k]) out[k] = after[k]
  return out as Partial<Instructions>
}

function sameSetPieces(a: Tactics['setPieces'], b: Tactics['setPieces']): boolean {
  return (a?.penalties ?? '') === (b?.penalties ?? '') && (a?.freeKicks ?? '') === (b?.freeKicks ?? '') && (a?.corners ?? '') === (b?.corners ?? '')
}

/**
 * Write a change into the timeline (when the match keeps one): the instructions
 * that differ, new set-piece takers, a shout and the number of substitutions. A
 * change at the same minute by the same side and hand as the last entry is
 * merged into it. The first change of set-piece takers backfills the side's
 * kick-off entry with the takers it started with, so the timeline can replay them.
 */
function recordChange(mp: MatchInProgress, side: 'home' | 'away', minute: number, by: 'manager' | 'ai', before: Tactics, after: Tactics, extra: { shout?: Shout; subs?: number } = {}): void {
  const timeline = mp.timeline
  if (!timeline) return
  const diff = instructionDiff(before, after)
  const spChanged = !sameSetPieces(before.setPieces, after.setPieces)
  if (!Object.keys(diff).length && !spChanged && !extra.shout && !extra.subs) return
  if (spChanged) {
    const kick = timeline.find((e) => e.side === side && e.by === 'kickoff')
    if (kick && !kick.setPieces && !timeline.some((e) => e.side === side && e.by !== 'kickoff' && e.setPieces)) kick.setPieces = { ...(before.setPieces ?? {}) }
  }
  const last = timeline[timeline.length - 1]
  const entry: TimelineEntry = last && last.side === side && last.minute === minute && last.by === by ? last : { minute, side, by }
  if (Object.keys(diff).length) entry.instructions = { ...(entry.instructions ?? {}), ...diff }
  if (spChanged) entry.setPieces = { ...(after.setPieces ?? {}) }
  if (extra.shout) entry.shout = extra.shout
  if (extra.subs) entry.subs = (entry.subs ?? 0) + extra.subs
  if (entry !== last) timeline.push(entry)
}

/**
 * The timeline as a result keeps it. A side's kick-off entry keeps only the
 * instructions a later entry of that side changes (the others never moved, so
 * the final tactics say them) and is dropped when nothing is left and its
 * set-piece takers never changed. The match feed reads it back whole. Saves
 * keep a whole season of results, so every byte here counts.
 */
export function compactTimeline(timeline: TimelineEntry[]): TimelineEntry[] {
  const out: TimelineEntry[] = []
  for (const e of timeline) {
    if (e.by !== 'kickoff') {
      out.push(e)
      continue
    }
    const later = timeline.filter((x) => x.side === e.side && x.by !== 'kickoff')
    const keys = new Set(later.flatMap((x) => Object.keys(x.instructions ?? {})))
    const kept: Partial<Record<keyof Instructions, string>> = {}
    for (const k of INSTRUCTION_KEYS) if (keys.has(k) && e.instructions?.[k] !== undefined) kept[k] = e.instructions[k]
    if (!Object.keys(kept).length && !e.setPieces) continue
    out.push({ ...e, instructions: kept as Partial<Instructions> })
  }
  return out
}

/** The score as it stands in a paused match. */
export function currentScore(mp: MatchInProgress): { home: number; away: number } {
  return score(mp.events)
}

/**
 * Play on from the current stop (45 or 70) to `to` (70 or 90). The human
 * side's changes in `second` are applied at the stop the match stands at: a
 * talk, instructions and substitutions at half time; instructions,
 * substitutions and a shout at 70. The AI side reacts to the scoreline at both
 * stops. Does nothing when the match already stands at or beyond `to`.
 */
export function advanceMatch(mp: MatchInProgress, lookups: { home: TeamLookups; away: TeamLookups }, second: SecondHalfOptions | undefined, to: 70 | 90): void {
  const clock: number = mp.clock ?? 45
  if (clock >= to) return
  const from = clock + 1
  const rng = Rng.fromState(mp.rngState)
  const home = inputFromSnapshot(mp.home, lookups.home)
  const away = inputFromSnapshot(mp.away, lookups.away)
  const current = score(mp.events)
  const pending = (mp.pendingSubs ??= { home: [], away: [] })

  // Intervention by the human side at this stop
  let shout: (typeof SHOUTS)[Shout] | null = null
  if (second) {
    const side = second.side === 'home' ? mp.home : mp.away
    const live = second.side === 'home' ? mp.hLive : mp.aLive
    const subs = second.side === 'home' ? mp.hSubs : mp.aSubs
    const input = second.side === 'home' ? home : away
    const before = side.tactics
    if (second.tactics) side.tactics = second.tactics
    let madeNow = 0
    for (const s of second.substitutions ?? []) {
      if (subs.length >= 5) break
      const off = live.find((p) => p.psId === s.off && p.offAt >= 90 && !p.red)
      const on = input.getPlayer(s.on)
      if (!off || !on || live.some((p) => p.psId === s.on)) continue
      off.offAt = clock
      live.push({ psId: on.id, slotId: off.slotId, position: off.position, onAt: clock, offAt: 90, yellow: false, red: false, injury: null, goals: 0, assists: 0, saves: 0, effective: on.overall * positionFactor(on, off.position), shares: { ...off.shares }, creativity: off.creativity })
      subs.push({ minute: clock, off: off.psId, on: on.id, reason: clock === 45 ? 'half-time' : '70th minute' })
      mp.events.push({ minute: clock, type: 'substitution', side: second.side, playerId: off.psId, playerName: input.getPlayer(off.psId)?.name, secondaryId: on.id, secondaryName: on.name, text: clock === 45 ? `Half-time change: ${on.name} replaces ${input.getPlayer(off.psId)?.name}.` : `Change on 70 minutes: ${on.name} replaces ${input.getPlayer(off.psId)?.name}.` })
      madeNow++
    }
    // Rebuild the side's lineup for the numbers from here: every slot keeps its most recent
    // occupant (substitutes were pushed after the men they replaced). A sent-off or injured
    // player stays in his slot here; being a man down is costed by shortHandedFactor, the same
    // way it is for the AI side, so the human is not penalised twice.
    const lineup: Lineup = {}
    for (const p of live) lineup[p.slotId] = p.psId
    side.lineup = lineup
    const us = second.side === 'home' ? current.home : current.away
    const them = second.side === 'home' ? current.away : current.home
    if (clock === 45) {
      const talk = scaleTalk(halfTimeTalk(rng, second.talk ?? 'none', us - them, live, input.getPlayer), side.talkSkill)
      side.variance *= talk.factor
      side.halfTimeText = talk.text
      side.talkText = side.talkText ? `${side.talkText} ${talk.text}` : talk.text
    } else {
      if (second.shout) {
        shout = SHOUTS[second.shout]
        side.lateText = shout.text
        side.shout = second.shout
      }
      // The manager has taken the changes into his own hands: the assistant's routine ones are off
      if (madeNow > 0) pending[second.side] = []
    }
    recordChange(mp, second.side, clock, 'manager', before, side.tactics, { shout: clock === 45 ? undefined : second.shout, subs: madeNow })
  }

  // The AI side reacts to the scoreline: at the break a two-goal swing changes the mentality;
  // at 70 a side behind goes for it and a side a goal up protects what it has.
  for (const sideKey of ['home', 'away'] as const) {
    if (second?.side === sideKey) continue
    const side = sideKey === 'home' ? mp.home : mp.away
    const before = side.tactics
    const us = sideKey === 'home' ? current.home : current.away
    const them = sideKey === 'home' ? current.away : current.home
    const diff = us - them
    if (clock === 45) {
      if (diff <= -2 && side.tactics.mentality !== 'attacking') side.tactics = { ...side.tactics, mentality: 'attacking', pressing: side.tactics.pressing === 'low' ? 'mid' : side.tactics.pressing }
      else if (diff >= 2 && side.tactics.mentality === 'attacking') side.tactics = { ...side.tactics, mentality: 'balanced' }
    } else {
      if (diff < 0) side.tactics = { ...side.tactics, mentality: 'attacking', tempo: 'fast' }
      else if (diff === 1) side.tactics = { ...side.tactics, mentality: 'defensive', defensiveLine: 'deep' }
    }
    recordChange(mp, sideKey, clock, 'ai', before, side.tactics)
  }

  // Recompute strengths and modifiers (the pitch may have changed)
  let { lamH, lamA } = recomputeRates(mp, home, away)
  // A shout costs both ways and only for the segment it was made for
  if (shout && second) {
    const r = applyShout(mp, second.side, shout, lamH, lamA)
    lamH = r.lamH
    lamA = r.lamA
  }

  if (to === 90) {
    // Legs go after the 70th minute: the men who started lose up to a tenth of their effective
    // rating by stamina, and the side whose legs go hands the last twenty minutes to the other.
    // Applied once, here; a change in play after 70 reuses the stored fade (lateFadeAt70) and
    // never cuts the legs twice.
    const fadeH = applyLateFade(mp.hLive, home.getPlayer)
    const fadeA = applyLateFade(mp.aLive, away.getPlayer)
    lamH *= (1 - fadeH) * (1 + fadeA)
    lamA *= (1 - fadeA) * (1 + fadeH)
    if (mp.detail === 'full') {
      mp.home.lateFadeAt70 = fadeH
      mp.away.lateFadeAt70 = fadeA
    }
  }

  if (mp.detail === 'full') mp.segment = { from, to, eventStart: mp.events.length }
  playSegment(mp, rng, home, away, from, to, lamH, lamA)
  mp.clock = to
  mp.rngState = rng.getState()
}

/** Strengths, modifiers, marking and expected goals for the pitch as it stands. Draws nothing. */
function recomputeRates(mp: MatchInProgress, home: MatchTeamInput, away: MatchTeamInput): { lamH: number; lamA: number } {
  const hs = withOffset(computeTeamStrength(mp.home.tactics, mp.home.lineup, home.getPlayer, home.getState), mp.home.ratingOffset)
  const as = withOffset(computeTeamStrength(mp.away.tactics, mp.away.lineup, away.getPlayer, away.getState), mp.away.ratingOffset)
  mp.home.modifiers = tacticalModifiers(mp.home.tactics, hs.slots, mp.away.tactics, as.slots)
  mp.away.modifiers = tacticalModifiers(mp.away.tactics, as.slots, mp.home.tactics, hs.slots)
  applyMarking(mp.home, mp.aLive, mp.home.modifiers, away.getPlayer, false)
  applyMarking(mp.away, mp.hLive, mp.away.modifiers, home.getPlayer, false)
  return expectedGoals(mp, home, away, hs, as)
}

/** A shout's cost in legs for the shouting side and its multipliers on both sides' expected goals. */
function applyShout(mp: MatchInProgress, sideKey: 'home' | 'away', shout: (typeof SHOUTS)[Shout], lamH: number, lamA: number): { lamH: number; lamA: number } {
  const side = sideKey === 'home' ? mp.home : mp.away
  side.modifiers.fatigue += shout.fatigue
  if (sideKey === 'home') return { lamH: lamH * shout.ownAttack, lamA: lamA * shout.oppAttack }
  return { lamH: lamH * shout.oppAttack, lamA: lamA * shout.ownAttack }
}

/**
 * The late-match fade for one side: every starter still on the pitch has his
 * effective rating cut by `LATE_FADE × legs(stamina)` (nothing at stamina 75
 * and above, 5 per cent at 50, 10 at 25) and the side's fade is the mean cut
 * over the eleven on the pitch, substitutes and the goalkeeper counting as
 * fresh (a keeper's stamina in the data reads low by convention, about 36
 * against 67 for outfielders, because he does not run). Returns that mean,
 * 0 to 0.1, which moves the last segment's expected goals both ways.
 */
export function applyLateFade(live: LivePlayer[], get: MatchTeamInput['getPlayer']): number {
  const on = live.filter((p) => p.offAt >= 90 && !p.red)
  if (!on.length) return 0
  let total = 0
  for (const p of on) {
    if (p.onAt !== 0 || p.position === 'GK') continue
    const stamina = get(p.psId)?.attributes.stamina ?? 65
    const cut = LATE_FADE * legs(stamina)
    p.effective *= 1 - cut
    total += cut
  }
  return total / on.length
}

/** The side's fade without applying it, for a report or a test. */
export function lateFade(live: LivePlayer[], get: MatchTeamInput['getPlayer']): number {
  const on = live.filter((p) => p.offAt >= 90 && !p.red)
  if (!on.length) return 0
  return on.reduce((s, p) => s + (p.onAt === 0 && p.position !== 'GK' ? LATE_FADE * legs(get(p.psId)?.attributes.stamina ?? 65) : 0), 0) / on.length
}

/** Play whatever is left of the match (the human side's `second` applies at the stop it stands at) and write the report. */
export function finishMatch(mp: MatchInProgress, lookups: { home: TeamLookups; away: TeamLookups }, second?: SecondHalfOptions): FullMatchResult {
  if ((mp.clock ?? 45) < 70) {
    advanceMatch(mp, lookups, second, 70)
    // The changes were made at the break; the side plays the last twenty minutes as it stands
    second = second ? { side: second.side } : undefined
  }
  advanceMatch(mp, lookups, second, 90)
  const rng = Rng.fromState(mp.rngState)
  const home = inputFromSnapshot(mp.home, lookups.home)
  const away = inputFromSnapshot(mp.away, lookups.away)

  const final = score(mp.events)
  mp.events.push({ minute: Math.max(90, ...mp.events.map((e) => e.minute)), type: 'full_time', side: 'home', text: `Full time: ${home.shortName} ${final.home}-${final.away} ${away.shortName}.` })
  mp.events.sort((x, y) => x.minute - y.minute || order(x.type) - order(y.type))

  const homeShots = Math.max(final.home, rng.poisson(mp.lamH * 7.5))
  const awayShots = Math.max(final.away, rng.poisson(mp.lamA * 7.5))
  const homeSot = Math.max(final.home, Math.min(homeShots, rng.poisson(mp.lamH * 3.0)))
  const awaySot = Math.max(final.away, Math.min(awayShots, rng.poisson(mp.lamA * 3.0)))
  const possH = clamp(50 + (mp.home.strength.midfield - mp.away.strength.midfield) * 1.1 + (mp.home.tactics.passing === 'short' ? 4 : mp.home.tactics.passing === 'direct' ? -4 : 0) - (mp.away.tactics.passing === 'short' ? 4 : mp.away.tactics.passing === 'direct' ? -4 : 0) + (mp.neutral ? 0 : 2) + rng.gaussian(0, 3), 28, 72)

  const homeStats = playerStats(rng, mp.hLive, final.home, final.away, home.getPlayer)
  const awayStats = playerStats(rng, mp.aLive, final.away, final.home, away.getPlayer)
  const all = [...homeStats, ...awayStats]
  const motm = all.filter((s) => s.minutes >= 20).sort((x, y) => y.rating - x.rating)[0]

  const conditionLoss: Record<string, number> = {}
  const cost = (live: LivePlayer[], side: TeamSnapshot, get: MatchTeamInput['getPlayer']) => {
    for (const p of live) {
      const minutes = Math.max(0, p.offAt - p.onAt)
      if (minutes <= 0) continue
      const ps = get(p.psId)
      if (!ps) continue
      const base = 26 + side.modifiers.fatigue + (ps.age >= 33 ? 5 : ps.age >= 30 ? 2 : 0) + (100 - ps.attributes.physical) / 10 + (side.tactics.tempo === 'fast' ? 2 : 0)
      // Stamina decides how much of it he feels: ×1.0 at 50, ×0.8 at 90, ×1.1 at 30 (a keeper, whose
      // stamina is not a running number, keeps the neutral ×1.0)
      conditionLoss[p.psId] = Math.round((base * (p.position === 'GK' ? 1 : staminaCostFactor(ps.attributes.stamina)) * minutes) / 90)
    }
  }
  cost(mp.hLive, mp.home, home.getPlayer)
  cost(mp.aLive, mp.away, away.getPlayer)

  const report = (side: TeamSnapshot, live: LivePlayer[], subs: Substitution[], xg: number, poss: number, shots: number, sot: number): TeamReport => ({
    strength: side.strength,
    modifiers: side.modifiers,
    xg: round2(xg),
    possession: Math.round(poss),
    shots,
    shotsOnTarget: sot,
    substitutions: subs,
    finishedWith: live.filter((p) => p.offAt >= 90 && !p.red).length,
    teamTalkEffect: side.talkText,
    halfTimeEffect: side.halfTimeText,
    lateEffect: side.lateText,
    // Only a full-detail match carries the pitch views' data: a summary match (the other
    // fixtures of a week, a quick season, head-to-head) is stored in every fixture of the save
    ...(mp.detail === 'full'
      ? { appearances: live.map((p) => ({ psId: p.psId, slotId: p.slotId, position: p.position, onAt: p.onAt, offAt: p.offAt, red: p.red, injured: !!p.injury })), tactics: side.tactics }
      : {}),
  })

  mp.rngState = rng.getState()
  return {
    homeTeamId: mp.home.teamId,
    awayTeamId: mp.away.teamId,
    homeName: mp.home.teamName,
    awayName: mp.away.teamName,
    homeGoals: final.home,
    awayGoals: final.away,
    events: mp.events,
    homeStats,
    awayStats,
    xg: { home: round2(mp.lamH), away: round2(mp.lamA) },
    motmId: motm?.playerSeasonId,
    homeReport: report(mp.home, mp.hLive, mp.hSubs, mp.lamH, possH, homeShots, homeSot),
    awayReport: report(mp.away, mp.aLive, mp.aSubs, mp.lamA, 100 - possH, awayShots, awaySot),
    conditionLoss,
    importance: mp.importance,
    importanceLabel: mp.importanceLabel,
    halfTimeScore: mp.halfTimeScore,
    momentum: mp.momentum,
    ...(mp.timeline ? { timeline: compactTimeline(mp.timeline) } : {}),
    ...(mp.seedKey ? { seedKey: mp.seedKey } : {}),
    ...(mp.detail === 'full' && mp.neutral ? { neutral: true } : {}),
  }
}

/** Players currently on the pitch for a side (for the UI at a stop). */
export function onPitch(mp: MatchInProgress, side: 'home' | 'away'): LivePlayer[] {
  return (side === 'home' ? mp.hLive : mp.aLive).filter((p) => p.offAt >= 90 && !p.red)
}

// ---------------------------------------------------------------------------
// Changes with the ball in play
//
// The engine decides each canonical segment (1-45, 46-70, 71-90) ahead of the
// clock, exactly as `simulateMatch` does, so an untouched match never changes.
// A change at minute k cuts the segment in play: everything up to k stands as
// it was shown, everything after k in the segment is rolled back and replayed
// from k + 1 with the new instructions and players, from a stream forked off a
// copy of the match's own. The match's stream itself never moves, so the next
// segment and the report draw exactly what they would have.

const MANAGER_REASONS = new Set(['manager', '70th minute'])

function isManagerWindow(s: Substitution): boolean {
  return MANAGER_REASONS.has(s.reason) && s.minute !== 45
}

/** The manager's substitution windows used so far: minutes other than 45 at which he made at least one change. */
export function managerWindowsUsed(mp: MatchInProgress, side: 'home' | 'away'): number {
  const subs = side === 'home' ? mp.hSubs : mp.aSubs
  return new Set(subs.filter(isManagerWindow).map((s) => s.minute)).size
}

/** Substitutions a side has made (every kind), up to `minute` when given. */
export function subsMade(mp: MatchInProgress, side: 'home' | 'away', minute?: number): number {
  const subs = side === 'home' ? mp.hSubs : mp.aSubs
  return minute === undefined ? subs.length : subs.filter((s) => s.minute <= minute).length
}

/** The men on the pitch at minute k by the decided events: on by k, not yet off, not sent off. */
export function onPitchAtMinute(mp: MatchInProgress, side: 'home' | 'away', minute: number): LivePlayer[] {
  const m = Math.min(minute, 89)
  return (side === 'home' ? mp.hLive : mp.aLive).filter((p) => p.onAt <= m && m < p.offAt)
}

/** Bench men who have not appeared by minute k and are fit and unsuspended: who can still come on. */
export function benchAt(mp: MatchInProgress, side: 'home' | 'away', minute: number, getState: (id: string) => SquadPlayer | undefined): string[] {
  const live = side === 'home' ? mp.hLive : mp.aLive
  const snap = side === 'home' ? mp.home : mp.away
  return snap.bench.filter((id) => {
    if (live.some((p) => p.psId === id && p.onAt <= minute)) return false
    const st = getState(id)
    return !st?.injury && (st?.suspension ?? 0) <= 0
  })
}

/** The minute of the side's last change by the manager (a stop or in play), or -1. */
function lastManagerMinute(mp: MatchInProgress, side: 'home' | 'away'): number {
  let last = -1
  for (const e of mp.timeline ?? []) if (e.side === side && e.by === 'manager') last = Math.max(last, e.minute)
  for (const s of side === 'home' ? mp.hSubs : mp.aSubs) if (MANAGER_REASONS.has(s.reason) || s.reason === 'half-time') last = Math.max(last, s.minute)
  return last
}

/**
 * Whether a change at `minute` can be made with the ball in play. A summary
 * match and a save from before in-play changes cannot be cut (the change waits
 * for `nextStop`); stoppage time is too late; a minute outside the segment in
 * play (the stops themselves included) belongs to `advanceMatch`. With `side`,
 * a minute before that side's last change is in the past.
 */
export function canChangeInPlay(mp: MatchInProgress, minute: number, side?: 'home' | 'away'): InPlayCheck {
  const waitFor = (m: number): 45 | 70 | null => (m <= 45 ? 45 : m <= 70 ? 70 : null)
  if (mp.detail !== 'full') return { ok: false, refusal: 'summary-match', nextStop: waitFor(minute) }
  const seg = mp.segment
  if (!seg) return { ok: false, refusal: 'no-segment', nextStop: waitFor(minute) }
  if (minute >= 90) return { ok: false, refusal: 'too-late', nextStop: null }
  const lo = seg.from === 1 ? 0 : seg.from
  if (minute < lo || minute >= seg.to) return { ok: false, refusal: 'outside-segment', nextStop: waitFor(minute) }
  if (side && minute < lastManagerMinute(mp, side)) return { ok: false, refusal: 'in-the-past', nextStop: null }
  return { ok: true, nextStop: null }
}

/**
 * Roll the segment in play back to the end of minute k: every event after k is
 * removed and undone (goals, assists, saves, cards, injuries, substitutions),
 * except the half-time whistle and a substitution that replaces a man whose
 * injury is kept. A routine change removed goes back into the parked changes at
 * its minute. Afterwards the end-of-segment state is the state at k.
 */
export function rollBackSegment(mp: MatchInProgress, minute: number): void {
  const seg = mp.segment
  if (!seg) return
  const pending = (mp.pendingSubs ??= { home: [], away: [] })
  const injuredKept = new Set<string>()
  for (const e of mp.events.slice(seg.eventStart)) if (e.type === 'injury' && e.minute <= minute && e.playerId) injuredKept.add(`${e.side}:${e.playerId}`)
  for (let i = mp.events.length - 1; i >= seg.eventStart; i--) {
    const e = mp.events[i]
    if (e.minute <= minute || e.type === 'half_time') continue
    if (e.type === 'substitution' && e.playerId && injuredKept.has(`${e.side}:${e.playerId}`)) continue
    undoEvent(mp, e, pending)
    mp.events.splice(i, 1)
  }
  pending.home.sort((a, b) => a.minute - b.minute)
  pending.away.sort((a, b) => a.minute - b.minute)
}

function undoEvent(mp: MatchInProgress, e: MatchEvent, pending: { home: Substitution[]; away: Substitution[] }): void {
  const own = e.side === 'home' ? mp.hLive : mp.aLive
  const opp = e.side === 'home' ? mp.aLive : mp.hLive
  const find = (list: LivePlayer[], id: string | undefined) => (id ? list.find((p) => p.psId === id) : undefined)
  switch (e.type) {
    case 'goal': {
      const s = find(own, e.playerId)
      if (s) s.goals--
      const a = find(own, e.secondaryId)
      if (a) a.assists--
      break
    }
    case 'penalty': {
      const s = find(own, e.playerId)
      if (s) s.goals--
      break
    }
    case 'save': {
      const gk = find(opp, e.secondaryId)
      if (gk) gk.saves--
      break
    }
    case 'yellow': {
      const p = find(own, e.playerId)
      if (p) {
        p.yellow = false
        delete p.cardAt
      }
      break
    }
    case 'red': {
      const p = find(own, e.playerId)
      if (p) {
        p.red = false
        p.offAt = 90
      }
      break
    }
    case 'injury': {
      const p = find(own, e.playerId)
      if (p) {
        p.injury = null
        p.offAt = 90
      }
      break
    }
    case 'substitution': {
      const subs = e.side === 'home' ? mp.hSubs : mp.aSubs
      const idx = own.findIndex((p) => p.psId === e.secondaryId && p.onAt === e.minute)
      if (idx >= 0) own.splice(idx, 1)
      const off = find(own, e.playerId)
      if (off) off.offAt = 90
      const si = subs.findIndex((s) => s.minute === e.minute && s.off === e.playerId && s.on === e.secondaryId)
      if (si >= 0) {
        const [s] = subs.splice(si, 1)
        if (s.reason === 'tired' || s.reason === 'tactical') pending[e.side].push(s)
      }
      break
    }
    default:
      break
  }
}

/**
 * Make a change with the ball in play, at `change.minute` (it applies from the
 * next minute): instructions and set-piece takers, substitutions (a window
 * each minute, three windows and five changes in all) and, from the 70th
 * minute, a shout. A change that changes nothing is refused before the match is
 * touched, so an untouched match stays identical to `simulateMatch`.
 */
export function changeInPlay(mp: MatchInProgress, lookups: { home: TeamLookups; away: TeamLookups }, change: InPlayChange): InPlayOutcome {
  const k = change.minute
  const check = canChangeInPlay(mp, k, change.side)
  if (!check.ok) return { applied: false, refusal: check.refusal, made: [], refused: [] }
  const seg = mp.segment!
  // Work on a copy: a refused change leaves the match exactly as it was
  const work = JSON.parse(JSON.stringify(mp)) as MatchInProgress
  rollBackSegment(work, k)
  const sideKey = change.side
  const side = sideKey === 'home' ? work.home : work.away
  const live = sideKey === 'home' ? work.hLive : work.aLive
  const subs = sideKey === 'home' ? work.hSubs : work.aSubs
  const look = lookups[sideKey]

  const before = side.tactics
  const proposed: Tactics = change.tactics ? { ...before, ...pickInstructions(change.tactics), setPieces: change.tactics.setPieces } : before
  const instructionsChanged = Object.keys(instructionDiff(before, proposed)).length > 0
  const setPiecesChanged = !sameSetPieces(before.setPieces, proposed.setPieces)

  let shoutRefused: boolean | undefined
  let shout: Shout | undefined
  if (change.shout) {
    if (seg.from < 71) shoutRefused = true
    else if (change.shout !== side.shout) shout = change.shout
  }

  const made: Substitution[] = []
  const refused: InPlayOutcome['refused'] = []
  const windowAtK = subs.some((s) => s.minute === k && isManagerWindow(s))
  const windows = managerWindowsUsed(work, sideKey)
  for (const s of change.substitutions ?? []) {
    // A substitution needs the ball in play: before kick-off the manager picks the team instead
    if (k < 1) {
      refused.push({ ...s, why: 'before-kick-off' })
      continue
    }
    // On the pitch at k, and not a man who came on this very minute
    const off = live.find((p) => p.psId === s.off && p.offAt >= 90 && !p.red && p.onAt < k)
    if (!off) {
      refused.push({ ...s, why: 'not-on-pitch' })
      continue
    }
    const on = look.getPlayer(s.on)
    if (on && live.some((p) => p.psId === s.on)) {
      refused.push({ ...s, why: 'already-played' })
      continue
    }
    const st = look.getState(s.on)
    if (!on || st?.injury || (st?.suspension ?? 0) > 0) {
      refused.push({ ...s, why: 'unavailable' })
      continue
    }
    if (subs.length >= MAX_SUBS) {
      refused.push({ ...s, why: 'no-subs-left' })
      continue
    }
    if (!windowAtK && !made.length && windows >= MAX_WINDOWS) {
      refused.push({ ...s, why: 'no-window' })
      continue
    }
    const offName = look.getPlayer(off.psId)?.name
    off.offAt = k
    live.push({ psId: on.id, slotId: off.slotId, position: off.position, onAt: k, offAt: 90, yellow: false, red: false, injury: null, goals: 0, assists: 0, saves: 0, effective: on.overall * positionFactor(on, off.position), shares: { ...off.shares }, creativity: off.creativity })
    const sub: Substitution = { minute: k, off: off.psId, on: on.id, reason: 'manager' }
    subs.push(sub)
    made.push(sub)
    work.events.push({ minute: k, type: 'substitution', side: sideKey, playerId: off.psId, playerName: offName, secondaryId: on.id, secondaryName: on.name, text: `Change on ${k} minutes: ${on.name} replaces ${offName}.` })
  }

  if (!instructionsChanged && !setPiecesChanged && !shout && !made.length) return { applied: false, refusal: 'no-change', made: [], refused, shoutRefused }

  side.tactics = proposed
  const pending = (work.pendingSubs ??= { home: [], away: [] })
  // The manager has taken the changes into his own hands: the assistant's routine ones are off
  if (made.length) pending[sideKey] = []
  if (shout) {
    side.shout = shout
    side.lateText = SHOUTS[shout].text
  }
  const lineup: Lineup = {}
  for (const p of live) lineup[p.slotId] = p.psId
  side.lineup = lineup
  work.timeline ??= []
  recordChange(work, sideKey, k, 'manager', before, proposed, { shout, subs: made.length })

  // The rates for the rest of the segment, the shouts in force re-applied after 70
  const home = inputFromSnapshot(work.home, lookups.home)
  const away = inputFromSnapshot(work.away, lookups.away)
  let { lamH, lamA } = recomputeRates(work, home, away)
  if (seg.from > 70) {
    for (const s of ['home', 'away'] as const) {
      const sh = (s === 'home' ? work.home : work.away).shout
      if (!sh) continue
      const r = applyShout(work, s, SHOUTS[sh], lamH, lamA)
      lamH = r.lamH
      lamA = r.lamA
    }
    // The late fade was applied to the legs at 70 (the effective ratings carry it); only its
    // pull on the expected goals is re-applied here, from the value stored then
    const fadeH = work.home.lateFadeAt70 ?? lateFade(work.hLive, home.getPlayer)
    const fadeA = work.away.lateFadeAt70 ?? lateFade(work.aLive, away.getPlayer)
    lamH *= (1 - fadeH) * (1 + fadeA)
    lamA *= (1 - fadeA) * (1 + fadeH)
  }
  const momentumFrom = (binOf(k) + 1) * 5 + 1
  playSegment(work, Rng.fromState(work.rngState).fork(`cut-${k}`), home, away, k + 1, seg.to, lamH, lamA, { replay: true, momentumFrom })
  if (seg.to <= 45) {
    work.halfTimeScore = score(work.events)
    const ht = work.events.find((e) => e.type === 'half_time')
    if (ht) ht.text = halfTimeText(work.home.shortName, work.away.shortName, work.halfTimeScore)
  }
  Object.assign(mp, work)
  return { applied: true, made, refused, shoutRefused }
}

// ---------------------------------------------------------------------------
// Internals

function inputFromSnapshot(s: TeamSnapshot, l: TeamLookups): MatchTeamInput {
  return { teamId: s.teamId, teamName: s.teamName, shortName: s.shortName, tactics: s.tactics, lineup: s.lineup, bench: s.bench, getPlayer: l.getPlayer, getState: l.getState, teamTalk: s.teamTalk, ratingOffset: s.ratingOffset, captainId: s.captainId, talkSkill: s.talkSkill, markTarget: s.markTarget }
}

function expectedGoals(mp: MatchInProgress, home: MatchTeamInput, away: MatchTeamInput, hsOverride?: TeamStrength, asOverride?: TeamStrength): { lamH: number; lamA: number } {
  const hs = hsOverride ?? mp.home.strength
  const as = asOverride ?? mp.away.strength
  const hm = mp.home.modifiers
  const am = mp.away.modifiers
  // The top of the scale is stretched: the gap between a 90 and an 87 is far
  // bigger in football terms than between a 72 and a 69, and an all-time XI
  // should feel like one.
  const stretch = (x: number) => x + Math.max(0, x - 80) * 0.8
  const attackPower = (s: TeamStrength) => stretch(0.62 * s.attack + 0.38 * s.midfield)
  const defencePower = (s: TeamStrength) => stretch(0.55 * s.defence + 0.28 * s.goalkeeping + 0.17 * s.midfield)
  const homeAdv = mp.neutral ? 1 : 1.12
  const awayAdv = mp.neutral ? 1 : 0.9
  let lamH = BASE_XG * Math.exp(K * (attackPower(hs) - defencePower(as))) * hm.attack * am.defence * homeAdv * mp.home.variance
  let lamA = BASE_XG * Math.exp(K * (attackPower(as) - defencePower(hs))) * am.attack * hm.defence * awayAdv * mp.away.variance
  lamH *= mp.home.boost.attack * mp.away.boost.defence
  lamA *= mp.away.boost.attack * mp.home.boost.defence
  // Designated set-piece takers: a good corner or free-kick specialist on the pitch adds chances
  lamH *= 1 + setPieceBonus(mp.home, mp.hLive, home.getPlayer)
  lamA *= 1 + setPieceBonus(mp.away, mp.aLive, away.getPlayer)
  // Strength and jumping: towering targets score from the delivery, and the side that wins the
  // duels (attackers' power against the defenders' share of them) moves expected goals up to 4%
  lamH *= 1 + aerialBonus(mp.hLive, home.getPlayer)
  lamA *= 1 + aerialBonus(mp.aLive, away.getPlayer)
  lamH *= mismatchFactor(aerialOf(mp.hLive, home.getPlayer, 'attack'), aerialOf(mp.aLive, away.getPlayer, 'defence'))
  lamA *= mismatchFactor(aerialOf(mp.aLive, away.getPlayer, 'attack'), aerialOf(mp.hLive, home.getPlayer, 'defence'))
  // Man-marking the opponent's danger man takes the edge off their attack while he is on the pitch
  if (stillOn(mp.aLive, mp.home.markTarget)) lamA *= 0.93
  if (stillOn(mp.hLive, mp.away.markTarget)) lamH *= 0.93
  // A captain with a strong mentality lifts his side a touch and organises the defence
  const hLead = leadership(mp.home, mp.hLive, home.getPlayer)
  const aLead = leadership(mp.away, mp.aLive, away.getPlayer)
  lamH *= (1 + hLead * 0.06) * (1 - aLead * 0.04)
  lamA *= (1 + aLead * 0.06) * (1 - hLead * 0.04)
  if (mp.importance > 1) {
    const big = (live: LivePlayer[], get: MatchTeamInput['getPlayer']) => avg(live.map((p) => get(p.psId)?.traits.bigMatch ?? 0.5))
    lamH *= 1 + (big(mp.hLive, home.getPlayer) - 0.5) * 0.14 * (mp.importance - 1) * 2.5
    lamA *= 1 + (big(mp.aLive, away.getPlayer) - 0.5) * 0.14 * (mp.importance - 1) * 2.5
  }
  return { lamH: clamp(lamH, 0.12, 5.8), lamA: clamp(lamA, 0.12, 5.8) }
}

/**
 * Play one segment of the match (1-45, 46-70 or 71-90): discipline and
 * injuries first, then goals and chances. Each segment takes its share of the
 * match's expected goals by length, the second half weighted 1.06 to the first
 * half's 0.94 (0.47, 0.294 and 0.236 of the match). Routine substitutions are
 * drawn once at the restart; those due after the 70th minute wait in
 * `pendingSubs` so the pitch at the 70' stop is the one the manager sees.
 */
function playSegment(mp: MatchInProgress, rng: Rng, home: MatchTeamInput, away: MatchTeamInput, from: number, to: number, lamH: number, lamA: number, opts: { replay?: boolean; momentumFrom?: number } = {}): void {
  const derby = mp.importance >= 1.2
  const pending = mp.pendingSubs ?? { home: [], away: [] }
  disciplineAndInjuries(rng, mp.hLive, home, 'home', mp.events, mp.hSubs, mp.home.tactics, derby, from, to, pending.home)
  disciplineAndInjuries(rng, mp.aLive, away, 'away', mp.events, mp.aSubs, mp.away.tactics, derby, from, to, pending.away)
  const hShort = shortHandedFactor(mp.hLive, from, to)
  const aShort = shortHandedFactor(mp.aLive, from, to)
  // First halves are quieter; second halves open up.
  const share = ((to - from + 1) / 90) * (to <= 45 ? 0.94 : 1.06)
  const lh = clamp(lamH * share * hShort.ownAttack * aShort.oppAttackBoostFor, 0.02, 3.5)
  const la = clamp(lamA * share * aShort.ownAttack * hShort.oppAttackBoostFor, 0.02, 3.5)
  const hg = rng.poisson(lh)
  const ag = rng.poisson(la)
  if (opts.replay) {
    // A replay after a change: the routine changes already decided go ahead at their minutes
    applyPendingSubstitutions(mp.hLive, home, 'home', mp.events, mp.hSubs, pending.home, to)
    applyPendingSubstitutions(mp.aLive, away, 'away', mp.events, mp.aSubs, pending.away, to)
  } else if (from === 46) {
    routineSubstitutions(rng, mp.hLive, home, 'home', mp.events, mp.hSubs, mp.home.modifiers.fatigue, pending.home)
    routineSubstitutions(rng, mp.aLive, away, 'away', mp.events, mp.aSubs, mp.away.modifiers.fatigue, pending.away)
  } else if (from > 70) {
    applyPendingSubstitutions(mp.hLive, home, 'home', mp.events, mp.hSubs, pending.home)
    applyPendingSubstitutions(mp.aLive, away, 'away', mp.events, mp.aSubs, pending.away)
  }
  for (let i = 0; i < hg; i++) scoreGoal(rng, mp.hLive, mp.aLive, 'home', mp.events, home.getPlayer, away.getPlayer, from, to, mp.home.tactics.setPieces?.penalties)
  for (let i = 0; i < ag; i++) scoreGoal(rng, mp.aLive, mp.hLive, 'away', mp.events, away.getPlayer, home.getPlayer, from, to, mp.away.tactics.setPieces?.penalties)
  if (mp.detail === 'full') {
    addChances(rng, mp.hLive, mp.aLive, 'home', Math.max(0, rng.poisson(lh * 2.2)), mp.events, home.getPlayer, away.getPlayer, from, to)
    addChances(rng, mp.aLive, mp.hLive, 'away', Math.max(0, rng.poisson(la * 2.2)), mp.events, away.getPlayer, home.getPlayer, from, to)
  } else {
    // No chance log in summary mode, but keepers still make saves (three of every eight chances)
    tallySaves(rng, mp.aLive, Math.min(4, rng.poisson(lh * 2.2)), from, to)
    tallySaves(rng, mp.hLive, Math.min(4, rng.poisson(la * 2.2)), from, to)
  }
  // The pitch views' detail comes from a stream forked off a copy of the generator, once the
  // segment is decided: the match's own draws, and the week's after it, never move. Summary
  // matches skip it: nothing shows their pitch, and every one is kept in the save's fixtures.
  if (mp.detail !== 'full') return
  const detail = Rng.fromState(rng.getState()).fork(`detail-${from}`)
  placeEvents(detail, mp.events, from, to)
  // A replay keeps the bins already shown (up to the one holding the change) and redraws the rest
  const binsFrom = opts.momentumFrom ?? from
  if (binsFrom <= to) mp.momentum = momentumBins(detail, { lamH: lh, lamA: la, homeTactics: mp.home.tactics, awayTactics: mp.away.tactics, events: mp.events, from: binsFrom, to, previous: mp.momentum ?? [] })
}

function score(events: MatchEvent[]): { home: number; away: number } {
  let home = 0
  let away = 0
  for (const e of events) {
    if (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal') {
      if (e.side === 'home') home++
      else away++
    }
  }
  return { home, away }
}

function withOffset<T extends TeamStrength>(s: T, offset: number): T {
  if (!offset) return s
  return { ...s, goalkeeping: s.goalkeeping - offset, defence: s.defence - offset, midfield: s.midfield - offset, attack: s.attack - offset, overall: s.overall - offset }
}

function strip(s: TeamStrength & { slots?: unknown; chemistryBreakdown?: unknown }): TeamStrength {
  return { goalkeeping: s.goalkeeping, defence: s.defence, midfield: s.midfield, attack: s.attack, balance: s.balance, chemistry: s.chemistry, overall: s.overall }
}

function order(t: MatchEvent['type']): number {
  return t === 'kickoff' ? -1 : t === 'half_time' || t === 'full_time' ? 1 : 0
}

function buildLive(slots: SlotEvaluation[]): LivePlayer[] {
  return slots.map((s) => ({
    psId: s.player.id,
    slotId: s.slotId,
    position: s.position,
    onAt: 0,
    offAt: 90,
    yellow: false,
    red: false,
    injury: null,
    goals: 0,
    assists: 0,
    saves: 0,
    effective: s.effective,
    shares: { gk: s.role.contribution.gk ?? 0, defence: s.role.contribution.defence, midfield: s.role.contribution.midfield, attack: s.role.contribution.attack },
    creativity: s.role.effects?.creativity ?? 0,
  }))
}

/**
 * Man-marking: the target's attacking influence is cut (fewer goals, lower
 * rating) and the marking side gives up a little going forward. Noted in the
 * report so the manager can see it worked.
 */
function applyMarking(side: Pick<MatchTeamInput, 'markTarget'>, theirLive: LivePlayer[], ourMods: TacticalModifiers, getTheirs: MatchTeamInput['getPlayer'], kickOff = true): void {
  if (!side.markTarget) return
  const target = theirLive.find((p) => p.psId === side.markTarget && !p.red && p.offAt >= 90)
  if (!target) return
  if (kickOff) {
    target.marked = true
    target.effective -= 3
  }
  ourMods.attack *= 0.97
  ourMods.notes.push(`Man-marking ${getTheirs(target.psId)?.name ?? 'their danger man'}: his influence is reduced, ours slightly too`)
}

/** A good assistant makes a talk land harder, for better or worse. */
function scaleTalk(t: { factor: number; text: string }, skill = 1): { factor: number; text: string } {
  return { factor: 1 + (t.factor - 1) * skill, text: t.text }
}

function teamTalkEffect(rng: Rng, talk: TeamTalk, ours: number, theirs: number, live: LivePlayer[], get: MatchTeamInput['getPlayer']): { factor: number; text: string } {
  if (talk === 'none') return { factor: 1, text: '' }
  const favourites = ours - theirs
  const prof = avg(live.map((p) => get(p.psId)?.traits.professionalism ?? 0.5))
  const roll = rng.next()
  switch (talk) {
    case 'calm':
      return favourites < -3 || roll < 0.55 ? { factor: 1.02, text: 'A calm word settled the nerves.' } : { factor: 0.99, text: 'The calm approach left the side a little flat.' }
    case 'encourage':
      return roll < 0.6 ? { factor: 1.025, text: 'Encouragement lifted the dressing room.' } : { factor: 1, text: 'The encouragement washed over them.' }
    case 'demand':
      if (favourites > 4) return roll < 0.6 ? { factor: 1.03, text: 'Demanding more kept the favourites honest.' } : { factor: 0.985, text: 'The demands grated on an already confident group.' }
      return roll < 0.35 ? { factor: 1.02, text: 'The demands sharpened minds.' } : { factor: 0.975, text: 'Demanding a win from underdogs piled on pressure.' }
    case 'fire-up':
      if (prof > 0.6) return roll < 0.5 ? { factor: 1.035, text: 'The side came out flying.' } : { factor: 0.98, text: 'Over-excited: the side lost its shape early on.' }
      return roll < 0.6 ? { factor: 1.03, text: 'Fired up, and it showed.' } : { factor: 0.97, text: 'The hairdryer treatment backfired.' }
  }
  return { factor: 1, text: '' }
}

/** Half-time talk: the right tone for the scoreline helps, the wrong one hurts. */
function halfTimeTalk(rng: Rng, talk: TeamTalk, diff: number, live: LivePlayer[], get: MatchTeamInput['getPlayer']): { factor: number; text: string } {
  if (talk === 'none') return { factor: 1, text: '' }
  const prof = avg(live.map((p) => get(p.psId)?.traits.professionalism ?? 0.5))
  const roll = rng.next()
  if (diff < 0) {
    if (talk === 'fire-up') return roll < 0.6 ? { factor: 1.07, text: 'Half-time rocket: they came out swinging.' } : { factor: 0.98, text: 'The rocket rattled them further.' }
    if (talk === 'demand') return roll < 0.55 ? { factor: 1.05, text: 'Demanding a response got one.' } : { factor: 0.99, text: 'Heads dropped further under the demands.' }
    if (talk === 'encourage') return { factor: 1.03, text: 'Encouragement kept belief alive.' }
    return { factor: 1.0, text: 'Calm words while behind: measured, not inspiring.' }
  }
  if (diff > 0) {
    if (talk === 'calm') return { factor: 1.03, text: 'Calm heads: the lead was protected sensibly.' }
    if (talk === 'encourage') return { factor: 1.02, text: 'Encouragement kept standards up.' }
    if (talk === 'demand') return prof > 0.55 && roll < 0.6 ? { factor: 1.03, text: 'No complacency allowed.' } : { factor: 0.98, text: 'Demanding more while winning irritated the squad.' }
    return roll < 0.4 ? { factor: 1.02, text: 'Fired up to finish the job.' } : { factor: 0.96, text: 'Over-hyped while ahead: shape went missing.' }
  }
  if (talk === 'encourage') return { factor: 1.025, text: 'A positive word at 0-0 helped.' }
  if (talk === 'demand') return roll < 0.5 ? { factor: 1.035, text: 'Demands at the break sharpened the side.' } : { factor: 0.985, text: 'The demands bred anxiety.' }
  if (talk === 'fire-up') return roll < 0.5 ? { factor: 1.04, text: 'Fired up for the second half.' } : { factor: 0.975, text: 'Too fired up: discipline suffered.' }
  return { factor: 1.01, text: 'Calm and composed at the break.' }
}

function disciplineAndInjuries(rng: Rng, live: LivePlayer[], team: MatchTeamInput, side: 'home' | 'away', events: MatchEvent[], subs: Substitution[], tactics: Tactics, derby: boolean, from: number, to: number, pending: Substitution[]) {
  const pressF = tactics.pressing === 'high' ? 1.25 : tactics.pressing === 'low' ? 0.9 : 1
  const derbyF = derby ? 1.2 : 1
  // The segment's share of the match: cards and injuries are spread by minutes, so the
  // three segments add up to exactly what two halves did.
  const halfF = (to - from + 1) / 90
  for (const p of live) {
    if (p.position === 'GK' || p.red || p.offAt < 90) continue
    const ps = team.getPlayer(p.psId)
    if (!ps) continue
    // Aggression scales every card: ×0.7 for the meekest, ×1.3 for the most combative
    const aggF = aggressionCardFactor(ps.attributes.aggression)
    if (!p.yellow) {
      const pYellow = (0.07 + 0.09 * p.shares.defence + (ps.attributes.physical > 82 ? 0.02 : 0)) * pressF * derbyF * (1.15 - ps.traits.professionalism * 0.3) * halfF * aggF
      if (rng.chance(pYellow)) {
        const minute = rng.int(from, to)
        p.yellow = true
        p.cardAt = minute
        events.push({ minute, type: 'yellow', side, playerId: p.psId, playerName: ps.name, text: `${ps.name} is booked.` })
      }
    } else if (rng.chance(0.09 * halfF * aggF)) {
      const minute = rng.int(Math.max(from, p.cardAt ?? from), to)
      p.red = true
      p.offAt = minute
      events.push({ minute, type: 'red', side, playerId: p.psId, playerName: ps.name, text: `${ps.name} sees a second yellow and is sent off!` })
      continue
    }
    const pRed = (0.004 + 0.004 * p.shares.defence) * derbyF * halfF * aggF
    if (!p.red && rng.chance(pRed)) {
      const minute = rng.int(Math.max(from, p.cardAt ?? from), to)
      p.red = true
      p.offAt = minute
      events.push({ minute, type: 'red', side, playerId: p.psId, playerName: ps.name, text: `Straight red for ${ps.name}!` })
    }
  }
  // Injuries fall in 3..88. A canonical segment always has room; a replay after a change at 88 or 89
  // has none, and drawing a minute from an empty range would land one at or before the change
  const injuryFrom = Math.max(from, 3)
  const injuryTo = Math.min(to, 88)
  for (const p of [...live]) {
    if (p.red || p.offAt < 90 || p.injury || injuryFrom > injuryTo) continue
    const ps = team.getPlayer(p.psId)
    if (!ps) continue
    const st = team.getState(p.psId)
    const cond = st?.condition ?? 90
    const condF = cond < 55 ? 2 : cond < 70 ? 1.45 : cond < 80 ? 1.1 : 1
    // Tired legs on an outfielder with little stamina: up to 30 per cent more risk (never a keeper)
    const pInj = 0.021 * (0.5 + ps.traits.injuryProneness) * condF * (p.position === 'GK' ? 1 : fatigueInjuryFactor(ps.attributes.stamina, cond)) * halfF
    if (rng.chance(pInj)) {
      const minute = rng.int(injuryFrom, injuryTo)
      const injury = rollInjury(rng)
      p.injury = injury
      p.offAt = minute
      events.push({ minute, type: 'injury', side, playerId: p.psId, playerName: ps.name, text: `${ps.name} goes down injured: ${injury.description.toLowerCase()}.` })
      bringOn(live, team, p, minute, side, events, subs, 'injury', pending)
    }
  }
}

function shortHandedFactor(live: LivePlayer[], from: number, to: number): { ownAttack: number; oppAttackBoostFor: number } {
  // Minutes in this half with fewer than eleven on the pitch.
  let shortMinutes = 0
  for (const p of live) {
    const replaced = live.some((q) => q !== p && q.onAt === p.offAt && q.slotId === p.slotId)
    if (p.red || (p.injury && !replaced)) {
      const start = Math.max(from, p.offAt)
      if (start < to) shortMinutes += to - start
    }
  }
  const frac = Math.min(1, shortMinutes / (to - from + 1))
  return { ownAttack: 1 - 0.3 * frac, oppAttackBoostFor: 1 + 0.3 * frac }
}

function routineSubstitutions(rng: Rng, live: LivePlayer[], team: MatchTeamInput, side: 'home' | 'away', events: MatchEvent[], subs: Substitution[], fatigue: number, pending: Substitution[]) {
  const maxSubs = 5
  let made = subs.length + pending.length
  if (made >= maxSubs) return
  const candidates = live
    .filter((p) => p.offAt >= 90 && !p.red && p.position !== 'GK' && p.onAt === 0)
    .map((p) => {
      const ps = team.getPlayer(p.psId)
      // A man with little stamina reads as more tired than his condition says, so he is the one taken off
      return { p, tired: (team.getState(p.psId)?.condition ?? 90) - (fatigue > 4 ? 8 : 0) + ((ps?.age ?? 28) >= 33 ? -8 : 0) + ((ps?.attributes.stamina ?? 65) - 65) * 0.3 + rng.gaussian(0, 6) }
    })
    .sort((a, b) => a.tired - b.tired)
  let n = 0
  for (const c of candidates) {
    if (made >= maxSubs || n >= 3) break
    const wantsOff = c.tired < 72 || (n === 0 && rng.chance(0.75)) || (n === 1 && rng.chance(0.55)) || (n === 2 && rng.chance(0.3))
    if (!wantsOff) continue
    const minute = clamp(Math.round(rng.gaussian(68, 9)), 50, 88)
    const reason = c.tired < 60 ? 'tired' : 'tactical'
    if (minute > 70) {
      // Due after the 70th-minute stop: decided now, made when the last segment is played
      const on = replacementFor(live, team, c.p, pending)
      if (on) {
        pending.push({ minute, off: c.p.psId, on: on.id, reason })
        made++
        n++
      }
    } else if (bringOn(live, team, c.p, minute, side, events, subs, reason, pending)) {
      made++
      n++
    }
  }
}

/** Make the parked routine changes, skipping any the last twenty minutes have overtaken (a red, an injury, a used substitute). */
function applyPendingSubstitutions(live: LivePlayer[], team: MatchTeamInput, side: 'home' | 'away', events: MatchEvent[], subs: Substitution[], pending: Substitution[], dueBy?: number) {
  if (dueBy !== undefined) {
    // Only the changes due by the end of the replayed stretch; later ones stay parked
    const later = pending.filter((s) => s.minute > dueBy)
    const due = pending.filter((s) => s.minute <= dueBy)
    pending.length = 0
    applyPendingSubstitutions(live, team, side, events, subs, due)
    pending.push(...later)
    return
  }
  for (const s of pending) {
    if (subs.length >= 5) break
    const off = live.find((p) => p.psId === s.off)
    const on = team.getPlayer(s.on)
    if (!off || off.offAt < 90 || off.red || !on || live.some((p) => p.psId === s.on)) continue
    const minute = Math.min(90, Math.max(s.minute, off.cardAt ?? 0))
    off.offAt = minute
    live.push({ psId: on.id, slotId: off.slotId, position: off.position, onAt: minute, offAt: 90, yellow: false, red: false, injury: null, goals: 0, assists: 0, saves: 0, effective: on.overall * positionFactor(on, off.position), shares: { ...off.shares }, creativity: off.creativity })
    subs.push({ ...s, minute })
    const offName = team.getPlayer(off.psId)?.name ?? 'a team-mate'
    events.push({ minute, type: 'substitution', side, playerId: off.psId, playerName: offName, secondaryId: on.id, secondaryName: on.name, text: `${on.name} comes on for ${offName}.` })
  }
  pending.length = 0
}

/** The best fit on the bench for the man coming off: not on the pitch, not already promised to a parked change, fit and unsuspended. */
function replacementFor(live: LivePlayer[], team: MatchTeamInput, off: LivePlayer, reserved: Substitution[]): PlayerSeason | undefined {
  const used = new Set(live.map((p) => p.psId))
  for (const r of reserved) used.add(r.on)
  let best: PlayerSeason | undefined
  let bestScore = -1
  for (const id of team.bench) {
    if (used.has(id)) continue
    const ps = team.getPlayer(id)
    if (!ps) continue
    const st = team.getState(id)
    if (st?.injury || (st?.suspension ?? 0) > 0) continue
    const s = ps.overall * positionFactor(ps, off.position) * ((st?.condition ?? 90) / 100 + 0.5)
    if (s > bestScore) {
      bestScore = s
      best = ps
    }
  }
  return best
}

function bringOn(live: LivePlayer[], team: MatchTeamInput, off: LivePlayer, minute: number, side: 'home' | 'away', events: MatchEvent[], subs: Substitution[], reason: string, reserved: Substitution[]): boolean {
  if (subs.length + reserved.length >= 5) return false
  const best = replacementFor(live, team, off, reserved)
  if (!best) return false
  minute = Math.min(90, Math.max(minute, off.cardAt ?? 0))
  off.offAt = Math.min(off.offAt, minute)
  live.push({ psId: best.id, slotId: off.slotId, position: off.position, onAt: minute, offAt: 90, yellow: false, red: false, injury: null, goals: 0, assists: 0, saves: 0, effective: best.overall * positionFactor(best, off.position), shares: { ...off.shares }, creativity: off.creativity })
  subs.push({ minute, off: off.psId, on: best.id, reason })
  const offName = team.getPlayer(off.psId)?.name ?? 'a team-mate'
  events.push({ minute, type: 'substitution', side, playerId: off.psId, playerName: offName, secondaryId: best.id, secondaryName: best.name, text: reason === 'injury' ? `${best.name} replaces the injured ${offName}.` : `${best.name} comes on for ${offName}.` })
  return true
}

function stillOn(live: LivePlayer[], psId: string | undefined): LivePlayer | undefined {
  if (!psId) return undefined
  return live.find((p) => p.psId === psId && !p.red && p.offAt >= 90)
}

/** Extra expected goals from designated corner and free-kick takers who are on the pitch. */
export function setPieceBonus(side: TeamSnapshot, live: LivePlayer[], get: MatchTeamInput['getPlayer']): number {
  const sp = side.tactics.setPieces
  if (!sp) return 0
  let bonus = 0
  const corners = stillOn(live, sp.corners)
  if (corners) bonus += (((get(corners.psId)?.attributes.passing ?? 70) - 72) / 100) * 0.06
  const fks = stillOn(live, sp.freeKicks)
  if (fks) bonus += (((get(fks.psId)?.attributes.shooting ?? 70) - 72) / 100) * 0.05
  return clamp(bonus, -0.04, 0.07)
}

/**
 * Extra expected goals from the side's aerial targets: the mean strength-and-jumping of
 * its three most powerful outfielders on the pitch, against 72, at 0.04 per 100 points
 * (−0.02 to +0.03 in practice, clamped to −0.03..+0.04). Every side has one.
 */
export function aerialBonus(live: LivePlayer[], get: MatchTeamInput['getPlayer']): number {
  const powers = live
    .filter((p) => p.offAt >= 90 && !p.red && p.position !== 'GK')
    .map((p) => {
      const ps = get(p.psId)
      return ps ? aerial(ps.attributes) : 65
    })
    .sort((a, b) => b - a)
    .slice(0, 3)
  if (!powers.length) return 0
  const top = powers.reduce((a, b) => a + b, 0) / powers.length
  return clamp(((top - 72) / 100) * 0.04, -0.03, 0.04)
}

/** The side's aerial power in attack or in defence: strength and jumping weighted by each man's share of that unit (plus 0.3 so everyone counts). */
export function aerialOf(live: LivePlayer[], get: MatchTeamInput['getPlayer'], unit: 'attack' | 'defence'): number {
  let sum = 0
  let weight = 0
  for (const p of live) {
    if (p.offAt < 90 || p.red || p.position === 'GK') continue
    const ps = get(p.psId)
    if (!ps) continue
    const w = 0.3 + p.shares[unit]
    sum += w * aerial(ps.attributes)
    weight += w
  }
  return weight > 0 ? sum / weight : 70
}

/** -0.25..0.25: how much the captain on the pitch lifts (or fails to lift) the side. */
export function leadership(side: TeamSnapshot, live: LivePlayer[], get: MatchTeamInput['getPlayer']): number {
  const cap = stillOn(live, side.captainId)
  if (!cap) return 0
  const p = get(cap.psId)
  if (!p) return 0
  return clamp(((p.attributes.mentality - 75) / 100) * (0.6 + p.traits.professionalism * 0.8), -0.25, 0.25)
}

function activeAt(live: LivePlayer[], minute: number): LivePlayer[] {
  // offAt holds the dismissal minute for a red card, so he counts for anything before it
  return live.filter((p) => p.onAt <= minute && p.offAt > minute && !(p.red && minute >= Math.min(p.offAt, 89)))
}

function goalMinute(rng: Rng, from: number, to: number): number {
  // A fifth of the last segment's goals come in stoppage time: the same share of all
  // goals (about 4.7 per cent) as 9 per cent of a whole second half's were.
  if (to >= 90 && rng.next() < 0.2) return rng.int(91, 94)
  const span = to - from
  const m = from + Math.floor(Math.pow(rng.next(), 0.85) * (span + 1))
  return clamp(m, from, to)
}

function scoreGoal(rng: Rng, att: LivePlayer[], def: LivePlayer[], side: 'home' | 'away', events: MatchEvent[], getAtt: MatchTeamInput['getPlayer'], getDef: MatchTeamInput['getPlayer'], from: number, to: number, penaltyTaker?: string) {
  const minute = goalMinute(rng, from, to)
  const onPitch = activeAt(att, Math.min(minute, 89))
  if (!onPitch.length) return
  if (rng.chance(0.025)) {
    const defenders = activeAt(def, Math.min(minute, 89)).filter((p) => p.position !== 'GK')
    if (defenders.length) {
      const og = rng.pickWeighted(defenders, (p) => p.shares.defence + 0.1)
      const name = getDef(og.psId)?.name ?? 'A defender'
      events.push({ minute, type: 'own_goal', side, playerId: og.psId, playerName: name, text: `Own goal! ${name} turns it into his own net.` })
      return
    }
  }
  if (rng.chance(0.09)) {
    const designated = penaltyTaker ? onPitch.find((p) => p.psId === penaltyTaker && p.position !== 'GK') : undefined
    const taker = designated ? { p: designated, ps: getAtt(designated.psId) } : [...onPitch].filter((p) => p.position !== 'GK').map((p) => ({ p, ps: getAtt(p.psId) })).filter((x) => x.ps).sort((a, b) => b.ps!.attributes.shooting + b.ps!.attributes.mentality - (a.ps!.attributes.shooting + a.ps!.attributes.mentality))[0]
    if (taker && taker.ps) {
      taker.p.goals++
      events.push({ minute, type: 'penalty', side, playerId: taker.p.psId, playerName: taker.ps.name, text: `${taker.ps.name} scores from the penalty spot.` })
      return
    }
  }
  const scorer = rng.pickWeighted(onPitch, (p) => {
    if (p.position === 'GK') return 0.001
    const ps = getAtt(p.psId)
    return (p.shares.attack * (p.marked ? 0.6 : 1) * 1.6 + 0.08) * Math.pow((ps?.attributes.shooting ?? 50) / 100, 2.2)
  })
  scorer.goals++
  let assister: LivePlayer | undefined
  if (rng.chance(0.78)) {
    const others = onPitch.filter((p) => p !== scorer)
    if (others.length) {
      assister = rng.pickWeighted(others, (p) => {
        const ps = getAtt(p.psId)
        return (p.shares.midfield * (p.marked ? 0.85 : 1) * 0.6 + p.shares.attack * (p.marked ? 0.6 : 1) * 0.7 + 0.05) * Math.pow((ps?.attributes.passing ?? 50) / 100, 2) * (1 + p.creativity / 4) * (p.position === 'GK' ? 0.05 : 1)
      })
      assister.assists++
    }
  }
  const sName = getAtt(scorer.psId)?.name ?? 'The striker'
  const aName = assister ? getAtt(assister.psId)?.name : undefined
  const flavour = rng.pick(GOAL_TEXTS)
  const text = aName ? `GOAL! ${sName} ${flavour}, assisted by ${aName}.` : `GOAL! ${sName} ${flavour}.`
  events.push({ minute, type: 'goal', side, playerId: scorer.psId, playerName: sName, secondaryId: assister?.psId, secondaryName: aName, text })
}

const GOAL_TEXTS = [
  'finishes low into the corner',
  'thumps it into the roof of the net',
  'slots it past the keeper',
  'heads it home from a corner',
  'curls one in from the edge of the box',
  'taps in from close range',
  'rounds the keeper and finishes',
  'drills it through a crowd of bodies',
  'volleys in spectacularly',
  'finishes a flowing team move',
  'pounces on a loose ball',
  'chips the keeper with real class',
]

/** The near-miss lines of a full-detail match, `{p}` the shooter and `{gk}` the keeper (the quick-season highlights reuse them). */
export const CHANCE_TEXTS = [
  '{p} is denied by a brilliant save from {gk}!',
  '{p} drags a shot wide with the goal gaping.',
  '{p} hits the post!',
  '{gk} gets down well to keep out {p}.',
  '{p} heads over from six yards.',
  '{p} fires straight at {gk}.',
  'Big chance for {p}, blocked on the line!',
  '{p} rattles the crossbar.',
]

function addChances(rng: Rng, att: LivePlayer[], def: LivePlayer[], side: 'home' | 'away', n: number, events: MatchEvent[], getAtt: MatchTeamInput['getPlayer'], getDef: MatchTeamInput['getPlayer'], from: number, to: number) {
  for (let i = 0; i < Math.min(n, 4); i++) {
    const minute = rng.int(from, to)
    const onPitch = activeAt(att, Math.min(minute, 89)).filter((p) => p.position !== 'GK')
    if (!onPitch.length) continue
    const p = rng.pickWeighted(onPitch, (q) => q.shares.attack * (q.marked ? 0.6 : 1) + 0.1)
    const gk = activeAt(def, Math.min(minute, 89)).find((q) => q.position === 'GK')
    const pName = getAtt(p.psId)?.name ?? 'A forward'
    const gkName = gk ? getDef(gk.psId)?.name ?? 'the keeper' : 'the keeper'
    const text = rng.pick(CHANCE_TEXTS).replace('{p}', pName).replace('{gk}', gkName)
    const type = text.includes('save') || text.includes('keep out') || text.includes('straight at') ? 'save' : 'chance'
    if (gk && type === 'save') gk.saves++
    events.push({ minute, type, side, playerId: p.psId, playerName: pName, secondaryId: gk?.psId, secondaryName: gkName, text })
  }
}

function tallySaves(rng: Rng, def: LivePlayer[], chances: number, from: number, to: number): void {
  for (let i = 0; i < chances; i++) {
    if (!rng.chance(3 / 8)) continue
    const gk = activeAt(def, Math.min(rng.int(from, to), 89)).find((q) => q.position === 'GK')
    if (gk) gk.saves++
  }
}

function rollInjury(rng: Rng): Injury {
  const r = rng.next()
  if (r < 0.55) return { description: rng.pick(['Knock', 'Dead leg', 'Tight hamstring', 'Bruised ribs', 'Twisted ankle']), weeksOut: rng.int(1, 2) }
  if (r < 0.85) return { description: rng.pick(['Hamstring strain', 'Calf strain', 'Groin strain', 'Sprained ankle', 'Hip problem']), weeksOut: rng.int(3, 5) }
  if (r < 0.97) return { description: rng.pick(['Torn hamstring', 'Knee ligament damage', 'Broken foot', 'Shoulder dislocation']), weeksOut: rng.int(6, 10) }
  return { description: rng.pick(['Ruptured ACL', 'Broken leg', 'Achilles rupture']), weeksOut: rng.int(12, 24) }
}

function playerStats(rng: Rng, live: LivePlayer[], goalsFor: number, goalsAgainst: number, get: MatchTeamInput['getPlayer']): PlayerMatchStats[] {
  const diff = goalsFor - goalsAgainst
  const out: PlayerMatchStats[] = []
  for (const p of live) {
    const minutes = Math.max(0, Math.min(90, p.offAt) - p.onAt)
    if (minutes <= 0 && !p.red) continue
    const ps = get(p.psId)
    const defensive = p.position === 'GK' || p.position === 'CB' || p.position === 'LB' || p.position === 'RB' || p.position === 'DM'
    let rating = 6.6 + clamp(diff * 0.22, -0.8, 0.8)
    rating += p.goals * 0.9 + p.assists * 0.5
    if (defensive) rating += goalsAgainst === 0 ? 0.5 : -Math.min(0.6, goalsAgainst * 0.14)
    if (p.position === 'GK') rating += Math.min(0.9, p.saves * 0.12) + (goalsAgainst >= 3 ? -0.3 : 0)
    const quality = (p.effective - 75) / 100
    rating += quality * 1.2
    rating += rng.gaussian(0, 0.45 * (1.1 - (ps?.traits.consistency ?? 0.5) * 0.7))
    if (p.red) rating -= 1.2
    else if (p.yellow) rating -= 0.15
    if (minutes < 30 && !p.red) rating = 6.4 + (rating - 6.6) * 0.5
    rating = clamp(rating, 4.5, 10)
    out.push({ playerSeasonId: p.psId, minutes: p.red ? Math.max(1, p.offAt - p.onAt) : minutes, goals: p.goals, assists: p.assists, rating: Math.round(rating * 10) / 10, yellow: p.yellow, red: p.red, injured: p.injury })
  }
  return out
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0.5
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Convenience for AI clubs: build an input from a pool of players and a style. */
export function teamInputFromPool(teamId: string, teamName: string, shortName: string, tactics: Tactics, pool: PlayerSeason[], getState: (id: string) => SquadPlayer | undefined = () => undefined): MatchTeamInput {
  const byId = new Map(pool.map((p) => [p.id, p]))
  const formation = getFormation(tactics.formationId)
  const { lineup, bench } = autoPickLineup(formation, pool, tactics, (p) => {
    const s = getState(p.id)
    return !s || (!s.injury && s.suspension <= 0)
  }, getState)
  return { teamId, teamName, shortName, tactics, lineup, bench, getPlayer: (id) => byId.get(id), getState }
}
