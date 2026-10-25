/**
 * The arena: one-sitting knockouts against real club-seasons, played beside a
 * season rather than inside one. This item ships its plumbing and the first
 * format, a one-off cup final (draft 16, manage one final to the last kick).
 *
 * Seed streams (`ArenaState.streams`, seeded in `createGame`) draw the field,
 * so everyone on a seed meets the same opponents whatever they drafted; the
 * user's own matches and shoot-outs draw from `game.rngState`.
 */
import type { ArenaRunEntry, ArenaSettings, ArenaState, ArenaStep, Game, GameSettings, MatchContext, PendingShootout } from '../types'
import { seasonLabel, type LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { QUICK_RULES } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { advanceMatch, beginMatch, finishMatch, onPitch, type FullMatchResult, type LiveChanges, type MatchInProgress, type MatchOptions, type MatchTeamInput, type SecondHalfOptions, type TeamLookups } from '@engine/match'
import { aiTeamInput, applyMatchToState, newSquadPlayer, recoverWeek, userTeamInput, type AiClub } from '@engine/season'
import { TRAINING } from '@engine/training'
import { ARENA_TIER_LABEL, arenaClub, clubIdOfKey, clubSeasonName, defaultTakers, finalOpponent, knockoutOffset, penaltyShootout, takerOf, teamStrengthOf, type ArenaField, type ArenaTier } from '@engine/knockout'
import type { ArenaShareInput } from '@engine/awards'
import type { ClubSeason } from '@engine/types'
import { playerLookup } from './players'
import { autoPick, lineupProblems } from './squad'
import { defaultHostClub } from './setup'
import { arenaFormatLabel } from './modes'
import { resultId } from './cabinet'

/** Players drafted for a one-off final. */
export const FINAL_SQUAD = 16

/** The fields this build offers for a final, the default first. */
export const FINAL_FIELDS: ReadonlyArray<{ value: ArenaField; label: string; hint: string }> = [
  { value: 'giants', label: 'Giants', hint: 'The strongest 5% of every club-season in the data' },
  { value: 'champions', label: 'Champions', hint: 'A real champion of a league with a table' },
  { value: 'wheel', label: 'The wheel', hint: 'Any club-season the wheel could land on, weighted the wheel’s way' },
]

/** Fields that draw from every league, whatever the wheel: their games need every pack loaded. */
export function arenaNeedsAllLeagues(settings: Pick<GameSettings, 'arena'>): boolean {
  const f = settings.arena?.field
  return f === 'champions' || f === 'giants' || f === 'europe'
}

/** The leagues the field draws from: all of them for the champions, giants and Europe, otherwise the wheel's. */
export function fieldLeagues(game: Pick<Game, 'settings'>, u: LoadedUniverse): string[] {
  return arenaNeedsAllLeagues(game.settings) ? u.available.map((l) => l.id) : game.settings.wheelLeagues
}

/** The arena state a new game starts with; `streams` are seeded by `createGame`. */
export function newArenaState(a: ArenaSettings, streams: ArenaState['streams']): ArenaState {
  return { format: a.format, ...(a.size ? { size: a.size } : {}), streams, clubs: {}, next: null, step: 0, log: [], yellows: {}, over: false, won: false, handManaged: false }
}

export interface ArenaChoices {
  teamName: string
  formationId: string
  field: ArenaField
  wheelLeagues: string[]
  fromSeason?: number
  toSeason?: number
  difficulty: 'calibrated' | 'realistic'
  seed: string
  hardMode: boolean
  twists: boolean
  /** Whose colours the side wears; the league's default host when absent or not in that season. */
  hostClubId?: string
}

/** The latest complete season of a league (its latest season when none is complete). */
export function latestCompleteSeason(u: LoadedUniverse, leagueId: string): number {
  const inLeague = u.clubSeasons.filter((cs) => cs.leagueId === leagueId)
  const complete = inLeague.filter((cs) => cs.complete).map((cs) => cs.season)
  return Math.max(...(complete.length ? complete : inLeague.map((cs) => cs.season)))
}

/** The clubs of a league season, sorted by name: the colours a final side can wear. */
export function colourClubs(u: LoadedUniverse, leagueId: string, season: number): string[] {
  return u.clubSeasons
    .filter((cs) => cs.leagueId === leagueId && cs.season === season)
    .map((cs) => cs.clubId)
    .sort((a, b) => (u.clubById[a]?.name ?? a).localeCompare(u.clubById[b]?.name ?? b))
}

/**
 * The settings of a one-off final. The league, season and host are colours
 * and labels only: the wheel's first league, its latest complete season and
 * that season's default host unless another club is chosen.
 */
export function finalGameSettings(u: LoadedUniverse, c: ArenaChoices, shortName: string): GameSettings {
  const leagueId = c.wheelLeagues[0]
  const leagueSeason = latestCompleteSeason(u, leagueId)
  const clubs = colourClubs(u, leagueId, leagueSeason)
  const hostClubId = c.hostClubId && clubs.includes(c.hostClubId) ? c.hostClubId : defaultHostClub(u, leagueId, leagueSeason, clubs)
  return {
    mode: 'arena',
    seed: c.seed,
    formationId: c.formationId,
    teamName: c.teamName,
    shortName,
    leagueId,
    wheelLeagues: c.wheelLeagues,
    hostClubId,
    leagueSeason,
    rules: { ...QUICK_RULES, squadSize: FINAL_SQUAD, leagues: c.wheelLeagues, fromSeason: c.fromSeason, toSeason: c.toSeason, hardMode: c.hardMode, twists: c.twists },
    jobSecurity: false,
    difficulty: c.difficulty,
    continental: false,
    arena: { format: 'cup', size: 2, field: c.field },
  }
}

/** The wheel in a few words, for the share text: `Premier League wheel`, `European Nights wheel`. */
export function wheelName(u: LoadedUniverse, s: Pick<GameSettings, 'wheelLeagues' | 'leagueId'>): string {
  return s.wheelLeagues.length > 1 ? 'European Nights wheel' : `${u.available.find((l) => l.id === s.wheelLeagues[0])?.name ?? s.wheelLeagues[0] ?? s.leagueId} wheel`
}

const FIELD_WORDS: Record<ArenaField, string> = { giants: 'against the giants', champions: 'against a champion', wheel: 'against the wheel', decade: 'against a decade', europe: "against this season's Europe" }

/** One line stating every choice an arena game starts with, for the line above Start. */
export function summariseArena(u: LoadedUniverse, s: GameSettings): string {
  const field = s.arena?.field ?? 'giants'
  const wheel = s.wheelLeagues.length > 1 ? `European Nights wheel of ${s.wheelLeagues.length} leagues` : wheelName(u, s)
  const parts = [`${s.teamName}, ${getFormation(s.formationId).name}, ${arenaFormatLabel(s.arena)} ${FIELD_WORDS[field]}, ${wheel}, ${s.difficulty}, seed ${s.seed}`]
  const r = s.rules
  if (r.fromSeason !== undefined || r.toSeason !== undefined) parts.push(`${seasonLabel(r.fromSeason ?? u.firstSeason)} to ${seasonLabel(r.toSeason ?? u.lastSeason)}`)
  if (r.hardMode) parts.push('hard mode')
  if (!r.twists) parts.push('no twists')
  parts.push(`squad of ${r.squadSize}`, `in ${u.clubById[s.hostClubId]?.name ?? s.hostClubId} colours`)
  return parts.join(', ')
}

/** What the next match of a run is: label, the share code, importance, venue. */
export function arenaStepInfo(a: Pick<ArenaState, 'format' | 'size' | 'step'>): { label: string; code: string; importance: number; neutral: boolean; home: boolean } {
  void a
  return { label: 'Cup final', code: 'F', importance: 1.4, neutral: true, home: true }
}

/** True when the run has no match after this one. */
function lastStep(a: ArenaState): boolean {
  return a.format === 'cup' && (a.size ?? 2) === 2 ? a.step >= 1 : true
}

/** Draw the next opponent from the field's stream. A final draws its one opponent. */
function drawNextOpponent(game: Game, u: LoadedUniverse): void {
  const a = game.arena
  if (!a) return
  const rng = Rng.fromState(a.streams.field)
  const r = game.settings.rules
  const cs = finalOpponent(u, rng, { leagues: fieldLeagues(game, u), fromSeason: r.fromSeason, toSeason: r.toSeason, field: game.settings.arena?.field ?? 'giants' })
  a.streams.field = rng.getState()
  const club = arenaClub(u, cs)
  a.clubs[club.id] = club
  a.next = club.id
}

/** Move the draft into the squad (no contracts), pick the side and draw the field; the run opens on its hub (phase `week`). */
export function beginArena(game: Game, u: LoadedUniverse): void {
  const a = game.arena
  if (!a) return
  const d = game.draft
  if (d) {
    for (const id of [...Object.values(d.lineup), ...d.bench]) game.squad[id] ??= newSquadPlayer(id)
    game.lineup = { ...d.lineup }
    game.bench = [...d.bench]
  }
  // The draft stays on the game: challenge links and bonus spins read it
  game.bonusSpins = 0
  autoPick(game, u, false)
  if (!a.next && !a.over && a.step === 0) drawNextOpponent(game, u)
  game.phase = 'week'
}

export interface ArenaOpponent {
  key: string
  club: AiClub
  cs: ClubSeason | undefined
  /** Real team strength. */
  real: number
  /** Rating points the calibration takes off. */
  offset: number
}

/** The next opponent with its real strength and calibration, or null. */
export function nextArenaOpponent(game: Game, u: LoadedUniverse): ArenaOpponent | null {
  const a = game.arena
  if (!a?.next) return null
  const club = a.clubs[a.next]
  if (!club) return null
  const cs = u.clubSeasonByKey[a.next]
  const real = cs ? teamStrengthOf(u, cs) : 0
  return { key: a.next, club, cs, real, offset: knockoutOffset([real], game.settings.arena?.field ?? 'giants', game.settings.difficulty) }
}

/** The user's side as the engine reads it: `week.ts`'s recipe, so prime ratings and custom players resolve the same way. */
export function arenaUserInput(game: Game, u: LoadedUniverse): MatchTeamInput {
  const input = userTeamInput(u, { teamName: game.settings.teamName, shortName: game.settings.shortName, tactics: game.tactics, lineup: game.lineup, bench: game.bench, state: game.squad, teamTalk: game.teamTalk, captainId: game.captainId, talkSkill: 1, markTarget: game.markTarget })
  return { ...input, getPlayer: playerLookup(game, u) }
}

function lookupsFor(game: Game, u: LoadedUniverse, club: AiClub, userIsHome: boolean): { home: TeamLookups; away: TeamLookups } {
  const user: TeamLookups = { getPlayer: playerLookup(game, u), getState: (id) => game.squad[id] }
  const opp: TeamLookups = { getPlayer: (id) => u.index[id], getState: (id) => club.state[id] }
  return userIsHome ? { home: user, away: opp } : { home: opp, away: user }
}

/**
 * Kick off the next match: live, it pauses at half time (`game.live`, phase
 * `match`); otherwise the assistant picks the side and plays it to the end.
 */
export function playArenaStep(game: Game, u: LoadedUniverse, live: boolean): void {
  const a = game.arena
  if (!a || a.over || a.pending || game.live) return
  const opp = nextArenaOpponent(game, u)
  if (!opp) return
  if (lineupProblems(game, u).length || !live) autoPick(game, u, live)
  const info = arenaStepInfo(a)
  const rng = Rng.fromState(game.rngState)
  const t = TRAINING[game.training]
  const boosts = { attack: t.attack, defence: t.defence }
  const user = arenaUserInput(game, u)
  // The opponent plays under its club id, so badges and kits resolve; the arena files it by club and season
  const them: MatchTeamInput = { ...aiTeamInput(u, opp.club, opp.offset), teamId: opp.club.clubId }
  const opts: MatchOptions = { rng, home: info.home ? user : them, away: info.home ? them : user, importance: info.importance, importanceLabel: info.label, neutral: info.neutral, detail: 'full', boosts: info.home ? { home: boosts } : { away: boosts } }
  const ctx: MatchContext = { matchweek: a.step + 1, competition: 'arena', roundLabel: info.label, opponentClubId: opp.club.clubId, home: info.home }
  const mp = beginMatch(opts)
  game.rngState = rng.getState()
  if (live) {
    game.live = { kind: 'arena', mp, ctx, userIsHome: info.home, opponentId: opp.key }
    game.phase = 'match'
    return
  }
  const lookups = lookupsFor(game, u, opp.club, info.home)
  advanceMatch(mp, lookups, undefined, 70)
  const kickOffXI = kickOff(mp, info.home)
  const res = finishMatch(mp, lookups)
  resolveArenaStep(game, u, res, mp, ctx, kickOffXI, false)
}

function kickOff(mp: MatchInProgress, userIsHome: boolean): Set<string> {
  return new Set((userIsHome ? mp.hLive : mp.aLive).filter((p) => p.onAt === 0).map((p) => p.psId))
}

/**
 * Play the paused arena match on from its stop with the manager's changes,
 * `advanceLiveMatch`'s pattern: only the substitutions the engine made are
 * written back to the lineup. At the whistle the step resolves.
 */
export function advanceArenaMatch(game: Game, u: LoadedUniverse, changes?: LiveChanges): void {
  const live = game.live
  const a = game.arena
  if (!live || live.kind !== 'arena' || !a) return
  const club = a.clubs[live.opponentId]
  if (!club) return
  const lookups = lookupsFor(game, u, club, live.userIsHome)
  const opts: SecondHalfOptions | undefined = changes ? { side: live.userIsHome ? 'home' : 'away', talk: changes.talk, tactics: changes.tactics, substitutions: changes.substitutions, shout: changes.shout } : undefined
  if (changes?.tactics) game.tactics = changes.tactics
  const stop = live.mp.clock ?? 45
  const persistSubs = () => {
    const made = live.userIsHome ? live.mp.hSubs : live.mp.aSubs
    for (const s of (changes?.substitutions ?? []).filter((s) => made.some((m) => m.minute === stop && m.off === s.off && m.on === s.on))) {
      const slot = Object.keys(game.lineup).find((k) => game.lineup[k] === s.off)
      if (slot && game.squad[s.on]) {
        game.lineup[slot] = s.on
        game.bench = game.bench.filter((id) => id !== s.on)
        if (!game.bench.includes(s.off)) game.bench.push(s.off)
      }
    }
  }
  if (stop < 70) {
    advanceMatch(live.mp, lookups, opts, 70)
    persistSubs()
    return
  }
  const kickOffXI = kickOff(live.mp, live.userIsHome)
  const res = finishMatch(live.mp, lookups, opts)
  game.live = null
  persistSubs()
  resolveArenaStep(game, u, res, live.mp, live.ctx, kickOffXI, true)
}

/** The men still on the pitch for a side at the whistle: the kick-off XI less substitutes taken off, red cards and injuries. */
function standing(mp: MatchInProgress, side: 'home' | 'away'): Array<{ id: string; keeper: boolean }> {
  return onPitch(mp, side)
    .filter((p) => !p.injury)
    .map((p) => ({ id: p.psId, keeper: p.position === 'GK' }))
}

function pendingShootout(game: Game, u: LoadedUniverse, mp: MatchInProgress, userIsHome: boolean): PendingShootout {
  const get = playerLookup(game, u)
  const ours = standing(mp, userIsHome ? 'home' : 'away')
  const theirs = standing(mp, userIsHome ? 'away' : 'home')
  const defaultOrder = defaultTakers(
    ours.map((p) => p.id),
    get,
    game.tactics.setPieces?.penalties,
  )
  const gk = (id: string) => get(id)?.attributes.goalkeeping ?? 0
  const inGoal = ours.find((p) => p.keeper)?.id
  const outfield = ours.map((p) => p.id).filter((id) => id !== inGoal).sort((x, y) => gk(y) - gk(x) || (x < y ? -1 : 1))
  // A keeper from the bench may come on for the shoot-out while one of the five changes is left
  const appeared = new Set((userIsHome ? mp.hLive : mp.aLive).map((p) => p.psId))
  const made = (userIsHome ? mp.hSubs : mp.aSubs).length
  const benchKeepers = made < 5 ? game.bench.filter((id) => !appeared.has(id) && get(id)?.positions[0] === 'GK' && !game.squad[id]?.injury && (game.squad[id]?.suspension ?? 0) <= 0) : []
  const theirIds = theirs.map((p) => p.id)
  const theirKeeper = theirs.find((p) => p.keeper)?.id ?? [...theirIds].sort((x, y) => (u.index[y]?.attributes.goalkeeping ?? 0) - (u.index[x]?.attributes.goalkeeping ?? 0))[0] ?? null
  return { defaultOrder, keepers: [...(inGoal ? [inGoal] : []), ...outfield, ...benchKeepers], theirOrder: defaultTakers(theirIds, (id) => u.index[id]), theirKeeper }
}

/**
 * The whistle has gone: the result goes onto the squad (a red card and every
 * second booking of the run are one-match bans, served by sitting out the
 * next), onto the opponent, into the log. A level match goes to penalties:
 * live, the manager sets the order (`pending`); otherwise at once with the
 * default takers.
 */
export function resolveArenaStep(game: Game, u: LoadedUniverse, res: FullMatchResult, mp: MatchInProgress, ctx: MatchContext, kickOffXI: Set<string>, live: boolean): void {
  const a = game.arena
  if (!a?.next) return
  const key = a.next
  const club = a.clubs[key]
  const info = arenaStepInfo(a)
  const userIsHome = info.home
  const stats = userIsHome ? res.homeStats : res.awayStats
  const gf = userIsHome ? res.homeGoals : res.awayGoals
  const ga = userIsHome ? res.awayGoals : res.homeGoals
  const result: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf === ga ? 'D' : 'L'
  const get = playerLookup(game, u)
  const played = new Set<string>()
  for (const st of stats) {
    const s = game.squad[st.playerSeasonId]
    if (!s) continue
    played.add(st.playerSeasonId)
    const before = s.suspension
    applyMatchToState(s, st, kickOffXI.has(st.playerSeasonId), res.conditionLoss[st.playerSeasonId] ?? 0, ga === 0, res.motmId === st.playerSeasonId, result, get(st.playerSeasonId)?.attributes.workRate)
    // The arena's own card rules replace the league's: a red is one match, so is every second booking of the run
    s.suspension = before
    if (st.yellow) {
      a.yellows[st.playerSeasonId] = (a.yellows[st.playerSeasonId] ?? 0) + 1
      if (a.yellows[st.playerSeasonId] % 2 === 0) s.suspension = Math.max(s.suspension, 1)
    }
    if (st.red) s.suspension = Math.max(s.suspension, 1)
  }
  for (const [id, s] of Object.entries(game.squad)) if (s.suspension > 0 && !played.has(id)) s.suspension -= 1
  game.weekPlayed = [...played]
  if (club) {
    const theirs = userIsHome ? res.awayStats : res.homeStats
    for (const st of theirs) {
      const s = club.state[st.playerSeasonId]
      if (s) applyMatchToState(s, st, true, res.conditionLoss[st.playerSeasonId] ?? 0, gf === 0, res.motmId === st.playerSeasonId, gf > ga ? 'L' : gf === ga ? 'D' : 'W')
    }
  }
  game.lastMatch = res
  game.lastMatchContext = ctx
  game.lastCupMatch = null
  game.lastCupContext = null
  const cs = u.clubSeasonByKey[key]
  const real = cs ? Math.round(teamStrengthOf(u, cs) * 10) / 10 : 0
  const row: ArenaStep = { label: info.label, opponent: key, neutral: info.neutral, home: userIsHome, gf, ga, training: game.training, live, realStrength: real, offset: knockoutOffset([real], game.settings.arena?.field ?? 'giants', game.settings.difficulty) }
  if (res.motmId) row.motmId = res.motmId
  a.log.push(row)
  game.phase = 'match'
  if (gf !== ga) {
    settleStep(game, gf > ga)
    return
  }
  const pending = pendingShootout(game, u, mp, userIsHome)
  if (live) {
    a.pending = { shootout: pending }
    return
  }
  kickPenalties(game, u, pending, pending.defaultOrder, pending.keepers[0])
}

/** The step is decided: on to the next match, or the run is over. */
function settleStep(game: Game, won: boolean): void {
  const a = game.arena!
  const key = a.next!
  a.step += 1
  if (won) delete a.clubs[key]
  if (!won || lastStep(a)) {
    a.over = true
    a.won = won
    a.next = null
  }
}

function kickPenalties(game: Game, u: LoadedUniverse, pending: PendingShootout, order: string[], keeperId: string | undefined, keeperSwap?: { off: string; on: string }): void {
  const a = game.arena!
  const get = playerLookup(game, u)
  const rng = Rng.fromState(game.rngState)
  // The toss decides who kicks first
  const usFirst = rng.chance(0.5)
  const ours = order.map((id) => takerOf(id, get))
  const theirs = (pending.theirOrder.length ? pending.theirOrder : ['none']).map((id) => takerOf(id, (x) => u.index[x]))
  const ourKeeper = keeperId ? (get(keeperId)?.attributes.goalkeeping ?? 30) : 30
  const theirKeeper = pending.theirKeeper ? (u.index[pending.theirKeeper]?.attributes.goalkeeping ?? 30) : 30
  const so = penaltyShootout(rng, usFirst ? { home: ours, away: theirs } : { home: theirs, away: ours }, usFirst ? { home: ourKeeper, away: theirKeeper } : { home: theirKeeper, away: ourKeeper })
  game.rngState = rng.getState()
  const us = usFirst ? so.home : so.away
  const them = usFirst ? so.away : so.home
  const row = a.log[a.log.length - 1]
  row.pens = { us, them, kicks: so.kicks.map((k) => ({ us: (k.side === 'home') === usFirst, takerId: k.takerId, scored: k.scored })), ...(keeperSwap ? { keeperSwap } : {}) }
  delete a.pending
  settleStep(game, us > them)
}

/**
 * The manager's shoot-out: `order` is any of the men on the pitch at 90, in
 * the order they kick (they cycle through it); the keeper is one of them, or
 * a bench keeper while a change is left (that is the change, and it is
 * logged). A changed order or keeper counts as managing by hand.
 */
export function takePenalties(game: Game, u: LoadedUniverse, order: string[], keeperId: string): { ok: boolean; message: string } {
  const a = game.arena
  const pending = a?.pending?.shootout
  if (!a || !pending) return { ok: false, message: 'There is no shoot-out to take.' }
  if (!order.length) return { ok: false, message: 'Name at least one taker.' }
  if (new Set(order).size !== order.length || order.some((id) => !pending.defaultOrder.includes(id))) return { ok: false, message: 'Only the men on the pitch at the whistle can take a kick, once each in the order.' }
  if (!pending.keepers.includes(keeperId)) return { ok: false, message: 'That player cannot go in goal.' }
  let takers = order
  let swap: { off: string; on: string } | undefined
  if (!pending.defaultOrder.includes(keeperId)) {
    // A keeper off the bench replaces the man in goal, who cannot then kick
    const off = pending.keepers[0]
    swap = { off, on: keeperId }
    takers = order.filter((id) => id !== off)
    if (!takers.length) return { ok: false, message: 'Name a taker who stays on the pitch.' }
  }
  if (order.join() !== pending.defaultOrder.join() || keeperId !== pending.keepers[0]) a.handManaged = true
  kickPenalties(game, u, pending, takers, keeperId, swap)
  return { ok: true, message: '' }
}

/**
 * Recovery between two arena matches, for the formats with more than one:
 * the week's recovery scaled by `factor`, the training focus on top, one
 * match off every injury.
 */
export function arenaRecovery(game: Game, u: LoadedUniverse, factor: number): void {
  const get = playerLookup(game, u)
  const t = TRAINING[game.training]
  const played = new Set(game.weekPlayed)
  for (const [id, s] of Object.entries(game.squad)) {
    const p = get(id)
    if (!p) continue
    const before = s.condition
    recoverWeek(s, p, played.has(id), t.recovery)
    s.condition = Math.min(100, before + Math.round((s.condition - before) * factor))
    s.sharpness = Math.max(20, Math.min(100, s.sharpness + t.sharpness))
    s.familiarity = Math.min(100, s.familiarity + t.familiarity)
  }
  for (const club of Object.values(game.arena?.clubs ?? {})) {
    for (const [id, s] of Object.entries(club.state)) {
      const p = u.index[id]
      if (!p) continue
      const before = s.condition
      recoverWeek(s, p, true, 0)
      s.condition = Math.min(100, before + Math.round((s.condition - before) * factor))
    }
  }
  game.weekPlayed = []
}

/** Leaving the match screen: back to the hub, or to the summary when the run is over. Nothing moves while penalties wait. */
export function closeArenaMatch(game: Game): void {
  const a = game.arena
  if (!a || a.pending || game.live) return
  if (a.over) finishArena(game)
  else if (game.phase === 'match') game.phase = 'week'
}

/** How the run ended. */
export function arenaTier(a: Pick<ArenaState, 'won'>): ArenaTier {
  return a.won ? 'WINNERS' : 'RUNNERS-UP'
}

/** Did the user win this step (in 90 minutes or on penalties)? */
export function stepWon(s: ArenaStep): boolean {
  return s.gf > s.ga || (s.gf === s.ga && !!s.pens && s.pens.us > s.pens.them)
}

/** The run is over: achievements, then the summary. */
export function finishArena(game: Game): void {
  const a = game.arena
  if (!a?.over) return
  const unlock = (id: string) => {
    if (!game.unlocked.includes(id)) game.unlocked.push(id)
  }
  if (a.won && a.format === 'cup' && (a.size ?? 2) === 2) unlock('final-whistle')
  if (a.log.some((s) => s.pens && s.pens.us > s.pens.them)) unlock('spot-kick-kings')
  game.phase = 'summary'
}

/** The Best runs entry of a finished run. */
export function arenaRunEntry(game: Game, date: string): ArenaRunEntry | null {
  const a = game.arena
  if (!a?.over) return null
  const last = a.log[a.log.length - 1]
  const s = game.settings
  return {
    id: resultId(game),
    date,
    format: a.format,
    ...(a.size ? { size: a.size } : {}),
    ...(s.arena?.field ? { field: s.arena.field } : {}),
    teamName: s.teamName,
    hostClubId: s.hostClubId,
    seed: s.seed,
    ...(s.arena?.daily ? { daily: true } : {}),
    score: a.log.filter(stepWon).length,
    tier: arenaTier(a),
    goalsFor: a.log.reduce((t, x) => t + x.gf, 0),
    goalsAgainst: a.log.reduce((t, x) => t + x.ga, 0),
    xi: Object.values(game.lineup),
    ...(s.rules.onlyNation ? { nation: s.rules.onlyNation } : {}),
    ...(last && !a.won ? { fellTo: last.opponent } : {}),
    ...(last ? { last: last.opponent } : {}),
  }
}

/** Best runs: grouped by format, then the score, then goal difference; at most 50. */
export function sortArenaRuns(entries: ArenaRunEntry[]): ArenaRunEntry[] {
  return [...entries].sort((x, y) => (x.format === y.format ? 0 : x.format < y.format ? -1 : 1) || (y.size ?? 0) - (x.size ?? 0) || y.score - x.score || y.goalsFor - y.goalsAgainst - (x.goalsFor - x.goalsAgainst)).slice(0, 50)
}

/** A club-season key in words (`Real Madrid 2017-18`), whether or not its league is loaded. */
export function arenaClubName(u: LoadedUniverse, key: string): string {
  const at = key.indexOf('@')
  const season = Number(key.slice(at + 1))
  return at > 0 && Number.isFinite(season) ? clubSeasonName(u, { clubId: clubIdOfKey(key), season }) : key
}

/** Home's line for an arena game in progress. */
export function arenaStatus(game: Game): string {
  const a = game.arena
  if (!a) return ''
  if (game.phase === 'draft') return 'Drafting'
  if (a.over) return a.won ? 'Won the final' : 'Lost the final'
  if (a.pending) return 'Penalties to take'
  return `${arenaStepInfo(a).label} next`
}

/** Everything the arena's share text prints, for a finished run (`arenaShareText`). */
export function arenaShareInput(game: Game, u: LoadedUniverse): ArenaShareInput | null {
  const a = game.arena
  if (!a?.over) return null
  const get = playerLookup(game, u)
  const motmId = a.log[a.log.length - 1]?.motmId
  const s = game.settings
  return {
    mode: arenaFormatLabel(s.arena),
    teamName: s.teamName,
    formationName: getFormation(game.tactics.formationId).name,
    wheel: wheelName(u, s),
    banner: ARENA_TIER_LABEL[arenaTier(a)],
    icon: a.won ? '🏆' : '🥈',
    steps: a.log.map((x, i) => ({ code: arenaStepInfo({ ...a, step: i }).code, gf: x.gf, ga: x.ga, opponent: arenaClubName(u, x.opponent), ...(x.pens ? { pens: { us: x.pens.us, them: x.pens.them } } : {}) })),
    ...(motmId ? { motm: get(motmId)?.name ?? motmId } : {}),
    seed: s.seed,
  }
}
