/**
 * The match engine.
 *
 * Expected goals for each side come from attack-vs-defence unit ratings,
 * shaped by tactics, home advantage, morale, fatigue and a dose of "any given
 * Saturday" variance. Goals are then drawn from a Poisson distribution and
 * dressed with scorers, assists, cards, injuries, substitutions and chances to
 * produce a readable minute-by-minute report in the Football Manager tradition.
 */
import type { Injury, Lineup, MatchEvent, MatchResult, PlayerMatchStats, PlayerSeason, Position, SquadPlayer, Tactics, TeamStrength } from './types'
import type { Rng } from './rng'
import { computeTeamStrength, type SlotEvaluation } from './ratings'
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

export interface TeamReport {
  strength: TeamStrength
  modifiers: TacticalModifiers
  xg: number
  possession: number
  shots: number
  shotsOnTarget: number
  substitutions: Array<{ minute: number; off: string; on: string; reason: string }>
  /** Final set of player-season ids who were on the pitch at full time. */
  finishedWith: number
  teamTalkEffect: string
}

export interface FullMatchResult extends MatchResult {
  homeReport: TeamReport
  awayReport: TeamReport
  /** Condition lost per player-season id. */
  conditionLoss: Record<string, number>
  importance: number
  importanceLabel?: string
}

const BASE_XG = 1.32
const K = 0.055

interface LivePlayer {
  ps: PlayerSeason
  slotId: string
  position: Position
  onAt: number
  offAt: number
  eval?: SlotEvaluation
  yellow: boolean
  red: boolean
  injury: Injury | null
  goals: number
  assists: number
  saves: number
}

export function simulateMatch(opts: MatchOptions): FullMatchResult {
  const { rng, home, away } = opts
  const detail = opts.detail ?? 'full'
  const importance = opts.importance ?? 1

  const hs = withOffset(computeTeamStrength(home.tactics, home.lineup, home.getPlayer, home.getState), home.ratingOffset ?? 0)
  const as = withOffset(computeTeamStrength(away.tactics, away.lineup, away.getPlayer, away.getState), away.ratingOffset ?? 0)
  const hm = tacticalModifiers(home.tactics, hs.slots, away.tactics, as.slots)
  const am = tacticalModifiers(away.tactics, as.slots, home.tactics, hs.slots)

  const hLive = buildLive(home, hs.slots)
  const aLive = buildLive(away, as.slots)

  const hTalk = teamTalkEffect(rng, home.teamTalk ?? 'none', hs.overall, as.overall, hLive)
  const aTalk = teamTalkEffect(rng, away.teamTalk ?? 'none', as.overall, hs.overall, aLive)

  // The top of the scale is stretched: the gap between a 90 and an 87 is far
  // bigger in football terms than between a 72 and a 69, and an all-time XI
  // should feel like one.
  const stretch = (x: number) => x + Math.max(0, x - 80) * 0.8
  const attackPower = (s: TeamStrength) => stretch(0.62 * s.attack + 0.38 * s.midfield)
  const defencePower = (s: TeamStrength) => stretch(0.55 * s.defence + 0.28 * s.goalkeeping + 0.17 * s.midfield)

  const homeAdv = opts.neutral ? 1 : 1.12
  const awayAdv = opts.neutral ? 1 : 0.9

  let lamH = BASE_XG * Math.exp(K * (attackPower(hs) - defencePower(as))) * hm.attack * am.defence * homeAdv * hTalk.factor
  let lamA = BASE_XG * Math.exp(K * (attackPower(as) - defencePower(hs))) * am.attack * hm.defence * awayAdv * aTalk.factor
  if (opts.boosts?.home) {
    lamH *= opts.boosts.home.attack
    lamA *= opts.boosts.home.defence
  }
  if (opts.boosts?.away) {
    lamA *= opts.boosts.away.attack
    lamH *= opts.boosts.away.defence
  }

  // Big-match temperament and consistency drive the variance of the day.
  const hCons = avg(hLive.map((p) => p.ps.traits.consistency))
  const aCons = avg(aLive.map((p) => p.ps.traits.consistency))
  const hBig = avg(hLive.map((p) => p.ps.traits.bigMatch))
  const aBig = avg(aLive.map((p) => p.ps.traits.bigMatch))
  if (importance > 1) {
    lamH *= 1 + (hBig - 0.5) * 0.14 * (importance - 1) * 2.5
    lamA *= 1 + (aBig - 0.5) * 0.14 * (importance - 1) * 2.5
  }
  const sigma = (c: number) => 0.06 + 0.12 * (1 - c)
  lamH *= Math.exp(rng.gaussian(0, sigma(hCons)))
  lamA *= Math.exp(rng.gaussian(0, sigma(aCons)))

  // Discipline and injuries happen first so they can shape the rest of the game.
  const events: MatchEvent[] = []
  const hSubs: TeamReport['substitutions'] = []
  const aSubs: TeamReport['substitutions'] = []
  const derby = importance >= 1.2
  disciplineAndInjuries(rng, hLive, home, 'home', events, hSubs, home.tactics, derby)
  disciplineAndInjuries(rng, aLive, away, 'away', events, aSubs, away.tactics, derby)

  // Red cards and unreplaced injuries shrink the team for the rest of the match.
  const hShort = shortHandedFactor(hLive)
  const aShort = shortHandedFactor(aLive)
  lamH *= hShort.ownAttack * aShort.oppAttackBoostFor
  lamA *= aShort.ownAttack * hShort.oppAttackBoostFor

  lamH = clamp(lamH, 0.12, 5.8)
  lamA = clamp(lamA, 0.12, 5.8)

  const homeGoals = rng.poisson(lamH)
  const awayGoals = rng.poisson(lamA)

  // Routine substitutions (tired legs) around the hour mark.
  routineSubstitutions(rng, hLive, home, 'home', events, hSubs, hm.fatigue)
  routineSubstitutions(rng, aLive, away, 'away', events, aSubs, am.fatigue)

  for (let i = 0; i < homeGoals; i++) scoreGoal(rng, hLive, aLive, 'home', events)
  for (let i = 0; i < awayGoals; i++) scoreGoal(rng, aLive, hLive, 'away', events)

  // Shots and chances for the report
  const hShots = Math.max(homeGoals, rng.poisson(lamH * 7.5))
  const aShots = Math.max(awayGoals, rng.poisson(lamA * 7.5))
  const hSot = Math.max(homeGoals, Math.min(hShots, rng.poisson(lamH * 3.0)))
  const aSot = Math.max(awayGoals, Math.min(aShots, rng.poisson(lamA * 3.0)))
  if (detail === 'full') {
    addChances(rng, hLive, aLive, 'home', hSot - homeGoals, events)
    addChances(rng, aLive, hLive, 'away', aSot - awayGoals, events)
  }
  const possH = clamp(50 + (hs.midfield - as.midfield) * 1.1 + (home.tactics.passing === 'short' ? 4 : home.tactics.passing === 'direct' ? -4 : 0) - (away.tactics.passing === 'short' ? 4 : away.tactics.passing === 'direct' ? -4 : 0) + (opts.neutral ? 0 : 2) + rng.gaussian(0, 3), 28, 72)

  events.push({ minute: 0, type: 'kickoff', side: 'home', text: 'Kick-off.' })
  events.push({ minute: 45, type: 'half_time', side: 'home', text: halfTimeText(events, home.shortName, away.shortName) })
  events.push({ minute: 90, type: 'full_time', side: 'home', text: `Full time: ${home.shortName} ${homeGoals}-${awayGoals} ${away.shortName}.` })
  events.sort((x, y) => x.minute - y.minute || order(x.type) - order(y.type))

  const homeStats = playerStats(rng, hLive, homeGoals, awayGoals, aSot)
  const awayStats = playerStats(rng, aLive, awayGoals, homeGoals, hSot)
  const all = [...homeStats, ...awayStats]
  const motm = all.filter((s) => s.minutes >= 20).sort((x, y) => y.rating - x.rating)[0]

  const conditionLoss: Record<string, number> = {}
  for (const p of [...hLive, ...aLive]) {
    const minutes = Math.max(0, p.offAt - p.onAt)
    if (minutes <= 0) continue
    const side = hLive.includes(p) ? home : away
    const fatigue = hLive.includes(p) ? hm.fatigue : am.fatigue
    const base = 26 + fatigue + (p.ps.age >= 33 ? 5 : p.ps.age >= 30 ? 2 : 0) + (100 - p.ps.attributes.physical) / 10 + (side.tactics.tempo === 'fast' ? 2 : 0)
    conditionLoss[p.ps.id] = Math.round((base * minutes) / 90)
  }

  return {
    homeTeamId: home.teamId,
    awayTeamId: away.teamId,
    homeGoals,
    awayGoals,
    events,
    homeStats,
    awayStats,
    xg: { home: round2(lamH), away: round2(lamA) },
    motmId: motm?.playerSeasonId,
    homeReport: { strength: strip(hs), modifiers: hm, xg: round2(lamH), possession: Math.round(possH), shots: hShots, shotsOnTarget: hSot, substitutions: hSubs, finishedWith: hLive.filter((p) => p.offAt >= 90 && !p.red).length, teamTalkEffect: hTalk.text },
    awayReport: { strength: strip(as), modifiers: am, xg: round2(lamA), possession: 100 - Math.round(possH), shots: aShots, shotsOnTarget: aSot, substitutions: aSubs, finishedWith: aLive.filter((p) => p.offAt >= 90 && !p.red).length, teamTalkEffect: aTalk.text },
    conditionLoss,
    importance,
    importanceLabel: opts.importanceLabel,
  }
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

function buildLive(_team: MatchTeamInput, slots: SlotEvaluation[]): LivePlayer[] {
  return slots.map((s) => ({ ps: s.player, slotId: s.slotId, position: s.position, onAt: 0, offAt: 90, eval: s, yellow: false, red: false, injury: null, goals: 0, assists: 0, saves: 0 }))
}

function teamTalkEffect(rng: Rng, talk: TeamTalk, ours: number, theirs: number, live: LivePlayer[]): { factor: number; text: string } {
  if (talk === 'none') return { factor: 1, text: '' }
  const favourites = ours - theirs
  const morale = avg(live.map((p) => p.ps.traits.professionalism))
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
      if (morale > 0.6) return roll < 0.5 ? { factor: 1.035, text: 'The side came out flying.' } : { factor: 0.98, text: 'Over-excited: the side lost its shape early on.' }
      return roll < 0.6 ? { factor: 1.03, text: 'Fired up, and it showed.' } : { factor: 0.97, text: 'The hairdryer treatment backfired.' }
  }
  return { factor: 1, text: '' }
}

function disciplineAndInjuries(
  rng: Rng,
  live: LivePlayer[],
  team: MatchTeamInput,
  side: 'home' | 'away',
  events: MatchEvent[],
  subs: TeamReport['substitutions'],
  tactics: Tactics,
  derby: boolean,
) {
  const pressF = tactics.pressing === 'high' ? 1.25 : tactics.pressing === 'low' ? 0.9 : 1
  const derbyF = derby ? 1.2 : 1
  for (const p of live) {
    if (p.position === 'GK') continue
    const defShare = p.eval?.role.contribution.defence ?? 0.3
    const pYellow = (0.07 + 0.09 * defShare + (p.ps.attributes.physical > 82 ? 0.02 : 0)) * pressF * derbyF * (1.15 - p.ps.traits.professionalism * 0.3)
    if (rng.chance(pYellow)) {
      const minute = rng.int(8, 90)
      p.yellow = true
      events.push({ minute, type: 'yellow', side, playerId: p.ps.id, playerName: p.ps.name, text: `${p.ps.name} is booked.` })
      // Second yellow
      if (rng.chance(0.07)) {
        const m2 = rng.int(Math.min(89, minute + 5), 92)
        p.red = true
        p.offAt = m2
        events.push({ minute: m2, type: 'red', side, playerId: p.ps.id, playerName: p.ps.name, text: `${p.ps.name} sees a second yellow and is sent off!` })
        continue
      }
    }
    const pRed = (0.004 + 0.004 * defShare) * derbyF
    if (!p.red && rng.chance(pRed)) {
      const minute = rng.int(5, 90)
      p.red = true
      p.offAt = minute
      events.push({ minute, type: 'red', side, playerId: p.ps.id, playerName: p.ps.name, text: `Straight red for ${p.ps.name}!` })
    }
  }
  // Injuries
  for (const p of live) {
    if (p.red) continue
    const st = team.getState(p.ps.id)
    const cond = st?.condition ?? 90
    const condF = cond < 55 ? 2 : cond < 70 ? 1.45 : cond < 80 ? 1.1 : 1
    const pInj = 0.021 * (0.5 + p.ps.traits.injuryProneness) * condF
    if (rng.chance(pInj)) {
      const minute = rng.int(3, 88)
      const injury = rollInjury(rng)
      p.injury = injury
      p.offAt = minute
      events.push({ minute, type: 'injury', side, playerId: p.ps.id, playerName: p.ps.name, text: `${p.ps.name} goes down injured: ${injury.description.toLowerCase()}.` })
      const sub = bringOn(rng, live, team, p, minute, side, events, subs, 'injury')
      if (!sub) {
        // No replacement: team finishes short-handed from this minute.
      }
    }
  }
}

function shortHandedFactor(live: LivePlayer[]): { ownAttack: number; oppAttackBoostFor: number } {
  // Minutes short-handed = minutes where fewer than 11 players on pitch.
  let shortMinutes = 0
  for (const p of live) {
    if (p.red) shortMinutes += 90 - p.offAt
    else if (p.injury && p.offAt < 90 && !live.some((q) => q.onAt === p.offAt && q !== p)) shortMinutes += 90 - p.offAt
  }
  const frac = Math.min(1, shortMinutes / 90)
  return { ownAttack: 1 - 0.3 * frac, oppAttackBoostFor: 1 + 0.3 * frac }
}

function routineSubstitutions(rng: Rng, live: LivePlayer[], team: MatchTeamInput, side: 'home' | 'away', events: MatchEvent[], subs: TeamReport['substitutions'], fatigue: number) {
  const maxSubs = 5
  let made = subs.length
  if (made >= maxSubs) return
  const candidates = live
    .filter((p) => p.offAt >= 90 && !p.red && p.position !== 'GK' && p.onAt === 0)
    .map((p) => ({ p, tired: (team.getState(p.ps.id)?.condition ?? 90) - (fatigue > 4 ? 8 : 0) + (p.ps.age >= 33 ? -8 : 0) + rng.gaussian(0, 6) }))
    .sort((a, b) => a.tired - b.tired)
  let n = 0
  for (const c of candidates) {
    if (made >= maxSubs || n >= 3) break
    const wantsOff = c.tired < 72 || (n === 0 && rng.chance(0.75)) || (n === 1 && rng.chance(0.55)) || (n === 2 && rng.chance(0.3))
    if (!wantsOff) continue
    const minute = clamp(Math.round(rng.gaussian(68, 9)), 46, 88)
    if (bringOn(rng, live, team, c.p, minute, side, events, subs, c.tired < 60 ? 'tired' : 'tactical')) {
      made++
      n++
    }
  }
}

function bringOn(_rng: Rng, live: LivePlayer[], team: MatchTeamInput, off: LivePlayer, minute: number, side: 'home' | 'away', events: MatchEvent[], subs: TeamReport['substitutions'], reason: string): boolean {
  if (subs.length >= 5) return false
  const used = new Set(live.map((p) => p.ps.id))
  let best: PlayerSeason | undefined
  let bestScore = -1
  for (const id of team.bench) {
    if (used.has(id)) continue
    const ps = team.getPlayer(id)
    if (!ps) continue
    const st = team.getState(id)
    if (st?.injury || (st?.suspension ?? 0) > 0) continue
    const score = ps.overall * positionFactor(ps, off.position) * ((st?.condition ?? 90) / 100 + 0.5)
    if (score > bestScore) {
      bestScore = score
      best = ps
    }
  }
  if (!best) return false
  off.offAt = Math.min(off.offAt, minute)
  live.push({ ps: best, slotId: off.slotId, position: off.position, onAt: minute, offAt: 90, eval: undefined, yellow: false, red: false, injury: null, goals: 0, assists: 0, saves: 0 })
  subs.push({ minute, off: off.ps.id, on: best.id, reason })
  events.push({ minute, type: 'substitution', side, playerId: off.ps.id, playerName: off.ps.name, secondaryId: best.id, secondaryName: best.name, text: reason === 'injury' ? `${best.name} replaces the injured ${off.ps.name}.` : `${best.name} comes on for ${off.ps.name}.` })
  return true
}

function activeAt(live: LivePlayer[], minute: number): LivePlayer[] {
  return live.filter((p) => p.onAt <= minute && p.offAt > minute && !p.red)
}

function goalMinute(rng: Rng): number {
  // Slight bias to later in each half; stoppage time 91-94 shown as 90+.
  const r = rng.next()
  if (r < 0.045) return rng.int(91, 94)
  if (r < 0.065) return rng.int(46, 47)
  const m = Math.floor(Math.pow(rng.next(), 0.85) * 90) + 1
  return clamp(m, 1, 90)
}

function scoreGoal(rng: Rng, att: LivePlayer[], def: LivePlayer[], side: 'home' | 'away', events: MatchEvent[]) {
  const minute = goalMinute(rng)
  const onPitch = activeAt(att, Math.min(minute, 89))
  if (!onPitch.length) return
  // Own goal
  if (rng.chance(0.025)) {
    const defenders = activeAt(def, Math.min(minute, 89)).filter((p) => p.position !== 'GK')
    if (defenders.length) {
      const og = rng.pickWeighted(defenders, (p) => (p.eval?.role.contribution.defence ?? 0.3) + 0.1)
      events.push({ minute, type: 'own_goal', side, playerId: og.ps.id, playerName: og.ps.name, text: `Own goal! ${og.ps.name} turns it into his own net.` })
      return
    }
  }
  // Penalty
  if (rng.chance(0.09)) {
    const taker = [...onPitch].filter((p) => p.position !== 'GK').sort((a, b) => b.ps.attributes.shooting + b.ps.attributes.mentality - (a.ps.attributes.shooting + a.ps.attributes.mentality))[0]
    if (taker) {
      taker.goals++
      events.push({ minute, type: 'penalty', side, playerId: taker.ps.id, playerName: taker.ps.name, text: `${taker.ps.name} scores from the penalty spot.` })
      return
    }
  }
  const scorer = rng.pickWeighted(onPitch, (p) => {
    if (p.position === 'GK') return 0.001
    const attackShare = p.eval?.role.contribution.attack ?? (p.position === 'ST' ? 1 : p.position === 'LW' || p.position === 'RW' ? 0.7 : p.position === 'AM' ? 0.6 : p.position === 'CM' ? 0.25 : 0.08)
    return (attackShare * 1.6 + 0.08) * Math.pow(p.ps.attributes.shooting / 100, 2.2)
  })
  scorer.goals++
  let assister: LivePlayer | undefined
  if (rng.chance(0.78)) {
    const others = onPitch.filter((p) => p !== scorer)
    if (others.length) {
      assister = rng.pickWeighted(others, (p) => {
        const mid = p.eval?.role.contribution.midfield ?? 0.3
        const atk = p.eval?.role.contribution.attack ?? 0.2
        const creativity = 1 + (p.eval?.role.effects?.creativity ?? 0) / 4
        return (mid * 0.6 + atk * 0.7 + 0.05) * Math.pow(p.ps.attributes.passing / 100, 2) * creativity * (p.position === 'GK' ? 0.05 : 1)
      })
      assister.assists++
    }
  }
  const flavour = rng.pick(GOAL_TEXTS)
  const text = assister ? `GOAL! ${scorer.ps.name} ${flavour}, assisted by ${assister.ps.name}.` : `GOAL! ${scorer.ps.name} ${flavour}.`
  events.push({ minute, type: 'goal', side, playerId: scorer.ps.id, playerName: scorer.ps.name, secondaryId: assister?.ps.id, secondaryName: assister?.ps.name, text })
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

function addChances(rng: Rng, att: LivePlayer[], def: LivePlayer[], side: 'home' | 'away', n: number, events: MatchEvent[]) {
  for (let i = 0; i < Math.min(n, 6); i++) {
    const minute = rng.int(2, 90)
    const onPitch = activeAt(att, Math.min(minute, 89)).filter((p) => p.position !== 'GK')
    if (!onPitch.length) continue
    const p = rng.pickWeighted(onPitch, (q) => (q.eval?.role.contribution.attack ?? 0.3) + 0.1)
    const gk = activeAt(def, Math.min(minute, 89)).find((q) => q.position === 'GK')
    if (gk) gk.saves++
    const text = rng.pick(CHANCE_TEXTS).replace('{p}', p.ps.name).replace('{gk}', gk?.ps.name ?? 'the keeper')
    events.push({ minute, type: text.includes('save') || text.includes('keep out') || text.includes('straight at') ? 'save' : 'chance', side, playerId: p.ps.id, playerName: p.ps.name, secondaryId: gk?.ps.id, secondaryName: gk?.ps.name, text })
  }
}

function halfTimeText(events: MatchEvent[], homeName: string, awayName: string): string {
  let h = 0
  let a = 0
  for (const e of events) {
    if (e.minute > 45) continue
    if (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal') {
      if (e.side === 'home') h++
      else a++
    }
  }
  return `Half time: ${homeName} ${h}-${a} ${awayName}.`
}

function rollInjury(rng: Rng): Injury {
  const r = rng.next()
  if (r < 0.55) return { description: rng.pick(['Knock', 'Dead leg', 'Tight hamstring', 'Bruised ribs', 'Twisted ankle']), weeksOut: rng.int(1, 2) }
  if (r < 0.85) return { description: rng.pick(['Hamstring strain', 'Calf strain', 'Groin strain', 'Sprained ankle', 'Hip problem']), weeksOut: rng.int(3, 5) }
  if (r < 0.97) return { description: rng.pick(['Torn hamstring', 'Knee ligament damage', 'Broken foot', 'Shoulder dislocation']), weeksOut: rng.int(6, 10) }
  return { description: rng.pick(['Ruptured ACL', 'Broken leg', 'Achilles rupture']), weeksOut: rng.int(12, 24) }
}

function playerStats(rng: Rng, live: LivePlayer[], goalsFor: number, goalsAgainst: number, oppShotsOnTarget: number): PlayerMatchStats[] {
  const diff = goalsFor - goalsAgainst
  const out: PlayerMatchStats[] = []
  for (const p of live) {
    const minutes = Math.max(0, Math.min(90, p.offAt) - p.onAt)
    if (minutes <= 0 && !p.red) continue
    const defensive = p.position === 'GK' || p.position === 'CB' || p.position === 'LB' || p.position === 'RB' || p.position === 'DM'
    let rating = 6.6 + clamp(diff * 0.22, -0.8, 0.8)
    rating += p.goals * 0.9 + p.assists * 0.5
    if (defensive) rating += goalsAgainst === 0 ? 0.5 : -Math.min(0.6, goalsAgainst * 0.14)
    if (p.position === 'GK') rating += Math.min(0.9, p.saves * 0.12) + (goalsAgainst >= 3 ? -0.3 : 0)
    const quality = ((p.eval?.effective ?? p.ps.overall) - 75) / 100
    rating += quality * 1.2
    rating += rng.gaussian(0, 0.45 * (1.1 - p.ps.traits.consistency * 0.7))
    if (p.red) rating -= 1.2
    else if (p.yellow) rating -= 0.15
    if (minutes < 30 && !p.red) rating = 6.4 + (rating - 6.6) * 0.5
    rating = clamp(rating, 4.5, 10)
    out.push({ playerSeasonId: p.ps.id, minutes: p.red ? Math.max(1, p.offAt - p.onAt) : minutes, goals: p.goals, assists: p.assists, rating: Math.round(rating * 10) / 10, yellow: p.yellow, red: p.red, injured: p.injury })
  }
  void oppShotsOnTarget
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
export function teamInputFromPool(
  teamId: string,
  teamName: string,
  shortName: string,
  tactics: Tactics,
  pool: PlayerSeason[],
  getState: (id: string) => SquadPlayer | undefined = () => undefined,
): MatchTeamInput {
  const byId = new Map(pool.map((p) => [p.id, p]))
  const formation = getFormation(tactics.formationId)
  const { lineup, bench } = autoPickFromPool(formation, pool, tactics, getState)
  return { teamId, teamName, shortName, tactics, lineup, bench, getPlayer: (id) => byId.get(id), getState }
}

import { autoPickLineup } from './ratings'
function autoPickFromPool(formation: ReturnType<typeof getFormation>, pool: PlayerSeason[], tactics: Tactics, getState: (id: string) => SquadPlayer | undefined) {
  return autoPickLineup(formation, pool, tactics, (p) => {
    const s = getState(p.id)
    return !s || (!s.injury && s.suspension <= 0)
  }, getState)
}
