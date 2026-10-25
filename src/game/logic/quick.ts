import type { Game, JanuaryListing, QuickChange, QuickCover, QuickEuropeRun, QuickEuropeTie, QuickGameResult, QuickJanuary, QuickResult } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { simulateMatch, type FullMatchResult, type MatchTeamInput } from '@engine/match'
import type { RngState } from '@engine/rng'
import { aiTeamInput, aiRatingOffset, buildAiClubs, buildContinentalClubs, computeTable, continentalRounds, drawFirstRound, drawNextRound, generateFixtures, matchweeksFor, positionOf, seasonTier, shootout, USER_TEAM, type AiClub } from '@engine/season'
import { autoPickLineup, computeTeamStrength } from '@engine/ratings'
import { getFormation } from '@engine/formations'
import { defaultTactics } from '@engine/tactics'
import type { Fixture, Formation, Lineup, PlayerSeason, Tactics } from '@engine/types'
import { playerLookup } from './players'
import { earnsPointsRecord } from './records'
import { recordUserGames } from './gameByGame'
import { januaryBudget, januaryListings, sameListing } from './january'
import { difficultyOf } from '@engine/draft'
import { applyChange, canPlayFor, fieldXI, injuredThrough, QUICK_CHANGES, quickBenchRule } from './quickBench'

/** A quick season finishing in this place or higher earns the Continental Cup run, when the option is on. */
export const QUICK_EUROPE_PLACES = 4

/** The drafted XI as the quick season fields it: the draft's lineup, every empty slot filled by `autoPickLineup` (no RNG). */
export function quickXI(game: Game, u: LoadedUniverse): { lineup: Lineup; bench: string[] } {
  const d = game.draft!
  const get = playerLookup(game, u)
  const formation = getFormation(game.tactics.formationId)
  const pool = [...Object.values(d.lineup), ...d.bench].map((id) => get(id)!).filter(Boolean)
  const lineup = { ...d.lineup }
  let bench = [...d.bench]
  // If the user never set a lineup (always the case in quick mode), make sure every slot is filled.
  if (Object.keys(lineup).length < formation.slots.length) {
    const auto = autoPickLineup(formation, pool, game.tactics)
    Object.assign(lineup, auto.lineup)
    // A bench player the fill put into the XI is no longer on the bench (one man never holds two places)
    const xi = new Set(Object.values(lineup))
    bench = bench.filter((id) => !xi.has(id))
  }
  return { lineup, bench }
}

/**
 * How many league games the user plays in a quick season: every other club twice. With an odd number of clubs each
 * matchweek holds a bye, so this is two fewer than the matchweeks (36 of 38 with 19 clubs). Pure.
 */
export function quickSeasonGames(u: LoadedUniverse, s: Pick<Game['settings'], 'leagueId' | 'leagueSeason' | 'hostClubId'>): number {
  return 2 * u.clubSeasons.filter((cs) => cs.leagueId === s.leagueId && cs.season === s.leagueSeason && cs.clubId !== s.hostClubId).length
}

/** The user's side in a quick-season match: the XI with the manager's tactics, captain and penalty taker. */
export function quickUserInput(game: Game, lineup: Lineup, bench: string[], tactics: Tactics, captainId: string | undefined, get: (id: string) => PlayerSeason | undefined): MatchTeamInput {
  return { teamId: USER_TEAM, teamName: game.settings.teamName, shortName: game.settings.shortName, tactics, lineup, bench, getPlayer: get, getState: () => undefined, ...(captainId ? { captainId } : {}) }
}

/** Copy of a tactics object that shares nothing with the original (safe to keep beside a live draft). */
function copyTactics(t: Tactics): Tactics {
  return { ...t, roles: { ...t.roles }, ...(t.setPieces ? { setPieces: { ...t.setPieces } } : {}) }
}

interface QuickRun {
  rng: Rng
  get: (id: string) => PlayerSeason | undefined
  ai: Record<string, AiClub>
  offset: number
  ids: string[]
  matchweeks: number
  /** League matchweeks before the January window: half the season. */
  half: number
  fixtures: Fixture[]
  /** The chosen XI and bench: the draft's, then every change and the January deal as the season reaches them. */
  lineup: Lineup
  bench: string[]
  goals: Record<string, number>
  ratings: Record<string, { sum: number; n: number }>
  formation: Formation
  /**
   * A Quick Draft bench with someone on it: injured starters are covered from it, the changes apply, and the match
   * engine is handed no substitutes (the bench plays between games, not in them). Off, the season is played exactly
   * as before benches existed.
   */
  benchOn: boolean
  changes: QuickChange[]
  /** The draft's position rule: who may cover or come into a slot. */
  canPlay: (p: PlayerSeason, position: Formation['slots'][number]['position']) => boolean
  /** Changes applied so far. */
  applied: Array<QuickChange & { outId: string }>
  /** The last matchweek each injured player misses. */
  out: Record<string, number>
  /** Injuries and covers of the user's game in each matchweek, for the results. */
  notes: Record<number, Pick<QuickGameResult, 'injuries' | 'covers'>>
  /** Handed each of the user's games as it is played, with the generator's state just before it (the highlights replay). */
  capture?: (m: ReplayedMatch) => void
}

/** One of the user's quick-season games as the season played it: both sides' inputs, the result and the RNG state it kicked off from. */
export interface ReplayedMatch {
  matchweek: number
  home: MatchTeamInput
  away: MatchTeamInput
  result: FullMatchResult
  before: RngState
}

/** The season's set-up from the game's RNG state: the AI clubs, the calibration, the fixtures (the first draws). */
function startRun(game: Game, u: LoadedUniverse, from: RngState = game.quickStartRng ?? game.rngState): QuickRun {
  // A season with a bench re-runs from where it kicked off when a change is made, never from the state it ended on
  const rng = Rng.fromState(from)
  const get = playerLookup(game, u)
  const { lineup, bench } = quickXI(game, u)
  const ai = buildAiClubs(u, game.settings.leagueId, game.settings.leagueSeason, game.settings.hostClubId)
  const offset = aiRatingOffset(u, ai, game.settings.difficulty ?? 'calibrated')
  const ids = [USER_TEAM, ...Object.keys(ai)]
  const matchweeks = matchweeksFor(ids.length)
  const fixtures = generateFixtures(ids, rng)
  const benchOn = quickBenchRule(game) && bench.length > 0
  return { rng, get, ai, offset, ids, matchweeks, half: matchweeks / 2, fixtures, lineup, bench, goals: {}, ratings: {}, formation: getFormation(game.tactics.formationId), benchOn, changes: benchOn ? game.quickChanges ?? [] : [], canPlay: canPlayFor(game), applied: [], out: {}, notes: {} }
}

/** Whether a player is out injured for matchweek `mw`. */
function isOut(run: QuickRun, id: string, mw: number): boolean {
  return (run.out[id] ?? 0) >= mw
}

/** Apply the changes due by matchweek `mw`, in order; a change that does not fit the squad as it stands then throws. */
function applyDueChanges(run: QuickRun, mw: number): void {
  while (run.applied.length < run.changes.length && run.changes[run.applied.length].from <= mw) {
    const c = run.changes[run.applied.length]
    if (isOut(run, c.inId, c.from)) throw new Error(`${run.get(c.inId)?.name ?? c.inId} is injured`)
    const slot = run.formation.slots.find((s) => s.id === c.slotId)
    const p = run.get(c.inId)
    if (!slot || !p || !run.canPlay(p, slot.position)) throw new Error(`${p?.name ?? c.inId} cannot play ${slot?.position ?? c.slotId}`)
    const next = applyChange(run.lineup, run.bench, c)
    run.lineup = next.lineup
    run.bench = next.bench
    run.applied.push({ ...c, outId: next.outId })
  }
}

/** The tactics and captain one half of the season is played with. */
interface QuickSide {
  tactics: Tactics
  captainId: string | undefined
}

/** The user's side for matchweek `mw`: with a bench, the XI fielded around injuries and no substitutes; without, the XI and bench as drafted. */
function userFor(game: Game, run: QuickRun, side: QuickSide, mw: number): { input: MatchTeamInput; covers: QuickCover[] } {
  if (!run.benchOn) return { input: quickUserInput(game, run.lineup, run.bench, side.tactics, side.captainId, run.get), covers: [] }
  const { lineup, covers } = fieldXI(run.formation, run.lineup, run.bench, (id) => isOut(run, id, mw), run.get, run.canPlay)
  return { input: quickUserInput(game, lineup, [], side.tactics, side.captainId, run.get), covers }
}

/** The user's games so far with each game's injuries and covers. */
function userResults(run: QuickRun): QuickGameResult[] {
  return recordUserGames(run.fixtures, run.ids, USER_TEAM, (id) => run.get(id)?.name).map((r) => {
    const n = run.notes[r.matchweek]
    return n ? { ...r, ...n } : r
  })
}

/**
 * Play the league fixtures of matchweeks `from` to `to` in fixture order, the user as `user`. The fixtures come out of
 * `generateFixtures` in matchweek order, so playing 1 to 19 and then 20 to 38 draws exactly what one loop over all of
 * them draws: the split is where the January window sits.
 */
function playMatchweeks(run: QuickRun, u: LoadedUniverse, game: Game, side: QuickSide, from: number, to: number): void {
  // Without a bench one side plays every game, as it always has
  const fixed = run.benchOn ? null : userFor(game, run, side, from).input
  let mw = -1
  for (const f of run.fixtures) {
    if (f.matchweek < from || f.matchweek > to) continue
    if (f.matchweek !== mw) {
      mw = f.matchweek
      if (run.benchOn) applyDueChanges(run, mw)
    }
    const userIsHome = f.homeTeamId === USER_TEAM
    const userIsAway = f.awayTeamId === USER_TEAM
    let user = fixed
    if (!user && (userIsHome || userIsAway)) {
      const side1 = userFor(game, run, side, mw)
      user = side1.input
      if (side1.covers.length) (run.notes[mw] ??= {}).covers = side1.covers
    }
    const home = userIsHome ? user! : aiTeamInput(u, run.ai[f.homeTeamId], run.offset)
    const away = userIsAway ? user! : aiTeamInput(u, run.ai[f.awayTeamId], run.offset)
    const before = run.capture && (userIsHome || userIsAway) ? run.rng.getState() : null
    const res = simulateMatch({ rng: run.rng, home, away, detail: 'summary' })
    f.result = res
    if (before) run.capture!({ matchweek: f.matchweek, home, away, result: res, before })
    if (userIsHome || userIsAway) {
      for (const st of userIsHome ? res.homeStats : res.awayStats) {
        run.goals[st.playerSeasonId] = (run.goals[st.playerSeasonId] ?? 0) + st.goals
        const r = (run.ratings[st.playerSeasonId] ??= { sum: 0, n: 0 })
        r.sum += st.rating
        r.n++
        // With a bench an injury keeps him out of the next games; without one the quick season has never counted them
        if (run.benchOn && st.injured) {
          run.out[st.playerSeasonId] = Math.max(run.out[st.playerSeasonId] ?? 0, mw + st.injured.weeksOut)
          ;((run.notes[mw] ??= {}).injuries ??= []).push({ id: st.playerSeasonId, out: st.injured.weeksOut })
        }
      }
    }
  }
}

/**
 * What the January window offers at the halfway pause: the position, the budget from it and the XI's value, and the
 * listings. The listings draw from a fork of a copy of the season's RNG, so the season's own stream is untouched and
 * passing on the window replays the season exactly as if there had been no window.
 */
function windowAt(game: Game, u: LoadedUniverse, run: QuickRun): Pick<QuickJanuary, 'afterMatchweek' | 'position' | 'budget' | 'listings'> {
  const table = computeTable(run.fixtures.filter((f) => f.result), run.ids)
  const position = positionOf(table, USER_TEAM)
  const xiValue = Object.values(run.lineup).reduce((s, id) => s + (run.get(id)?.value ?? 0), 0)
  const budget = januaryBudget(position, run.ids.length, xiValue)
  const listings = januaryListings(game, u, run.lineup, budget, run.get, Rng.fromState(run.rng.getState()).fork('january'), run.bench)
  return { afterMatchweek: run.half, position, budget, listings }
}

/**
 * Kick off a quick season with the January window: play the first half with the game's tactics and captain, then stop
 * with the window open (`phase: 'january'`). Nothing is written to `game.rngState`: the whole season, first half
 * included, is played again from the same state by `runQuickSeason` once the window closes.
 */
export function openJanuary(game: Game, u: LoadedUniverse): void {
  const run = startRun(game, u)
  playMatchweeks(run, u, game, { tactics: game.tactics, captainId: game.captainId }, 1, run.half)
  const w = windowAt(game, u, run)
  game.quickJanuary = {
    ...w,
    firstHalf: userResults(run),
    firstHalfTactics: copyTactics(game.tactics),
    ...(game.captainId ? { firstHalfCaptainId: game.captainId } : {}),
  }
  game.lineup = { ...run.lineup }
  game.bench = [...run.bench]
  game.phase = 'january'
}

/**
 * Close the January window with listing `index` (null to pass) and play the season out. The player leaving drops any
 * captaincy or set-piece duty, so the second half never names a man who is gone. No undo: the season is final.
 */
export function closeJanuary(game: Game, u: LoadedUniverse, index: number | null): void {
  const j = game.quickJanuary
  if (!j || game.phase !== 'january') return
  const move = index === null ? null : j.listings[index]
  if (move === undefined) throw new Error('No such January listing')
  j.move = move ? { ...move } : null
  if (move) {
    if (game.captainId === move.outId) delete game.captainId
    const sp = game.tactics.setPieces
    if (sp) for (const k of ['penalties', 'freeKicks', 'corners'] as const) if (sp[k] === move.outId) delete sp[k]
  }
  runQuickSeason(game, u)
}

/**
 * Draw the January window again from the start of the season, with the tactics and captain the first half kicked off
 * with. For a window whose deal no longer replays (league data updated under a save paused in January): the first
 * half and the listings are recomputed on the data now loaded, so the manager is never stuck on a dead window.
 */
export function reopenJanuary(game: Game, u: LoadedUniverse): void {
  const j = game.quickJanuary
  if (!j || game.phase !== 'january') return
  game.tactics = copyTactics(j.firstHalfTactics)
  if (j.firstHalfCaptainId) game.captainId = j.firstHalfCaptainId
  else delete game.captainId
  openJanuary(game, u)
}

/** The quick season's first step after the draft (Quick Draft and the Daily): the tactics screen, with the XI in place. */
export function toKickoff(game: Game, u: LoadedUniverse): void {
  const { lineup, bench } = quickXI(game, u)
  game.lineup = lineup
  game.bench = bench
  game.phase = 'kickoff'
}

/**
 * Kick off from the tactics step: the whole season at once, or the first half up to the January window when the game
 * has one. `skip` puts the default tactics back and clears the captain first.
 */
export function kickOff(game: Game, u: LoadedUniverse, skip = false): void {
  if (game.phase !== 'kickoff') return
  if (skip) {
    game.tactics = defaultTactics(game.tactics.formationId)
    delete game.captainId
  }
  if (game.settings.january) openJanuary(game, u)
  else runQuickSeason(game, u)
}

/**
 * 38-0 mode: the drafted XI plays the whole season against the real clubs of the chosen league season. Fixed lineup,
 * default roles, no injuries, the manager's tactics, captain and penalty taker. When a January window was opened and
 * closed (`game.quickJanuary.move` set, null for a pass) the first half is played with the tactics it kicked off with,
 * the deal is checked against what the window offered and applied, and the second half is played with the current
 * tactics: passing with unchanged tactics gives the very season a run without a window gives.
 */
export function runQuickSeason(game: Game, u: LoadedUniverse): void {
  const startRng = game.quickStartRng ?? game.rngState
  const run = startRun(game, u, startRng)
  const { rng, get, matchweeks } = run
  const j = game.quickJanuary && game.quickJanuary.move !== undefined ? game.quickJanuary : null
  const firstTactics = j ? j.firstHalfTactics : game.tactics
  const firstCaptain = j ? j.firstHalfCaptainId : game.captainId
  const opening = { ...run.lineup }
  const strength = computeTeamStrength(firstTactics, opening, get, () => undefined)
  // The season's unlocks are worked out afresh, so a re-run after a bench change never keeps a stale one
  game.unlocked = game.unlocked.filter((id) => !QUICK_UNLOCKS.includes(id))
  playMatchweeks(run, u, game, { tactics: firstTactics, captainId: firstCaptain }, 1, run.half)
  let deal: JanuaryListing | null = null
  if (j?.move) {
    const offered = windowAt(game, u, run)
    if (!offered.listings.some((l) => sameListing(l, j.move!))) throw new Error('That January deal was not on offer')
    deal = j.move
    run.lineup = { ...run.lineup, [deal.slotId]: deal.playerSeasonId }
  }
  const second: QuickSide = { tactics: game.tactics, captainId: game.captainId }
  playMatchweeks(run, u, game, second, run.half + 1, matchweeks)
  // The European run is played by the XI as the league season left it, injuries still out covered from the bench
  const user = userFor(game, run, second, matchweeks + 1).input
  const { fixtures, ids, goals, ratings } = run
  const table = computeTable(fixtures, ids)
  const row = table.find((r) => r.teamId === USER_TEAM)!
  const pos = positionOf(table, USER_TEAM)
  const tier = seasonTier(table, USER_TEAM, false, matchweeks)
  const topScorer = Object.entries(goals).sort((a, b) => b[1] - a[1])[0]
  const pots = Object.entries(ratings)
    .filter(([, r]) => r.n >= Math.floor(matchweeks * 0.4))
    .map(([id, r]) => ({ id, avg: r.sum / r.n }))
    .sort((a, b) => b.avg - a.avg)[0]
  // The European run draws from a fork of a copy of the stream, after the league: the league season and the RNG state are as without it
  const europe = game.settings.continental && pos <= QUICK_EUROPE_PLACES ? europeanRun(game, u, run, user, Rng.fromState(rng.getState()).fork('continental')) : null
  const quick: QuickResult = {
    points: row.points,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    position: pos,
    tier,
    table: table.map((r) => ({ teamId: r.teamId, points: r.points, won: r.won, drawn: r.drawn, lost: r.lost, goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst })),
    topScorer: topScorer ? { playerSeasonId: topScorer[0], goals: topScorer[1] } : undefined,
    pots: pots ? { playerSeasonId: pots.id, rating: Math.round(pots.avg * 100) / 100 } : undefined,
    strength: { overall: strength.overall, goalkeeping: strength.goalkeeping, defence: strength.defence, midfield: strength.midfield, attack: strength.attack, balance: strength.balance, chemistry: strength.chemistry },
    // Game by game, from the fixtures already played: no random numbers are drawn here
    results: userResults(run),
    ...(deal ? { january: { kind: deal.kind, inId: deal.playerSeasonId, inName: get(deal.playerSeasonId)?.name ?? deal.playerSeasonId, outId: deal.outId, outName: get(deal.outId)?.name ?? deal.outId, fee: deal.fee, slotId: deal.slotId } } : {}),
    ...(europe ? { europe } : {}),
    ...(run.applied.length ? { changes: run.applied } : {}),
    startRng: { ...startRng },
  }
  game.quickResult = quick
  game.lineup = run.lineup
  game.bench = run.bench
  game.tier = tier
  if (tier === 'PERFECT') game.unlocked.push('quick-perfect', 'perfect')
  if (pos === 1) game.unlocked.push('champions')
  if (row.points >= 100) game.unlocked.push('centurions')
  if (tier === 'INVINCIBLE' || tier === 'PERFECT') game.unlocked.push('invincible')
  if (pos === 1 && difficultyOf(game.settings.rules) === 'hard') game.unlocked.push('hard-champions')
  if (pos === 1 && game.settings.rules.onlyClub) game.unlocked.push('one-club-champions')
  if (pos === 1 && game.settings.rules.onlyNation) game.unlocked.push('one-nation-champions')
  if (earnsPointsRecord(u, game.settings.leagueId, game.settings.difficulty, row, matchweeks, false)) game.unlocked.push('record-points')
  if (europe?.reached === 'W') game.unlocked.push('continental')
  game.phase = 'summary'
  if (run.benchOn) {
    // Open to bench changes while the playback runs; the store records the result when it closes
    game.quickStartRng = game.quickStartRng ?? game.rngState
    game.quickOpen = true
  }
  game.rngState = rng.getState()
}

/** Every achievement a quick season can unlock (`runQuickSeason` works them out again on each run). */
export const QUICK_UNLOCKS: readonly string[] = ['quick-perfect', 'perfect', 'champions', 'centurions', 'invincible', 'hard-champions', 'one-club-champions', 'one-nation-champions', 'record-points', 'continental']

/**
 * A short Continental Cup after the league: the user and the fifteen strongest clubs of the other loaded leagues that
 * season (`buildContinentalClubs`), drawn by `drawFirstRound`, four single-match rounds (round of 16 to a neutral
 * final), a shoot-out after a draw, the AI clubs handicapped like the league's. The run stops when the user goes out.
 * Null when fewer than fifteen foreign clubs are loaded.
 */
function europeanRun(game: Game, u: LoadedUniverse, run: QuickRun, user: MatchTeamInput, rng: Rng): QuickEuropeRun | null {
  const s = game.settings
  const clubs = buildContinentalClubs(u, s.leagueId, s.leagueSeason, s.hostClubId, 15)
  if (Object.keys(clubs).length < 15) return null
  const rounds = continentalRounds(run.matchweeks)
  const ties = drawFirstRound([USER_TEAM, ...Object.keys(clubs)], rng, rounds)
  const mine: QuickEuropeTie[] = []
  for (let r = 0; r < rounds.length; r++) {
    const round = rounds[r].round
    let out = false
    for (const tie of ties.filter((t) => t.round === round)) {
      const home = tie.homeTeamId === USER_TEAM ? user : aiTeamInput(u, clubs[tie.homeTeamId], run.offset)
      const away = tie.awayTeamId === USER_TEAM ? user : aiTeamInput(u, clubs[tie.awayTeamId], run.offset)
      const res = simulateMatch({ rng, home, away, neutral: round === 'F', detail: 'summary' })
      let winner = res.homeGoals > res.awayGoals ? tie.homeTeamId : res.awayGoals > res.homeGoals ? tie.awayTeamId : null
      let pens: { home: number; away: number } | undefined
      if (!winner) {
        pens = shootout(rng, res.homeReport.strength.overall, res.awayReport.strength.overall)
        winner = pens.home > pens.away ? tie.homeTeamId : tie.awayTeamId
      }
      tie.result = { ...res, penalties: pens }
      tie.winnerId = winner
      const home1 = tie.homeTeamId === USER_TEAM
      if (home1 || tie.awayTeamId === USER_TEAM) {
        mine.push({ round, opponentId: home1 ? tie.awayTeamId : tie.homeTeamId, home: home1, gf: home1 ? res.homeGoals : res.awayGoals, ga: home1 ? res.awayGoals : res.homeGoals, ...(pens ? { pens: home1 ? { for: pens.home, against: pens.away } : { for: pens.away, against: pens.home } } : {}), won: winner === USER_TEAM })
        if (winner !== USER_TEAM) out = true
      }
    }
    if (out || r === rounds.length - 1) break
    ties.push(...drawNextRound(ties, rounds[r + 1].round, rng, rounds))
  }
  const last = mine.at(-1)
  if (!last) return null
  return { ties: mine, reached: last.round === 'F' && last.won ? 'W' : last.round }
}

/** What the bench panel of the playback shows before the next game: the chosen XI and bench, who is out, who covers. */
export interface QuickSquadView {
  /** The XI as chosen (the draft's, the changes and the January deal so far), before injury cover. */
  lineup: Lineup
  bench: string[]
  /** Players out injured for the next game. */
  out: string[]
  /** The injured starters the bench will cover in the next game. */
  covers: QuickCover[]
  changesLeft: number
  /** The matchweek of the next game, null once every game is shown. */
  next: number | null
}

/**
 * The squad before game `revealed + 1` of `results` (the games the playback shows), folded from the draft, the
 * changes due by then and the January deal, with the injuries of the games already shown. Pure.
 */
export function quickSquadAt(game: Game, u: LoadedUniverse, results: QuickGameResult[], revealed: number): QuickSquadView {
  const start = quickXI(game, u)
  let lineup = start.lineup
  let bench = start.bench
  const next = revealed < results.length ? results[revealed].matchweek : null
  const upTo = next ?? Infinity
  const j = game.quickJanuary
  let deal = j?.move ?? null
  const half = j?.afterMatchweek ?? Infinity
  const takeDeal = () => {
    if (deal) lineup = { ...lineup, [deal.slotId]: deal.playerSeasonId }
    deal = null
  }
  const changes = game.quickChanges ?? []
  for (const c of changes) {
    if (c.from > upTo) break
    if (c.from > half) takeDeal()
    try {
      const n = applyChange(lineup, bench, c)
      lineup = n.lineup
      bench = n.bench
    } catch {
      // A change the season could not apply never reached the result either
    }
  }
  if (upTo > half) takeDeal()
  const through = injuredThrough(results, revealed)
  const isOut = (id: string) => next !== null && (through[id] ?? 0) >= next
  const get = playerLookup(game, u)
  const covers = next === null ? [] : fieldXI(getFormation(game.tactics.formationId), lineup, bench, isOut, get, canPlayFor(game)).covers
  return { lineup, bench, out: [...Object.values(lineup), ...bench].filter(isOut), covers, changesLeft: Math.max(0, QUICK_CHANGES - changes.length), next }
}

/**
 * Why a change before game `revealed + 1` cannot be made, or null when it can: the season needs a bench rule and
 * someone on it, a change left, a game still to play, the change after any made before, and (with a January window)
 * a first-half change while the first half plays, a second-half one once the window has closed. Pure.
 */
export function quickChangeProblem(game: Game, u: LoadedUniverse, results: QuickGameResult[], revealed: number, c?: Pick<QuickChange, 'slotId' | 'inId'>): string | null {
  if (!quickBenchRule(game)) return 'This draft has no bench'
  const view = quickSquadAt(game, u, results, revealed)
  if (!view.bench.length) return 'Nobody on the bench'
  if (view.changesLeft <= 0) return `All ${QUICK_CHANGES} changes are used`
  if (view.next === null) return game.phase === 'january' ? 'Make the January call first' : 'The season is over'
  const last = game.quickChanges?.at(-1)
  if (last && view.next < last.from) return 'That game is before your last change'
  const j = game.quickJanuary
  if (game.phase === 'january') {
    if (!j || view.next > j.afterMatchweek) return 'Make the January call first'
  } else if (game.phase === 'summary') {
    if (!game.quickOpen) return 'The season is closed'
    if (j && j.move !== undefined && view.next <= j.afterMatchweek) return 'The first half is done'
  } else return 'No season is being played'
  if (c) {
    if (!view.bench.includes(c.inId)) return 'That player is not on the bench'
    if (!view.lineup[c.slotId]) return 'No starter in that slot'
    const p = playerLookup(game, u)(c.inId)
    if (view.out.includes(c.inId)) return `${p?.name ?? 'He'} is injured`
    const slot = getFormation(game.tactics.formationId).slots.find((s) => s.id === c.slotId)
    if (!p || !slot || !canPlayFor(game)(p, slot.position)) return `${p?.name ?? 'He'} cannot play ${slot?.position ?? 'there'}`
  }
  return null
}

/**
 * Make a bench change before game `revealed + 1` of the playback: the bench player `inId` takes slot `slotId` from
 * that game's matchweek on. The season is played again from where it kicked off with the change in, so every game
 * already shown comes out the same. In January's first half the window is drawn again; after the season, the result.
 */
export function makeQuickChange(game: Game, u: LoadedUniverse, results: QuickGameResult[], revealed: number, slotId: string, inId: string): void {
  const problem = quickChangeProblem(game, u, results, revealed, { slotId, inId })
  if (problem) throw new Error(problem)
  const from = results[revealed].matchweek
  game.quickChanges = [...(game.quickChanges ?? []), { from, slotId, inId }]
  if (game.phase === 'january') reopenJanuary(game, u)
  else runQuickSeason(game, u)
}

/** The playback of a season with a bench has closed: no more changes, the result stands. */
export function closeQuickSeason(game: Game): void {
  delete game.quickOpen
}

/** The games the playback runs over: the first half while the January window is open, else the whole season. */
export function playbackResults(game: Game): QuickGameResult[] {
  return game.phase === 'january' ? game.quickJanuary?.firstHalf ?? [] : game.quickResult?.results ?? []
}

/**
 * The RNG state the quick season on show kicked off from, or null on a save written before it was kept: while the
 * January window is open the season has not moved the game's state yet.
 */
export function quickSeasonStart(game: Game): RngState | null {
  if (game.phase === 'january') return game.quickStartRng ?? game.rngState
  return game.quickResult?.startRng ?? game.quickStartRng ?? null
}

/**
 * Play the quick season on show again, from where it kicked off, up to the user's game of matchweek `matchweek`, and
 * hand that game back as it was played: the same sides, tactics, January deal and bench changes, so the same score.
 * Nothing on `game` changes. Null when the season's start state was not kept or the user had no game that matchweek.
 */
export function replayUserMatch(game: Game, u: LoadedUniverse, matchweek: number): ReplayedMatch | null {
  const start = quickSeasonStart(game)
  if (!start) return null
  const run = startRun(game, u, start)
  let found: ReplayedMatch | null = null
  run.capture = (m) => {
    if (m.matchweek === matchweek) found = m
  }
  const j = game.quickJanuary
  // The first half was played with the tactics it kicked off with once a window opened, whatever the window changed
  const first: QuickSide = j ? { tactics: j.firstHalfTactics, captainId: j.firstHalfCaptainId } : { tactics: game.tactics, captainId: game.captainId }
  playMatchweeks(run, u, game, first, 1, Math.min(run.half, matchweek))
  if (found || matchweek <= run.half || game.phase === 'january') return found
  if (j?.move) run.lineup = { ...run.lineup, [j.move.slotId]: j.move.playerSeasonId }
  playMatchweeks(run, u, game, { tactics: game.tactics, captainId: game.captainId }, run.half + 1, Math.min(run.matchweeks, matchweek))
  return found
}
