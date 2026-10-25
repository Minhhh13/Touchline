import type { Game, LiveMatch } from '../types'
import { isClassicSeason, poolClubSeasons, type LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { advanceMatch, beginMatch, changeInPlay, finishMatch, simulateMatch, type FullMatchResult, type InPlayChange, type InPlayOutcome, type LiveChanges, type MatchTeamInput, type SecondHalfOptions } from '@engine/match'
import { aiTeamInput, applyMatchToState, computeTable, describeImportance, drawNextRound, positionOf, recoverWeek, roundsFor, seasonTier, shootout, updateConfidence, USER_TEAM, userTeamInput, type AiClub, type Competition, type CupTie, type NewsItem, type SeasonState } from '@engine/season'
import { TRAINING } from '@engine/training'
import { rollEvent, resolveEvent, type EventContext } from '@engine/events'
import { openWindow, prizeMoney, weeklyCashFlow } from '@engine/market'
import { computeAwards } from '@engine/awards'
import { playerLookup, squadPlayers } from './players'
import { autoPick, lineupProblems, squadWages } from './squad'
import { tickWindow } from './marketOps'
import { staffTier } from '@engine/staff'
import { developSquad, DEVELOPMENT_INTERVAL } from './development'
import { evaluateObjective, OBJECTIVE_REWARD } from '@engine/objectives'
import { getFormation } from '@engine/formations'
import { autoPickLineup } from '@engine/ratings'
import type { SquadPlayer } from '@engine/types'
import { earnsPointsRecord } from './records'
import { EXPECTED_SHARE, minutesShare, RECENT_WEEKS, statusMoraleDrift, type SquadStatus } from '@engine/status'
import { difficultyOf } from '@engine/draft'
import { postNews } from './news'
import { ASSISTANT_DECIDED } from './digest'
import { logMorale } from './happiness'
import { eventPlayer } from './inboxActions'

function news(game: Game, item: Omit<NewsItem, 'matchweek'>): void {
  postNews(game, { matchweek: game.season!.matchweek, ...item })
}

function userInput(game: Game, u: LoadedUniverse): MatchTeamInput {
  const get = playerLookup(game, u)
  const input = userTeamInput(u, { teamName: game.settings.teamName, shortName: game.settings.shortName, tactics: game.tactics, lineup: game.lineup, bench: game.bench, state: game.squad, teamTalk: game.teamTalk, captainId: game.captainId, talkSkill: 1 + 0.15 * staffTier(game.staff, 'assistant'), markTarget: game.markTarget })
  return { ...input, getPlayer: get }
}

function userLookups(game: Game, u: LoadedUniverse) {
  return { getPlayer: playerLookup(game, u), getState: (id: string) => game.squad[id] }
}

/** Any AI club in the season: a league rival or a Continental Cup opponent. */
export function clubOf(season: SeasonState, clubId: string): AiClub | undefined {
  return season.ai[clubId] ?? season.continental?.clubs[clubId]
}

/** A knockout competition's ties: the domestic cup or the Continental Cup. */
export function tiesOf(season: SeasonState, comp: Competition): CupTie[] {
  return comp === 'cup' ? season.cup : season.continental?.ties ?? []
}

function aiLookups(game: Game, u: LoadedUniverse, clubId: string) {
  const club = clubOf(game.season!, clubId)
  return { getPlayer: (id: string) => u.index[id], getState: (id: string) => club?.state[id] }
}

function matchBoosts(game: Game): { attack: number; defence: number } {
  const t = TRAINING[game.training]
  const coach = staffTier(game.staff, 'coach')
  let attack = t.attack * (1 + 0.01 * coach)
  let defence = t.defence * (1 - 0.01 * coach)
  if (game.nextMatchBoost?.attack) attack *= 1 + game.nextMatchBoost.attack / 100
  if (game.nextMatchBoost?.defence) defence *= 1 - game.nextMatchBoost.defence / 100
  return { attack, defence }
}

function applyResultToUser(game: Game, u: LoadedUniverse, res: FullMatchResult, userIsHome: boolean, countStats = true, kickOffXI?: Set<string>, week = game.season?.matchweek ?? 0, cup = false): void {
  const stats = userIsHome ? res.homeStats : res.awayStats
  const gf = userIsHome ? res.homeGoals : res.awayGoals
  const ga = userIsHome ? res.awayGoals : res.homeGoals
  const result: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf === ga ? 'D' : 'L'
  // Half-time substitutions are written into game.lineup before we get here, so the kick-off XI is passed in when known
  const starters = kickOffXI ?? new Set(Object.values(game.lineup))
  const played = new Set<string>()
  const get = playerLookup(game, u)
  for (const st of stats) {
    const s = game.squad[st.playerSeasonId]
    if (!s) continue
    played.add(st.playerSeasonId)
    if (!countStats) {
      s.condition = Math.max(40, s.condition - Math.round((res.conditionLoss[st.playerSeasonId] ?? 0) * 0.6))
      s.sharpness = Math.min(100, s.sharpness + 9)
      s.familiarity = Math.min(100, s.familiarity + 8)
      if (st.injured) s.injury = { ...st.injured }
      continue
    }
    const before = s.morale
    applyMatchToState(s, st, starters.has(st.playerSeasonId), res.conditionLoss[st.playerSeasonId] ?? 0, ga === 0, res.motmId === st.playerSeasonId, result, get(st.playerSeasonId)?.attributes.workRate)
    logMorale(s, week, before, cup ? 'cup' : 'result', `${result} ${st.rating.toFixed(1)}`)
    recordMinutes(game, s, st.playerSeasonId, st.minutes)
    if (st.injured && s.injury) {
      // A good physio gets him back sooner
      const physio = staffTier(game.staff, 'physio')
      if (physio === 2 || (physio === 1 && s.injury.weeksOut >= 3)) s.injury.weeksOut = Math.max(1, s.injury.weeksOut - 1)
      news(game, { kind: 'injury', title: `${get(st.playerSeasonId)?.name} injured`, body: `${st.injured.description}. Out for around ${s.injury.weeksOut} week${s.injury.weeksOut === 1 ? '' : 's'}.`, playerId: st.playerSeasonId })
    }
    if (st.red) news(game, { kind: 'suspension', title: `${get(st.playerSeasonId)?.name} sent off`, body: `Suspended for ${s.suspension} match${s.suspension === 1 ? '' : 'es'}.`, playerId: st.playerSeasonId })
    if (st.yellow && s.yellowCards % 5 === 0) news(game, { kind: 'suspension', title: `${get(st.playerSeasonId)?.name} suspended`, body: `Five yellow cards: a one-match ban.`, playerId: st.playerSeasonId })
  }
  if (!countStats) return
  for (const id of played) game.weekPlayed.push(id)
  for (const id of Object.keys(game.squad)) {
    if (played.has(id)) game.consecutiveMissed[id] = 0
    else game.consecutiveMissed[id] = (game.consecutiveMissed[id] ?? 0) + 1
  }
  serveSuspensions(game.squad, played)
  if (game.promisedStart) {
    const kept = starters.has(game.promisedStart)
    const s = game.squad[game.promisedStart]
    if (s) {
      const before = s.morale
      s.morale = Math.max(10, Math.min(100, s.morale + (kept ? 5 : -16)))
      logMorale(s, week, before, 'promise', kept ? 'kept' : 'broken')
      news(game, { kind: 'event', title: kept ? 'Promise kept' : 'Promise broken', body: kept ? `${get(game.promisedStart)?.name} started as promised.` : `${get(game.promisedStart)?.name} was promised a start and did not get one. He is furious.`, playerId: game.promisedStart })
    }
    game.promisedStart = undefined
  }
  game.nextMatchBoost = undefined
  game.markTarget = undefined
}

/** Minutes this week: a second match in the same week (a cup tie) adds to the week's entry rather than opening another. */
function recordMinutes(game: Game, s: SquadPlayer, id: string, minutes: number): void {
  const recent = (s.recentMinutes ??= [])
  if (game.weekPlayed.includes(id) && recent.length) recent[recent.length - 1] += minutes
  else recent.push(minutes)
}

function applyResultToAi(game: Game, teamId: string, res: FullMatchResult, isHome: boolean): void {
  const club = clubOf(game.season!, teamId)
  if (!club) return
  const stats = isHome ? res.homeStats : res.awayStats
  const gf = isHome ? res.homeGoals : res.awayGoals
  const ga = isHome ? res.awayGoals : res.homeGoals
  const result: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf === ga ? 'D' : 'L'
  const played = new Set<string>()
  for (const st of stats) {
    const s = club.state[st.playerSeasonId]
    if (!s) continue
    played.add(st.playerSeasonId)
    applyMatchToState(s, st, true, res.conditionLoss[st.playerSeasonId] ?? 0, ga === 0, res.motmId === st.playerSeasonId, result)
  }
  serveSuspensions(club.state, played)
}

/** A banned player serves one match of his suspension for every match his side plays without him. */
function serveSuspensions(state: Record<string, SquadPlayer>, played: Set<string>): void {
  for (const [id, s] of Object.entries(state)) {
    if (s.suspension > 0 && !played.has(id)) s.suspension -= 1
  }
}

function weeklyRecovery(game: Game, u: LoadedUniverse): void {
  const get = playerLookup(game, u)
  const t = TRAINING[game.training]
  const played = new Set(game.weekPlayed)
  const physio = staffTier(game.staff, 'physio')
  const coach = staffTier(game.staff, 'coach')
  const assistant = staffTier(game.staff, 'assistant')
  const captain = game.captainId ? get(game.captainId) : undefined
  const leader = !!captain && game.squad[captain.id] && captain.traits.professionalism >= 0.6 && captain.attributes.mentality >= 72
  // A week the side played is a week of minutes on offer; a bye week records nothing
  const weekHadMatch = game.weekPlayed.length > 0
  for (const [id, s] of Object.entries(game.squad)) {
    const p = get(id)
    if (!p) continue
    recoverWeek(s, p, played.has(id), t.recovery + physio * 2)
    s.sharpness = Math.max(20, Math.min(100, s.sharpness + t.sharpness + coach))
    s.familiarity = Math.min(100, s.familiarity + t.familiarity + assistant)
    if (weekHadMatch) {
      const recent = (s.recentMinutes ??= [])
      if (!played.has(id)) recent.push(0)
      if (recent.length > RECENT_WEEKS) recent.splice(0, recent.length - RECENT_WEEKS)
    }
    // Playing time against his squad status moves morale, instead of a flat bench penalty
    const share = minutesShare(s.recentMinutes ?? [])
    const week = game.season!.matchweek
    if (share !== null) {
      const before = s.morale
      const status = statusOf(game, id)
      statusMoraleDrift(s, p, status, share)
      logMorale(s, week, before, 'minutes', `${Math.round(share * 100)}/${Math.round(EXPECTED_SHARE[status] * 100)}`)
    }
    // A respected captain keeps heads up
    if (leader && id !== captain.id && s.morale < 70) {
      const before = s.morale
      s.morale = Math.min(70, s.morale + (s.morale < 50 ? 2 : 1))
      logMorale(s, week, before, 'captain')
    }
  }
  for (const club of [...Object.values(game.season!.ai), ...Object.values(game.season!.continental?.clubs ?? {})]) {
    for (const [id, s] of Object.entries(club.state)) {
      const p = get(id)
      if (p) recoverWeek(s, p, true, 0)
    }
  }
  game.weekPlayed = []
}

/** A player's squad status; rotation for contracts written before statuses existed. */
export function statusOf(game: Game, id: string): SquadStatus {
  return game.contracts[id]?.status ?? 'rotation'
}

/** Minutes played over the last `weeks` recorded matchweeks as a share of what was on offer, or null with nothing recorded. */
export function recentShare(s: SquadPlayer, weeks = RECENT_WEEKS): number | null {
  return minutesShare((s.recentMinutes ?? []).slice(-weeks))
}

function trainingInjuries(game: Game, u: LoadedUniverse, rng: Rng): void {
  const t = TRAINING[game.training]
  const get = playerLookup(game, u)
  for (const [id, s] of Object.entries(game.squad)) {
    if (s.injury) continue
    const p = get(id)
    if (!p) continue
    const physio = staffTier(game.staff, 'physio')
    if (rng.chance(0.006 * t.injuryRisk * (0.5 + p.traits.injuryProneness) * (physio === 2 ? 0.55 : physio === 1 ? 0.75 : 1))) {
      s.injury = { description: rng.pick(['Training ground knock', 'Tight calf', 'Rolled ankle in training']), weeksOut: rng.int(1, 3) }
      news(game, { kind: 'injury', title: `${p.name} hurt in training`, body: `${s.injury.description}. Out for ${s.injury.weeksOut} week${s.injury.weeksOut === 1 ? '' : 's'}.`, playerId: id })
    }
  }
}

function userFixture(game: Game) {
  return game.season!.fixtures.find((f) => f.matchweek === game.season!.matchweek + 1 && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM))
}

/** The next league opponent, or null at the end of the season or on a bye week (odd number of clubs). */
export function nextOpponent(game: Game): { clubId: string; home: boolean } | null {
  if (!game.season || game.season.matchweek >= game.season.matchweeks) return null
  const f = userFixture(game)
  if (!f) return null
  const home = f.homeTeamId === USER_TEAM
  return { clubId: home ? f.awayTeamId : f.homeTeamId, home }
}

export interface UpcomingTie {
  tie: CupTie
  comp: Competition
  label: string
}

/** The user's knockout tie, in either competition, played midweek after the next matchweek. */
export function upcomingCupTie(game: Game): UpcomingTie | null {
  const season = game.season
  if (!season) return null
  const mw = season.matchweek + 1
  for (const comp of ['cup', 'continental'] as const) {
    if (comp === 'cup' && (season.cupEliminated || season.cupWon)) continue
    if (comp === 'continental' && (!season.continental || season.continental.eliminated || season.continental.won)) continue
    const tie = tiesOf(season, comp).find((t) => !t.result && t.afterMatchweek === mw && (t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM))
    if (tie) return { tie, comp, label: roundsFor(comp, season.matchweeks).find((r) => r.round === tie.round)?.label ?? 'Cup tie' }
  }
  return null
}

/**
 * Play the next matchweek. Interactive play stops at half time and again at
 * the 70th minute of the user's match (`game.live`); `autoManage` plays
 * everything through with the assistant picking the team and answering
 * decisions.
 */
export function playMatchweek(game: Game, u: LoadedUniverse, autoManage = false): void {
  const season = game.season
  if (!season || season.matchweek >= season.matchweeks || season.sacked) return
  if (game.live) finishLiveMatch(game, u, undefined, true)
  if (game.seasonEnding) {
    game.seasonEnding = false
    finishSeason(game, u)
  }
  if (game.phase === 'summary') return
  const rng = Rng.fromState(game.rngState)

  if (game.pendingEvent && autoManage) {
    // The assistant takes the second option; the choice goes on record before the event's own item follows it
    const ev = game.pendingEvent
    const choice = ev.choices[Math.min(1, ev.choices.length - 1)]
    news(game, { kind: 'event', title: `${ASSISTANT_DECIDED}${ev.title}`, body: choice.label, playerId: eventPlayer(ev) })
    applyEventChoice(game, u, choice.id)
  }
  if (lineupProblems(game, u).length || autoManage) autoPick(game, u, !autoManage)

  const mw = season.matchweek + 1
  const table = computeTable(season.fixtures, [USER_TEAM, ...Object.keys(season.ai)])
  const week = season.fixtures.filter((f) => f.matchweek === mw)
  const boosts = matchBoosts(game)

  for (const f of week) {
    const userIsHome = f.homeTeamId === USER_TEAM
    const userIsAway = f.awayTeamId === USER_TEAM
    if (userIsHome || userIsAway) {
      const opponentId = userIsHome ? f.awayTeamId : f.homeTeamId
      const imp = describeImportance(u, season.hostClubId, opponentId, table, mw)
      const user = userInput(game, u)
      const opp = aiTeamInput(u, season.ai[opponentId], season.aiOffset)
      const opts = { rng, home: userIsHome ? user : opp, away: userIsHome ? opp : user, importance: imp.importance, importanceLabel: imp.label, neutral: false, detail: 'full' as const, boosts: userIsHome ? { home: boosts } : { away: boosts } }
      const ctx = { matchweek: mw, competition: 'league' as const, opponentClubId: opponentId, home: userIsHome, importanceLabel: imp.label }
      if (autoManage) {
        const res = simulateMatch(opts)
        f.result = res
        recordUserLeagueResult(game, u, res, userIsHome, opponentId, ctx)
      } else {
        game.live = { kind: 'league', mp: beginMatch(opts), ctx, userIsHome, opponentId }
      }
    } else {
      const home = aiTeamInput(u, season.ai[f.homeTeamId], season.aiOffset)
      const away = aiTeamInput(u, season.ai[f.awayTeamId], season.aiOffset)
      const res = simulateMatch({ rng, home, away, detail: 'summary' })
      f.result = res
      applyResultToAi(game, f.homeTeamId, res, true)
      applyResultToAi(game, f.awayTeamId, res, false)
    }
  }
  game.lastCupMatch = null
  game.lastCupContext = null
  game.rngState = rng.getState()

  // Bye week (odd number of clubs): the others play, we rest, then the midweek and the housekeeping happen as usual
  if (!week.some((f) => f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM)) {
    season.matchweek = mw
    news(game, { kind: 'info', title: `Matchweek ${mw}: free weekend`, body: 'An odd number of clubs in the league means everyone sits one round out. Legs rested.' })
    afterLeagueMatch(game, u, autoManage)
    if (!game.live && game.phase === 'match') game.phase = 'week'
    return
  }

  game.phase = 'match'
  if (autoManage) {
    season.matchweek = mw
    afterLeagueMatch(game, u, true)
  }
}

function recordUserLeagueResult(game: Game, u: LoadedUniverse, res: FullMatchResult, userIsHome: boolean, opponentId: string, ctx: LiveMatch['ctx'], kickOffXI?: Set<string>): void {
  const season = game.season!
  applyResultToUser(game, u, res, userIsHome, true, kickOffXI, ctx.matchweek)
  applyResultToAi(game, opponentId, res, !userIsHome)
  game.lastMatch = res
  game.lastMatchContext = ctx
  const gf = userIsHome ? res.homeGoals : res.awayGoals
  const ga = userIsHome ? res.awayGoals : res.homeGoals
  news(game, { kind: 'result', title: `${userIsHome ? game.settings.shortName : season.ai[opponentId].shortName} ${res.homeGoals}-${res.awayGoals} ${userIsHome ? season.ai[opponentId].shortName : game.settings.shortName}`, body: gf > ga ? 'Three points.' : gf === ga ? 'A point apiece.' : 'A defeat to learn from.' })
}

/** The engine's lookups for both sides of the live match: the user's squad, an AI club or a friendly's opponents. */
function liveLookups(game: Game, u: LoadedUniverse, live: LiveMatch) {
  return live.kind === 'friendly' ? { home: userLookups(game, u), away: friendlyLookups(u, live.opponentId) } : live.userIsHome ? { home: userLookups(game, u), away: aiLookups(game, u, live.opponentId) } : { home: aiLookups(game, u, live.opponentId), away: userLookups(game, u) }
}

/** Write the manager's substitutions the engine made at `minute` into the lineup and bench, so the squad screen matches the pitch. */
function persistSubstitutions(game: Game, live: LiveMatch, minute: number, asked: Array<{ off: string; on: string }>): void {
  const made = live.userIsHome ? live.mp.hSubs : live.mp.aSubs
  for (const s of asked.filter((s) => made.some((m) => m.minute === minute && m.off === s.off && m.on === s.on))) {
    const slot = Object.keys(game.lineup).find((k) => game.lineup[k] === s.off)
    if (slot && game.squad[s.on]) {
      game.lineup[slot] = s.on
      game.bench = game.bench.filter((id) => id !== s.on)
      if (!game.bench.includes(s.off)) game.bench.push(s.off)
    }
  }
}

/**
 * Play the paused match on from the stop it stands at. From half time it runs to
 * the 70th minute and returns with `game.live` intact for the second stop; from
 * 70 it plays to the final whistle and carries on with the week, unless `hold`
 * keeps the match live through the last twenty minutes (decided to the whistle,
 * still open to changes) until `completeLiveMatch`. A match held at 90 completes.
 * `second` holds the manager's changes at this stop; without it the assistant
 * reacts for both sides. A paused match saved before the window existed carries
 * no clock and resumes at 45.
 */
export function advanceLiveMatch(game: Game, u: LoadedUniverse, second?: LiveChanges, autoManage = false, hold = false): void {
  const live = game.live
  if (!live || !game.season) return
  const stop = live.mp.clock ?? 45
  if (stop >= 90) {
    completeLiveMatch(game, u, autoManage)
    return
  }
  const userSide: 'home' | 'away' = live.userIsHome ? 'home' : 'away'
  const lookups = liveLookups(game, u, live)
  const opts: SecondHalfOptions | undefined = second ? { side: userSide, talk: second.talk, tactics: second.tactics, substitutions: second.substitutions, shout: second.shout } : undefined
  if (second?.tactics) game.tactics = second.tactics
  // Persist the changes made at this stop to the lineup so the squad screen matches what is on the
  // pitch: only those the engine actually made (it refuses a man who has already played, a used
  // substitute or a sixth change), never the request as typed.
  const persistSubs = () => persistSubstitutions(game, live, stop, second?.substitutions ?? [])
  if (stop < 70 || hold) {
    advanceMatch(live.mp, lookups, opts, stop < 70 ? 70 : 90)
    persistSubs()
    return
  }
  // Who kicked off for us, before the substitutions are written back into the lineup
  const kickOffXI = new Set((live.userIsHome ? live.mp.hLive : live.mp.aLive).filter((p) => p.onAt === 0).map((p) => p.psId))
  const res = finishMatch(live.mp, lookups, opts)
  game.live = null
  persistSubs()
  afterLiveResult(game, u, live, res, kickOffXI, autoManage)
}

/**
 * Close a match held to the whistle: write the report (the engine has nothing
 * left to play, so it draws exactly what it would have in one go) and carry on
 * with the week as the unheld path does.
 */
export function completeLiveMatch(game: Game, u: LoadedUniverse, autoManage = false): void {
  const live = game.live
  if (!live || !game.season) return
  if ((live.mp.clock ?? 45) < 90) {
    finishLiveMatch(game, u, undefined, autoManage)
    return
  }
  const kickOffXI = new Set((live.userIsHome ? live.mp.hLive : live.mp.aLive).filter((p) => p.onAt === 0).map((p) => p.psId))
  const res = finishMatch(live.mp, liveLookups(game, u, live))
  game.live = null
  afterLiveResult(game, u, live, res, kickOffXI, autoManage)
}

/**
 * A change with the ball in play for the user's side at `change.minute`:
 * instructions, set-piece takers, substitutions and (from 70) a shout. The
 * instructions go into `game.tactics` and the substitutions the engine made
 * into the lineup and bench, as at the stops.
 */
export function changeLiveMatch(game: Game, u: LoadedUniverse, change: Omit<InPlayChange, 'side'>): InPlayOutcome {
  const live = game.live
  if (!live || !game.season) return { applied: false, refusal: 'no-segment', made: [], refused: [] }
  const side: 'home' | 'away' = live.userIsHome ? 'home' : 'away'
  const out = changeInPlay(live.mp, liveLookups(game, u, live), { ...change, side })
  if (!out.applied) return out
  game.tactics = { ...(side === 'home' ? live.mp.home : live.mp.away).tactics }
  persistSubstitutions(game, live, change.minute, out.made)
  return out
}

/** The bookkeeping once the user's live match has its report: friendly, league or knockout. */
function afterLiveResult(game: Game, u: LoadedUniverse, live: LiveMatch, res: FullMatchResult, kickOffXI: Set<string>, autoManage: boolean): void {
  const season = game.season!
  if (live.kind === 'friendly') {
    applyResultToUser(game, u, res, true, false)
    for (const s of Object.values(game.squad)) s.condition = Math.min(100, s.condition + 14)
    game.friendliesPlayed++
    game.lastMatch = res
    game.lastMatchContext = live.ctx
    news(game, { kind: 'info', title: `Friendly: ${res.homeGoals}-${res.awayGoals} v ${res.awayName}`, body: 'Legs loosened, patterns rehearsed.' })
    game.phase = 'match'
    return
  }
  if (live.kind === 'league') {
    const f = season.fixtures.find((x) => x.matchweek === live.ctx.matchweek && (x.homeTeamId === USER_TEAM || x.awayTeamId === USER_TEAM))!
    f.result = res
    recordUserLeagueResult(game, u, res, live.userIsHome, live.opponentId, live.ctx, kickOffXI)
    season.matchweek = live.ctx.matchweek
    afterLeagueMatch(game, u, autoManage, !autoManage)
    return
  }
  // Knockout tie (domestic cup or Continental Cup)
  const comp = live.comp ?? 'cup'
  const tie = tiesOf(season, comp)[live.cupTieIndex!]
  completeUserCupTie(game, u, tie, res, live, kickOffXI)
  const rng = Rng.fromState(game.rngState)
  drawNext(game, u, rng, tie.round, comp)
  game.rngState = rng.getState()
  afterMatchweek(game, u, !autoManage)
}

/**
 * Play the paused match to the final whistle: `second` is applied at the stop
 * it stands at and the side plays on unchanged from the next one (with
 * `autoManage`, the assistant reacts for both sides at every stop).
 */
export function finishLiveMatch(game: Game, u: LoadedUniverse, second?: LiveChanges, autoManage = false): void {
  if (!game.live) return
  if ((game.live.mp.clock ?? 45) < 70) {
    advanceLiveMatch(game, u, second, autoManage)
    second = second ? {} : undefined
  }
  advanceLiveMatch(game, u, second, autoManage)
}

/**
 * The last match of a season played live stays on the match screen until the
 * manager moves on; the season is only closed then.
 */
export function closeLiveMatch(game: Game, u: LoadedUniverse): void {
  if (game.seasonEnding) {
    game.seasonEnding = false
    finishSeason(game, u)
    return
  }
  if (game.phase === 'match') game.phase = game.season && game.season.matchweek === 0 ? 'preseason' : 'week'
}

function friendlyLookups(u: LoadedUniverse, clubSeasonKey: string) {
  const cs = u.clubSeasonByKey[clubSeasonKey]
  const byId = new Map((cs?.squad ?? []).map((p) => [p.id, p]))
  return { getPlayer: (id: string) => byId.get(id), getState: () => undefined }
}

/** After the league match: cup ties this week (AI ones now, the user's live), then housekeeping. */
function afterLeagueMatch(game: Game, u: LoadedUniverse, autoManage: boolean, playedLive = false): void {
  const season = game.season!
  const mw = season.matchweek
  for (const comp of ['cup', 'continental'] as const) {
    if (comp === 'continental' && !season.continental) continue
    const roundInfo = roundsFor(comp, season.matchweeks).find((r) => r.afterMatchweek === mw)
    if (!roundInfo) continue
    const rng = Rng.fromState(game.rngState)
    simulateAiCupTies(game, u, rng, roundInfo.round, comp)
    const ties = tiesOf(season, comp)
    const idx = ties.findIndex((t) => t.round === roundInfo.round && !t.result && (t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM))
    if (idx >= 0) {
      const tie = ties[idx]
      const userIsHome = tie.homeTeamId === USER_TEAM
      const opponentId = userIsHome ? tie.awayTeamId : tie.homeTeamId
      if (lineupProblems(game, u).length || autoManage) autoPick(game, u, !autoManage)
      const user = userInput(game, u)
      const imp = describeImportance(u, season.hostClubId, opponentId, null, mw, roundInfo.round, comp)
      const opp = aiTeamInput(u, clubOf(season, opponentId)!, season.aiOffset)
      const neutral = roundInfo.round === 'F'
      const opts = { rng, home: userIsHome ? user : opp, away: userIsHome ? opp : user, importance: imp.importance, importanceLabel: imp.label ?? roundInfo.label, neutral, detail: 'full' as const }
      const ctx = { matchweek: mw, competition: comp, roundLabel: roundInfo.label, opponentClubId: opponentId, home: userIsHome, importanceLabel: imp.label }
      if (autoManage) {
        const res = simulateMatch(opts)
        completeUserCupTie(game, u, tie, res, { kind: 'cup', comp, mp: null as never, ctx, userIsHome, opponentId, cupTieIndex: idx })
        drawNext(game, u, rng, roundInfo.round, comp)
        game.rngState = rng.getState()
      } else {
        game.live = { kind: 'cup', comp, mp: beginMatch(opts), ctx, userIsHome, opponentId, cupTieIndex: idx }
        game.rngState = rng.getState()
        game.phase = 'match'
        return
      }
    } else {
      drawNext(game, u, rng, roundInfo.round, comp)
      game.rngState = rng.getState()
    }
  }
  afterMatchweek(game, u, playedLive)
}

function simulateAiCupTies(game: Game, u: LoadedUniverse, rng: Rng, round: CupTie['round'], comp: Competition): void {
  const season = game.season!
  for (const tie of tiesOf(season, comp).filter((t) => t.round === round && !t.result)) {
    if (tie.homeTeamId === USER_TEAM || tie.awayTeamId === USER_TEAM) continue
    const hc = clubOf(season, tie.homeTeamId)
    const ac = clubOf(season, tie.awayTeamId)
    if (!hc || !ac) continue
    const home = aiTeamInput(u, hc, season.aiOffset)
    const away = aiTeamInput(u, ac, season.aiOffset)
    const res = simulateMatch({ rng, home, away, neutral: round === 'F', detail: 'summary' })
    applyResultToAi(game, tie.homeTeamId, res, true)
    applyResultToAi(game, tie.awayTeamId, res, false)
    let winner = res.homeGoals > res.awayGoals ? tie.homeTeamId : res.awayGoals > res.homeGoals ? tie.awayTeamId : null
    let pens: { home: number; away: number } | undefined
    if (!winner) {
      pens = shootout(rng, res.homeReport.strength.overall, res.awayReport.strength.overall)
      winner = pens.home > pens.away ? tie.homeTeamId : tie.awayTeamId
    }
    tie.result = { ...res, penalties: pens }
    tie.winnerId = winner
  }
}

function completeUserCupTie(game: Game, u: LoadedUniverse, tie: CupTie, res: FullMatchResult, live: LiveMatch, kickOffXI?: Set<string>): void {
  const season = game.season!
  const comp = live.comp ?? 'cup'
  const rng = Rng.fromState(game.rngState)
  applyResultToUser(game, u, res, live.userIsHome, true, kickOffXI, live.ctx.matchweek, true)
  applyResultToAi(game, live.opponentId, res, !live.userIsHome)
  game.lastCupMatch = res
  game.lastCupContext = live.ctx
  let winner = res.homeGoals > res.awayGoals ? tie.homeTeamId : res.awayGoals > res.homeGoals ? tie.awayTeamId : null
  let pens: { home: number; away: number } | undefined
  if (!winner) {
    pens = shootout(rng, res.homeReport.strength.overall, res.awayReport.strength.overall)
    winner = pens.home > pens.away ? tie.homeTeamId : tie.awayTeamId
  }
  tie.result = { ...res, penalties: pens }
  tie.winnerId = winner
  const won = winner === USER_TEAM
  const info = roundsFor(comp, season.matchweeks).find((r) => r.round === tie.round)!
  if (comp === 'cup') {
    if (!won) season.cupEliminated = true
    if (won && tie.round === 'F') season.cupWon = true
  } else if (season.continental) {
    if (!won) season.continental.eliminated = true
    if (won && tie.round === 'F') season.continental.won = true
  }
  const oppName = clubOf(season, live.opponentId)?.name ?? u.clubById[live.opponentId]?.name ?? live.opponentId
  const lifted = won && tie.round === 'F' ? (comp === 'cup' ? ' The cup is yours!' : ' Champions of the continent!') : ''
  news(game, { kind: 'cup', title: `${info.label}: ${won ? 'through' : 'out'}`, body: `${res.homeGoals}-${res.awayGoals}${pens ? ` (${pens.home}-${pens.away} on penalties)` : ''} against ${oppName}.${lifted}` })
  game.rngState = rng.getState()
}

function drawNext(game: Game, u: LoadedUniverse, rng: Rng, round: CupTie['round'], comp: Competition): void {
  const season = game.season!
  const rounds = roundsFor(comp, season.matchweeks)
  const idx = rounds.findIndex((r) => r.round === round)
  if (idx < 0 || idx >= rounds.length - 1) return
  const ties = tiesOf(season, comp)
  const next = drawNextRound(ties, rounds[idx + 1].round, rng, rounds)
  ties.push(...next)
  const userTie = next.find((t) => t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM)
  if (userTie) {
    const oppId = userTie.homeTeamId === USER_TEAM ? userTie.awayTeamId : userTie.homeTeamId
    news(game, { kind: 'cup', title: `${rounds[idx + 1].label} draw`, body: `${userTie.homeTeamId === USER_TEAM ? 'Home' : 'Away'} to ${clubOf(season, oppId)?.name ?? u.clubById[oppId]?.name ?? oppId}, after matchweek ${rounds[idx + 1].afterMatchweek}.` })
  }
}

/** Furthest Continental Cup round the user reached this season (W = winners), or undefined when not entered. */
export function continentalRun(season: SeasonState): 'R16' | 'QF' | 'SF' | 'F' | 'W' | undefined {
  const c = season.continental
  if (!c) return undefined
  if (c.won) return 'W'
  const order: Array<'R16' | 'QF' | 'SF' | 'F'> = ['R16', 'QF', 'SF', 'F']
  let best: 'R16' | 'QF' | 'SF' | 'F' = 'R16'
  for (const t of c.ties) if ((t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM) && order.indexOf(t.round) > order.indexOf(best)) best = t.round
  return best
}

/** Weekly housekeeping once every match of the week is done. */
function afterMatchweek(game: Game, u: LoadedUniverse, playedLive = false): void {
  const season = game.season!
  const mw = season.matchweek
  const rng = Rng.fromState(game.rngState)
  trainingInjuries(game, u, rng)
  weeklyRecovery(game, u)
  if (mw % DEVELOPMENT_INTERVAL === 0 && mw < season.matchweeks) {
    const changes = developSquad(game, u, rng)
    const up = changes.filter((c) => c.to > c.from)
    const down = changes.filter((c) => c.to < c.from)
    if (changes.length) news(game, { kind: 'training', title: 'Development report', body: `${up.length ? `Improving: ${up.map((c) => `${c.name} ${c.from}→${c.to}`).join(', ')}.` : ''}${up.length && down.length ? ' ' : ''}${down.length ? `Fading: ${down.map((c) => `${c.name} ${c.from}→${c.to}`).join(', ')}.` : ''}` })
  }
  const wages = squadWages(game, u)
  game.finances.wagesPaid += wages / 1000
  const flow = weeklyCashFlow(game.finances, wages)
  game.finances.budget = Math.round((game.finances.budget + flow) * 10) / 10
  if (flow > 0) game.finances.income += flow

  const newTable = computeTable(season.fixtures, [USER_TEAM, ...Object.keys(season.ai)])
  const userRow = newTable.find((r) => r.teamId === USER_TEAM)!
  // On a bye week there is no new result to judge; do not count last week's again
  const playedThisWeek = season.fixtures.some((f) => f.matchweek === mw && f.result && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM))
  const last = playedThisWeek ? (userRow.form[userRow.form.length - 1] ?? null) : null
  season.confidence = updateConfidence(season.confidence, newTable, USER_TEAM, season.boardTarget, mw, last)
  if (game.settings.jobSecurity && mw >= 10 && season.confidence < 12 && mw < season.matchweeks) {
    season.sacked = true
    news(game, { kind: 'board', title: 'Sacked', body: 'The board has relieved you of your duties. The season ends here.' })
  }
  if (season.confidence < 20 && !game.unlocked.includes('survivor-pending')) game.unlocked.push('survivor-pending')

  // Transfer window: opens at the halfway point; three market days pass per matchweek, so it shuts three matchweeks later
  if (mw === Math.floor(season.matchweeks / 2) && !game.window) {
    game.window = openWindow({ u, rng, ownedPlayerIds: new Set(squadPlayers(game, u).map((x) => x.p.playerId)), leagueSeason: season.leagueSeason, priceLevel: 1.05, fromSeason: game.settings.rules.fromSeason, toSeason: game.settings.rules.toSeason, leagues: game.settings.wheelLeagues, onlyNation: game.settings.rules.onlyNation, classic: game.settings.rules.classic }, 'january')
    news(game, { kind: 'transfer', title: 'January window open', body: `${game.window.listings.length} players are available. Budget £${game.finances.budget}M.` })
  } else if (game.window && game.window.kind === 'january') {
    for (let i = 0; i < 3; i++) {
      if (game.window.day < game.window.days) tickWindow(game, u, rng)
    }
    if (game.window.day >= game.window.days) {
      news(game, { kind: 'transfer', title: 'Window closed', body: 'The January window has shut.' })
      game.window = null
    }
  }

  game.pendingEvent = null
  if (mw < season.matchweeks && rng.chance(0.42)) {
    const ctx = eventContext(game, u, rng, newTable)
    const ev = rollEvent(ctx)
    if (ev) game.pendingEvent = ev
  }
  game.phase = 'match'
  game.rngState = rng.getState()
  if (mw >= season.matchweeks || season.sacked) {
    // Played live: let the manager see the final whistle first; the summary follows when they continue
    if (playedLive) game.seasonEnding = true
    else finishSeason(game, u)
  }
}

export function eventContext(game: Game, u: LoadedUniverse, rng: Rng, table?: ReturnType<typeof computeTable>): EventContext {
  const season = game.season!
  const t = table ?? computeTable(season.fixtures, [USER_TEAM, ...Object.keys(season.ai)])
  const row = t.find((r) => r.teamId === USER_TEAM)!
  const next = nextOpponent(game)
  const host = u.clubById[season.hostClubId]
  const lastFixture = [...season.fixtures].filter((f) => f.result && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM)).sort((a, b) => b.matchweek - a.matchweek)[0]
  let beatRival = false
  const isDynasty = game.settings.mode === 'dynasty'
  if (lastFixture?.result && host && lastFixture.matchweek === season.matchweek) {
    const home = lastFixture.homeTeamId === USER_TEAM
    const opp = home ? lastFixture.awayTeamId : lastFixture.homeTeamId
    const gf = home ? lastFixture.result.homeGoals : lastFixture.result.awayGoals
    const ga = home ? lastFixture.result.awayGoals : lastFixture.result.homeGoals
    beatRival = host.rivals.includes(opp) && gf > ga
  }
  let lastResult: EventContext['lastResult']
  const res = game.lastMatch
  // Compare by matchweek, not identity: the fixture result and lastMatch are different Immer proxies of one object
  if (res && game.lastMatchContext?.competition === 'league' && game.lastMatchContext.matchweek === season.matchweek) {
    const home = res.homeTeamId === USER_TEAM
    const gf = home ? res.homeGoals : res.awayGoals
    const ga = home ? res.awayGoals : res.homeGoals
    const oppId = home ? res.awayTeamId : res.homeTeamId
    const ours = res.events.filter((e) => e.type === 'goal' && e.side === (home ? 'home' : 'away') && e.playerId && game.squad[e.playerId])
    lastResult = { gf, ga, opponentName: clubOf(season, oppId)?.name ?? oppId, motmId: res.motmId && game.squad[res.motmId] ? res.motmId : undefined, scorerId: ours[0]?.playerId, competition: 'league' }
  }
  return {
    rng,
    isDynasty,
    lastResult,
    matchweek: season.matchweek,
    expiring: squadPlayers(game, u)
      .filter((x) => (game.contracts[x.p.id]?.years ?? 1) <= 1 && !game.contracts[x.p.id]?.renewed && !game.contracts[x.p.id]?.declined && !game.contracts[x.p.id]?.loan)
      .map((x) => ({ ...x, status: statusOf(game, x.p.id) })),
    recentForm: row.form,
    beatRival,
    squad: squadPlayers(game, u).map((x) => {
      const status = statusOf(game, x.p.id)
      const recent = x.s.recentMinutes ?? []
      // Short of his status by more than a quarter of the minutes over the last three recorded matchweeks
      const lastThree = recentShare(x.s, 3)
      const shortOfMinutes = recent.length >= 3 && lastThree !== null && lastThree < EXPECTED_SHARE[status] - 0.25
      return { p: x.p, s: x.s, consecutiveMissed: game.consecutiveMissed[x.p.id] ?? 0, status, share: recentShare(x.s), shortOfMinutes }
    }),
    unbeaten: row.lost === 0,
    wins: row.won,
    losses: row.lost,
    position: positionOf(t, USER_TEAM),
    boardTarget: season.boardTarget,
    confidence: season.confidence,
    nextOpponentIsRival: !!next && !!host && host.rivals.includes(next.clubId),
    budget: game.finances.budget,
  }
}

export function applyEventChoice(game: Game, u: LoadedUniverse, choiceId: string): void {
  const ev = game.pendingEvent
  if (!ev) return
  const rng = Rng.fromState(game.rngState)
  const ctx = eventContext(game, u, rng)
  const out = resolveEvent(ev, choiceId, ctx)
  const week = game.season?.matchweek ?? 0
  for (const m of out.moraleDelta ?? []) {
    const s = game.squad[m.playerSeasonId]
    if (!s) continue
    const before = s.morale
    s.morale = Math.max(10, Math.min(100, s.morale + m.delta))
    logMorale(s, week, before, 'event', ev.title)
  }
  if (out.teamMoraleDelta) {
    for (const s of Object.values(game.squad)) {
      const before = s.morale
      s.morale = Math.max(10, Math.min(100, s.morale + out.teamMoraleDelta))
      logMorale(s, week, before, 'event', ev.title)
    }
  }
  for (const c of out.conditionDelta ?? []) {
    const s = game.squad[c.playerSeasonId]
    if (s) s.condition = Math.max(5, Math.min(100, s.condition + c.delta))
  }
  if (out.confidenceDelta && game.season) game.season.confidence = Math.max(0, Math.min(100, game.season.confidence + out.confidenceDelta))
  if (out.budgetDelta) game.finances.budget = Math.round((game.finances.budget + out.budgetDelta) * 10) / 10
  if (out.promiseStart) game.promisedStart = out.promiseStart
  if (out.nextMatchBoost) game.nextMatchBoost = out.nextMatchBoost
  if (out.captain) game.captainId = out.captain
  if (out.renewContract) {
    const c = game.contracts[out.renewContract.playerSeasonId]
    if (c) {
      c.renewed = true
      c.years = Math.max(c.years, 1)
      if (out.renewContract.status) c.status = out.renewContract.status
    }
    const p = playerLookup(game, u)(out.renewContract.playerSeasonId)
    if (p && out.renewContract.wageRise !== 1) game.customPlayers[p.id] = { ...p, wage: Math.round(p.wage * out.renewContract.wageRise) }
  }
  if (out.declineContract) {
    const c = game.contracts[out.declineContract]
    if (c) c.declined = true
  }
  if (out.transferList) {
    const c = game.contracts[out.transferList]
    if (c) c.listed = true
  }
  if (out.clearInjury) {
    const s = game.squad[out.clearInjury.playerSeasonId]
    if (s && s.injury) {
      if (rng.chance(out.clearInjury.setbackChance)) {
        s.injury.weeksOut += rng.int(2, 4)
        news(game, { kind: 'injury', title: 'Setback', body: `${playerLookup(game, u)(out.clearInjury.playerSeasonId)?.name} broke down in training. ${s.injury.weeksOut} more weeks.`, playerId: out.clearInjury.playerSeasonId })
      } else {
        s.injury = null
        s.sharpness = Math.max(40, s.sharpness - 10)
      }
    }
  }
  if (ev.id === 'agent' && choiceId === 'meet') game.bonusSpins += 1
  news(game, { kind: 'event', title: ev.title, body: out.text, playerId: eventPlayer(ev) })
  game.pendingEvent = null
  game.rngState = rng.getState()
}

/** Pre-season friendly, played live like any other match. */
export function playFriendly(game: Game, u: LoadedUniverse): void {
  if (!game.season || game.friendliesPlayed >= 3 || game.live) return
  const rng = Rng.fromState(game.rngState)
  if (lineupProblems(game, u).length) autoPick(game, u, true)
  const user = userInput(game, u)
  const pool = poolClubSeasons(u, game.settings.rules.classic).filter((cs) => (cs.position >= 8 || cs.position === 0) && (!game.settings.wheelLeagues.length || game.settings.wheelLeagues.includes(cs.leagueId)))
  const cs = rng.pick(pool)
  const club = u.clubById[cs.clubId]
  const oppTactics = { ...game.season.ai[Object.keys(game.season.ai)[0]].tactics }
  const byId = new Map(cs.squad.map((p) => [p.id, p]))
  const formation = getFormation(oppTactics.formationId)
  const picked = autoPickLineup(formation, cs.squad, oppTactics)
  const key = `${cs.clubId}@${cs.season}`
  const label = `${club?.name ?? cs.clubId} ${cs.season}-${String((cs.season + 1) % 100).padStart(2, '0')}`
  const opp: MatchTeamInput = { teamId: `friendly-${cs.clubId}`, teamName: label, shortName: club?.shortName ?? cs.clubId, tactics: oppTactics, lineup: picked.lineup, bench: picked.bench, getPlayer: (id) => byId.get(id), getState: () => undefined, ratingOffset: game.season.aiOffset }
  const mp = beginMatch({ rng, home: user, away: opp, neutral: true, detail: 'full', importance: 0.9, importanceLabel: 'Pre-season friendly' })
  game.live = { kind: 'friendly', mp, ctx: { matchweek: 0, competition: 'league', roundLabel: 'Friendly', opponentClubId: cs.clubId, home: true, importanceLabel: `Pre-season friendly v ${label}` }, userIsHome: true, opponentId: key }
  game.phase = 'match'
  game.rngState = rng.getState()
}

export function startSeasonProper(game: Game): void {
  if (game.phase === 'preseason') {
    game.phase = 'week'
    if (game.window?.kind === 'summer') {
      postNews(game, { matchweek: 0, kind: 'transfer', title: 'Summer window closed', body: 'The season is under way. The next window opens in January.' })
      game.window = null
    }
  }
}

export function finishSeason(game: Game, u: LoadedUniverse): void {
  const season = game.season!
  const table = computeTable(season.fixtures, [USER_TEAM, ...Object.keys(season.ai)])
  const row = table.find((r) => r.teamId === USER_TEAM)!
  const pos = positionOf(table, USER_TEAM)
  const tier = season.sacked ? 'RELEGATED' : seasonTier(table, USER_TEAM, season.cupWon, season.matchweeks)
  game.tier = tier
  const squad = squadPlayers(game, u)
  game.awards = computeAwards(squad, season.matchweeks)
  const run = continentalRun(season)
  const euroPrize = { R16: 4, QF: 8, SF: 15, F: 25, W: 45 }[run ?? 'R16'] ?? 0
  const prize = season.sacked ? 0 : prizeMoney(pos, season.cupWon) + (run ? euroPrize : 0)
  game.finances.budget = Math.round((game.finances.budget + prize) * 10) / 10
  game.finances.income += prize
  // Top four, or the continental trophy, earns a place in next season's Continental Cup
  game.qualifiedContinental = !season.sacked && (pos <= 4 || !!season.continental?.won)
  // Board objectives: judged now, paid now
  if (season.objectives?.length && !season.sacked) {
    const ctx = { season, squad, rivals: u.clubById[season.hostClubId]?.rivals ?? [] }
    let metCount = 0
    for (const o of season.objectives) {
      o.met = evaluateObjective(o, ctx).met
      if (o.met) metCount++
    }
    const bonus = metCount * OBJECTIVE_REWARD.budget
    game.finances.budget = Math.round((game.finances.budget + bonus) * 10) / 10
    game.finances.income += bonus
    season.confidence = Math.max(0, Math.min(100, season.confidence + metCount * OBJECTIVE_REWARD.confidence + (season.objectives.length - metCount) * OBJECTIVE_REWARD.miss))
    news(game, { kind: 'board', title: `Board objectives: ${metCount} of ${season.objectives.length} met`, body: season.objectives.map((o) => `${o.met ? '✓' : '✗'} ${o.label}`).join('. ') + (bonus ? `. £${bonus}M added to the budget.` : '.') })
  }
  // All-time records for the club's legends list
  const career = (game.careerStats ??= {})
  for (const x of squad) {
    if (!x.s.seasonStats.apps) continue
    const rec = career[x.p.playerId] ?? { name: x.p.name, seasons: 0, apps: 0, goals: 0, assists: 0, motm: 0, titles: 0, lastYear: game.year }
    rec.seasons += 1
    rec.apps += x.s.seasonStats.apps
    rec.goals += x.s.seasonStats.goals
    rec.assists += x.s.seasonStats.assists
    rec.motm += x.s.seasonStats.motm
    if (pos === 1 && !season.sacked) rec.titles += 1
    rec.lastYear = game.year
    rec.name = x.p.name
    career[x.p.playerId] = rec
  }
  game.history.push({
    year: game.year,
    leagueId: season.leagueId,
    leagueSeason: season.leagueSeason,
    teamName: game.settings.teamName,
    hostClubId: season.hostClubId,
    position: pos,
    points: row.points,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    tier,
    cupWon: season.cupWon,
    continentalWon: !!season.continental?.won,
    continentalRun: run,
    potsName: game.awards.playerOfTheSeason?.name,
    bootName: game.awards.goldenBoot?.name,
    bootGoals: game.awards.goldenBoot ? Number(game.awards.goldenBoot.value.split(' ')[0]) : undefined,
  })
  const unlock = (id: string) => {
    if (!game.unlocked.includes(id)) game.unlocked.push(id)
  }
  if (tier === 'PERFECT') unlock('perfect')
  if (tier === 'PERFECT' || tier === 'INVINCIBLE') unlock('invincible')
  if (pos === 1) unlock('champions')
  if (row.points >= 100) unlock('centurions')
  if (season.cupWon) unlock('cup')
  if (season.cupWon && pos === 1) unlock('double')
  if (season.continental?.won) unlock('continental')
  if (season.continental?.won && season.cupWon && pos === 1) unlock('treble')
  if (game.awards.goldenBoot && Number(game.awards.goldenBoot.value.split(' ')[0]) >= 30) unlock('boot30')
  if (game.awards.goldenGlove && Number(game.awards.goldenGlove.value.split(' ')[0]) >= 20) unlock('glove20')
  if (pos === 1 && difficultyOf(game.settings.rules) === 'hard') unlock('hard-champions')
  if (pos === 1 && game.settings.rules.onlyClub) unlock('one-club-champions')
  if (pos === 1 && game.settings.rules.onlyNation) unlock('one-nation-champions')
  if (earnsPointsRecord(u, season.leagueId, game.settings.difficulty, row, season.matchweeks, season.sacked)) unlock('record-points')
  if (game.unlocked.includes('survivor-pending') && !season.sacked) unlock('survivor')
  const titles = game.history.slice(-3).filter((h) => h.position === 1).length
  if (titles >= 3) unlock('dynasty-3')
  game.unlocked = game.unlocked.filter((x) => x !== 'survivor-pending')
  news(game, { kind: 'award', title: 'Season over', body: `${row.won}W ${row.drawn}D ${row.lost}L, ${row.points} points, ${pos}${['th', 'st', 'nd', 'rd'][pos % 10 > 3 || (pos % 100 >= 11 && pos % 100 <= 13) ? 0 : pos % 10]}. Prize money £${prize}M.` })
  game.jobOffers = game.settings.mode === 'dynasty' && !season.sacked ? jobOffersFor(game, u, pos, table.length) : []
  game.pendingMove = null
  game.phase = 'summary'
}

/**
 * After a good season, bigger clubs come calling, sometimes from another
 * league. Offers name a club in the next real season of that league.
 */
function jobOffersFor(game: Game, u: LoadedUniverse, pos: number, teams: number): Game['jobOffers'] {
  const rng = Rng.fromState(game.rngState)
  const season = game.season!
  const offers: Game['jobOffers'] = []
  if (pos > Math.max(6, Math.round(teams * 0.35)) && !season.cupWon && !season.continental?.won) return offers
  const squadValue = (cs: { squad: Array<{ value: number }> }) => cs.squad.reduce((s, p) => s + p.value, 0)
  const hostNow = u.clubSeasonByKey[`${season.hostClubId}@${season.leagueSeason}`]
  const hostValue = hostNow ? squadValue(hostNow) : 0
  const candidates: Array<{ leagueId: string; clubId: string; value: number }> = []
  const offerPool = poolClubSeasons(u, !!game.settings.rules.classic || isClassicSeason(u, season.leagueId, season.leagueSeason))
  for (const league of u.leagues) {
    const seasons = [...new Set(offerPool.filter((cs) => cs.leagueId === league.id).map((cs) => cs.season))].sort()
    const current = league.id === season.leagueId ? season.leagueSeason : seasons[seasons.indexOf(season.leagueSeason) >= 0 ? seasons.indexOf(season.leagueSeason) : seasons.length - 2] ?? seasons[0]
    const next = seasons[(seasons.indexOf(current) + 1) % seasons.length]
    for (const cs of u.clubSeasons.filter((c) => c.leagueId === league.id && c.season === next)) {
      if (cs.clubId === season.hostClubId) continue
      const v = squadValue(cs)
      if (v > hostValue * (league.id === season.leagueId ? 1.2 : 1.0)) candidates.push({ leagueId: league.id, clubId: cs.clubId, value: v })
    }
  }
  if (!candidates.length) return offers
  candidates.sort((a, b) => b.value - a.value)
  const pool = candidates.slice(0, 8)
  const n = pos === 1 || season.cupWon ? 2 : 1
  const pitches = ['They want a title challenge and think you are the one to lead it.', 'Their board has been impressed by your work and wants ambition to match their budget.', 'A sleeping giant looking for a manager to wake it up.', 'They will double the transfer budget for the right appointment.']
  const picked = new Set<string>()
  for (let i = 0; i < n && pool.length; i++) {
    let choice = rng.pick(pool)
    let guard = 0
    while (picked.has(choice.clubId) && guard++ < 10) choice = rng.pick(pool)
    if (picked.has(choice.clubId)) break
    picked.add(choice.clubId)
    offers.push({ leagueId: choice.leagueId, clubId: choice.clubId, pitch: rng.pick(pitches), budgetBonus: Math.round(Math.max(10, Math.min(80, choice.value * 0.05))) })
  }
  game.rngState = rng.getState()
  return offers
}
