import type { Game, GameSettings } from '../types'
import { seasonLabel, type LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { newDraft, QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { defaultTactics } from '@engine/tactics'
import { newSquadPlayer, buildAiClubs, buildContinentalClubs, continentalRounds, drawFirstRound, generateFixtures, drawFirstCupRound, USER_TEAM, boardTargetFor, aiTeamInput, aiRatingOffset, matchweeksFor, type ContinentalState } from '@engine/season'
import { startingFinances } from '@engine/market'
import { computeTeamStrength } from '@engine/ratings'
import { autoPick, squadWages, teamStrength } from './squad'
import { buildYouthIntake } from './youth'
import { pickObjectives, OBJECTIVE_REWARD } from '@engine/objectives'
import { playerLookup, squadPlayers } from './players'
import { defaultStatuses } from '@engine/status'
import { newArenaState } from './arena'

/** The place in the table a new manager is handed by default: mid-table, so the board's target is reachable. */
export const DEFAULT_HOST_POSITION = 10

/** The shapes the Daily rotates through, in the order its seed indexes them. */
export const DAILY_FORMATIONS = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '4-4-2-diamond'] as const

/** Everything the Daily fixes for everyone: the league, the season, the host club, the shape and the difficulty. */
export interface DailySettings {
  seed: string
  leagueId: 'england'
  wheelLeagues: ['england']
  season: number
  host: string
  formationId: string
  difficulty: 'calibrated'
}

/**
 * The club whose place a new side takes when the player has not chosen: the one whose real finish that season is
 * nearest `DEFAULT_HOST_POSITION` (ties go to the higher place), among the clubs with a squad in `clubsInLeague`.
 * Without a table for that season it is the alphabetical middle of the list, as the setup screen always offered.
 */
export function defaultHostClub(u: LoadedUniverse, leagueId: string, season: number, clubsInLeague: string[]): string {
  const rows = (u.tables[leagueId]?.[season] ?? []).filter((r) => clubsInLeague.includes(r.clubId))
  let best: { clubId: string; position: number } | null = null
  for (const r of rows) {
    const d = Math.abs(r.position - DEFAULT_HOST_POSITION)
    if (!best || d < Math.abs(best.position - DEFAULT_HOST_POSITION) || (d === Math.abs(best.position - DEFAULT_HOST_POSITION) && r.position < best.position)) best = { clubId: r.clubId, position: r.position }
  }
  return best?.clubId ?? clubsInLeague[Math.floor(clubsInLeague.length / 2)] ?? ''
}

/**
 * The Daily's fixed settings for a `daily-YYYY-MM-DD` seed. The date's digits index the complete English seasons,
 * their clubs sorted by id (times seven) and `DAILY_FORMATIONS` (times three); this mapping must never change, or
 * everyone's puzzle changes with the deploy.
 */
export function dailySettings(u: LoadedUniverse, seed: string): DailySettings {
  const n = Number(seed.split('-').slice(1).join('')) || 0
  const complete = u.clubSeasons.filter((cs) => cs.complete && cs.leagueId === 'england')
  const seasons = [...new Set(complete.map((cs) => cs.season))].sort()
  const season = seasons[n % seasons.length]
  const clubs = complete.filter((cs) => cs.season === season).map((cs) => cs.clubId).sort()
  return { seed, leagueId: 'england', wheelLeagues: ['england'], season, host: clubs[(n * 7) % clubs.length], formationId: DAILY_FORMATIONS[(n * 3) % DAILY_FORMATIONS.length], difficulty: 'calibrated' }
}

/** The 2 to 3 letter code shown on the scoreboard, from the initials of the team name. */
export function shortNameFor(name: string): string {
  const short = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase() || 'TXI'
  return short.length >= 2 ? short : name.slice(0, 3).toUpperCase()
}

/** The complete settings of today's Daily, ready for `startGame`; only the team name is the player's. */
export function dailyGameSettings(u: LoadedUniverse, seed: string, teamName = 'Touchline XI'): GameSettings {
  const d = dailySettings(u, seed)
  const name = teamName.trim() || 'Touchline XI'
  return {
    mode: 'daily',
    seed: d.seed,
    formationId: d.formationId,
    teamName: name,
    shortName: shortNameFor(name),
    leagueId: d.leagueId,
    wheelLeagues: d.wheelLeagues,
    hostClubId: d.host,
    leagueSeason: d.season,
    rules: { ...QUICK_RULES, twists: true, leagues: d.wheelLeagues },
    jobSecurity: false,
    difficulty: d.difficulty,
    continental: false,
  }
}

/**
 * One line stating every choice a game will start with, so the ones folded away under More options are still read:
 * "Touchline XI, 4-3-3, as Brentford in the Premier League 2025-26, calibrated, seed K7Q2-MX9A", then anything off
 * the defaults (European Nights, era, one club or nation, hard mode, twists changed from the mode's default, squad
 * size, job security, Europe).
 */
export function summariseSetup(u: LoadedUniverse, s: GameSettings): string {
  const league = u.available.find((l) => l.id === s.leagueId)?.name ?? s.leagueId
  const parts = [`${s.teamName}, ${getFormation(s.formationId).name}, as ${u.clubById[s.hostClubId]?.name ?? s.hostClubId} in the ${league} ${seasonLabel(s.leagueSeason)}, ${s.difficulty ?? 'calibrated'}, seed ${s.seed}`]
  const r = s.rules
  if (s.wheelLeagues.length > 1) parts.push(`European Nights wheel of ${s.wheelLeagues.length} leagues`)
  if (r.fromSeason !== undefined || r.toSeason !== undefined) parts.push(`${seasonLabel(r.fromSeason ?? u.firstSeason)} to ${seasonLabel(r.toSeason ?? u.lastSeason)}`)
  if (r.onlyClub) parts.push(`${u.clubById[r.onlyClub]?.name ?? r.onlyClub} only`)
  if (r.onlyNation) parts.push(`${u.nations[r.onlyNation]?.name ?? r.onlyNation} only`)
  if (r.hardMode) parts.push('hard mode')
  if (r.budget !== undefined) parts.push(`cap £${r.budget}M`)
  const manage = s.mode === 'season' || s.mode === 'dynasty'
  // Twists are on by default for a quick draft and off for a managed season: only a change from that is worth a word
  const twistsDefault = !!(manage ? SEASON_RULES.twists : QUICK_RULES.twists)
  if (!!r.twists !== twistsDefault) parts.push(r.twists ? 'twists' : 'no twists')
  if (manage) {
    parts.push(`squad of ${r.squadSize}`)
    if (!s.jobSecurity) parts.push('no sack')
    if (s.continental) parts.push('Continental Cup')
  }
  return parts.join(', ')
}

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
    // The arena's own streams of the game seed (field, ties, draw), seeded here with the game so they never touch `rngState`
    arena: settings.arena ? newArenaState(settings.arena, { field: new Rng(`${settings.seed}#field`).getState(), ties: new Rng(`${settings.seed}#ties`).getState(), draw: new Rng(`${settings.seed}#draw`).getState() }) : null,
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
    // The salary cap's spend outlives the draft, for the summary and the Record page
    if (d.spent !== undefined) game.capSpent = d.spent
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
  // Every contract carries a squad status: by rank for anyone who has none yet (drafted players, older saves)
  const statuses = defaultStatuses(squadPlayers(game, u).map((x) => ({ id: x.p.id, overall: x.p.overall, age: x.p.age })), new Set(Object.values(game.lineup)))
  for (const id of Object.keys(game.squad)) {
    const c = (game.contracts[id] ??= { years: 1 })
    c.status ??= statuses[id] ?? 'rotation'
  }
  game.rngState = rng.getState()
  void playerLookup
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
