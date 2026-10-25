import type { Game, GameSettings } from '../types'
import { seasonLabel, type LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { benchPlaces, difficultyOf, DIFFICULTY_RESPINS, draftModeOf, modesOf, newDraft, QUICK_RULES, ratingsHidden, ratingsModeOf, rulesTags, SEASON_RULES, withDifficulty, type DraftDifficulty, type DraftMode, type DraftRules, type QuickMode, type RatingsMode } from '@engine/draft'
import { MODE_INFO, crazyFormation, withModes } from '@engine/modes'
import { POWER_UPS_ICON } from '@engine/powerups'
import { dailySettings } from './daily'
import { eraFirstSeason } from './era'
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
import { SUPER_LEAGUE_NAME } from '@engine/superLeague'
import { isSuperLeague } from './superLeague'

/** The place in the table a new manager is handed by default: mid-table, so the board's target is reachable. */
export const DEFAULT_HOST_POSITION = 10

// The Daily's fixed settings and rules live in ./daily; re-exported here beside the rest of the setup logic
export { DAILY_FORMATIONS, DAILY_RULES, DAILY_SEASON, dailySettings, type DailySettings } from './daily'

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
  /** Quick Draft bench places (0 to 5); none when absent or 0. */
  benchPicks?: number
  /** Quick Draft managers on or off; the base rules' value when absent. */
  managers?: boolean
  /** Quick Draft with managers: spin three and pick one (`DraftRules.managerSpin`) rather than pick from the drafted clubs'. Off when absent. */
  managerSpin?: boolean
  /** Quick Draft: the end-of-draft case (`DraftRules.endCase`). Off when absent. */
  endCase?: boolean
  /** The Classic toggle: the wheel may land on 1992-93 to 2007-08 (estimated ratings), and `first` is then the first classic season. */
  classic?: boolean
  /** Quick Draft: the season is the Super League instead of a real league season. */
  superLeague?: boolean
  /** Quick Draft mode cards other than Hard (Crazy, Underdog, Legends, Speedrun, Gamble, the Upgrader); Hard is `difficulty`. None when absent. */
  modes?: Array<QuickMode | 'upgrader'>
  /** Quick Draft power-ups (the tray of six on the draft screen); off when absent. */
  powerUps?: boolean
}

/**
 * The formation a new Quick Draft starts in: the one chosen on the setup screen, or under Crazy the shape the seed draws
 * (`crazyFormation`), whatever was chosen. A challenge passes the shape its challenger had and never comes here. Pure.
 */
export function startFormation(rules: DraftRules, seed: string, chosen: string): string {
  return modesOf(rules).includes('crazy') ? crazyFormation(seed) : chosen
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
  const rules: DraftRules = {
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
    ...(c.benchPicks ? { benchPicks: c.benchPicks } : {}),
    ...(c.managers !== undefined ? { managers: c.managers } : {}),
    ...(c.managerSpin && (c.managers ?? base.managers) ? { managerSpin: true } : {}),
    ...(c.endCase ? { endCase: true } : {}),
    ...(c.classic ? { classic: true } : {}),
    ...(c.superLeague ? { superLeague: true } : {}),
  }
  // The mode flags (and Crazy's twists); Hard is already the difficulty, so it rides along unchanged
  const moded = c.modes?.length ? withModes(rules, [...(hard ? (['hard'] as const) : []), ...c.modes]) : rules
  return c.powerUps ? { ...moded, powerUps: true } : moded
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
  const respinWords = respins === 0 ? 'no re-spins' : `${respins} re-spin${respins === 1 ? '' : 's'}`
  return [
    // A budget that is not the difficulty's own (the Daily's 2) is stated alone, so it never reads as "Normal: 2"
    respins === DIFFICULTY_RESPINS[diff] ? `${name}: ${respinWords}` : respinWords[0].toUpperCase() + respinWords.slice(1),
    ratingsHidden(r) ? 'Ratings hidden' : 'Ratings on',
    draftModeOf(r) === 'position' ? 'Position First' : 'Squad First',
    ratingsModeOf(r) === 'prime' ? 'Prime ratings' : 'Season ratings',
    r.fromSeason === undefined && r.toSeason === undefined ? 'All-time' : `${seasonLabel(eraFirstSeason(u, r))} to ${seasonLabel(r.toSeason ?? u.lastSeason)}`,
    r.twists ? 'Twists on' : 'No twists',
    ...(benchPlaces(r) ? [`Bench of ${benchPlaces(r)}`] : []),
    ...modesOf(r).map((m) => `${MODE_INFO[m].icon} ${MODE_INFO[m].title}`),
    ...(r.upgrader ? [`${MODE_INFO.upgrader.icon} ${MODE_INFO.upgrader.title}`] : []),
    ...(r.powerUps ? [`${POWER_UPS_ICON} Power-ups`] : []),
    ...(r.managers ? [r.managerSpin ? 'Manager spin' : 'Manager pick'] : []),
    ...(r.endCase ? ['🎁 End case'] : []),
    ...(r.superLeague ? [SUPER_LEAGUE_NAME] : []),
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
    // The season options are pinned too: the same January window for everyone, no Continental Cup run
    continental: d.continental,
    january: d.january,
  }
}

/** How `rulesTags` labels read inside the summary line. */
const TAG_WORDS: Record<string, string> = { Easy: 'easy mode', Normal: 'normal mode', Hard: 'hard mode', Blind: 'blind', 'Prime ratings': 'prime ratings', 'Season ratings': 'season ratings' }

/**
 * One line stating every choice a game will start with, so the ones folded away under More options are still read:
 * "Touchline XI, 4-3-3, in the Premier League 2025-26, calibrated, seed K7Q2-MX9A" (a managed season adds "as Brentford"), then anything off
 * the defaults (European Nights, era, one club or nation, the difficulty, blind, Position First or prime ratings when
 * they differ from the mode's defaults, twists changed from the mode's default, squad size, job security, Europe; for a
 * quick draft no January window, or a Continental Cup run).
 */
export function summariseSetup(u: LoadedUniverse, s: GameSettings): string {
  const league = u.available.find((l) => l.id === s.leagueId)?.name ?? s.leagueId
  // A quick draft's XI is the user's own team: only a managed season takes a club's place, so only it says "as"
  const host = s.mode === 'season' || s.mode === 'dynasty' ? `as ${u.clubById[s.hostClubId]?.name ?? s.hostClubId} ` : ''
  // The Super League is no real league season, and its nineteen play at full strength whatever the opposition setting
  const where = isSuperLeague(s) ? `in the ${SUPER_LEAGUE_NAME}, full strength` : `in the ${league} ${seasonLabel(s.leagueSeason)}, ${s.difficulty ?? 'calibrated'}`
  const parts = [`${s.teamName}, ${getFormation(s.formationId).name}, ${host}${where}, seed ${s.seed}`]
  const r = s.rules
  if (s.wheelLeagues.length > 1) parts.push(`European Nights wheel of ${s.wheelLeagues.length} leagues`)
  if (r.fromSeason !== undefined || r.toSeason !== undefined) parts.push(`${seasonLabel(eraFirstSeason(u, r))} to ${seasonLabel(r.toSeason ?? u.lastSeason)}`)
  if (r.classic) parts.push('classic seasons (estimated ratings)')
  if (r.onlyClub) parts.push(`${u.clubById[r.onlyClub]?.name ?? r.onlyClub} only`)
  if (r.onlyNation) parts.push(`${u.nations[r.onlyNation]?.name ?? r.onlyNation} only`)
  const manage = s.mode === 'season' || s.mode === 'dynasty'
  // The 38-0 options, only where they differ from the mode's defaults: `hard mode`, `easy mode`, `blind`, `Position First`, `prime ratings`
  for (const t of rulesTags(r, manage ? SEASON_RULES : QUICK_RULES)) parts.push(TAG_WORDS[t] ?? t)
  // Twists are on by default for a quick draft and off for a managed season: only a change from that is worth a word
  const twistsDefault = !!(manage ? SEASON_RULES.twists : QUICK_RULES.twists)
  // Crazy turns twists on by itself, so only a change that Crazy does not explain is worth a word
  if (!!r.twists !== twistsDefault && !modesOf(r).includes('crazy')) parts.push(r.twists ? 'twists' : 'no twists')
  for (const m of modesOf(r)) parts.push(`${MODE_INFO[m].title.toLowerCase()} mode`)
  if (r.upgrader) parts.push('the Player Upgrader')
  if (r.powerUps) parts.push('power-ups')
  if (manage) {
    parts.push(`squad of ${r.squadSize}`)
    if (!s.jobSecurity) parts.push('no sack')
    if (s.continental) parts.push('Continental Cup')
  } else {
    // The quick season's options: the January window is on by default (the cups are offered after every league season)
    if (s.january === false) parts.push('no January window')
    if (benchPlaces(r)) parts.push(`bench of up to ${benchPlaces(r)}`)
    // A manager pick is on by default for a Quick Draft (off in the Daily, which this line never describes)
    if (s.mode === 'quick' && !r.managers) parts.push('no manager')
  }
  return parts.join(', ')
}

/**
 * The Quick Draft's line above Spin: the team name, the shape and the rules or modes in play, never the league season
 * or the seed (the goal is the season itself; both stay under More options and in the summary). Shown as
 * "Touchline XI · 4-3-3 · Normal · bench 5 · Crazy": the difficulty always, then only what differs from the defaults.
 */
export function quickSetupLine(u: LoadedUniverse, s: GameSettings): string {
  const r = s.rules
  const words = [s.teamName, getFormation(s.formationId).name, { easy: 'Easy', normal: 'Normal', hard: 'Hard' }[difficultyOf(r)]]
  for (const t of rulesTags(r, QUICK_RULES)) if (!['Easy', 'Normal', 'Hard'].includes(t)) words.push(t)
  if (r.fromSeason !== undefined || r.toSeason !== undefined) words.push(`${seasonLabel(eraFirstSeason(u, r))} to ${seasonLabel(r.toSeason ?? u.lastSeason)}`)
  if (r.classic) words.push('Classic (est.)')
  // The Super League's wheel is every league by design, so it names the league instead of the count
  if (isSuperLeague(s)) words.push(SUPER_LEAGUE_NAME)
  else if (s.wheelLeagues.length > 1) words.push(`${s.wheelLeagues.length} leagues`)
  if (r.onlyClub) words.push(`${u.clubById[r.onlyClub]?.name ?? r.onlyClub} only`)
  if (r.onlyNation) words.push(`${u.nations[r.onlyNation]?.name ?? r.onlyNation} only`)
  if (!r.twists && !modesOf(r).includes('crazy')) words.push('no twists')
  if (benchPlaces(r)) words.push(`bench ${benchPlaces(r)}`)
  for (const m of modesOf(r)) words.push(MODE_INFO[m].title)
  if (r.upgrader && !modesOf(r).includes('gamble')) words.push(MODE_INFO.upgrader.title)
  if (r.powerUps) words.push('Power-ups')
  if (!r.managers) words.push('no manager')
  if (s.january === false) words.push('no January')
  if (s.continental) words.push('Continental run')
  if ((s.difficulty ?? 'calibrated') === 'realistic' && !isSuperLeague(s)) words.push('Realistic')
  return words.join(' · ')
}

/** One chip of the row above Start: `key` names what it states (the UI adds the league's flag to `host`). */
export interface SetupChip {
  key: string
  text: string
}

/**
 * The same choices as `summariseSetup`, as short chips for the row above Start: the formation, the club and season,
 * the opposition and the seed always, then only what differs from the mode's defaults, in the same order.
 */
export function setupChips(u: LoadedUniverse, s: GameSettings): SetupChip[] {
  const out: SetupChip[] = [
    { key: 'formation', text: getFormation(s.formationId).name },
    // The league and season played in, never the club replaced (a quick draft never names it)
    { key: 'host', text: isSuperLeague(s) ? SUPER_LEAGUE_NAME : `${u.available.find((l) => l.id === s.leagueId)?.name ?? s.leagueId} ${seasonLabel(s.leagueSeason)}` },
    { key: 'opposition', text: (s.difficulty ?? 'calibrated') === 'realistic' ? 'Realistic' : 'Calibrated' },
    { key: 'seed', text: `Seed ${s.seed}` },
  ]
  const r = s.rules
  if (s.wheelLeagues.length > 1) out.push({ key: 'europe', text: `🌍 ${s.wheelLeagues.length} leagues` })
  if (r.fromSeason !== undefined || r.toSeason !== undefined) out.push({ key: 'era', text: `${seasonLabel(r.fromSeason ?? u.firstSeason)} to ${seasonLabel(r.toSeason ?? u.lastSeason)}` })
  if (r.onlyClub) out.push({ key: 'club', text: `${u.clubById[r.onlyClub]?.name ?? r.onlyClub} only` })
  if (r.onlyNation) out.push({ key: 'nation', text: `${u.nations[r.onlyNation]?.flag ?? ''} ${u.nations[r.onlyNation]?.name ?? r.onlyNation} only`.trim() })
  const manage = s.mode === 'season' || s.mode === 'dynasty'
  for (const t of rulesTags(r, manage ? SEASON_RULES : QUICK_RULES)) out.push({ key: `tag-${t}`, text: t })
  const twistsDefault = !!(manage ? SEASON_RULES.twists : QUICK_RULES.twists)
  if (!!r.twists !== twistsDefault && !modesOf(r).includes('crazy')) out.push({ key: 'twists', text: r.twists ? 'Twists' : 'No twists' })
  for (const m of modesOf(r)) out.push({ key: `mode-${m}`, text: `${MODE_INFO[m].icon} ${MODE_INFO[m].title}` })
  if (r.upgrader) out.push({ key: 'upgrader', text: `${MODE_INFO.upgrader.icon} ${MODE_INFO.upgrader.title}` })
  if (r.powerUps) out.push({ key: 'power-ups', text: `${POWER_UPS_ICON} Power-ups` })
  if (manage) {
    out.push({ key: 'squad', text: `Squad of ${r.squadSize}` })
    if (!s.jobSecurity) out.push({ key: 'no-sack', text: 'No sack' })
    if (s.continental) out.push({ key: 'continental', text: 'Continental Cup' })
  } else {
    if (s.january === false) out.push({ key: 'january', text: 'No January' })
    if (benchPlaces(r)) out.push({ key: 'bench', text: `Bench ${benchPlaces(r)}` })
    if (s.continental) out.push({ key: 'continental', text: 'Continental run' })
  }
  return out
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
    draft: newDraft(formation, settings.rules, settings.seed),
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
