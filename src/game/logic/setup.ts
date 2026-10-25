import type { Game, GameSettings } from '../types'
import { seasonLabel, type LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { difficultyOf, draftModeOf, newDraft, QUICK_RULES, ratingsHidden, ratingsModeOf, rulesTags, SEASON_RULES, withDifficulty, type DraftDifficulty, type DraftMode, type DraftRules, type RatingsMode } from '@engine/draft'
import { dailySettings } from './daily'
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

/** The place in the table a new manager is handed by default: mid-table, so the board's target is reachable. */
export const DEFAULT_HOST_POSITION = 10

// The Daily's fixed settings and rules live in ./daily; re-exported here beside the rest of the setup logic
export { DAILY_FORMATIONS, DAILY_RULES, dailySettings, type DailySettings } from './daily'

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

/** What the setup screen's cards, slider and toggles hold, before they become `DraftRules`. */
export interface SetupChoices {
  difficulty: DraftDifficulty
  /** The Show ratings card; ignored on hard, which always hides them. */
  showRatings: boolean
  draftMode: DraftMode
  ratings: RatingsMode
  /** The era slider's two handles (season start years, either way round) over the wheel's seasons `first` to `last`. */
  eraFrom: number
  eraTo: number
  first: number
  last: number
  twists: boolean
  /** The wheel leagues: the league played in, or all of them for European Nights. */
  leagues: string[]
  onlyClub?: string
  onlyNation?: string
}

/**
 * The draft rules a setup screen starts with: the mode's base rules (`QUICK_RULES`, or `SEASON_RULES` with the squad
 * size) at the chosen difficulty (`withDifficulty`: its re-spins, hard mode in step), ratings shown unless the card
 * says off or the difficulty is hard, the draft mode, the ratings mode and the era. The era handles are ordered and
 * clamped to the wheel's seasons, and a handle at either end of the slider writes no bound, so a full slider is the
 * All-time wheel (no `fromSeason` / `toSeason`) and a range that runs to the newest season leaves `toSeason` out,
 * exactly as the presets do. Pure: the same choices give the same rules on every device.
 */
export function setupRules(base: DraftRules, c: SetupChoices): DraftRules {
  const lo = Math.max(c.first, Math.min(c.eraFrom, c.eraTo))
  const hi = Math.min(c.last, Math.max(c.eraFrom, c.eraTo))
  const hard = c.difficulty === 'hard'
  return {
    ...withDifficulty(base, c.difficulty),
    showRatings: hard ? false : c.showRatings,
    draftMode: c.draftMode,
    ratings: c.ratings,
    fromSeason: lo > c.first ? Math.min(lo, c.last) : undefined,
    toSeason: hi < c.last ? Math.max(hi, c.first) : undefined,
    onlyClub: c.onlyClub,
    onlyNation: c.onlyNation,
    twists: c.twists,
    leagues: c.leagues,
  }
}

/**
 * The draft rules in plain words, one short item each, for a fixed wheel (the Daily, a challenge link) where the
 * cards are not the player's to change: `['Normal: 1 re-spin', 'Ratings on', 'Squad First', 'Season ratings',
 * 'All-time', 'Twists on']`.
 */
export function describeRules(u: LoadedUniverse, r: DraftRules): string[] {
  const diff = difficultyOf(r)
  const name = diff === 'easy' ? 'Easy' : diff === 'hard' ? 'Hard' : 'Normal'
  const respins = r.respins
  return [
    `${name}: ${respins === 0 ? 'no re-spins' : `${respins} re-spin${respins === 1 ? '' : 's'}`}`,
    ratingsHidden(r) ? 'Ratings hidden' : 'Ratings on',
    draftModeOf(r) === 'position' ? 'Position First' : 'Squad First',
    ratingsModeOf(r) === 'prime' ? 'Prime ratings' : 'Season ratings',
    r.fromSeason === undefined && r.toSeason === undefined ? 'All-time' : `${seasonLabel(r.fromSeason ?? u.firstSeason)} to ${seasonLabel(r.toSeason ?? u.lastSeason)}`,
    r.twists ? 'Twists on' : 'No twists',
  ]
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
    // Every draft rule pinned by DAILY_RULES, never the quick defaults, so the Daily is the same wheel for everyone
    rules: d.rules,
    jobSecurity: false,
    difficulty: d.difficulty,
    continental: false,
  }
}

/** How `rulesTags` labels read inside the summary line. */
const TAG_WORDS: Record<string, string> = { Easy: 'easy mode', Normal: 'normal mode', Hard: 'hard mode', Blind: 'blind', 'Prime ratings': 'prime ratings', 'Season ratings': 'season ratings' }

/**
 * One line stating every choice a game will start with, so the ones folded away under More options are still read:
 * "Touchline XI, 4-3-3, as Brentford in the Premier League 2025-26, calibrated, seed K7Q2-MX9A", then anything off
 * the defaults (European Nights, era, one club or nation, the difficulty, blind, Position First or prime ratings when
 * they differ from the mode's defaults, twists changed from the mode's default, squad size, job security, Europe).
 */
export function summariseSetup(u: LoadedUniverse, s: GameSettings): string {
  const league = u.available.find((l) => l.id === s.leagueId)?.name ?? s.leagueId
  const parts = [`${s.teamName}, ${getFormation(s.formationId).name}, as ${u.clubById[s.hostClubId]?.name ?? s.hostClubId} in the ${league} ${seasonLabel(s.leagueSeason)}, ${s.difficulty ?? 'calibrated'}, seed ${s.seed}`]
  const r = s.rules
  if (s.wheelLeagues.length > 1) parts.push(`European Nights wheel of ${s.wheelLeagues.length} leagues`)
  if (r.fromSeason !== undefined || r.toSeason !== undefined) parts.push(`${seasonLabel(r.fromSeason ?? u.firstSeason)} to ${seasonLabel(r.toSeason ?? u.lastSeason)}`)
  if (r.onlyClub) parts.push(`${u.clubById[r.onlyClub]?.name ?? r.onlyClub} only`)
  if (r.onlyNation) parts.push(`${u.nations[r.onlyNation]?.name ?? r.onlyNation} only`)
  const manage = s.mode === 'season' || s.mode === 'dynasty'
  // The 38-0 options, only where they differ from the mode's defaults: `hard mode`, `easy mode`, `blind`, `Position First`, `prime ratings`
  for (const t of rulesTags(r, manage ? SEASON_RULES : QUICK_RULES)) parts.push(TAG_WORDS[t] ?? t)
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
  // Every contract carries a squad status: by rank for anyone who has none yet (drafted players, older saves)
  const statuses = defaultStatuses(squadPlayers(game, u).map((x) => ({ id: x.p.id, overall: x.p.overall, age: x.p.age })), new Set(Object.values(game.lineup)))
  for (const id of Object.keys(game.squad)) {
    const c = (game.contracts[id] ??= { years: 1 })
    c.status ??= statuses[id] ?? 'rotation'
  }
  // A fresh inbox: everything posted so far is this season's opening news, all of it unread
  game.newsTotal = game.season.news.length
  game.newsSeen = 0
  game.rngState = rng.getState()
  void playerLookup
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
