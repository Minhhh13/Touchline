import type { Game, JanuaryListing, QuickEuropeRun, QuickEuropeTie, QuickJanuary, QuickResult } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { simulateMatch, type MatchTeamInput } from '@engine/match'
import { aiTeamInput, aiRatingOffset, buildAiClubs, buildContinentalClubs, computeTable, continentalRounds, drawFirstRound, drawNextRound, generateFixtures, matchweeksFor, positionOf, seasonTier, shootout, USER_TEAM, type AiClub } from '@engine/season'
import { autoPickLineup, computeTeamStrength } from '@engine/ratings'
import { getFormation } from '@engine/formations'
import { defaultTactics } from '@engine/tactics'
import type { Fixture, Lineup, PlayerSeason, Tactics } from '@engine/types'
import { playerLookup } from './players'
import { earnsPointsRecord } from './records'
import { recordUserGames } from './gameByGame'
import { januaryBudget, januaryListings, sameListing } from './january'
import { difficultyOf } from '@engine/draft'

/** A quick season finishing in this place or higher earns the Continental Cup run, when the option is on. */
export const QUICK_EUROPE_PLACES = 4

/** The drafted XI as the quick season fields it: the draft's lineup, every empty slot filled by `autoPickLineup` (no RNG). */
export function quickXI(game: Game, u: LoadedUniverse): { lineup: Lineup; bench: string[] } {
  const d = game.draft!
  const get = playerLookup(game, u)
  const formation = getFormation(game.tactics.formationId)
  const pool = [...Object.values(d.lineup), ...d.bench].map((id) => get(id)!).filter(Boolean)
  const lineup = { ...d.lineup }
  const bench = [...d.bench]
  // If the user never set a lineup (always the case in quick mode), make sure every slot is filled.
  if (Object.keys(lineup).length < formation.slots.length) {
    const auto = autoPickLineup(formation, pool, game.tactics)
    Object.assign(lineup, auto.lineup)
  }
  return { lineup, bench }
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
  lineup: Lineup
  bench: string[]
  goals: Record<string, number>
  ratings: Record<string, { sum: number; n: number }>
}

/** The season's set-up from the game's RNG state: the AI clubs, the calibration, the fixtures (the first draws). */
function startRun(game: Game, u: LoadedUniverse): QuickRun {
  const rng = Rng.fromState(game.rngState)
  const get = playerLookup(game, u)
  const { lineup, bench } = quickXI(game, u)
  const ai = buildAiClubs(u, game.settings.leagueId, game.settings.leagueSeason, game.settings.hostClubId)
  const offset = aiRatingOffset(u, ai, game.settings.difficulty ?? 'calibrated')
  const ids = [USER_TEAM, ...Object.keys(ai)]
  const matchweeks = matchweeksFor(ids.length)
  const fixtures = generateFixtures(ids, rng)
  return { rng, get, ai, offset, ids, matchweeks, half: matchweeks / 2, fixtures, lineup, bench, goals: {}, ratings: {} }
}

/**
 * Play the league fixtures of matchweeks `from` to `to` in fixture order, the user as `user`. The fixtures come out of
 * `generateFixtures` in matchweek order, so playing 1 to 19 and then 20 to 38 draws exactly what one loop over all of
 * them draws: the split is where the January window sits.
 */
function playMatchweeks(run: QuickRun, u: LoadedUniverse, user: MatchTeamInput, from: number, to: number): void {
  for (const f of run.fixtures) {
    if (f.matchweek < from || f.matchweek > to) continue
    const userIsHome = f.homeTeamId === USER_TEAM
    const userIsAway = f.awayTeamId === USER_TEAM
    const home = userIsHome ? user : aiTeamInput(u, run.ai[f.homeTeamId], run.offset)
    const away = userIsAway ? user : aiTeamInput(u, run.ai[f.awayTeamId], run.offset)
    const res = simulateMatch({ rng: run.rng, home, away, detail: 'summary' })
    f.result = res
    if (userIsHome || userIsAway) {
      for (const st of userIsHome ? res.homeStats : res.awayStats) {
        run.goals[st.playerSeasonId] = (run.goals[st.playerSeasonId] ?? 0) + st.goals
        const r = (run.ratings[st.playerSeasonId] ??= { sum: 0, n: 0 })
        r.sum += st.rating
        r.n++
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
  const listings = januaryListings(game, u, run.lineup, budget, run.get, Rng.fromState(run.rng.getState()).fork('january'))
  return { afterMatchweek: run.half, position, budget, listings }
}

/**
 * Kick off a quick season with the January window: play the first half with the game's tactics and captain, then stop
 * with the window open (`phase: 'january'`). Nothing is written to `game.rngState`: the whole season, first half
 * included, is played again from the same state by `runQuickSeason` once the window closes.
 */
export function openJanuary(game: Game, u: LoadedUniverse): void {
  const run = startRun(game, u)
  playMatchweeks(run, u, quickUserInput(game, run.lineup, run.bench, game.tactics, game.captainId, run.get), 1, run.half)
  const w = windowAt(game, u, run)
  game.quickJanuary = {
    ...w,
    firstHalf: recordUserGames(run.fixtures, run.ids, USER_TEAM, (id) => run.get(id)?.name),
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
  const run = startRun(game, u)
  const { rng, get, matchweeks } = run
  const j = game.quickJanuary && game.quickJanuary.move !== undefined ? game.quickJanuary : null
  const firstTactics = j ? j.firstHalfTactics : game.tactics
  const firstCaptain = j ? j.firstHalfCaptainId : game.captainId
  const opening = { ...run.lineup }
  const strength = computeTeamStrength(firstTactics, opening, get, () => undefined)
  playMatchweeks(run, u, quickUserInput(game, run.lineup, run.bench, firstTactics, firstCaptain, get), 1, run.half)
  let deal: JanuaryListing | null = null
  if (j?.move) {
    const offered = windowAt(game, u, run)
    if (!offered.listings.some((l) => sameListing(l, j.move!))) throw new Error('That January deal was not on offer')
    deal = j.move
    run.lineup = { ...run.lineup, [deal.slotId]: deal.playerSeasonId }
  }
  const user = quickUserInput(game, run.lineup, run.bench, game.tactics, game.captainId, get)
  playMatchweeks(run, u, user, run.half + 1, matchweeks)
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
    results: recordUserGames(fixtures, ids, USER_TEAM, (id) => get(id)?.name),
    ...(deal ? { january: { kind: deal.kind, inId: deal.playerSeasonId, inName: get(deal.playerSeasonId)?.name ?? deal.playerSeasonId, outId: deal.outId, outName: get(deal.outId)?.name ?? deal.outId, fee: deal.fee, slotId: deal.slotId } } : {}),
    ...(europe ? { europe } : {}),
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
  game.rngState = rng.getState()
}

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
