/**
 * Season Highlights: "Sim to the next big match". The assistant plays the
 * routine weeks exactly as Sim 5 does and hands the manager the ones that
 * matter: derbies, title deciders, cup semi-finals and finals, the run-in
 * while the title or survival is open, the January window and a board on the
 * brink. Reading a stop is pure and draws no random number, so the weeks the
 * run plays are the same weeks `simWeeks(k)` would play.
 */
import { ordinal, type LoadedUniverse } from '@engine/universe'
import { describeImportance, positionOf, seasonTable, USER_TEAM, type Competition } from '@engine/season'
import type { Game } from '../types'
import { nextOpponent, playMatchweekSteps, runSteps, startSeasonProper, upcomingCupTie, WEEK_END, type GameBox, type WeekStep } from './week'
import { briefOpen, briefStanding, gapLine, RUN_IN_LAST_STOPS } from './runin'

/** Why the sim stopped, most important first among the before-the-week reasons. */
export type StopKind = 'final' | 'semi-final' | 'title-decider' | 'derby' | 'brief' | 'title-run-in' | 'survival-run-in' | 'window' | 'board'

export interface StopReason {
  kind: StopKind
  /** The matchweek the stop is about: the week to play next for a match stop, the week just played for the window and the board. */
  matchweek: number
  /** The stop in words: `Derby day`, `Cup semi-final`, `Title run-in`, `January window`. */
  label: string
  /** The opponent of a match stop. */
  opponentClubId?: string
  home?: boolean
  /** Set on a cup stop. */
  comp?: Competition
  /** Run-in stops: points from the top (title) or from the drop line (survival), signed from the user's side. */
  gap?: number
  /** Survival run-in: the user is inside the bottom three. */
  inDrop?: boolean
  /** Board stop: the confidence it fell to. */
  confidence?: number
  /** Run-in brief stop: where the brief stands (`18th, 1 point behind safety`). */
  detail?: string
}

/** Matchweeks at the end of the season that count as the run-in. */
export const RUN_IN_WEEKS = 5
/** A race within this many points is still open. */
export const RUN_IN_GAP = 3
/** Board confidence below this, crossed in a simmed week with job security on, stops the sim. */
export const BOARD_ALARM = 25
/** Importance from `describeImportance` at or above which a league match stops the sim (Derby day 1.25, Title decider 1.3). */
export const BIG_MATCH = 1.2
const RELEGATION_PLACES = 3

/**
 * The reason to stop before the next matchweek, or null when the assistant may
 * play it. Pure: reads the table, the fixture and the knockout draw.
 */
export function nextStop(game: Game, u: LoadedUniverse): StopReason | null {
  const season = game.season
  if (!season || season.sacked || season.matchweek >= season.matchweeks || game.phase === 'summary') return null
  const mw = season.matchweek + 1
  const table = seasonTable(season)

  const tie = upcomingCupTie(game)
  if (tie && (tie.round === 'F' || tie.round === 'SF')) {
    const home = tie.homeTeamId === USER_TEAM
    const opponentClubId = home ? tie.awayTeamId : tie.homeTeamId
    const label = describeImportance(u, season.hostClubId, opponentClubId, null, mw, tie.round, tie.comp).label ?? tie.label
    return { kind: tie.round === 'F' ? 'final' : 'semi-final', matchweek: mw, label, opponentClubId, home, comp: tie.comp }
  }

  const opp = nextOpponent(game)
  if (opp) {
    const imp = describeImportance(u, season.hostClubId, opp.clubId, table, mw)
    if (imp.importance >= BIG_MATCH) return { kind: imp.label === 'Title decider' ? 'title-decider' : 'derby', matchweek: mw, label: imp.label ?? 'Big match', opponentClubId: opp.clubId, home: opp.home }
  }

  // A run-in: each of the last three matchweeks while the brief can still go either way
  if (season.carryIn && mw > season.matchweeks - RUN_IN_LAST_STOPS && briefOpen(game)) {
    const b = briefStanding(game)!
    return { kind: 'brief', matchweek: mw, label: 'Run-in decider', gap: b.gap, detail: `${ordinal(b.position)}, ${gapLine(b.template, b.target, b.position, b.gap)}`, opponentClubId: opp?.clubId, home: opp?.home }
  }

  if (mw > season.matchweeks - RUN_IN_WEEKS) {
    const n = table.length
    const pos = positionOf(table, USER_TEAM)
    const pts = table[pos - 1].points
    // Title: top by three or fewer, or within three of the top
    const titleGap = pos === 1 ? pts - (table[1]?.points ?? 0) : pts - table[0].points
    if (n > 1 && Math.abs(titleGap) <= RUN_IN_GAP) return { kind: 'title-run-in', matchweek: mw, label: 'Title run-in', gap: titleGap }
    // Survival: in the bottom three while safety can still be reached, or within three points above the drop line
    if (n > RELEGATION_PLACES + 1) {
      const lastSafe = table[n - RELEGATION_PLACES - 1].points
      const firstDown = table[n - RELEGATION_PLACES].points
      const left = season.fixtures.filter((f) => f.matchweek >= mw && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM)).length
      const down = pos > n - RELEGATION_PLACES
      if (down && pts + 3 * left >= lastSafe) return { kind: 'survival-run-in', matchweek: mw, label: 'Survival run-in', gap: pts - lastSafe, inDrop: true }
      if (!down && pts - firstDown <= RUN_IN_GAP) return { kind: 'survival-run-in', matchweek: mw, label: 'Survival run-in', gap: pts - firstDown, inDrop: false }
    }
  }
  return null
}

/** What a week changed that can stop the sim after it: read before the week is played. */
export interface WeekMark {
  confidence: number
  januaryOpen: boolean
}

export function weekMark(game: Game): WeekMark {
  return { confidence: game.season?.confidence ?? 0, januaryOpen: game.window?.kind === 'january' }
}

/** The reason to stop after a simmed week: the January window opened, or the board crossed into alarm. */
export function stopAfterWeek(game: Game, before: WeekMark): StopReason | null {
  const season = game.season
  if (!season || season.sacked || game.phase === 'summary') return null
  const mw = season.matchweek
  if (!before.januaryOpen && game.window?.kind === 'january' && game.window.day === 0) return { kind: 'window', matchweek: mw, label: 'January window' }
  if (game.settings.jobSecurity && before.confidence >= BOARD_ALARM && season.confidence < BOARD_ALARM) return { kind: 'board', matchweek: mw, label: 'Board alarm', confidence: Math.round(season.confidence) }
  return null
}

/**
 * Play matchweeks with the assistant until the next stop, the end of the
 * season or a sacking, whichever comes first. The stop week is not played.
 * Each week is `simWeeks`' step: `playMatchweek(game, u, true)` and the phase
 * back to `week`. Returns the stop, or null when the run ended the season.
 */
export function simToNextStop(game: Game, u: LoadedUniverse): StopReason | null {
  return runSteps(simToNextStopSteps({ g: game }, u))
}

/** `simToNextStop` in steps (each week's `playMatchweekSteps`, then `WEEK_END`), for a caller that gives the page a task between them. */
export function* simToNextStopSteps(box: GameBox, u: LoadedUniverse): Generator<WeekStep, StopReason | null, undefined> {
  if (box.g.phase === 'preseason') startSeasonProper(box.g, u)
  for (;;) {
    const game = box.g
    const season = game.season
    if (game.phase === 'summary' || !season || season.sacked || season.matchweek >= season.matchweeks) return null
    const before = nextStop(game, u)
    if (before) return before
    const m = weekMark(game)
    yield* playMatchweekSteps(game, u, true)
    if (game.phase === 'match') game.phase = 'week'
    const after = stopAfterWeek(game, m)
    if (after) return after
    yield WEEK_END
  }
}

/**
 * The first stop that can be seen coming from the fixtures and the draw: the
 * next derby, a drawn semi-final or final, the week the January window opens.
 * Title deciders, the run-in and the board depend on results still to come, so
 * the sim may stop earlier than this. Null when nothing is in sight.
 */
export function foreseeStop(game: Game, u: LoadedUniverse): { label: string; matchweek: number } | null {
  const season = game.season
  if (!season || season.sacked || season.matchweek >= season.matchweeks || game.phase === 'summary') return null
  const found: Array<{ label: string; matchweek: number }> = []
  const derby = season.fixtures
    .filter((f) => f.matchweek > season.matchweek && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM))
    .sort((a, b) => a.matchweek - b.matchweek)
    .find((f) => describeImportance(u, season.hostClubId, f.homeTeamId === USER_TEAM ? f.awayTeamId : f.homeTeamId, null, f.matchweek).importance >= BIG_MATCH)
  if (derby) found.push({ label: 'Derby day', matchweek: derby.matchweek })
  const knockouts: Array<{ comp: Competition; out: boolean; ties: typeof season.cup }> = [
    { comp: 'cup', out: season.cupEliminated || season.cupWon, ties: season.cup },
    { comp: 'continental', out: !season.continental || season.continental.eliminated || season.continental.won, ties: season.continental?.ties ?? [] },
  ]
  for (const k of knockouts) {
    if (k.out) continue
    const tie = k.ties.find((t) => !t.result && (t.round === 'SF' || t.round === 'F') && t.afterMatchweek > season.matchweek && (t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM))
    // A two-legged tie (engine 7's Continental Cup) stops at its first leg while that is still to play, as `nextStop` does
    const at = tie?.firstLeg && !tie.firstLeg.result && tie.firstLeg.afterMatchweek > season.matchweek ? tie.firstLeg.afterMatchweek : tie?.afterMatchweek
    if (tie && at) found.push({ label: describeImportance(u, season.hostClubId, '', null, at, tie.round, k.comp).label ?? 'Cup tie', matchweek: at })
  }
  const half = Math.floor(season.matchweeks / 2)
  if (!game.window && season.matchweek < half) found.push({ label: 'the January window', matchweek: half })
  found.sort((a, b) => a.matchweek - b.matchweek)
  return found[0] ?? null
}

/** The sim button's label: names the target when one is in sight. */
export function simToLabel(game: Game, u: LoadedUniverse): string {
  const seen = foreseeStop(game, u)
  return seen ? `Sim to ${seen.label} (MW ${seen.matchweek})` : 'Sim to the next big match'
}

function ptsWord(n: number): string {
  return `${n} point${n === 1 ? '' : 's'}`
}

function raceLine(stop: StopReason): string {
  const gap = stop.gap ?? 0
  if (stop.kind === 'title-run-in') return gap > 0 ? `top by ${ptsWord(gap)}` : gap < 0 ? `${ptsWord(-gap)} off the top` : 'level on points at the top'
  // Survival: from inside the bottom three the gap is to the last safe place, otherwise the cushion over the first place down
  if (stop.inDrop) return gap < 0 ? `in the bottom three, ${ptsWord(-gap)} from safety` : 'in the bottom three, level on points with safety'
  return gap > 0 ? `${ptsWord(gap)} above the drop zone` : 'level on points with the drop zone'
}

/** The stop in one line, for the Dugout: `Stopped for Derby day v Liverpool, MW 12`. */
export function stopLine(stop: StopReason, u: LoadedUniverse): string {
  const name = (id: string) => u.clubById[id]?.name ?? id
  const versus = stop.opponentClubId ? ` ${stop.home === false ? 'at' : 'v'} ${name(stop.opponentClubId)}` : ''
  switch (stop.kind) {
    case 'final':
    case 'semi-final':
      return `Stopped for the ${stop.label}${versus}, midweek after MW ${stop.matchweek}`
    case 'title-decider':
    case 'derby':
      return `Stopped for ${stop.label}${versus}, MW ${stop.matchweek}`
    case 'brief':
      return `Stopped for the run-in decider${versus}, MW ${stop.matchweek}${stop.detail ? `: ${stop.detail}` : ''}`
    case 'title-run-in':
      return `Stopped for the title run-in, MW ${stop.matchweek}: ${raceLine(stop)}`
    case 'survival-run-in':
      return `Stopped for the survival run-in, MW ${stop.matchweek}: ${raceLine(stop)}`
    case 'window':
      return `Stopped: the January window opened after MW ${stop.matchweek}`
    case 'board':
      return `Stopped: board confidence fell to ${stop.confidence ?? 0} after MW ${stop.matchweek}`
    default: {
      const never: never = stop.kind
      return never
    }
  }
}
