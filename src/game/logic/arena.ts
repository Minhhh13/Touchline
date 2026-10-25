/**
 * The arena: one-sitting knockouts against real club-seasons, played beside a
 * season rather than inside one. Three formats: a one-off cup final (draft 16,
 * manage one final to the last kick), the Cup (draft 16, a knockout of 8, 16
 * or 32 clubs with seeded draws and the ties between AI sides played around
 * yours) and the Gauntlet (draft 14, climb a ladder of fifteen ever stronger
 * club-seasons until the first defeat).
 *
 * Seed streams (`ArenaState.streams`, seeded in `createGame`) draw the field,
 * so everyone on a seed meets the same opponents whatever they drafted; the
 * user's own matches and shoot-outs draw from `game.rngState`.
 */
import type { ArenaRunEntry, ArenaSettings, ArenaState, ArenaStep, Game, GameSettings, MatchContext, PendingShootout } from '../types'
import { seasonLabel, type LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { autoDraft, picksMade, QUICK_RULES } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { advanceMatch, beginMatch, finishMatch, onPitch, type FullMatchResult, type LiveChanges, type MatchInProgress, type MatchOptions, type MatchTeamInput, type SecondHalfOptions, type TeamLookups } from '@engine/match'
import { aiTeamInput, applyMatchToState, newSquadPlayer, recoverWeek, USER_TEAM, userTeamInput, type AiClub } from '@engine/season'
import { TRAINING } from '@engine/training'
import { arenaClub, arenaPool, arenaTierLabel, clubIdOfKey, clubSeasonKey, clubSeasonName, defaultTakers, finalOpponent, knockoutOffset, penaltyShootout, takerOf, teamStrengthOf, type ArenaField, type ArenaTier } from '@engine/knockout'
import { buildLadder, gauntletHome, gauntletImportance, gauntletOffset, GAUNTLET_RUNGS, GIANT_KILLING, rungLabels } from '@engine/gauntlet'
import { applyArenaResult, changedStates, cupClub, CUP_FIELD_TARGET, cupField, cupImportance, cupRoundCount, cupRoundName, cupSeeds, drawFirstRound, drawNextRound, playAiTie, recoverCupStates, roundTies, userTie, type CupBracket, type CupSize } from '@engine/cup'
import { lastName, type ArenaShareInput } from '@engine/awards'
import type { ClubSeason } from '@engine/types'
import { playerLookup } from './players'
import { autoPick, lineupProblems } from './squad'
import { defaultHostClub } from './setup'
import { arenaFormatLabel } from './modes'
import { resultId } from './cabinet'

/** Players drafted for a one-off final. */
export const FINAL_SQUAD = 16
/** Players drafted for the Gauntlet, before its bonus spins. */
export const GAUNTLET_SQUAD = 14
/** The Gauntlet's bonus spins stop once the squad has this many. */
export const GAUNTLET_SQUAD_CAP = 18
/** Surviving these rungs reopens the draft for one more bench pick. */
export const GAUNTLET_BONUS_AFTER: readonly number[] = [2, 4, 6, 8]
/** The share of a week's recovery the squad gets between two rungs. */
export const GAUNTLET_RECOVERY = 0.8
/** Players drafted for the Cup, whatever its size. */
export const CUP_SQUAD = 16
/** The share of a week's recovery every side gets in the four days between two Cup ties. */
export const CUP_RECOVERY = 0.6
/** The Cup's default size and field. */
export const DEFAULT_CUP_SIZE: CupSize = 16
/** The decade the decade field opens on. */
export const DEFAULT_DECADE = 2010

/** The fields an arena cup can be played against, in the setup's order. */
export const ARENA_FIELDS: ReadonlyArray<{ value: ArenaField; label: string; hint: string }> = [
  { value: 'wheel', label: 'The wheel', hint: 'Club-seasons the wheel could land on, weighted the wheel’s way (a cup takes one season per club)' },
  { value: 'champions', label: 'Champions', hint: 'Real champions of the leagues with a table' },
  { value: 'giants', label: 'Giants', hint: 'The strongest 5% of every club-season in the data. Giants: brutal on Realistic' },
  { value: 'decade', label: 'A decade', hint: 'Club-seasons of one decade with a real team strength of 78 or more' },
  { value: 'europe', label: 'Europe this season', hint: 'The top four of every league in its latest complete season. Loads all seven leagues' },
]

/** The field in a word or two, for the share text and the summary: `Champions`, `The 2010s`. */
export function fieldLabel(a: Pick<ArenaSettings, 'field' | 'decade'> | undefined): string {
  const f = a?.field ?? 'giants'
  if (f === 'decade') return `The ${a?.decade ?? DEFAULT_DECADE}s`
  return f === 'europe' ? 'Europe' : (ARENA_FIELDS.find((x) => x.value === f)?.label ?? f)
}

/** True for a Cup of 8, 16 or 32 clubs (a bracket), false for a one-off final and the Gauntlet. */
export function isBigCup(a: Pick<ArenaState, 'format' | 'size'> | Pick<ArenaSettings, 'format' | 'size'> | undefined | null): boolean {
  return a?.format === 'cup' && (a.size ?? 2) > 2
}

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
  /** Clubs in the cup, the user included: 2 (the default) is the one-off final. */
  size?: CupSize
  /** The decade field's first year. */
  decade?: number
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
    arena: { format: 'cup', size: c.size ?? 2, field: c.field, ...(c.field === 'decade' ? { decade: c.decade ?? DEFAULT_DECADE } : {}) },
  }
}

/** The settings of a Cup: a final's, with 16 picks whatever the size (16 clubs unless another size is chosen). */
export function cupGameSettings(u: LoadedUniverse, c: ArenaChoices, shortName: string): GameSettings {
  return finalGameSettings(u, { ...c, size: c.size ?? DEFAULT_CUP_SIZE }, shortName)
}

/** The settings of a Gauntlet: a final's, with fourteen picks and no field (the ladder comes from the wheel's own leagues and era). */
export function gauntletGameSettings(u: LoadedUniverse, c: Omit<ArenaChoices, 'field'>, shortName: string): GameSettings {
  const s = finalGameSettings(u, { ...c, field: 'wheel' }, shortName)
  return { ...s, rules: { ...s.rules, squadSize: GAUNTLET_SQUAD }, arena: { format: 'gauntlet' } }
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
  const format = s.arena?.format === 'gauntlet' ? 'The Gauntlet up the wheel' : `${arenaFormatLabel(s.arena)} ${field === 'decade' ? `against the ${s.arena?.decade ?? DEFAULT_DECADE}s` : FIELD_WORDS[field]}`
  const parts = [`${s.teamName}, ${getFormation(s.formationId).name}, ${format}, ${wheel}, ${s.difficulty}, seed ${s.seed}`]
  const r = s.rules
  if (r.fromSeason !== undefined || r.toSeason !== undefined) parts.push(`${seasonLabel(r.fromSeason ?? u.firstSeason)} to ${seasonLabel(r.toSeason ?? u.lastSeason)}`)
  if (r.hardMode) parts.push('hard mode')
  if (!r.twists) parts.push('no twists')
  parts.push(`squad of ${r.squadSize}`, `in ${u.clubById[s.hostClubId]?.name ?? s.hostClubId} colours`)
  return parts.join(', ')
}

/** What the next match of a run is: label, the share code, importance, venue. */
export function arenaStepInfo(a: Pick<ArenaState, 'format' | 'size' | 'step' | 'bracket'>): { label: string; code: string; importance: number; neutral: boolean; home: boolean } {
  if (a.format === 'gauntlet') {
    const rung = a.step + 1
    return { label: `Rung ${rung}`, code: `R${rung}`, importance: gauntletImportance(rung), neutral: false, home: gauntletHome(rung) }
  }
  const size = a.size ?? 2
  if (size > 2) {
    // A Cup round: its name and weight; the venue is the draw's coin, the final neutral
    const r = cupRoundName(size, a.step)
    const tie = userTie(a.bracket?.rounds[a.step])
    return { label: r.name, code: r.code, importance: cupImportance(size, a.step), neutral: roundTies(size, a.step) === 1, home: tie ? tie.home === USER_TEAM : true }
  }
  return { label: 'Cup final', code: 'F', importance: 1.4, neutral: true, home: true }
}

/** True when the run has no match after this one. */
function lastStep(a: ArenaState): boolean {
  if (a.format === 'gauntlet') return a.step >= GAUNTLET_RUNGS
  return a.format === 'cup' ? a.step >= cupRoundCount(a.size ?? 2) : true
}

/** The club-season key a Gauntlet rung (1-based) is played against: its main, or its alternate once the lifeline swapped it. */
export function rungOpponent(a: Pick<ArenaState, 'ladder' | 'lifelineUsed'>, rung: number): string | null {
  if (!a.ladder) return null
  return (a.lifelineUsed === rung ? a.ladder.alternates[rung - 1] : a.ladder.mains[rung - 1]) ?? null
}

/** Rating points taken off the opponent of step `step` (0-based) whose real strength is `real`. */
function stepOffset(game: Game, real: number, step: number): number {
  if (game.arena?.bracket) return game.arena.bracket.offset
  return game.arena?.format === 'gauntlet' ? gauntletOffset(real, step + 1, game.settings.difficulty) : knockoutOffset([real], game.settings.arena?.field ?? 'giants', game.settings.difficulty)
}

/**
 * Draw the next opponent: a final draws its one opponent from the field's
 * stream; the Gauntlet reads its ladder and the Cup its bracket (no draw).
 */
function drawNextOpponent(game: Game, u: LoadedUniverse): void {
  const a = game.arena
  if (!a) return
  if (a.bracket) {
    const tie = userTie(a.bracket.rounds[a.step])
    if (!tie) return
    const club = cupClub(u, tie.home === USER_TEAM ? tie.away : tie.home, a.bracket.states)
    a.clubs[club.id] = club
    a.next = club.id
    return
  }
  let cs: ClubSeason | undefined
  if (a.format === 'gauntlet') {
    const key = rungOpponent(a, a.step + 1)
    cs = key ? u.clubSeasonByKey[key] : undefined
    if (!cs) return
  } else {
    const rng = Rng.fromState(a.streams.field)
    const r = game.settings.rules
    const scope = { leagues: fieldLeagues(game, u), fromSeason: r.fromSeason, toSeason: r.toSeason, field: game.settings.arena?.field ?? 'giants', decade: game.settings.arena?.decade }
    // The decade and Europe fields are a Cup's field of one; the others keep the final's own draw
    cs = scope.field === 'decade' || scope.field === 'europe' ? cupField(u, rng, scope, 1)[0] : finalOpponent(u, rng, scope)
    a.streams.field = rng.getState()
  }
  const club = arenaClub(u, cs)
  a.clubs[club.id] = club
  a.next = club.id
}

/** Move the draft into the squad (no contracts), pick the side and draw the field; the run opens on its hub (phase `week`). */
export function beginArena(game: Game, u: LoadedUniverse): void {
  const a = game.arena
  if (!a) return
  const d = game.draft
  if (a.step > 0) {
    // Back from a bonus spin: the new man joins the bench at a new player's state; the side the manager set stays
    for (const id of d ? [...Object.values(d.lineup), ...d.bench] : []) {
      if (game.squad[id]) continue
      game.squad[id] = newSquadPlayer(id)
      game.bench.push(id)
    }
    game.bonusSpins = 0
    game.phase = 'week'
    return
  }
  if (a.format === 'gauntlet' && !a.ladder) {
    // The ladder comes from the field's stream, once: the same fifteen rungs for everyone on the seed
    const rng = Rng.fromState(a.streams.field)
    const r = game.settings.rules
    a.ladder = buildLadder(u, rng, arenaPool(u, { leagues: fieldLeagues(game, u), fromSeason: r.fromSeason, toSeason: r.toSeason }))
    a.streams.field = rng.getState()
  }
  if (isBigCup(a) && !a.bracket) a.bracket = buildBracket(game, u)
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

/** A child of one of the arena's streams; the stream moves on by one draw, so the next fork is a different one. */
function forkStream(game: Game, stream: 'draw' | 'ties', label: string): Rng {
  const a = game.arena!
  const parent = Rng.fromState(a.streams[stream])
  const child = parent.fork(label)
  a.streams[stream] = parent.getState()
  return child
}

/**
 * The Cup's field, seeds and round one, from the streams alone (the draft
 * never enters it): `size − 1` entrants from the field's stream, calibrated
 * as one field, the strongest quarter seeded, and the first draw from a fork
 * of the draw stream.
 */
function buildBracket(game: Game, u: LoadedUniverse): CupBracket {
  const a = game.arena!
  const size = a.size ?? 2
  const r = game.settings.rules
  const field = game.settings.arena?.field ?? 'wheel'
  const rng = Rng.fromState(a.streams.field)
  const entrants = cupField(u, rng, { leagues: fieldLeagues(game, u), fromSeason: r.fromSeason, toSeason: r.toSeason, field, decade: game.settings.arena?.decade }, size - 1)
  a.streams.field = rng.getState()
  const seeds = cupSeeds(u, entrants, size)
  const seeded = new Set(seeds)
  const unseeded = [USER_TEAM, ...entrants.map(clubSeasonKey).filter((k) => !seeded.has(k))]
  const offset = knockoutOffset(
    entrants.map((cs) => teamStrengthOf(u, cs)),
    field,
    game.settings.difficulty,
    CUP_FIELD_TARGET,
  )
  return { seeds, offset, rounds: [drawFirstRound(forkStream(game, 'draw', 'draw:0'), seeds, unseeded)], states: {} }
}

/** Every AI tie of a round, in bracket order, each on its own fork of the ties stream (the user's position is forked too, so where he sits never moves the others). */
function playCupRound(game: Game, u: LoadedUniverse, round: number): void {
  const a = game.arena!
  const b = a.bracket!
  const size = a.size ?? 2
  const ties = b.rounds[round]
  ties.forEach((t, i) => {
    const rng = forkStream(game, 'ties', `${round}:${i}`)
    if (t.winner === undefined) playAiTie(u, rng, t, b, cupImportance(size, round), roundTies(size, round) === 1)
  })
  if (ties.length === 1 && ties[0].winner) b.winner = ties[0].winner
}

/** The next round's draw: the round's winners in bracket order, on a fork of the draw stream. */
function drawCupRound(game: Game, round: number): void {
  const b = game.arena!.bracket!
  const alive = b.rounds[round - 1].map((t) => t.winner).filter((w): w is string => !!w)
  b.rounds.push(drawNextRound(forkStream(game, 'draw', `draw:${round}`), alive))
}

/**
 * The user's tie is decided: it goes into the bracket, the round's other ties
 * are played, and either the four days to the next round pass (recovery for
 * everyone, then the draw) or the user is out (or has won it) and the rest of
 * the bracket is played to its winner.
 */
function settleCupTie(game: Game, u: LoadedUniverse, won: boolean): void {
  const a = game.arena!
  const b = a.bracket!
  const key = a.next!
  const round = a.step
  const tie = userTie(b.rounds[round])
  const row = a.log[a.log.length - 1]
  if (tie && row) {
    const home = tie.home === USER_TEAM
    tie.hg = home ? row.gf : row.ga
    tie.ag = home ? row.ga : row.gf
    if (row.pens) tie.pens = home ? { home: row.pens.us, away: row.pens.them } : { home: row.pens.them, away: row.pens.us }
    tie.winner = won ? USER_TEAM : key
  }
  // The side that beat the user carries its legs and bans on; a beaten side is gone
  const club = a.clubs[key]
  if (!won && club) b.states[key] = changedStates(club)
  else delete b.states[key]
  delete a.clubs[key]
  a.next = null
  a.step += 1
  playCupRound(game, u, round)
  const rounds = cupRoundCount(a.size ?? 2)
  if (won && a.step < rounds) {
    arenaRecovery(game, u, CUP_RECOVERY)
    recoverCupStates(u, b, CUP_RECOVERY)
    drawCupRound(game, a.step)
    drawNextOpponent(game, u)
    return
  }
  a.over = true
  a.won = won
  for (let r = b.rounds.length; !b.winner && r < rounds; r++) {
    recoverCupStates(u, b, CUP_RECOVERY)
    drawCupRound(game, r)
    playCupRound(game, u, r)
  }
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
  return { key: a.next, club, cs, real, offset: stepOffset(game, real, a.step) }
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
  const billing = a.format === 'gauntlet' ? rungLabels(a.step + 1, opp.real).billing : undefined
  const rng = Rng.fromState(game.rngState)
  const t = TRAINING[game.training]
  const boosts = { attack: t.attack, defence: t.defence }
  const user = arenaUserInput(game, u)
  // The opponent plays under its club id, so badges and kits resolve; the arena files it by club and season
  const them: MatchTeamInput = { ...aiTeamInput(u, opp.club, opp.offset), teamId: opp.club.clubId }
  const opts: MatchOptions = { rng, home: info.home ? user : them, away: info.home ? them : user, importance: info.importance, importanceLabel: billing ?? info.label, neutral: info.neutral, detail: 'full', boosts: info.home ? { home: boosts } : { away: boosts } }
  const ctx: MatchContext = { matchweek: a.step + 1, competition: 'arena', roundLabel: info.label, opponentClubId: opp.club.clubId, home: info.home, ...(billing ? { importanceLabel: billing } : {}) }
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
  // The opponent under the arena's card rules too: a Cup side that beats you plays on with them
  if (club) applyArenaResult(club, res, userIsHome ? 'away' : 'home')
  game.lastMatch = res
  game.lastMatchContext = ctx
  game.lastCupMatch = null
  game.lastCupContext = null
  const cs = u.clubSeasonByKey[key]
  const real = cs ? Math.round(teamStrengthOf(u, cs) * 10) / 10 : 0
  const row: ArenaStep = { label: info.label, opponent: key, neutral: info.neutral, home: userIsHome, gf, ga, training: game.training, live, realStrength: real, offset: stepOffset(game, real, a.step) }
  if (res.motmId) row.motmId = res.motmId
  a.log.push(row)
  game.phase = 'match'
  if (gf !== ga) {
    settleStep(game, u, gf > ga)
    return
  }
  const pending = pendingShootout(game, u, mp, userIsHome)
  if (live) {
    a.pending = { shootout: pending }
    return
  }
  kickPenalties(game, u, pending, pending.defaultOrder, pending.keepers[0])
}

/**
 * The step is decided: on to the next match, or the run is over. A Gauntlet
 * rung survived recovers the squad by most of a week and puts the next rung's
 * club in place for the hub.
 */
function settleStep(game: Game, u: LoadedUniverse, won: boolean): void {
  const a = game.arena!
  if (a.bracket) return settleCupTie(game, u, won)
  const key = a.next!
  a.step += 1
  if (won) delete a.clubs[key]
  if (!won || lastStep(a)) {
    a.over = true
    a.won = won
    a.next = null
    return
  }
  if (a.format === 'gauntlet') {
    a.next = null
    arenaRecovery(game, u, GAUNTLET_RECOVERY)
    drawNextOpponent(game, u)
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
  settleStep(game, u, us > them)
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

/** True when leaving this match opens a Gauntlet bonus spin: rungs 2, 4, 6 and 8 survived, the squad under 18. */
export function bonusSpinDue(game: Pick<Game, 'arena' | 'draft' | 'phase'>): boolean {
  const a = game.arena
  return !!a && a.format === 'gauntlet' && !a.over && !a.pending && game.phase === 'match' && !!game.draft && GAUNTLET_BONUS_AFTER.includes(a.step) && picksMade(game.draft) < GAUNTLET_SQUAD_CAP
}

/**
 * Leaving the match screen: back to the hub, to a bonus spin, or to the
 * summary when the run is over. Nothing moves while penalties wait. A bonus
 * spin reopens the run's own draft for one more pick: the rules are copied
 * (`createGame` hands `settings.rules` to the draft by reference), so the
 * settings keep the squad size the run started with.
 */
export function closeArenaMatch(game: Game): void {
  const a = game.arena
  if (!a || a.pending || game.live) return
  if (a.over) finishArena(game)
  else if (bonusSpinDue(game)) {
    const d = game.draft!
    d.rules = { ...d.rules, squadSize: picksMade(d) + 1 }
    game.bonusSpins = 1
    game.phase = 'draft'
  } else if (game.phase === 'match') game.phase = 'week'
}

/** The match screen's continue label: penalties first, the summary, a bonus spin or the next round. */
export function arenaContinueLabel(game: Pick<Game, 'arena' | 'draft' | 'phase'>): string {
  const a = game.arena
  if (!a) return ''
  if (a.pending) return 'Penalties first'
  if (a.over) return 'Run summary →'
  if (bonusSpinDue(game)) return 'Bonus spin →'
  return `Next: ${arenaStepInfo(a).label} →`
}

/** Change the draw: once a run, before a Gauntlet rung, its main is swapped for its alternate. */
export function changeTheDraw(game: Game, u: LoadedUniverse): { ok: boolean; message: string } {
  const a = game.arena
  if (!a || a.format !== 'gauntlet' || !a.ladder) return { ok: false, message: 'Only the Gauntlet has a lifeline.' }
  if (a.over || a.pending || game.live || game.phase !== 'week') return { ok: false, message: 'The draw can only change before a rung.' }
  if (a.lifelineUsed !== undefined) return { ok: false, message: `The lifeline was used at rung ${a.lifelineUsed}.` }
  const rung = a.step + 1
  if (a.next) delete a.clubs[a.next]
  a.next = null
  a.lifelineUsed = rung
  drawNextOpponent(game, u)
  return { ok: true, message: '' }
}

/**
 * Sim to the end: the assistant plays every rung (or match) left, penalties
 * included, and drafts every bonus spin with `autoDraft` on `rngState`. Ends
 * on the summary.
 */
export function simArenaToEnd(game: Game, u: LoadedUniverse): void {
  const a = game.arena
  if (!a || game.live || a.pending) return
  for (let guard = 0; guard < 4 * GAUNTLET_RUNGS && game.phase !== 'summary'; guard++) {
    if (game.phase === 'draft') {
      const d = game.draft
      if (!d) break
      const rng = Rng.fromState(game.rngState)
      autoDraft(u, d, rng)
      game.rngState = rng.getState()
      beginArena(game, u)
      continue
    }
    if (game.phase === 'week' && !a.over) playArenaStep(game, u, false)
    closeArenaMatch(game)
    if (a.pending) break
  }
}

/** How the run ended: a Cup by the round it ended in (the round's name, its first round however big the cup). */
export function arenaTier(a: Pick<ArenaState, 'won' | 'format' | 'size' | 'log'>): ArenaTier {
  if (a.format === 'gauntlet') return a.won ? 'GAUNTLET COMPLETE' : 'RUNGS'
  const size = a.size ?? 2
  if (size > 2) {
    if (a.won) return 'CUP WINNERS'
    const ties = roundTies(size, Math.max(0, a.log.length - 1))
    return ties === 1 ? 'FINALISTS' : ties === 2 ? 'SEMI-FINALISTS' : ties === 4 ? 'QUARTER-FINALISTS' : ties === 8 ? 'OUT IN THE ROUND OF 16' : 'OUT IN THE FIRST ROUND'
  }
  return a.won ? 'WINNERS' : 'RUNNERS-UP'
}

/** The banner of a run: `WINNERS`, `7 RUNGS`, `GAUNTLET COMPLETE`, `SEMI-FINALISTS`. */
export function arenaBanner(a: Pick<ArenaState, 'won' | 'format' | 'size' | 'log'>): string {
  return arenaTierLabel(arenaTier(a), a.log.filter(stepWon).length)
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
  if (a.won && isBigCup(a)) {
    unlock('cup-night')
    if (a.size === 32) unlock('cup-32')
    if (game.settings.arena?.field === 'giants') unlock('giant-slayers')
    if (a.log.every((s) => s.ga === 0)) unlock('clean-run')
  }
  if (a.log.some((s) => s.pens && s.pens.us > s.pens.them)) unlock('spot-kick-kings')
  if (a.format === 'gauntlet') {
    const rungs = a.log.filter(stepWon).length
    if (rungs >= 5) unlock('gauntlet-5')
    if (rungs >= 10) unlock('gauntlet-10')
    if (rungs >= GAUNTLET_RUNGS) unlock('gauntlet-15')
  }
  if (game.settings.difficulty === 'realistic' && a.log.some((s) => stepWon(s) && s.realStrength >= GIANT_KILLING)) unlock('giant-killer')
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

/** A club-season key in fewer letters, for the bracket: the club's short name and the season (`Wolves 2022-23`). */
export function arenaClubShortName(u: LoadedUniverse, key: string): string {
  const at = key.indexOf('@')
  const season = Number(key.slice(at + 1))
  const club = u.clubById[clubIdOfKey(key)]
  return at > 0 && Number.isFinite(season) && club ? `${club.shortName ?? club.name} ${seasonLabel(season)}` : arenaClubName(u, key)
}

/** Home's line for an arena game in progress. */
export function arenaStatus(game: Game): string {
  const a = game.arena
  if (!a) return ''
  if (game.phase === 'draft') return a.step > 0 ? 'Bonus spin' : 'Drafting'
  if (a.format === 'gauntlet' && a.over) return a.won ? 'Gauntlet complete' : `Climbed ${arenaBanner(a).toLowerCase()}`
  if (isBigCup(a) && a.over) return a.won ? 'Lifted the Cup' : sentence(arenaBanner(a))
  if (a.over) return a.won ? 'Won the final' : 'Lost the final'
  if (a.pending) return 'Penalties to take'
  return `${arenaStepInfo(a).label} next`
}

function sentence(caps: string): string {
  const lower = caps.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** The side that won a Cup, in words: the user's team or `Real Madrid 2017-18`; null until decided. */
export function cupWinnerName(game: Game, u: LoadedUniverse): string | null {
  const w = game.arena?.bracket?.winner
  if (!w) return null
  return w === USER_TEAM ? game.settings.teamName : arenaClubName(u, w)
}

/** Everything the arena's share text prints, for a finished run (`arenaShareText`). */
export function arenaShareInput(game: Game, u: LoadedUniverse): ArenaShareInput | null {
  const a = game.arena
  if (!a?.over) return null
  const get = playerLookup(game, u)
  const motmId = a.log[a.log.length - 1]?.motmId
  const s = game.settings
  if (isBigCup(a)) {
    // The Cup: a line per tie, the winner when you went out before the final (a lost final names him already), and the final's man of the match when you reached it
    const inFinal = a.log.length === cupRoundCount(a.size ?? 2)
    const winner = cupWinnerName(game, u)
    return {
      mode: `${arenaFormatLabel(s.arena)} · ${fieldLabel(s.arena)}`,
      teamName: s.teamName,
      formationName: getFormation(game.tactics.formationId).name,
      wheel: wheelName(u, s),
      banner: arenaBanner(a),
      icon: a.won ? '🏆' : inFinal ? '🥈' : '🏟️',
      steps: a.log.map((x, i) => ({ code: arenaStepInfo({ ...a, step: i }).code, gf: x.gf, ga: x.ga, opponent: arenaClubName(u, x.opponent), ...(x.pens ? { pens: { us: x.pens.us, them: x.pens.them } } : {}) })),
      ...(!a.won && !inFinal && winner ? { lines: [`🏆 Won by ${winner}`] } : {}),
      ...(inFinal && motmId ? { motm: get(motmId)?.name ?? motmId, motmLabel: 'Final MOTM' } : {}),
      seed: s.seed,
    }
  }
  return {
    mode: arenaFormatLabel(s.arena),
    teamName: s.teamName,
    formationName: getFormation(game.tactics.formationId).name,
    wheel: wheelName(u, s),
    banner: arenaBanner(a),
    icon: a.format === 'gauntlet' ? (a.won ? '🏔️' : '🪜') : a.won ? '🏆' : '🥈',
    steps: a.log.map((x, i) => ({ code: arenaStepInfo({ ...a, step: i }).code, gf: x.gf, ga: x.ga, opponent: arenaClubName(u, x.opponent), ...(x.pens ? { pens: { us: x.pens.us, them: x.pens.them } } : {}) })),
    ...(a.format === 'gauntlet' ? { strip: a.log.map(rungMark).join(''), lines: gauntletLines(game, u) } : motmId ? { motm: get(motmId)?.name ?? motmId } : {}),
    seed: s.seed,
  }
}

/** A Gauntlet rung as the strip marks it: 🟩 won in 90 minutes, 🟨 won on penalties, 🟥 the defeat (a lost shoot-out included). */
export function rungMark(s: ArenaStep): string {
  return !stepWon(s) ? '🟥' : s.gf > s.ga ? '🟩' : '🟨'
}

/** The run's top scorer and most frequent man of the match among the user's squad, for the Gauntlet's share line. */
export function runHeroes(game: Game, u: LoadedUniverse): { scorer?: { name: string; goals: number }; star?: string } {
  const get = playerLookup(game, u)
  const ids = Object.keys(game.squad).sort()
  const stats = (id: string) => game.squad[id].seasonStats
  const scorerId = ids.filter((id) => stats(id).goals > 0).sort((x, y) => stats(y).goals - stats(x).goals || stats(y).motm - stats(x).motm)[0]
  const starId = ids.filter((id) => stats(id).motm > 0).sort((x, y) => stats(y).motm - stats(x).motm || stats(y).goals - stats(x).goals)[0]
  return { ...(scorerId ? { scorer: { name: get(scorerId)?.name ?? scorerId, goals: stats(scorerId).goals } } : {}), ...(starId ? { star: get(starId)?.name ?? starId } : {}) }
}

/** The Gauntlet's lines under the strip: where it ended, then `⚽ Haaland 6 · ⭐ De Bruyne`. */
export function gauntletLines(game: Game, u: LoadedUniverse): string[] {
  const a = game.arena
  if (!a) return []
  const last = a.log[a.log.length - 1]
  const lines: string[] = []
  if (a.won) lines.push(`Climbed all ${GAUNTLET_RUNGS} rungs`)
  else if (last) lines.push(`Fell to ${arenaClubName(u, last.opponent)} at rung ${a.log.length}, ${last.gf}-${last.ga}${last.pens ? ` (${last.pens.us}-${last.pens.them} pens)` : ''}`)
  const h = runHeroes(game, u)
  const hero = [h.scorer ? `⚽ ${lastName(h.scorer.name)} ${h.scorer.goals}` : '', h.star ? `⭐ ${lastName(h.star)}` : ''].filter(Boolean).join(' · ')
  if (hero) lines.push(hero)
  return lines
}
