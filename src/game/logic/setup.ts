import type { Game, GameSettings } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { newDraft } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { defaultTactics } from '@engine/tactics'
import { newSquadPlayer, buildAiClubs, generateFixtures, drawFirstCupRound, USER_TEAM, boardTargetFor, aiTeamInput, aiRatingOffset, matchweeksFor } from '@engine/season'
import { startingFinances } from '@engine/market'
import { computeTeamStrength } from '@engine/ratings'
import { autoPick, squadWages, teamStrength } from './squad'
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
  }
  game.draft = null
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
    ai,
    aiOffset,
    news: [
      { matchweek: 0, kind: 'board', title: 'Welcome to the hot seat', body: `The board expects a ${ordinal(boardTarget)}-place finish or better in the ${s.leagueSeason}-${String((s.leagueSeason + 1) % 100).padStart(2, '0')} season. Three friendlies are available before the opener.` },
    ],
    confidence: 60,
    boardTarget,
    sacked: false,
  }
  if (game.year === 1) game.finances = startingFinances(u, s.hostClubId, s.leagueSeason, squadWages(game, u))
  else {
    // New season: the wage cap follows the squad again, the budget carries over.
    const fresh = startingFinances(u, s.hostClubId, s.leagueSeason, squadWages(game, u))
    game.finances = { ...game.finances, wageCap: fresh.wageCap, income: 0, spent: 0, wagesPaid: 0 }
  }
  game.friendliesPlayed = 0
  game.phase = 'preseason'
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
