/**
 * The Run-in: take over a real club at matchweek 28 (25 of 34) with its real
 * squad, the table projected from the real final one and a brief (win the
 * title, reach the top four, or survive), reinforce with four spins of the
 * wheel, then play the last ten matchweeks through the Season loop unchanged
 * (`playMatchweek`, `afterMatchweek`, `finishSeason`). It ends in a verdict
 * against what the real club did.
 */
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { newDraft, SEASON_RULES } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { formationForStyle, tacticsForStyle } from '@engine/tactics'
import { autoPickLineup } from '@engine/ratings'
import { aiRatingOffset, buildAiClubs, computeTable, generateFixtures, humansOf, matchweeksFor, newSquadPlayer, positionOf, seasonTable, USER_TEAM, type SeasonState } from '@engine/season'
import { briefTarget, projectedCarryIn, relegatedDirectly, takeoverWeek, type RunInJob, type RunInTemplate } from '@engine/scenario'
import type { Objective, ObjectiveId } from '@engine/objectives'
import { startingFinances } from '@engine/market'
import { defaultStatuses } from '@engine/status'
import { ordinal, seasonLabel } from '@engine/universe'
import { runInShareText } from '@engine/awards'
import type { Game, GameSettings, RunInEntry } from '../types'
import { moveDraftToSquad } from './setup'
import { autoPick, squadWages } from './squad'
import { playerLookup, squadPlayers } from './players'
import { resultId } from './cabinet'
import { storyForGame } from './story'

/** Spins of the wheel to reinforce the inherited squad (the balance guard tunes this between 3 and 5 first). */
export const RUN_IN_SPINS = 4
/** Players kept from the real squad: the XI and the best of the rest. */
export const RUN_IN_SQUAD = 18
/** Squad morale at the takeover: a title race lifts it, a relegation fight weighs on it. */
export const RUN_IN_MORALE: Record<RunInTemplate, number> = { title: 72, europe: 62, survival: 45 }
/** Board confidence at the takeover. Job security is on, so a bad run can end the job from the first week. */
export const RUN_IN_CONFIDENCE: Record<RunInTemplate, number> = { title: 70, europe: 60, survival: 50 }
/** The last matchweeks Highlights stops before while the brief is still open. */
export const RUN_IN_LAST_STOPS = 3
/** Run-ins the Record page keeps. */
export const RUN_IN_LOG_CAP = 50

export const RUN_IN_TEMPLATE_LABEL: Record<RunInTemplate, string> = { title: 'Title race', europe: 'Chase for Europe', survival: 'Survival' }

/** The brief on a chip: `Win the title`, `Top four`, `Stay up`. */
export const RUN_IN_BRIEF_SHORT: Record<RunInTemplate, string> = { title: 'Win the title', europe: 'Top four', survival: 'Stay up' }

const BRIEF_ID: Record<RunInTemplate, ObjectiveId> = { title: 'title', europe: 'top-four', survival: 'survive' }

/** The brief as a board objective, judged on the final position (`evaluateObjective`). */
export function runInBrief(template: RunInTemplate, target: number): Objective {
  const label = template === 'title' ? 'Win the title' : template === 'europe' ? 'Finish in the top four' : `Stay up: finish ${ordinal(target)} or better`
  return { id: BRIEF_ID[template], label, target }
}

/** Is this objective a run-in's brief? */
export function isBrief(o: Objective): boolean {
  return o.id === 'title' || o.id === 'top-four' || o.id === 'survive'
}

/** The complete settings of a run-in job, ready for `startGame`: the club's own name and shape, Realistic, job security on, four spins on its league's wheel. */
export function runInGameSettings(u: LoadedUniverse, job: RunInJob, opts: { seed: string; formationId?: string }): GameSettings {
  const club = u.clubById[job.clubId]
  const name = club?.name ?? job.clubId
  return {
    mode: 'runin',
    seed: opts.seed,
    formationId: opts.formationId ?? formationForStyle(club?.style ?? 'balanced'),
    teamName: name,
    // The club's own three-letter code, as every other side shows: its short name ("Blackpool") read twice in the live table
    shortName: club?.code ?? name.slice(0, 3).toUpperCase(),
    leagueId: job.leagueId,
    wheelLeagues: [job.leagueId],
    hostClubId: job.clubId,
    leagueSeason: job.season,
    rules: { ...SEASON_RULES, leagues: [job.leagueId], twists: false, respins: 1, squadSize: RUN_IN_SQUAD + RUN_IN_SPINS },
    jobSecurity: true,
    // The squad is real, so the rivals are too: Calibrated would hand a real squad handicapped opponents
    difficulty: 'realistic',
    continental: false,
    runIn: { template: job.template },
  }
}

/**
 * The inherited squad and the reinforcement draft, right after `createGame`:
 * the real XI by `autoPickLineup` in the chosen shape, the rest by overall up
 * to eighteen, each at familiarity 70, sharpness 85, condition 88 to 97 (drawn
 * from the game's stream) and the brief's morale. The draft is seeded with
 * them as a Dynasty summer is (lineup, bench, taken), four picks to make and
 * one re-spin.
 */
export function seedRunInDraft(game: Game, u: LoadedUniverse): void {
  const s = game.settings
  const cs = u.clubSeasonByKey[`${s.hostClubId}@${s.leagueSeason}`]
  if (!cs || !s.runIn) return
  const rng = Rng.fromState(game.rngState)
  const formation = getFormation(s.formationId)
  game.tactics = tacticsForStyle(u.clubById[s.hostClubId]?.style ?? 'balanced', s.formationId)
  const picked = autoPickLineup(formation, cs.squad, game.tactics)
  const xi = new Set(Object.values(picked.lineup))
  const rest = cs.squad.filter((p) => !xi.has(p.id)).sort((a, b) => b.overall - a.overall).slice(0, Math.max(0, RUN_IN_SQUAD - xi.size))
  const morale = RUN_IN_MORALE[s.runIn.template]
  for (const id of [...xi, ...rest.map((p) => p.id)]) {
    game.squad[id] = newSquadPlayer(id, { familiarity: 70, sharpness: 85, condition: rng.int(88, 97), morale })
    game.contracts[id] = { years: 1 }
  }
  const d = newDraft(formation, { ...s.rules, squadSize: Object.keys(game.squad).length + RUN_IN_SPINS, respins: 1, twists: false, budget: undefined, chain: undefined })
  for (const id of Object.keys(game.squad)) d.takenPlayers.push(u.index[id]?.playerId ?? id)
  d.lineup = { ...picked.lineup }
  d.bench = rest.map((p) => p.id)
  game.draft = d
  game.phase = 'draft'
  game.rngState = rng.getState()
}

/**
 * Take the job (`finishDraft` for mode `runin`): the draft into the squad as
 * `beginSeason` does it, then the season at the takeover: the full fixture
 * list (the weeks before it carry no result), the projected table carried in,
 * no cup, no Continental Cup, no window and no friendlies, the brief as the
 * board's target and only objective.
 */
export function beginRunIn(game: Game, u: LoadedUniverse): void {
  const s = game.settings
  const template = s.runIn?.template ?? 'survival'
  const carryIn = projectedCarryIn(u, s.leagueId, s.leagueSeason, s.hostClubId)
  if (!carryIn) throw new Error(`${seasonLabel(s.leagueSeason)} has no complete table for a run-in`)
  const rng = Rng.fromState(game.rngState)
  moveDraftToSquad(game, rng)
  // The wheel's signings leave their real clubs (engine 6, E6-2)
  const ai = buildAiClubs(u, s.leagueId, s.leagueSeason, s.hostClubId, humansOf(Object.keys(game.squad), playerLookup(game, u)))
  const full = buildAiClubs(u, s.leagueId, s.leagueSeason, s.hostClubId)
  const ids = [USER_TEAM, ...Object.keys(ai)]
  const matchweeks = matchweeksFor(ids.length)
  const fixtures = generateFixtures(ids, rng)
  const takeoverAt = takeoverWeek(matchweeks)
  const target = briefTarget(template, ids.length)
  const brief = runInBrief(template, target)
  const from = computeTable([], ids, carryIn)
  const pos = positionOf(from, USER_TEAM)
  const toPlay = matchweeks - takeoverAt
  game.season = {
    leagueId: s.leagueId,
    leagueSeason: s.leagueSeason,
    matchweeks,
    hostClubId: s.hostClubId,
    teamName: s.teamName,
    fixtures,
    matchweek: takeoverAt,
    cup: [],
    cupEliminated: true,
    cupWon: false,
    ai,
    aiOffset: aiRatingOffset(u, full, s.difficulty),
    news: [{ matchweek: takeoverAt, kind: 'board', title: 'The job is yours', body: `You take over ${s.teamName} after matchweek ${takeoverAt}, ${ordinal(pos)} on ${from[pos - 1].points} points (projected from the final table), with ${toPlay} to play. The board's brief: ${brief.label.toLowerCase()}.` }],
    confidence: RUN_IN_CONFIDENCE[template],
    boardTarget: target,
    objectives: [brief],
    sacked: false,
    carryIn,
    takeoverAt,
  }
  // Unused by a run-in, but every season carries finances
  game.finances = startingFinances(u, s.hostClubId, s.leagueSeason, squadWages(game, u))
  game.window = null
  game.friendliesPlayed = 3
  game.phase = 'week'
  autoPick(game, u, false)
  const statuses = defaultStatuses(squadPlayers(game, u).map((x) => ({ id: x.p.id, overall: x.p.overall, age: x.p.age })), new Set(Object.values(game.lineup)))
  for (const id of Object.keys(game.squad)) {
    const c = (game.contracts[id] ??= { years: 1 })
    c.status ??= statuses[id] ?? 'rotation'
  }
  game.rngState = rng.getState()
}

/**
 * The XI a run-in's job will start with, while the reinforcements are still being drafted: the draft's pitch shows the
 * club's men until the job starts (the picks go to the bench, and `beginRunIn` picks the XI again), so this plays the
 * same two steps on a copy (the draft into the squad, then `autoPick`) and returns that lineup. Null outside a run-in's
 * draft or before the first pick. Pure: the game is not touched, and the copy's draw for contract years is thrown away.
 */
export function runInProjectedLineup(game: Game, u: LoadedUniverse): Game['lineup'] | null {
  if (game.settings.mode !== 'runin' || game.phase !== 'draft' || !game.draft || !game.draft.history.some((h) => h.pickedId)) return null
  const copy = JSON.parse(JSON.stringify(game)) as Game
  moveDraftToSquad(copy, Rng.fromState(copy.rngState))
  autoPick(copy, u, false)
  return copy.lineup
}

/** The table at the takeover, as the run-in carried it in; null outside a run-in. */
export function takeoverTable(season: Pick<SeasonState, 'fixtures' | 'ai' | 'carryIn'>): ReturnType<typeof seasonTable> | null {
  if (!season.carryIn) return null
  return computeTable([], [USER_TEAM, ...Object.keys(season.ai)], season.carryIn)
}

/** Where the brief stands: the place now, the target, points to or over its line, and games left. */
export interface BriefStanding {
  template: RunInTemplate
  target: number
  position: number
  points: number
  /** Negative: points behind the club in the target place; otherwise the cushion over the first club outside it. */
  gap: number
  toPlay: number
  /** Certain either way already. */
  settled: 'met' | 'missed' | null
}

export function briefStanding(game: Game): BriefStanding | null {
  const season = game.season
  const template = game.settings.runIn?.template
  if (!season?.carryIn || !template) return null
  const table = seasonTable(season)
  const target = season.boardTarget
  const position = positionOf(table, USER_TEAM)
  const points = table[position - 1].points
  const gap = position > target ? points - table[target - 1].points : points - (table[target]?.points ?? points)
  const left = new Map<string, number>()
  for (const f of season.fixtures) {
    if (f.result || f.matchweek <= season.matchweek) continue
    left.set(f.homeTeamId, (left.get(f.homeTeamId) ?? 0) + 1)
    left.set(f.awayTeamId, (left.get(f.awayTeamId) ?? 0) + 1)
  }
  const toPlay = left.get(USER_TEAM) ?? 0
  const others = table.filter((r) => r.teamId !== USER_TEAM)
  // Sure: fewer than `target` others can still reach our points; gone: `target` others are already past our ceiling
  const canReach = others.filter((r) => r.points + 3 * (left.get(r.teamId) ?? 0) >= points).length
  const past = others.filter((r) => r.points > points + 3 * toPlay).length
  const settled = season.sacked ? 'missed' : canReach < target ? 'met' : past >= target ? 'missed' : null
  return { template, target, position, points, gap, toPlay, settled }
}

/** Is the brief still to be decided? Highlights stops before each of the last `RUN_IN_LAST_STOPS` weeks while it is. */
export function briefOpen(game: Game): boolean {
  const b = briefStanding(game)
  return !!b && b.settled === null && b.toPlay > 0
}

function pts(n: number): string {
  return `${n} point${n === 1 ? '' : 's'}`
}

/** The brief's line in words: `1 behind safety`, `2 clear of the drop`, `3 off the top`, `top by 2`, `level with 4th`. */
export function gapLine(template: RunInTemplate, target: number, position: number, gap: number): string {
  const line = template === 'title' ? 'the top' : template === 'europe' ? 'the top four' : 'safety'
  if (position > target) return gap === 0 ? `level on points with ${template === 'survival' ? 'safety' : ordinal(target)}` : `${pts(-gap)} ${template === 'title' ? 'off' : 'behind'} ${line}`
  if (template === 'title') return gap === 0 ? 'top on goal difference' : `top by ${pts(gap)}`
  if (template === 'europe') return gap === 0 ? 'in the top four on goal difference' : `${pts(gap)} clear in the top four`
  return gap === 0 ? 'out of the drop on goal difference' : `${pts(gap)} clear of the drop`
}

/**
 * How the real club finished, in words: `went down on 39`, `won the title on 89`,
 * `finished 6th on 66`. A Bundesliga 16th played a relegation play-off the data
 * does not keep (most of them stayed up), so it reads `finished 16th on 30, in
 * the relegation play-off place`, never `went down`.
 */
export function realFinish(real: { position: number; points: number }, clubs: number, leagueId: string): string {
  if (real.position > clubs - relegatedDirectly(leagueId)) return `went down on ${real.points}`
  if (real.position > clubs - 3) return `finished ${ordinal(real.position)} on ${real.points}, in the relegation play-off place`
  if (real.position === 1) return `won the title on ${real.points}`
  return `finished ${ordinal(real.position)} on ${real.points}`
}

export interface RunInVerdict {
  template: RunInTemplate
  met: boolean
  sacked: boolean
  /** `SURVIVED`, `TITLE WON`, `TOP FOUR` or `MISSED`. */
  chip: string
  icon: string
  position: number
  points: number
  clubs: number
  /** The table at the takeover. */
  from: { matchweek: number; position: number; points: number }
  real: { position: number; points: number } | null
  /** `You kept West Ham up on 41; the real West Ham went down on 39`. */
  line: string
  /** `📊 The real West Ham went down on 39`, null without the real row. */
  realLine: string | null
}

/** The verdict of a finished run-in against what really happened; null for any other game or before the end. */
export function runInVerdict(game: Game, u: LoadedUniverse): RunInVerdict | null {
  const season = game.season
  const template = game.settings.runIn?.template
  const start = season ? takeoverTable(season) : null
  if (!season || !template || !start || game.phase !== 'summary') return null
  const table = seasonTable(season)
  const clubs = table.length
  const position = positionOf(table, USER_TEAM)
  const points = table[position - 1].points
  const sacked = season.sacked
  const met = !sacked && position <= season.boardTarget
  const club = u.clubById[season.hostClubId]?.shortName ?? game.settings.teamName
  const fromPos = positionOf(start, USER_TEAM)
  const row = u.tables[season.leagueId]?.[season.leagueSeason]?.find((r) => r.clubId === season.hostClubId)
  const real = row ? { position: row.position, points: row.points } : null
  const chip = met ? (template === 'title' ? 'TITLE WON' : template === 'europe' ? 'TOP FOUR' : 'SURVIVED') : 'MISSED'
  const icon = sacked ? '🪑' : met ? (template === 'title' ? '🏆' : '✅') : '❌'
  const lastPlayed = Math.max(season.takeoverAt ?? 0, ...season.fixtures.filter((f) => f.result && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM)).map((f) => f.matchweek))
  const mine = sacked
    ? `Sacked after MW ${lastPlayed} with ${club} ${ordinal(position)} on ${points}`
    : template === 'survival'
      ? met
        ? `You kept ${club} up on ${points}`
        : position <= clubs - relegatedDirectly(season.leagueId)
          ? `${club} finished ${ordinal(position)} on ${points} under you, in the relegation play-off place`
          : `${club} went down on ${points} under you`
      : met
        ? template === 'title'
          ? `You won the title with ${club} on ${points}`
          : `You took ${club} into the top four on ${points}`
        : `You finished ${ordinal(position)} with ${club} on ${points}`
  const realText = real ? `the real ${club} ${realFinish(real, clubs, season.leagueId)}` : null
  return {
    template,
    met,
    sacked,
    chip,
    icon,
    position,
    points,
    clubs,
    from: { matchweek: season.takeoverAt ?? 0, position: fromPos, points: start[fromPos - 1].points },
    real,
    line: realText ? `${mine}; ${realText}` : mine,
    realLine: realText ? `📊 The real ${club} ${realFinish(real!, clubs, season.leagueId)}` : null,
  }
}

/** The share text: TouchLine · Run-in · West Ham 2025-26, the takeover, the verdict, the strip, the real club, the seed. */
export function runInShare(game: Game, u: LoadedUniverse, appName?: string): string | null {
  const v = runInVerdict(game, u)
  if (!v) return null
  const story = storyForGame(game, u)
  const strip = (story?.strip ?? []).map((o) => (o === 'W' ? '🟩' : o === 'D' ? '🟨' : '🟥')).join('')
  const club = u.clubById[game.settings.hostClubId]?.shortName ?? game.settings.teamName
  return runInShareText({ title: `${club} ${seasonLabel(game.settings.leagueSeason)}`, from: v.from, icon: v.icon, chip: v.chip, position: v.position, points: v.points, strip, real: v.realLine ?? undefined, seed: game.settings.seed }, appName)
}

/** The Record page's row for a finished run-in. */
export function runInEntry(game: Game, u: LoadedUniverse, date: string): RunInEntry | null {
  const v = runInVerdict(game, u)
  const template = game.settings.runIn?.template
  if (!v || !template) return null
  return {
    id: resultId(game),
    date,
    template,
    teamName: game.settings.teamName,
    leagueId: game.settings.leagueId,
    leagueSeason: game.settings.leagueSeason,
    hostClubId: game.settings.hostClubId,
    seed: game.settings.seed,
    met: v.met,
    sacked: v.sacked,
    position: v.position,
    points: v.points,
    from: v.from,
    ...(v.real ? { real: v.real } : {}),
  }
}

/** Achievements a finished run-in earns (`finishSeason`): the Great Escape keeps a side up that really went down; Run-in Title wins the league from the takeover. */
export function runInUnlocks(game: Game, u: LoadedUniverse, position: number): string[] {
  const season = game.season
  if (!season?.carryIn || season.sacked || game.settings.mode !== 'runin') return []
  const out: string[] = []
  const clubs = Object.keys(season.ai).length + 1
  const real = u.tables[season.leagueId]?.[season.leagueSeason]?.find((r) => r.clubId === season.hostClubId)
  // A side that really went down: the Bundesliga's 16th went to a play-off, so only its two below count
  if (game.settings.runIn?.template === 'survival' && real && real.position > clubs - relegatedDirectly(season.leagueId) && position <= clubs - 3) out.push('great-escape')
  if (position === 1) out.push('run-in-title')
  return out
}

/** A job in one line for the setup: `18th, 28 points after matchweek 28 (projected), 1 point behind safety`. */
export function jobLine(job: RunInJob): string {
  return `${ordinal(job.projected.position)}, ${job.projected.points} points after matchweek ${job.takeover} (projected), ${gapLine(job.template, job.target, job.projected.position, job.gap)}`
}

/** Every choice a run-in starts with, in one line above Start: `West Ham United 2025-26 · Stay up: finish 17th or better · 4-2-3-1 · 4 spins · Realistic · seed K7Q2-MX9A`. */
export function summariseRunIn(u: LoadedUniverse, s: GameSettings): string {
  const template = s.runIn?.template ?? 'survival'
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === s.leagueId && cs.season === s.leagueSeason).length
  return `${u.clubById[s.hostClubId]?.name ?? s.hostClubId} ${seasonLabel(s.leagueSeason)} · ${runInBrief(template, briefTarget(template, clubs)).label} · ${getFormation(s.formationId).name} · ${RUN_IN_SPINS} spins · Realistic · seed ${s.seed}`
}
