import type { AiClub } from '@engine/season'
import { computeTeamStrength } from '@engine/ratings'
import { staffTier } from '@engine/staff'
import type { LoadedUniverse } from '@engine/universe'
import type { PlayerSeason, Position, TeamStrength } from '@engine/types'
import type { Game } from '../types'
import { opponentInput } from './squadDisplay'

/** One of the assistant's notes on an opponent, worded by the screen. */
export type OppositionTip = 'slowCbs' | 'nervy' | 'composed' | 'technical' | 'counter' | 'deep' | 'frontHeavy' | 'drilled' | 'weakLink'

export interface OppositionScout {
  strength: TeamStrength
  /** The XI they will field, resolved as the match resolves it (their reserve keeper included when he plays). */
  xi: PlayerSeason[]
  /** Their three best men, best first. */
  stars: PlayerSeason[]
  /** Their weakest outfield man, named only with a scout of tier 2 or better. */
  weak?: PlayerSeason
  injured: number
  tips: OppositionTip[]
}

/** The thresholds behind the notes (attributes, team ratings). */
export const SCOUT_NOTES = { slowCbs: 72, nervy: 72, composed: 80, technical: 80, unitGap: 4, weakLinkTier: 2 } as const

const MIDFIELD: Position[] = ['DM', 'CM', 'AM']
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)

/**
 * The opposition report's facts on an AI side (pure, no draws): its strength, danger men and the assistant's notes.
 * The XI is read through the match's own lookup, so a side fielding its reserve keeper (never in `u.index`) is
 * counted with eleven men.
 */
export function scoutOpposition(game: Game, u: LoadedUniverse, club: AiClub, offset: number): OppositionScout {
  const input = opponentInput(game, u, club, offset)
  const strength = computeTeamStrength(club.tactics, input.lineup, input.getPlayer, input.getState)
  const xi = Object.values(input.lineup)
    .map((id) => input.getPlayer(id))
    .filter((p): p is PlayerSeason => !!p)
  const stars = [...xi].sort((a, b) => b.overall - a.overall).slice(0, 3)
  const weak = staffTier(game.staff, 'scout') >= SCOUT_NOTES.weakLinkTier ? [...xi].filter((p) => p.positions[0] !== 'GK').sort((a, b) => a.overall - b.overall)[0] : undefined
  const injured = club.squad.filter((id) => club.state[id]?.injury).length
  const cbPace = mean(xi.filter((p) => p.positions[0] === 'CB').map((p) => p.attributes.pace))
  const midPassing = mean(xi.filter((p) => MIDFIELD.includes(p.positions[0])).map((p) => p.attributes.passing))
  const composure = mean(xi.map((p) => p.attributes.mentality))
  const tips: OppositionTip[] = []
  if (cbPace < SCOUT_NOTES.slowCbs) tips.push('slowCbs')
  if (composure < SCOUT_NOTES.nervy) tips.push('nervy')
  else if (composure > SCOUT_NOTES.composed) tips.push('composed')
  if (midPassing > SCOUT_NOTES.technical) tips.push('technical')
  if (club.tactics.passing === 'direct' && club.tactics.tempo === 'fast') tips.push('counter')
  if (club.tactics.mentality === 'defensive') tips.push('deep')
  if (strength.attack > strength.defence + SCOUT_NOTES.unitGap) tips.push('frontHeavy')
  if (strength.defence > strength.attack + SCOUT_NOTES.unitGap) tips.push('drilled')
  if (weak) tips.push('weakLink')
  return { strength, xi, stars, weak, injured, tips }
}
