/**
 * The match engine.
 *
 * Expected goals for each side come from attack-vs-defence unit ratings,
 * shaped by tactics, home advantage, morale, fatigue and a dose of "any given
 * Saturday" variance. Goals are then drawn from a Poisson distribution and
 * dressed with scorers, assists, cards, injuries, substitutions and chances to
 * produce a readable minute-by-minute report in the Football Manager tradition.
 *
 * A match is played in two halves. `beginMatch` plays the first half and
 * returns a serialisable `MatchInProgress`; `finishMatch` plays the second
 * half, optionally with new instructions, substitutions and a half-time talk.
 * `simulateMatch` does both in one go.
 */
import type { Injury, Lineup, MatchEvent, MatchResult, PlayerMatchStats, PlayerSeason, Position, SquadPlayer, Tactics, TeamStrength } from './types'
import { Rng, type RngState } from './rng'
import { autoPickLineup, computeTeamStrength, type SlotEvaluation } from './ratings'
import { tacticalModifiers, type TacticalModifiers } from './tactics'
import { getFormation } from './formations'
import { positionFactor } from './positions'

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
  strength: TeamStrength
  modifiers: TacticalModifiers
  talkText: string
  /** Team-level "day" variance factor, kept across both halves. */
  variance: number
  boost: { attack: number; defence: number }
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
}

export interface SecondHalfOptions {
  /** Which side the human manages, when they intervene at half time. */
  side: 'home' | 'away'
  talk?: TeamTalk
  tactics?: Tactics
  substitutions?: Array<{ off: string; on: string }>
}

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
  return finishMatch(mp, { home: opts.home, away: opts.away })
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
  }
  const { lamH, lamA } = expectedGoals(mp, home, away)
  mp.lamH = lamH
  mp.lamA = lamA

  playHalf(mp, rng, home, away, 1, lamH, lamA)
  mp.halfTimeScore = score(mp.events)
  mp.events.push({ minute: 45, type: 'half_time', side: 'home', text: `Half time: ${home.shortName} ${mp.halfTimeScore.home}-${mp.halfTimeScore.away} ${away.shortName}.` })
  mp.rngState = rng.getState()
  return mp
}

export function finishMatch(mp: MatchInProgress, lookups: { home: TeamLookups; away: TeamLookups }, second?: SecondHalfOptions): FullMatchResult {
  const rng = Rng.fromState(mp.rngState)
  const home = inputFromSnapshot(mp.home, lookups.home)
  const away = inputFromSnapshot(mp.away, lookups.away)

  // Half-time intervention by the human side
  let htText = ''
  if (second) {
    const side = second.side === 'home' ? mp.home : mp.away
    const live = second.side === 'home' ? mp.hLive : mp.aLive
    const subs = second.side === 'home' ? mp.hSubs : mp.aSubs
    const input = second.side === 'home' ? home : away
    if (second.tactics) side.tactics = second.tactics
    for (const s of second.substitutions ?? []) {
      if (subs.length >= 5) break
      const off = live.find((p) => p.psId === s.off && p.offAt >= 90 && !p.red)
      const on = input.getPlayer(s.on)
      if (!off || !on || live.some((p) => p.psId === s.on)) continue
      off.offAt = 45
      live.push({ psId: on.id, slotId: off.slotId, position: off.position, onAt: 45, offAt: 90, yellow: false, red: false, injury: null, goals: 0, assists: 0, saves: 0, effective: on.overall * positionFactor(on, off.position), shares: off.shares, creativity: off.creativity })
      subs.push({ minute: 45, off: off.psId, on: on.id, reason: 'half-time' })
      mp.events.push({ minute: 45, type: 'substitution', side: second.side, playerId: off.psId, playerName: input.getPlayer(off.psId)?.name, secondaryId: on.id, secondaryName: on.name, text: `Half-time change: ${on.name} replaces ${input.getPlayer(off.psId)?.name}.` })
    }
    // Rebuild the side's lineup from who is on the pitch for the second-half numbers
    const lineup: Lineup = {}
    for (const p of live) if (p.offAt >= 90 && !p.red) lineup[p.slotId] = p.psId
    side.lineup = lineup
    const us = second.side === 'home' ? mp.halfTimeScore.home : mp.halfTimeScore.away
    const them = second.side === 'home' ? mp.halfTimeScore.away : mp.halfTimeScore.home
    const talk = scaleTalk(halfTimeTalk(rng, second.talk ?? 'none', us - them, live, input.getPlayer), side.talkSkill)
    side.variance *= talk.factor
    htText = talk.text
    side.talkText = side.talkText ? `${side.talkText} ${talk.text}` : talk.text
  }

  // The AI side reacts to the scoreline at the break.
  for (const sideKey of ['home', 'away'] as const) {
    if (second?.side === sideKey) continue
    const side = sideKey === 'home' ? mp.home : mp.away
    const us = sideKey === 'home' ? mp.halfTimeScore.home : mp.halfTimeScore.away
    const them = sideKey === 'home' ? mp.halfTimeScore.away : mp.halfTimeScore.home
    if (us - them <= -2 && side.tactics.mentality !== 'attacking') side.tactics = { ...side.tactics, mentality: 'attacking', pressing: side.tactics.pressing === 'low' ? 'mid' : side.tactics.pressing }
    else if (us - them >= 2 && side.tactics.mentality === 'attacking') side.tactics = { ...side.tactics, mentality: 'balanced' }
  }

  // Recompute second-half strengths and modifiers (the pitch may have changed)
  const hs = withOffset(computeTeamStrength(mp.home.tactics, mp.home.lineup, home.getPlayer, home.getState), mp.home.ratingOffset)
  const as = withOffset(computeTeamStrength(mp.away.tactics, mp.away.lineup, away.getPlayer, away.getState), mp.away.ratingOffset)
  mp.home.modifiers = tacticalModifiers(mp.home.tactics, hs.slots, mp.away.tactics, as.slots)
  mp.away.modifiers = tacticalModifiers(mp.away.tactics, as.slots, mp.home.tactics, hs.slots)
  const { lamH, lamA } = expectedGoals(mp, home, away, hs, as)

  playHalf(mp, rng, home, away, 2, lamH, lamA)
  const final = score(mp.events)
  mp.events.push({ minute: 90, type: 'full_time', side: 'home', text: `Full time: ${home.shortName} ${final.home}-${final.away} ${away.shortName}.` })
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
      conditionLoss[p.psId] = Math.round((base * minutes) / 90)
    }
  }
  cost(mp.hLive, mp.home, home.getPlayer)
  cost(mp.aLive, mp.away, away.getPlayer)

  const report = (side: TeamSnapshot, live: LivePlayer[], subs: Substitution[], xg: number, poss: number, shots: number, sot: number, isHuman: boolean): TeamReport => ({
    strength: side.strength,
    modifiers: side.modifiers,
    xg: round2(xg),
    possession: Math.round(poss),
    shots,
    shotsOnTarget: sot,
    substitutions: subs,
    finishedWith: live.filter((p) => p.offAt >= 90 && !p.red).length,
    teamTalkEffect: side.talkText,
    halfTimeEffect: isHuman ? htText : undefined,
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
    homeReport: report(mp.home, mp.hLive, mp.hSubs, mp.lamH, possH, homeShots, homeSot, second?.side === 'home'),
    awayReport: report(mp.away, mp.aLive, mp.aSubs, mp.lamA, 100 - possH, awayShots, awaySot, second?.side === 'away'),
    conditionLoss,
    importance: mp.importance,
    importanceLabel: mp.importanceLabel,
    halfTimeScore: mp.halfTimeScore,
  }
}

/** Players currently on the pitch for a side (for the half-time UI). */
export function onPitch(mp: MatchInProgress, side: 'home' | 'away'): LivePlayer[] {
  return (side === 'home' ? mp.hLive : mp.aLive).filter((p) => p.offAt >= 90 && !p.red)
}

// ---------------------------------------------------------------------------
// Internals

function inputFromSnapshot(s: TeamSnapshot, l: TeamLookups): MatchTeamInput {
  return { teamId: s.teamId, teamName: s.teamName, shortName: s.shortName, tactics: s.tactics, lineup: s.lineup, bench: s.bench, getPlayer: l.getPlayer, getState: l.getState, teamTalk: s.teamTalk, ratingOffset: s.ratingOffset, captainId: s.captainId, talkSkill: s.talkSkill }
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

/** Play one half: discipline and injuries first, then goals and chances. */
function playHalf(mp: MatchInProgress, rng: Rng, home: MatchTeamInput, away: MatchTeamInput, half: 1 | 2, lamH: number, lamA: number): void {
  const from = half === 1 ? 1 : 46
  const to = half === 1 ? 45 : 90
  const derby = mp.importance >= 1.2
  disciplineAndInjuries(rng, mp.hLive, home, 'home', mp.events, mp.hSubs, mp.home.tactics, derby, from, to)
  disciplineAndInjuries(rng, mp.aLive, away, 'away', mp.events, mp.aSubs, mp.away.tactics, derby, from, to)
  const hShort = shortHandedFactor(mp.hLive, from, to)
  const aShort = shortHandedFactor(mp.aLive, from, to)
  // First halves are quieter; second halves open up.
  const halfF = half === 1 ? 0.47 : 0.53
  const lh = clamp(lamH * halfF * hShort.ownAttack * aShort.oppAttackBoostFor, 0.05, 3.5)
  const la = clamp(lamA * halfF * aShort.ownAttack * hShort.oppAttackBoostFor, 0.05, 3.5)
  const hg = rng.poisson(lh)
  const ag = rng.poisson(la)
  if (half === 2) {
    routineSubstitutions(rng, mp.hLive, home, 'home', mp.events, mp.hSubs, mp.home.modifiers.fatigue)
    routineSubstitutions(rng, mp.aLive, away, 'away', mp.events, mp.aSubs, mp.away.modifiers.fatigue)
  }
  for (let i = 0; i < hg; i++) scoreGoal(rng, mp.hLive, mp.aLive, 'home', mp.events, home.getPlayer, away.getPlayer, from, to, mp.home.tactics.setPieces?.penalties)
  for (let i = 0; i < ag; i++) scoreGoal(rng, mp.aLive, mp.hLive, 'away', mp.events, away.getPlayer, home.getPlayer, from, to, mp.away.tactics.setPieces?.penalties)
  if (mp.detail === 'full') {
    addChances(rng, mp.hLive, mp.aLive, 'home', Math.max(0, rng.poisson(lh * 2.2)), mp.events, home.getPlayer, away.getPlayer, from, to)
    addChances(rng, mp.aLive, mp.hLive, 'away', Math.max(0, rng.poisson(la * 2.2)), mp.events, away.getPlayer, home.getPlayer, from, to)
  }
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

function disciplineAndInjuries(rng: Rng, live: LivePlayer[], team: MatchTeamInput, side: 'home' | 'away', events: MatchEvent[], subs: Substitution[], tactics: Tactics, derby: boolean, from: number, to: number) {
  const pressF = tactics.pressing === 'high' ? 1.25 : tactics.pressing === 'low' ? 0.9 : 1
  const derbyF = derby ? 1.2 : 1
  const halfF = 0.5
  for (const p of live) {
    if (p.position === 'GK' || p.red || p.offAt < 90) continue
    const ps = team.getPlayer(p.psId)
    if (!ps) continue
    if (!p.yellow) {
      const pYellow = (0.07 + 0.09 * p.shares.defence + (ps.attributes.physical > 82 ? 0.02 : 0)) * pressF * derbyF * (1.15 - ps.traits.professionalism * 0.3) * halfF
      if (rng.chance(pYellow)) {
        const minute = rng.int(from, to)
        p.yellow = true
        events.push({ minute, type: 'yellow', side, playerId: p.psId, playerName: ps.name, text: `${ps.name} is booked.` })
      }
    } else if (rng.chance(0.045)) {
      const minute = rng.int(from, to)
      p.red = true
      p.offAt = minute
      events.push({ minute, type: 'red', side, playerId: p.psId, playerName: ps.name, text: `${ps.name} sees a second yellow and is sent off!` })
      continue
    }
    const pRed = (0.004 + 0.004 * p.shares.defence) * derbyF * halfF
    if (!p.red && rng.chance(pRed)) {
      const minute = rng.int(from, to)
      p.red = true
      p.offAt = minute
      events.push({ minute, type: 'red', side, playerId: p.psId, playerName: ps.name, text: `Straight red for ${ps.name}!` })
    }
  }
  for (const p of live) {
    if (p.red || p.offAt < 90 || p.injury) continue
    const ps = team.getPlayer(p.psId)
    if (!ps) continue
    const st = team.getState(p.psId)
    const cond = st?.condition ?? 90
    const condF = cond < 55 ? 2 : cond < 70 ? 1.45 : cond < 80 ? 1.1 : 1
    const pInj = 0.021 * (0.5 + ps.traits.injuryProneness) * condF * halfF
    if (rng.chance(pInj)) {
      const minute = rng.int(Math.max(from, 3), Math.min(to, 88))
      const injury = rollInjury(rng)
      p.injury = injury
      p.offAt = minute
      events.push({ minute, type: 'injury', side, playerId: p.psId, playerName: ps.name, text: `${ps.name} goes down injured: ${injury.description.toLowerCase()}.` })
      bringOn(live, team, p, minute, side, events, subs, 'injury')
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

function routineSubstitutions(rng: Rng, live: LivePlayer[], team: MatchTeamInput, side: 'home' | 'away', events: MatchEvent[], subs: Substitution[], fatigue: number) {
  const maxSubs = 5
  let made = subs.length
  if (made >= maxSubs) return
  const candidates = live
    .filter((p) => p.offAt >= 90 && !p.red && p.position !== 'GK' && p.onAt === 0)
    .map((p) => {
      const ps = team.getPlayer(p.psId)
      return { p, tired: (team.getState(p.psId)?.condition ?? 90) - (fatigue > 4 ? 8 : 0) + ((ps?.age ?? 28) >= 33 ? -8 : 0) + rng.gaussian(0, 6) }
    })
    .sort((a, b) => a.tired - b.tired)
  let n = 0
  for (const c of candidates) {
    if (made >= maxSubs || n >= 3) break
    const wantsOff = c.tired < 72 || (n === 0 && rng.chance(0.75)) || (n === 1 && rng.chance(0.55)) || (n === 2 && rng.chance(0.3))
    if (!wantsOff) continue
    const minute = clamp(Math.round(rng.gaussian(68, 9)), 50, 88)
    if (bringOn(live, team, c.p, minute, side, events, subs, c.tired < 60 ? 'tired' : 'tactical')) {
      made++
      n++
    }
  }
}

function bringOn(live: LivePlayer[], team: MatchTeamInput, off: LivePlayer, minute: number, side: 'home' | 'away', events: MatchEvent[], subs: Substitution[], reason: string): boolean {
  if (subs.length >= 5) return false
  const used = new Set(live.map((p) => p.psId))
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
  if (!best) return false
  off.offAt = Math.min(off.offAt, minute)
  live.push({ psId: best.id, slotId: off.slotId, position: off.position, onAt: minute, offAt: 90, yellow: false, red: false, injury: null, goals: 0, assists: 0, saves: 0, effective: best.overall * positionFactor(best, off.position), shares: off.shares, creativity: off.creativity })
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

/** -0.25..0.25: how much the captain on the pitch lifts (or fails to lift) the side. */
export function leadership(side: TeamSnapshot, live: LivePlayer[], get: MatchTeamInput['getPlayer']): number {
  const cap = stillOn(live, side.captainId)
  if (!cap) return 0
  const p = get(cap.psId)
  if (!p) return 0
  return clamp(((p.attributes.mentality - 75) / 100) * (0.6 + p.traits.professionalism * 0.8), -0.25, 0.25)
}

function activeAt(live: LivePlayer[], minute: number): LivePlayer[] {
  return live.filter((p) => p.onAt <= minute && p.offAt > minute && !p.red)
}

function goalMinute(rng: Rng, from: number, to: number): number {
  if (to >= 90 && rng.next() < 0.09) return rng.int(91, 94)
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
    return (p.shares.attack * 1.6 + 0.08) * Math.pow((ps?.attributes.shooting ?? 50) / 100, 2.2)
  })
  scorer.goals++
  let assister: LivePlayer | undefined
  if (rng.chance(0.78)) {
    const others = onPitch.filter((p) => p !== scorer)
    if (others.length) {
      assister = rng.pickWeighted(others, (p) => {
        const ps = getAtt(p.psId)
        return (p.shares.midfield * 0.6 + p.shares.attack * 0.7 + 0.05) * Math.pow((ps?.attributes.passing ?? 50) / 100, 2) * (1 + p.creativity / 4) * (p.position === 'GK' ? 0.05 : 1)
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

const CHANCE_TEXTS = [
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
    const p = rng.pickWeighted(onPitch, (q) => q.shares.attack + 0.1)
    const gk = activeAt(def, Math.min(minute, 89)).find((q) => q.position === 'GK')
    if (gk) gk.saves++
    const pName = getAtt(p.psId)?.name ?? 'A forward'
    const gkName = gk ? getDef(gk.psId)?.name ?? 'the keeper' : 'the keeper'
    const text = rng.pick(CHANCE_TEXTS).replace('{p}', pName).replace('{gk}', gkName)
    events.push({ minute, type: text.includes('save') || text.includes('keep out') || text.includes('straight at') ? 'save' : 'chance', side, playerId: p.psId, playerName: pName, secondaryId: gk?.psId, secondaryName: gkName, text })
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
