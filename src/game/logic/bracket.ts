/**
 * A knockout as a bracket: every round from the first to the final, each round's ties put in tree order (the two
 * ties whose winners meet next sit side by side, so the lines between rounds join), the user's route through it and
 * the order a cup run's ties are revealed in. One view for the Quick Draft's post-season cups, the Season's Cup and
 * Continental Cup and the arena's Cup (`components/Bracket.tsx` draws it). Pure: no RNG, nothing written.
 */
import { USER_TEAM, type CupRoundInfo, type CupTie as SeasonCupTie } from '@engine/season'
import { cupRoundCount, cupRoundName } from '@engine/cup'
import type { QuickCupRun } from '../types'
import { cupRoundLabel, quickCupRounds, type QuickCupComp } from './quickCups'

/** One tie as the bracket draws it. Sides are ids (`USER_TEAM` for the user); goals are absent until it is played. */
export interface BracketTie {
  home: string
  away: string
  hg?: number
  ag?: number
  /** Went to extra time. */
  et?: boolean
  pens?: { home: number; away: number }
  winner?: string
}

export interface BracketRound {
  name: string
  /** The ties drawn, in tree order; empty while the round is still to be drawn. */
  ties: BracketTie[]
  /** How many ties the round holds once drawn. */
  slots: number
  /** Said in place of the ties while the round is not drawn ("Drawn after matchweek 14"). */
  pending?: string
}

export interface BracketView {
  rounds: BracketRound[]
  /** The cup's winner, once the final is played. */
  champion?: string
  /** Only the user's own ties are known (a run played before the bracket was kept): the rounds hold one tie each. */
  pathOnly?: boolean
}

/** Whether a side is in a tie. */
export function inTie(t: Pick<BracketTie, 'home' | 'away'>, id: string): boolean {
  return t.home === id || t.away === id
}

/**
 * Each round's ties reordered, from the last round drawn back to the first, so that ties 2k and 2k+1 of a round feed
 * tie k of the next one (the side that came from the earlier tie on top). A round whose next round is not drawn yet
 * keeps its drawn order. The ties themselves are not copied or changed.
 */
export function treeOrder<T extends BracketTie>(rounds: ReadonlyArray<ReadonlyArray<T>>): T[][] {
  const out = rounds.map((r) => [...r])
  for (let r = out.length - 2; r >= 0; r--) {
    const next = out[r + 1]
    if (!next.length) continue
    const place = new Map<string, number>()
    next.forEach((t, i) => {
      place.set(t.home, i * 2)
      place.set(t.away, i * 2 + 1)
    })
    const at = (t: T) => (t.winner !== undefined && place.has(t.winner) ? place.get(t.winner)! : Number.MAX_SAFE_INTEGER)
    // A stable sort: ties whose winner is not in the next round (none in a played bracket) keep their order at the end
    out[r] = out[r].map((t, i) => ({ t, i })).sort((a, b) => at(a.t) - at(b.t) || a.i - b.i).map((x) => x.t)
  }
  return out
}

/** A bracket from its rounds' names and ties (`undefined` or empty for a round not drawn), in tree order. */
export function buildBracket(names: string[], rounds: ReadonlyArray<ReadonlyArray<BracketTie> | undefined>, pending: (round: number) => string | undefined = () => undefined): BracketView {
  const ordered = treeOrder(names.map((_, r) => rounds[r] ?? []))
  const first = ordered[0]?.length || 2 ** Math.max(0, names.length - 1)
  const view: BracketView = {
    rounds: names.map((name, r) => {
      const ties = ordered[r]
      const round: BracketRound = { name, ties, slots: Math.max(1, Math.round(first / 2 ** r)) }
      if (!ties.length) {
        const why = pending(r)
        if (why) round.pending = why
      }
      return round
    }),
  }
  const final = view.rounds.at(-1)?.ties
  if (final?.length === 1 && final[0].winner) view.champion = final[0].winner
  return view
}

/** The bracket of a Quick Draft post-season cup run; a run from before the bracket shows the user's own ties alone. */
export function quickCupBracket(run: QuickCupRun, comp: QuickCupComp): BracketView {
  const names = quickCupRounds(comp).map((r) => cupRoundLabel(comp, r.round))
  if (run.bracket?.length) return buildBracket(names, run.bracket)
  const rounds = quickCupRounds(comp).map((info) =>
    run.ties
      .filter((t) => t.round === info.round)
      .map((t): BracketTie => {
        const winner = t.won ? USER_TEAM : t.opponentId
        const hg = t.home ? t.gf : t.ga
        const ag = t.home ? t.ga : t.gf
        return { home: t.home ? USER_TEAM : t.opponentId, away: t.home ? t.opponentId : USER_TEAM, hg, ag, ...(t.et ? { et: true } : {}), ...(t.pens ? { pens: t.home ? { home: t.pens.for, away: t.pens.against } : { home: t.pens.against, away: t.pens.for } } : {}), winner }
      }),
  )
  const view: BracketView = { rounds: names.map((name, r) => ({ name, ties: rounds[r], slots: 1 })), pathOnly: true }
  if (run.reached === 'W') view.champion = USER_TEAM
  return view
}

/**
 * The bracket of a Season's Cup or Continental Cup from its ties so far (a compacted save keeps every score, the
 * penalties and the winner). A round not drawn yet says after which matchweek it will be.
 */
export function seasonCupBracket(ties: SeasonCupTie[], rounds: CupRoundInfo[]): BracketView {
  return buildBracket(
    rounds.map((r) => r.label.replace(/^Continental /, '').replace(/^./, (c) => c.toUpperCase())),
    rounds.map((info) =>
      ties
        .filter((t) => t.round === info.round)
        .map((t): BracketTie => ({
          home: t.homeTeamId,
          away: t.awayTeamId,
          ...(t.result ? { hg: t.result.homeGoals, ag: t.result.awayGoals } : {}),
          ...(t.result?.penalties ? { pens: { home: t.result.penalties.home, away: t.result.penalties.away } } : {}),
          ...(t.winnerId ? { winner: t.winnerId } : {}),
        })),
    ),
    (r) => (r > 0 ? `Drawn after matchweek ${rounds[r - 1].afterMatchweek}` : undefined),
  )
}

/** The bracket of an arena Cup of `size` clubs from its rounds drawn so far; a round to come says after which one it is drawn. */
export function arenaBracketView(size: number, rounds: ReadonlyArray<ReadonlyArray<BracketTie>>): BracketView {
  const names = Array.from({ length: cupRoundCount(size) }, (_, r) => cupRoundName(size, r).name)
  return buildBracket(names, rounds, (r) => (r > 0 ? `Drawn after the ${names[r - 1].toLowerCase()}` : undefined))
}

/** Where the user's tie sits in each round (its index), or null for a round he is not in. */
export function userRoute(view: BracketView, userId: string = USER_TEAM): Array<number | null> {
  return view.rounds.map((r) => {
    const i = r.ties.findIndex((t) => inTie(t, userId))
    return i < 0 ? null : i
  })
}

/**
 * The order a run's ties are revealed in, as a step number per tie (`steps[round][tie]`): round by round, the user's
 * own tie first in its round (it gets its moment before the rest of the round fills in), then the others top to bottom.
 */
export function revealSteps(view: BracketView, userId: string = USER_TEAM): number[][] {
  let n = 0
  return view.rounds.map((r) => {
    const steps = r.ties.map(() => 0)
    const mine = r.ties.findIndex((t) => inTie(t, userId))
    const order = [...(mine >= 0 ? [mine] : []), ...r.ties.map((_, i) => i).filter((i) => i !== mine)]
    for (const i of order) steps[i] = n++
    return steps
  })
}

/** How many reveal steps a bracket has: one per tie drawn. */
export function revealCount(view: BracketView): number {
  return view.rounds.reduce((sum, r) => sum + r.ties.length, 0)
}

/** The tie (round and index) revealed at step `step`, or null past the end. */
export function tieAtStep(steps: number[][], step: number): { round: number; tie: number } | null {
  for (let r = 0; r < steps.length; r++) {
    const i = steps[r].indexOf(step)
    if (i >= 0) return { round: r, tie: i }
  }
  return null
}

/** A tie's score as the bracket prints it from one side: "2-1", "1-1 (4-3 pens)", "3-2 aet". */
export function bracketScore(t: BracketTie): string {
  if (t.hg === undefined || t.ag === undefined) return 'v'
  const base = `${t.hg}-${t.ag}`
  if (t.pens) return `${base} (${t.pens.home}-${t.pens.away} pens)`
  return t.et ? `${base} aet` : base
}
