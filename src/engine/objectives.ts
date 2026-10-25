/**
 * Board objectives beyond the league position: two a season, checked at the
 * end. Met ones add transfer budget and board confidence; missed ones cost
 * confidence. They give a mid-table season something to play for.
 */
import type { Rng } from './rng'
import type { SeasonState, CupTie } from './season'
import { USER_TEAM, positionOf, seasonTable } from './season'
import type { PlayerSeason, SquadPlayer } from './types'

export type ObjectiveId = 'cup-qf' | 'cup-sf' | 'goals' | 'home-form' | 'youth' | 'continental-qf' | 'rivals'

export interface Objective {
  id: ObjectiveId
  label: string
  /** Numeric target where one applies (goals, starts, losses). */
  target?: number
  /** Filled in at the end of the season. */
  met?: boolean
  /** Progress text for the UI, filled in by `describeProgress`. */
}

export const OBJECTIVE_REWARD = { budget: 5, confidence: 8, miss: -6 }

function reached(ties: CupTie[], round: CupTie['round']): boolean {
  return ties.some((t) => t.round === round && (t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM))
}

/** Two objectives suited to the board's ambition: stronger sides get harder asks. */
export function pickObjectives(rng: Rng, boardTarget: number, matchweeks: number, hasContinental: boolean, hasRivals: boolean): Objective[] {
  const ambitious = boardTarget <= 4
  const goalsTarget = Math.round(matchweeks * (ambitious ? 1.9 : 1.5))
  const pool: Objective[] = [
    ambitious ? { id: 'cup-sf', label: 'Reach the cup semi-final' } : { id: 'cup-qf', label: 'Reach the cup quarter-final' },
    { id: 'goals', label: `Score ${goalsTarget} league goals`, target: goalsTarget },
    { id: 'home-form', label: ambitious ? 'Lose at most two home league matches' : 'Lose at most four home league matches', target: ambitious ? 2 : 4 },
    { id: 'youth', label: 'Give a player aged 21 or under ten league starts', target: 10 },
  ]
  if (hasContinental) pool.push({ id: 'continental-qf', label: 'Reach the Continental Cup quarter-final' })
  if (hasRivals) pool.push({ id: 'rivals', label: 'Do not lose to a rival' })
  const shuffled = rng.shuffle([...pool])
  return shuffled.slice(0, 2)
}

export interface ObjectiveContext {
  season: SeasonState
  squad: Array<{ p: PlayerSeason; s: SquadPlayer }>
  rivals: string[]
}

/** Current progress and whether the objective stands met if the season ended now. */
export function evaluateObjective(o: Objective, ctx: ObjectiveContext): { met: boolean; progress: string } {
  const { season } = ctx
  const mine = season.fixtures.filter((f) => f.result && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM))
  switch (o.id) {
    case 'cup-qf':
    case 'cup-sf': {
      const round = o.id === 'cup-qf' ? 'QF' : 'SF'
      const met = reached(season.cup, round)
      return { met, progress: met ? 'Reached' : season.cupEliminated ? 'Knocked out early' : 'Still in the cup' }
    }
    case 'continental-qf': {
      const ties = season.continental?.ties ?? []
      const met = reached(ties, 'QF')
      return { met, progress: met ? 'Reached' : season.continental?.eliminated ? 'Knocked out in the round of 16' : 'Still in Europe' }
    }
    case 'goals': {
      const table = seasonTable(season)
      const row = table.find((r) => r.teamId === USER_TEAM)
      const gf = row?.goalsFor ?? 0
      return { met: gf >= (o.target ?? 0), progress: `${gf} of ${o.target}` }
    }
    case 'home-form': {
      const losses = mine.filter((f) => f.homeTeamId === USER_TEAM && f.result!.homeGoals < f.result!.awayGoals).length
      return { met: losses <= (o.target ?? 0), progress: `${losses} home defeat${losses === 1 ? '' : 's'} (limit ${o.target})` }
    }
    case 'youth': {
      const best = Math.max(0, ...ctx.squad.filter((x) => x.p.age <= 21).map((x) => x.s.seasonStats.starts))
      return { met: best >= (o.target ?? 0), progress: `best ${best} of ${o.target} starts` }
    }
    case 'rivals': {
      const lost = mine.filter((f) => {
        const home = f.homeTeamId === USER_TEAM
        const opp = home ? f.awayTeamId : f.homeTeamId
        if (!ctx.rivals.includes(opp)) return false
        const gf = home ? f.result!.homeGoals : f.result!.awayGoals
        const ga = home ? f.result!.awayGoals : f.result!.homeGoals
        return gf < ga
      }).length
      return { met: lost === 0, progress: lost ? `Lost ${lost} derb${lost === 1 ? 'y' : 'ies'}` : 'Unbeaten in derbies so far' }
    }
  }
}

export { positionOf }
