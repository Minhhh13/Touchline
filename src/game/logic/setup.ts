import type { Game, GameSettings } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { newDraft } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { defaultTactics } from '@engine/tactics'
import { newSquadPlayer, buildAiClubs, buildContinentalClubs, continentalRounds, drawFirstRound, generateFixtures, drawFirstCupRound, USER_TEAM, boardTargetFor, aiTeamInput, aiRatingOffset, matchweeksFor, type ContinentalState } from '@engine/season'
import { startingFinances } from '@engine/market'
import { computeTeamStrength } from '@engine/ratings'
import { autoPick, squadWages, teamStrength } from './squad'
import { buildYouthIntake } from './youth'
import { pickObjectives, OBJECTIVE_REWARD } from '@engine/objectives'
import { playerLookup } from './players'

export function createGame(settings: GameSettings): Game {
  const rng = new Rng(settings.seed)
  const formation = getFormation(settings.formationId)
  return {
    id: `${Date.now().toString(36)}-${settings.seed}`,
    createdAt: new Date().toISOString(),
    settings,
    phase: 'draft',
    rngState: rng.getState(),
    draft: newDraft(formation, settings.rules),
    squad: {},
    contracts: {},
    customPlayers: {},
    tactics: defaultTactics(settings.formationId),
    lineup: {},
    bench: [],
    teamTalk: 'encourage',
    training: 'balanced',
    season: null,
    finances: { budget: 0, wageCap: 0, income: 0, spent: 0, wagesPaid: 0 },
    window: null,
    pendingEvent: null,
    live: null,
    weekPlayed: [],
    lastMatch: null,
    lastMatchContext: null,
    lastCupMatch: null,
    lastCupContext: null,
    consecutiveMissed: {},
    awards: null,
    tier: null,
    year: 1,
    history: [],
    bonusSpins: 0,
    friendliesPlayed: 0,
    unlocked: [],
    jobOffers: [],
    pendingMove: null,
    quickResult: null,
  }
}

/** Move the drafted players into the squad and prepare the season. */
export function beginSeason(game: Game, u: LoadedUniverse): void {
  const rng = Rng.fromState(game.rngState)
  const d = game.draft
  if (d) {
    for (const id of [...Object.values(d.lineup), ...d.bench]) {
      if (!game.squad[id]) {
        game.squad[id] = newSquadPlayer(id)
        game.contracts[id] = { years: rng.int(1, 3) }
      }
    }
    game.lineup = { ...d.lineup }
    game.bench = [...d.bench]
    // A summer signing made while the wheel was still spinning is in the squad but not the draft
    const placed = new Set([...Object.values(game.lineup), ...game.bench])
    for (const id of Object.keys(game.squad)) if (!placed.has(id)) game.bench.push(id)
  }
  game.draft = null
  // The draft's squad size already included every bonus spin, so they are spent now
  game.bonusSpins = 0
  // The host club must exist in that league season; otherwise take a random one's place.
  const inLeague = u.clubSeasons.filter((cs) => cs.leagueId === game.settings.leagueId && cs.season === game.settings.leagueSeason).map((cs) => cs.clubId)
  if (inLeague.length && !inLeague.includes(game.settings.hostClubId)) game.settings = { ...game.settings, hostClubId: rng.pick(inLeague) }
  const s = game.settings
  const ai = buildAiClubs(u, s.leagueId, s.leagueSeason, s.hostClubId)
  const ids = [USER_TEAM, ...Object.keys(ai)]
  const matchweeks = matchweeksFor(ids.length)
  const fixtures = generateFixtures(ids, rng)
  const cup = drawFirstCupRound(ids, rng, matchweeks)
  const userStrength = teamStrength(game, u).overall
  const aiOffset = aiRatingOffset(u, ai, s.difficulty ?? 'calibrated')
  const aiStrengths = Object.values(ai).map((c) => {
    const inp = aiTeamInput(u, c)
    return computeTeamStrength(c.tactics, inp.lineup, inp.getPlayer, inp.getState).overall - aiOffset
  })
  const boardTarget = boardTargetFor(userStrength, aiStrengths)
  // Continental Cup: by choice in the first season, by right afterwards
  let continental: ContinentalState | undefined
  const wantsEurope = game.year === 1 ? !!s.continental : !!game.qualifiedContinental
  if (wantsEurope) {
    const clubs = buildContinentalClubs(u, s.leagueId, s.leagueSeason, s.hostClubId, 15)
    if (Object.keys(clubs).length === 15) continental = { ties: drawFirstRound([USER_TEAM, ...Object.keys(clubs)], rng, continentalRounds(matchweeks)), clubs, eliminated: false, won: false }
  }
  game.season = {
    leagueId: s.leagueId,
    leagueSeason: s.leagueSeason,
    matchweeks,
    hostClubId: s.hostClubId,
    teamName: s.teamName,
    fixtures,
    matchweek: 0,
    cup,
    cupEliminated: false,
    cupWon: false,
    continental,
    ai,
    aiOffset,
    news: [
      { matchweek: 0, kind: 'board', title: 'Welcome to the hot seat', body: `The board expects a ${ordinal(boardTarget)}-place finish or better in the ${s.leagueSeason}-${String((s.leagueSeason + 1) % 100).padStart(2, '0')} season. Three friendlies are available before the opener.` },
    ],
    confidence: 60,
    boardTarget,
    objectives: pickObjectives(rng, boardTarget, matchweeks, !!continental, (u.clubById[s.hostClubId]?.rivals ?? []).some((r) => !!ai[r])),
    sacked: false,
  }
  game.season.news.unshift({ matchweek: 0, kind: 'board', title: 'Board objectives', body: `Beyond the league position the board asks for two things: ${game.season.objectives!.map((o) => o.label.toLowerCase()).join(', and ')}. Each one met adds £${OBJECTIVE_REWARD.budget}M to next season's budget.` })
  if (continental) {
    const tie = continental.ties.find((t) => t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM)!
    const opp = tie.homeTeamId === USER_TEAM ? tie.awayTeamId : tie.homeTeamId
    game.season.news.unshift({ matchweek: 0, kind: 'cup', title: 'Continental Cup draw', body: `${wantsEurope && game.year > 1 ? 'Qualified by right. ' : ''}Round of 16: ${tie.homeTeamId === USER_TEAM ? 'home to' : 'away at'} ${continental.clubs[opp]?.name ?? opp}, after matchweek ${continentalRounds(matchweeks)[0].afterMatchweek}.` })
  } else if (wantsEurope) {
    game.season.news.unshift({ matchweek: 0, kind: 'cup', title: 'No Continental Cup', body: 'Not enough clubs from other leagues are loaded to form a field this season.' })
  }
  game.qualifiedContinental = false
  if (game.year === 1) game.finances = startingFinances(u, s.hostClubId, s.leagueSeason, squadWages(game, u))
  else {
    // New season: the wage cap follows the squad again, the budget carries over.
    const fresh = startingFinances(u, s.hostClubId, s.leagueSeason, squadWages(game, u))
    game.finances = { ...game.finances, wageCap: fresh.wageCap, income: 0, spent: 0, wagesPaid: 0 }
  }
  game.friendliesPlayed = 0
  game.phase = 'preseason'
  // Dynasty: the academy presents this year's intake
  if (s.mode === 'dynasty') {
    const candidates = buildYouthIntake(game, u, rng)
    game.youthIntake = candidates.length ? { year: game.year, candidates } : undefined
    if (candidates.length) game.season.news.unshift({ matchweek: 0, kind: 'info', title: 'Youth intake', body: `${candidates.length} academy prospects are ready for a look. Sign one for nothing, or pass.` })
  }
  // The draft order constrained who went where; start the season with the strongest eleven.
  autoPick(game, u, false)
  game.rngState = rng.getState()
  void playerLookup
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
