import type { AttributeKey, Position } from './types'

/**
 * Player roles, Football Manager style. A role changes two things:
 *  1. which attributes matter for the player in that slot (the weight map), and
 *  2. how the player's quality is split between the team's units
 *     (a wing-back pushes quality from defence into attack, a ball-winning
 *     midfielder does the opposite).
 */
export interface Role {
  id: string
  name: string
  position: Position
  blurb: string
  weights: Partial<Record<AttributeKey, number>>
  /**
   * Share of this player's rating that flows to each unit.
   * Must sum to 1. 'gk' only used by goalkeeper roles.
   */
  contribution: { gk?: number; defence: number; midfield: number; attack: number }
  /** Flat tactical modifiers applied to the team when this role is used. */
  effects?: Partial<{
    /** Extra chance creation (positive) or suppression (negative), in % of xG. */
    creativity: number
    /** Extra solidity vs opposition chances, in % of xG against. */
    solidity: number
    /** Extra fatigue per match (positive = more tiring). */
    fatigue: number
  }>
}

export const ROLES: Role[] = [
  // Goalkeepers
  role('gk-stopper', 'Shot Stopper', 'GK', 'Stays on the line, makes the saves that matter.', { goalkeeping: 0.78, mentality: 0.12, physical: 0.1 }, { gk: 1, defence: 0, midfield: 0, attack: 0 }, { solidity: 2 }),
  role('gk-sweeper', 'Sweeper Keeper', 'GK', 'Starts attacks and sweeps behind a high line. Needs passing.', { goalkeeping: 0.62, passing: 0.18, mentality: 0.12, pace: 0.08 }, { gk: 0.85, defence: 0, midfield: 0.15, attack: 0 }, { creativity: 2, solidity: -1 }),
  // Centre-backs
  role('cb-stopper', 'Stopper', 'CB', 'Steps in hard and wins the duel. Pure defending.', { defending: 0.48, physical: 0.26, mentality: 0.14, pace: 0.12 }, { defence: 0.95, midfield: 0.05, attack: 0 }, { solidity: 2 }),
  role('cb-cover', 'Covering Defender', 'CB', 'Drops off and reads the game. Pace and anticipation.', { defending: 0.42, pace: 0.24, mentality: 0.2, physical: 0.14 }, { defence: 0.95, midfield: 0.05, attack: 0 }, { solidity: 1 }),
  role('cb-bpd', 'Ball-Playing Defender', 'CB', 'Starts moves from the back. Weaker heading, better feet.', { defending: 0.36, passing: 0.24, mentality: 0.16, physical: 0.14, pace: 0.1 }, { defence: 0.8, midfield: 0.2, attack: 0 }, { creativity: 2, solidity: -1 }),
  // Full-backs (shared definitions for LB and RB generated below)
  ...sideBacks('LB'),
  ...sideBacks('RB'),
  // Defensive midfielders
  role('dm-anchor', 'Anchor', 'DM', 'Sits in front of the defence and never leaves. Shield first.', { defending: 0.42, mentality: 0.24, physical: 0.2, passing: 0.14 }, { defence: 0.6, midfield: 0.4, attack: 0 }, { solidity: 3, creativity: -1 }),
  role('dm-dlp', 'Deep-Lying Playmaker', 'DM', 'Dictates tempo from deep. Every attack goes through them.', { passing: 0.4, mentality: 0.26, defending: 0.18, dribbling: 0.16 }, { defence: 0.3, midfield: 0.6, attack: 0.1 }, { creativity: 3, solidity: -1 }),
  role('dm-bwm', 'Ball-Winning Midfielder', 'DM', 'Hunts the ball all over the pitch. Tiring, disruptive.', { defending: 0.38, physical: 0.3, mentality: 0.18, pace: 0.14 }, { defence: 0.5, midfield: 0.5, attack: 0 }, { solidity: 2, fatigue: 6 }),
  // Central midfielders
  role('cm-b2b', 'Box-to-Box', 'CM', 'Covers every blade of grass. Contributes at both ends.', { physical: 0.24, passing: 0.22, mentality: 0.2, defending: 0.18, shooting: 0.16 }, { defence: 0.3, midfield: 0.45, attack: 0.25 }, { fatigue: 5 }),
  role('cm-playmaker', 'Central Playmaker', 'CM', 'The brain of the team. Keeps the ball and finds the pass.', { passing: 0.4, mentality: 0.24, dribbling: 0.2, defending: 0.16 }, { defence: 0.15, midfield: 0.65, attack: 0.2 }, { creativity: 3, solidity: -1 }),
  role('cm-mezzala', 'Mezzala', 'CM', 'Drifts into the half-space to create and arrive late in the box.', { dribbling: 0.26, passing: 0.24, shooting: 0.2, pace: 0.16, mentality: 0.14 }, { defence: 0.1, midfield: 0.5, attack: 0.4 }, { creativity: 2, solidity: -2 }),
  role('cm-carrilero', 'Carrilero', 'CM', 'Shuttles side to side to protect the flank. Disciplined.', { mentality: 0.26, defending: 0.24, passing: 0.22, physical: 0.18, pace: 0.1 }, { defence: 0.4, midfield: 0.55, attack: 0.05 }, { solidity: 2 }),
  // Attacking midfielders
  role('am-ap', 'Advanced Playmaker', 'AM', 'Finds pockets between the lines and threads the final pass.', { passing: 0.36, dribbling: 0.24, mentality: 0.2, shooting: 0.12, pace: 0.08 }, { defence: 0, midfield: 0.5, attack: 0.5 }, { creativity: 3 }),
  role('am-shadow', 'Shadow Striker', 'AM', 'Plays off the striker and arrives in the box to finish.', { shooting: 0.34, pace: 0.22, dribbling: 0.2, mentality: 0.14, passing: 0.1 }, { defence: 0, midfield: 0.25, attack: 0.75 }, { creativity: 1 }),
  role('am-treq', 'Trequartista', 'AM', 'A free spirit with no defensive duty. Magic or nothing.', { dribbling: 0.3, passing: 0.3, shooting: 0.22, mentality: 0.18 }, { defence: -0.05, midfield: 0.45, attack: 0.6 }, { creativity: 4, solidity: -3 }),
  // Wingers (LW/RW)
  ...wingers('LW'),
  ...wingers('RW'),
  // Strikers
  role('st-poacher', 'Poacher', 'ST', 'Lives in the box. One touch, one goal.', { shooting: 0.5, pace: 0.2, mentality: 0.18, dribbling: 0.12 }, { defence: 0, midfield: 0, attack: 1 }, { creativity: 1 }),
  role('st-target', 'Target Man', 'ST', 'Holds the ball up, wins headers, brings others into play.', { physical: 0.36, shooting: 0.3, mentality: 0.18, passing: 0.16 }, { defence: 0, midfield: 0.2, attack: 0.8 }, { solidity: 1 }),
  role('st-complete', 'Complete Forward', 'ST', 'Does everything. Needs a very complete player to justify it.', { shooting: 0.3, dribbling: 0.2, pace: 0.18, physical: 0.16, passing: 0.16 }, { defence: 0, midfield: 0.15, attack: 0.85 }, { creativity: 2 }),
  role('st-false9', 'False Nine', 'ST', 'Drops into midfield to drag defenders out and create space.', { passing: 0.3, dribbling: 0.26, shooting: 0.22, mentality: 0.22 }, { defence: 0, midfield: 0.4, attack: 0.6 }, { creativity: 3, solidity: -1 }),
  role('st-pressing', 'Pressing Forward', 'ST', 'The first defender. Harasses centre-backs all day.', { physical: 0.3, pace: 0.26, shooting: 0.26, mentality: 0.18 }, { defence: 0.1, midfield: 0.15, attack: 0.75 }, { solidity: 2, fatigue: 6 }),
]

function sideBacks(pos: 'LB' | 'RB'): Role[] {
  const side = pos === 'LB' ? 'lb' : 'rb'
  return [
    role(`${side}-fullback`, 'Full-Back', pos, 'Defends the flank first, supports when safe.', { defending: 0.36, pace: 0.22, physical: 0.16, mentality: 0.14, passing: 0.12 }, { defence: 0.8, midfield: 0.15, attack: 0.05 }, { solidity: 2 }),
    role(`${side}-wingback`, 'Wing-Back', pos, 'Bombs forward and overlaps. Leaves space behind.', { pace: 0.3, dribbling: 0.2, defending: 0.2, physical: 0.16, passing: 0.14 }, { defence: 0.5, midfield: 0.2, attack: 0.3 }, { creativity: 3, solidity: -2, fatigue: 6 }),
    role(`${side}-inverted`, 'Inverted Full-Back', pos, 'Tucks into midfield in possession to build a box.', { passing: 0.28, defending: 0.26, mentality: 0.22, dribbling: 0.14, pace: 0.1 }, { defence: 0.55, midfield: 0.4, attack: 0.05 }, { creativity: 1, solidity: 1 }),
  ]
}

function wingers(pos: 'LW' | 'RW'): Role[] {
  const side = pos === 'LW' ? 'lw' : 'rw'
  return [
    role(`${side}-winger`, 'Winger', pos, 'Hugs the touchline, beats the full-back and crosses.', { pace: 0.3, dribbling: 0.3, passing: 0.2, shooting: 0.1, mentality: 0.1 }, { defence: 0.05, midfield: 0.3, attack: 0.65 }, { creativity: 3 }),
    role(`${side}-inside`, 'Inside Forward', pos, 'Cuts inside to shoot. A second striker from wide.', { shooting: 0.3, pace: 0.26, dribbling: 0.26, mentality: 0.1, passing: 0.08 }, { defence: 0, midfield: 0.15, attack: 0.85 }, { creativity: 1 }),
    role(`${side}-wideplay`, 'Wide Playmaker', pos, 'Comes inside to pick passes. Creativity over pace.', { passing: 0.36, dribbling: 0.24, mentality: 0.2, shooting: 0.12, pace: 0.08 }, { defence: 0.05, midfield: 0.5, attack: 0.45 }, { creativity: 3, solidity: -1 }),
    role(`${side}-defwing`, 'Defensive Winger', pos, 'Tracks back relentlessly. Protects the full-back.', { physical: 0.26, pace: 0.24, defending: 0.2, passing: 0.16, dribbling: 0.14 }, { defence: 0.3, midfield: 0.45, attack: 0.25 }, { solidity: 3, creativity: -2, fatigue: 5 }),
  ]
}

function role(
  id: string,
  name: string,
  position: Position,
  blurb: string,
  weights: Partial<Record<AttributeKey, number>>,
  contribution: Role['contribution'],
  effects?: Role['effects'],
): Role {
  return { id, name, position, blurb, weights, contribution, effects }
}

export const ROLE_BY_ID: Record<string, Role> = Object.fromEntries(ROLES.map((r) => [r.id, r]))

export function rolesFor(position: Position): Role[] {
  return ROLES.filter((r) => r.position === position)
}

/** Sensible default role for each position. */
export const DEFAULT_ROLE: Record<Position, string> = {
  GK: 'gk-stopper',
  CB: 'cb-cover',
  LB: 'lb-fullback',
  RB: 'rb-fullback',
  DM: 'dm-anchor',
  CM: 'cm-b2b',
  AM: 'am-ap',
  LW: 'lw-winger',
  RW: 'rw-inside',
  ST: 'st-complete',
}

export function getRole(id: string): Role {
  const r = ROLE_BY_ID[id]
  if (!r) throw new Error(`Unknown role ${id}`)
  return r
}
