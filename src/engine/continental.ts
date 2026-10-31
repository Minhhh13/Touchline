/**
 * The Continental Cup from engine 7: four groups of four, each side meeting
 * the other three at home and away, the top two of each group through to
 * two-legged quarter-finals and semi-finals (goals over both legs, no away
 * goals rule: extra time and penalties after the second leg when level) and a
 * one-off final at a neutral ground. One format for the Season and Dynasty
 * (`SeasonState.continental.groups`, played on midweeks of the league season)
 * and the Quick Draft's post-season run (`QuickCupRun.groups`). An engine 6
 * Continental Cup (no `groups`) keeps playing its single-tie knockout.
 *
 * Pure: every random draw comes from the `Rng` passed in.
 */
import type { Rng } from './rng'
import type { Fixture, TableRow } from './types'
import { computeTable, cupRounds, extraTime, shootout, type CupRoundInfo, type CupTie } from './season'

/** Groups in the draw, and sides in each. */
export const GROUP_COUNT = 4
export const GROUP_SIZE = 4
export const GROUP_NAMES: readonly string[] = ['A', 'B', 'C', 'D']
/** Matchdays in a group of four played home and away. */
export const GROUP_MATCHDAYS = 6
/** Sides in the draw: the user and fifteen others. */
export const CONTINENTAL_ENTRANTS = GROUP_COUNT * GROUP_SIZE

/**
 * A group's fixtures by matchday, as indices into its teams, home side first: each pair meets twice with the venues
 * swapped, every side has three home games, alternating or with at most two running at home or away, and matchdays 3
 * and 4 are the same pairs (as the real competition plays them).
 */
export const GROUP_SCHEDULE: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [0, 1],
    [2, 3],
  ],
  [
    [1, 2],
    [3, 0],
  ],
  [
    [0, 2],
    [3, 1],
  ],
  [
    [2, 0],
    [1, 3],
  ],
  [
    [2, 1],
    [0, 3],
  ],
  [
    [1, 0],
    [3, 2],
  ],
]

/** One group match. `matchweek` is the league matchweek it follows (a midweek), or its matchday after a league season. */
export interface GroupMatch extends Fixture {
  matchday: number
}

export interface ContinentalGroup {
  /** `A` to `D`. */
  name: string
  /** The four sides, in the order they were drawn from the pots. */
  teams: string[]
  matches: GroupMatch[]
}

/** A knockout round of the format: QF and SF have a first leg, the final does not. */
export interface ContinentalRound extends CupRoundInfo {
  /** The matchweek the first leg follows; `afterMatchweek` is the second leg's. */
  firstLeg?: number
}

export interface ContinentalPlan {
  /** The matchweek each group matchday follows. */
  groupWeeks: number[]
  rounds: ContinentalRound[]
}

/**
 * The format's calendar inside a league season of `matchweeks`: the six group matchdays after matchweeks 3, 5, 8, 10,
 * 12 and 16 of 38, the quarter-finals after 19 and 21, the semi-finals after 27 and 29 and the final after 33, scaled
 * to the league's length and moved a week on where that would share a midweek with another of them or with a
 * domestic cup round (6, 14, 24 and 36 of 38): every one its own midweek, before the last matchweek, for any league
 * of 26 to 46 matchweeks (tested).
 */
export function continentalPlan(matchweeks: number): ContinentalPlan {
  const at = (mw38: number) => Math.max(1, Math.min(matchweeks - 1, Math.round((mw38 / 38) * matchweeks)))
  // Scaled, then nudged a week later where a short league puts two midweeks together or on a domestic cup week
  const cup = new Set(cupRounds(matchweeks).map((r) => r.afterMatchweek))
  const weeks: number[] = []
  for (const w of [3, 5, 8, 10, 12, 16, 19, 21, 27, 29, 33].map(at)) {
    let x = Math.max(w, (weeks.at(-1) ?? 0) + 1)
    while (cup.has(x)) x++
    weeks.push(x)
  }
  return {
    groupWeeks: weeks.slice(0, 6),
    rounds: [
      { round: 'QF', firstLeg: weeks[6], afterMatchweek: weeks[7], label: 'Continental quarter-final' },
      { round: 'SF', firstLeg: weeks[8], afterMatchweek: weeks[9], label: 'Continental semi-final' },
      { round: 'F', afterMatchweek: weeks[10], label: 'Continental final' },
    ],
  }
}

/** The post-season run's plan: matchdays 1 to 6, then the knockout weeks numbered on (legs 7 and 8, 9 and 10, the final 11). Only the order matters there. */
export const POST_SEASON_PLAN: ContinentalPlan = {
  groupWeeks: [1, 2, 3, 4, 5, 6],
  rounds: [
    { round: 'QF', firstLeg: 7, afterMatchweek: 8, label: 'Continental quarter-final' },
    { round: 'SF', firstLeg: 9, afterMatchweek: 10, label: 'Continental semi-final' },
    { round: 'F', afterMatchweek: 11, label: 'Continental final' },
  ],
}

/**
 * The entrants in pot order: the field strongest first (as `buildContinentalClubs` returns it) with the user at the
 * head of the second pot, so the user never meets more than one of the four strongest in the groups.
 */
export function potOrder(field: string[], userId: string): string[] {
  const rest = field.filter((id) => id !== userId)
  return [...rest.slice(0, GROUP_SIZE), userId, ...rest.slice(GROUP_SIZE)].slice(0, CONTINENTAL_ENTRANTS)
}

/**
 * The group draw: the sixteen entrants (in pot order, `potOrder`) cut into four pots of four, each pot shuffled (four
 * shuffles, nothing else), group g taking the g-th side of every pot; then each group's six matchdays from
 * `GROUP_SCHEDULE` on `plan.groupWeeks`.
 */
export function drawGroups(entrants: string[], rng: Rng, plan: ContinentalPlan): ContinentalGroup[] {
  if (entrants.length !== CONTINENTAL_ENTRANTS) throw new Error(`The Continental Cup needs ${CONTINENTAL_ENTRANTS} sides`)
  const pots = Array.from({ length: GROUP_SIZE }, (_, p) => rng.shuffle(entrants.slice(p * GROUP_COUNT, (p + 1) * GROUP_COUNT)))
  return GROUP_NAMES.map((name, g) => {
    const teams = pots.map((pot) => pot[g])
    const matches: GroupMatch[] = GROUP_SCHEDULE.flatMap((day, d) => day.map(([h, a]) => ({ matchday: d + 1, matchweek: plan.groupWeeks[d], homeTeamId: teams[h], awayTeamId: teams[a] })))
    return { name, teams, matches }
  })
}

/** A group's table: points, then goal difference, goals scored and the side's id, as every league table is ordered. */
export function groupTable(group: Pick<ContinentalGroup, 'teams' | 'matches'>): TableRow[] {
  return computeTable(group.matches, group.teams)
}

/** Every match of the group stage is played. */
export function groupsComplete(groups: ContinentalGroup[]): boolean {
  return groups.every((g) => g.matches.every((m) => !!m.result))
}

/** The side finishing `place` (1 or 2) in each group once its six matchdays are played, by group. */
export function groupPlaces(groups: ContinentalGroup[], place: 1 | 2): string[] {
  return groups.map((g) => groupTable(g)[place - 1].teamId)
}

/** Whether a side came through its group (top two), once every match is played. */
export function throughGroups(groups: ContinentalGroup[], teamId: string): boolean {
  const g = groups.find((x) => x.teams.includes(teamId))
  if (!g || !g.matches.every((m) => !!m.result)) return false
  return groupTable(g)
    .slice(0, 2)
    .some((r) => r.teamId === teamId)
}

/**
 * The quarter-finals, fixed by the groups (no draw): A1 v B2, B1 v A2, C1 v D2, D1 v C2, the runner-up at home in the
 * first leg and the group winner at home in the second.
 */
export function quarterFinals(groups: ContinentalGroup[], plan: ContinentalPlan): CupTie[] {
  const first = groupPlaces(groups, 1)
  const second = groupPlaces(groups, 2)
  const qf = plan.rounds[0]
  const pairs: Array<[number, number]> = [
    [0, 1],
    [1, 0],
    [2, 3],
    [3, 2],
  ]
  return pairs.map(([w, r]) => ({ round: qf.round, afterMatchweek: qf.afterMatchweek, homeTeamId: second[r], awayTeamId: first[w], firstLeg: { afterMatchweek: qf.firstLeg! } }))
}

/** The next knockout round drawn from the winners of `round`'s ties (one shuffle), with its first leg when it has one. */
export function drawContinentalRound(ties: CupTie[], round: CupTie['round'], rng: Rng, plan: ContinentalPlan): CupTie[] {
  const at = plan.rounds.findIndex((r) => r.round === round)
  const next = plan.rounds[at + 1]
  if (at < 0 || !next) return []
  const winners = ties.filter((t) => t.round === round && t.winnerId).map((t) => t.winnerId!)
  rng.shuffle(winners)
  const out: CupTie[] = []
  for (let i = 0; i + 1 < winners.length; i += 2) out.push({ round: next.round, afterMatchweek: next.afterMatchweek, homeTeamId: winners[i], awayTeamId: winners[i + 1], ...(next.firstLeg ? { firstLeg: { afterMatchweek: next.firstLeg } } : {}) })
  return out
}

/** A tie's outcome from its own sides (`homeTeamId` first): goals over the tie, extra time included, and the shoot-out. */
export interface TieScore {
  home: number
  away: number
  /** The deciding match went to extra time. */
  et?: boolean
  pens?: { home: number; away: number }
  /** A two-legged tie's legs, each from the tie's sides (`homeTeamId`'s goals first). */
  legs?: Array<{ home: number; away: number }>
}

/** The score of a tie as it stands: a decided tie's aggregate (`agg`), an engine 6 tie's single result, a first leg alone, or null before a ball is kicked. */
export function tieScore(t: CupTie): TieScore | null {
  const l1 = t.firstLeg?.result
  const legs = t.firstLeg ? [...(l1 ? [{ home: l1.homeGoals, away: l1.awayGoals }] : []), ...(t.result ? [{ home: t.result.awayGoals, away: t.result.homeGoals }] : [])] : undefined
  if (t.agg) return { home: t.agg.home, away: t.agg.away, ...(t.agg.et ? { et: true } : {}), ...(t.agg.pens ? { pens: t.agg.pens } : {}), ...(legs ? { legs } : {}) }
  if (t.firstLeg) return l1 ? { home: legs!.reduce((s, l) => s + l.home, 0), away: legs!.reduce((s, l) => s + l.away, 0), legs } : null
  if (!t.result) return null
  return { home: t.result.homeGoals, away: t.result.awayGoals, ...(t.result.penalties ? { pens: t.result.penalties } : {}) }
}

/** Who plays at home in the leg after `matchweek` (the first leg's host, the second leg's or a single match's), or null when the tie has no match then. */
export function legAt(t: CupTie, matchweek: number): { leg: 1 | 2 | 0; homeTeamId: string; awayTeamId: string } | null {
  if (t.firstLeg?.afterMatchweek === matchweek) return { leg: 1, homeTeamId: t.homeTeamId, awayTeamId: t.awayTeamId }
  if (t.afterMatchweek !== matchweek) return null
  return t.firstLeg ? { leg: 2, homeTeamId: t.awayTeamId, awayTeamId: t.homeTeamId } : { leg: 0, homeTeamId: t.homeTeamId, awayTeamId: t.awayTeamId }
}

/** Overall team strength of a match's sides, for the shoot-out's nerve (as the cups have always used). */
export interface Nerve {
  home: number
  away: number
}

/**
 * Settle a tie once its deciding match is in (`tie.result`, the second leg or the one-off final): the aggregate over
 * both legs, then extra time on the deciding match's expected goals (`extraTime`: two draws) when level, then a
 * shoot-out (`shootout`, with the deciding match's sides' nerve) when still level. Writes `agg` and `winnerId`.
 * Extra time and the shoot-out draw from `rng` only when needed.
 */
export function settleTie(t: CupTie, rng: Rng, nerve: Nerve): void {
  const res = t.result
  if (!res) throw new Error('The tie has no deciding match yet')
  const legs = t.firstLeg ? 2 : 1
  // The deciding match's sides: the second leg is at the tie's away side's ground
  const flip = legs === 2
  let home = (flip ? res.awayGoals : res.homeGoals) + (t.firstLeg?.result?.homeGoals ?? 0)
  let away = (flip ? res.homeGoals : res.awayGoals) + (t.firstLeg?.result?.awayGoals ?? 0)
  let et = false
  let pens: { home: number; away: number } | undefined
  if (home === away) {
    et = true
    const extra = extraTime(rng, res.xg)
    home += flip ? extra.away : extra.home
    away += flip ? extra.home : extra.away
    if (home === away) {
      const p = shootout(rng, nerve.home, nerve.away)
      pens = flip ? { home: p.away, away: p.home } : p
    }
  }
  t.agg = { home, away, ...(et ? { et: true } : {}), ...(pens ? { pens } : {}) }
  t.winnerId = home > away ? t.homeTeamId : away > home ? t.awayTeamId : pens!.home > pens!.away ? t.homeTeamId : t.awayTeamId
}

/** The deciding match's extra-time goals of a settled tie (its own sides, home first), for crediting scorers: null when it ended in ninety minutes. */
export function extraTimeGoals(t: CupTie): { home: number; away: number } | null {
  if (!t.agg?.et || !t.result) return null
  const flip = !!t.firstLeg
  const l1 = t.firstLeg?.result
  const home = t.agg.home - (flip ? t.result.awayGoals : t.result.homeGoals) - (l1?.homeGoals ?? 0)
  const away = t.agg.away - (flip ? t.result.homeGoals : t.result.awayGoals) - (l1?.awayGoals ?? 0)
  return flip ? { home: away, away: home } : { home, away }
}

/** The furthest stage a side reached (`G` for out in the groups, `W` for winners), or undefined when it was never in the draw. */
export function continentalReach(groups: ContinentalGroup[], ties: CupTie[], teamId: string): 'G' | 'QF' | 'SF' | 'F' | 'W' | undefined {
  if (!groups.some((g) => g.teams.includes(teamId))) return undefined
  const order = ['G', 'QF', 'SF', 'F'] as const
  let best: (typeof order)[number] = 'G'
  for (const t of ties) {
    if (t.homeTeamId !== teamId && t.awayTeamId !== teamId) continue
    if (t.round === 'F' && t.winnerId === teamId) return 'W'
    const r = order.find((x) => x === t.round)
    if (r && order.indexOf(r) > order.indexOf(best)) best = r
  }
  return best
}
