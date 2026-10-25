import type { Game, QuickResult } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { simulateMatch, type MatchTeamInput } from '@engine/match'
import { aiTeamInput, aiRatingOffset, buildAiClubs, computeTable, generateFixtures, matchweeksFor, positionOf, seasonTier, USER_TEAM } from '@engine/season'
import { autoPickLineup, computeTeamStrength } from '@engine/ratings'
import { getFormation } from '@engine/formations'
import { playerLookup } from './players'

/**
 * 38-0 mode: the drafted XI plays the whole season instantly against the real
 * clubs of the chosen league season. Fixed lineup, default roles, no injuries.
 */
export function runQuickSeason(game: Game, u: LoadedUniverse): void {
  const rng = Rng.fromState(game.rngState)
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
  const user: MatchTeamInput = { teamId: USER_TEAM, teamName: game.settings.teamName, shortName: game.settings.shortName, tactics: game.tactics, lineup, bench, getPlayer: get, getState: () => undefined }
  const strength = computeTeamStrength(game.tactics, lineup, get, () => undefined)

  const ai = buildAiClubs(u, game.settings.leagueId, game.settings.leagueSeason, game.settings.hostClubId)
  const offset = aiRatingOffset(u, ai, game.settings.difficulty ?? 'calibrated')
  const ids = [USER_TEAM, ...Object.keys(ai)]
  const matchweeks = matchweeksFor(ids.length)
  const fixtures = generateFixtures(ids, rng)
  const goals: Record<string, number> = {}
  const ratings: Record<string, { sum: number; n: number }> = {}
  for (const f of fixtures) {
    const userIsHome = f.homeTeamId === USER_TEAM
    const userIsAway = f.awayTeamId === USER_TEAM
    const home = userIsHome ? user : aiTeamInput(u, ai[f.homeTeamId], offset)
    const away = userIsAway ? user : aiTeamInput(u, ai[f.awayTeamId], offset)
    const res = simulateMatch({ rng, home, away, detail: 'summary' })
    f.result = res
    if (userIsHome || userIsAway) {
      for (const st of userIsHome ? res.homeStats : res.awayStats) {
        goals[st.playerSeasonId] = (goals[st.playerSeasonId] ?? 0) + st.goals
        const r = (ratings[st.playerSeasonId] ??= { sum: 0, n: 0 })
        r.sum += st.rating
        r.n++
      }
    }
  }
  const table = computeTable(fixtures, ids)
  const row = table.find((r) => r.teamId === USER_TEAM)!
  const pos = positionOf(table, USER_TEAM)
  const tier = seasonTier(table, USER_TEAM, false, matchweeks)
  const topScorer = Object.entries(goals).sort((a, b) => b[1] - a[1])[0]
  const pots = Object.entries(ratings)
    .filter(([, r]) => r.n >= Math.floor(matchweeks * 0.4))
    .map(([id, r]) => ({ id, avg: r.sum / r.n }))
    .sort((a, b) => b.avg - a.avg)[0]
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
  }
  game.quickResult = quick
  game.lineup = lineup
  game.bench = bench
  game.tier = tier
  if (tier === 'PERFECT') game.unlocked.push('quick-perfect', 'perfect')
  if (pos === 1) game.unlocked.push('champions')
  if (row.points >= 100) game.unlocked.push('centurions')
  if (tier === 'INVINCIBLE' || tier === 'PERFECT') game.unlocked.push('invincible')
  if (pos === 1 && game.settings.rules.hardMode) game.unlocked.push('hard-champions')
  if (pos === 1 && game.settings.rules.onlyClub) game.unlocked.push('one-club-champions')
  if (pos === 1 && game.settings.rules.onlyNation) game.unlocked.push('one-nation-champions')
  game.phase = 'summary'
  game.rngState = rng.getState()
}
