/**
 * Team instructions and how they interact with the opponent. Every modifier
 * here is explained to the player in the UI, so keep effects legible.
 */
import type { PlayStyle, Tactics } from './types'
import { DEFAULT_ROLE, getRole } from './roles'
import type { SlotEvaluation } from './ratings'
import { getFormation } from './formations'

export interface TacticalModifiers {
  /** Multiplier on own expected goals. */
  attack: number
  /** Multiplier on opposition expected goals. */
  defence: number
  /** Extra condition lost per 90 minutes (points). */
  fatigue: number
  /** Human-readable reasons, for the match report. */
  notes: string[]
}

export function defaultTactics(formationId = '4-3-3'): Tactics {
  const f = getFormation(formationId)
  const roles: Record<string, string> = {}
  for (const s of f.slots) roles[s.id] = DEFAULT_ROLE[s.position]
  return { formationId, mentality: 'balanced', pressing: 'mid', tempo: 'standard', width: 'standard', defensiveLine: 'standard', passing: 'mixed', roles }
}

/** Keep roles valid when the formation changes: reuse by slot id, default otherwise. */
export function retargetRoles(tactics: Tactics, newFormationId: string): Tactics {
  const f = getFormation(newFormationId)
  const roles: Record<string, string> = {}
  for (const s of f.slots) {
    const existing = tactics.roles[s.id]
    roles[s.id] = existing && getRole(existing).position === s.position ? existing : DEFAULT_ROLE[s.position]
  }
  return { ...tactics, formationId: newFormationId, roles }
}

/** Tactical style the AI uses for a club, converted to a full Tactics object. */
export function tacticsForStyle(style: PlayStyle, formationId: string): Tactics {
  const t = defaultTactics(formationId)
  switch (style) {
    case 'possession':
      return { ...t, mentality: 'balanced', pressing: 'mid', tempo: 'slow', width: 'standard', defensiveLine: 'high', passing: 'short' }
    case 'counter':
      return { ...t, mentality: 'balanced', pressing: 'low', tempo: 'fast', width: 'standard', defensiveLine: 'deep', passing: 'direct' }
    case 'direct':
      return { ...t, mentality: 'balanced', pressing: 'mid', tempo: 'fast', width: 'wide', defensiveLine: 'standard', passing: 'direct' }
    case 'press':
      return { ...t, mentality: 'attacking', pressing: 'high', tempo: 'fast', width: 'standard', defensiveLine: 'high', passing: 'mixed' }
    case 'defensive':
      return { ...t, mentality: 'defensive', pressing: 'low', tempo: 'slow', width: 'narrow', defensiveLine: 'deep', passing: 'direct' }
    default:
      return t
  }
}

export const STYLE_LABEL: Record<PlayStyle, string> = {
  possession: 'Possession',
  counter: 'Counter-attack',
  direct: 'Direct',
  press: 'High press',
  defensive: 'Defensive',
  balanced: 'Balanced',
}

/**
 * Compute how our instructions play against theirs.
 * `ours`/`theirs` are the evaluated slots so instructions can check the players
 * actually asked to execute them (a high line needs quick centre-backs).
 */
export function tacticalModifiers(ours: Tactics, ourSlots: SlotEvaluation[], theirs: Tactics, theirSlots: SlotEvaluation[]): TacticalModifiers {
  let attack = 1
  let defence = 1
  let fatigue = 0
  const notes: string[] = []
  const formation = getFormation(ours.formationId)

  // Mentality
  if (ours.mentality === 'attacking') {
    attack *= 1.12
    defence *= 1.1
    notes.push('Attacking mentality: more chances both ways')
  } else if (ours.mentality === 'defensive') {
    attack *= 0.86
    defence *= 0.86
    notes.push('Defensive mentality: fewer chances both ways')
  }

  // Pressing
  const ourStamina = avg(ourSlots.filter((s) => s.position !== 'GK').map((s) => s.player.attributes.physical))
  const theirComposure = avg(theirSlots.filter((s) => s.position !== 'GK').map((s) => s.player.attributes.mentality))
  if (ours.pressing === 'high') {
    const edge = clamp((78 - theirComposure) / 100, -0.06, 0.08)
    attack *= 1.05 + edge
    defence *= 1.03 - edge * 0.5
    fatigue += ourStamina >= 78 ? 4 : 7
    notes.push(edge > 0.02 ? 'High press is rattling a nervy opponent' : edge < -0.02 ? 'High press is being played through by a composed side' : 'High press: more turnovers, more space behind')
  } else if (ours.pressing === 'low') {
    attack *= 0.96
    defence *= 0.95
    fatigue -= 2
    notes.push('Low block: compact and patient')
  }

  // Tempo
  if (ours.tempo === 'fast') {
    attack *= 1.04
    defence *= 1.03
    fatigue += 2
  } else if (ours.tempo === 'slow') {
    attack *= 0.97
    defence *= 0.96
  }

  // Width vs the shape we have
  const wideAttackers = formation.slots.filter((s) => s.position === 'LW' || s.position === 'RW').length
  if (ours.width === 'wide') {
    attack *= wideAttackers >= 2 ? 1.04 : 0.98
    notes.push(wideAttackers >= 2 ? 'Wide play stretches the defence' : 'Wide instructions with no wingers waste width')
  } else if (ours.width === 'narrow') {
    attack *= wideAttackers <= 1 ? 1.04 : 0.98
    if (theirs.width === 'wide') defence *= 1.03
  }

  // Defensive line vs the pace of our centre-backs and their forwards
  const cbPace = avg(ourSlots.filter((s) => s.position === 'CB').map((s) => s.player.attributes.pace))
  const theirFwdPace = avg(theirSlots.filter((s) => ['ST', 'LW', 'RW'].includes(s.position)).map((s) => s.player.attributes.pace))
  if (ours.defensiveLine === 'high') {
    attack *= 1.03
    if (cbPace >= Math.min(84, theirFwdPace - 2)) {
      defence *= 0.98
      notes.push('High line: quick defenders are coping')
    } else {
      defence *= 1.08
      notes.push('High line is exposed by pace in behind')
    }
  } else if (ours.defensiveLine === 'deep') {
    attack *= 0.96
    defence *= 0.95
    if (theirs.passing === 'direct') defence *= 1.02
  }

  // Passing style vs the players asked to deliver it
  const midPassing = avg(ourSlots.filter((s) => ['DM', 'CM', 'AM'].includes(s.position)).map((s) => s.player.attributes.passing))
  const stPhysical = avg(ourSlots.filter((s) => s.position === 'ST').map((s) => s.player.attributes.physical))
  if (ours.passing === 'short') {
    attack *= midPassing >= 80 ? 1.04 : midPassing >= 72 ? 1 : 0.96
    notes.push(midPassing >= 80 ? 'Short passing suits a technical midfield' : midPassing < 72 ? 'Short passing with a limited midfield is costing chances' : 'Short passing: steady build-up')
  } else if (ours.passing === 'direct') {
    attack *= stPhysical >= 80 ? 1.04 : stPhysical >= 72 ? 1 : 0.96
    notes.push(stPhysical >= 80 ? 'Direct play finds a powerful target' : stPhysical < 72 ? 'Direct balls are bouncing off a slight striker' : 'Direct play: quick transitions')
  }

  // Roles' flat effects
  let creativity = 0
  let solidity = 0
  for (const s of ourSlots) {
    creativity += s.role.effects?.creativity ?? 0
    solidity += s.role.effects?.solidity ?? 0
    fatigue += (s.role.effects?.fatigue ?? 0) / 11
  }
  attack *= 1 + creativity / 100
  defence *= 1 - solidity / 100

  // Style match-ups against the opponent's instructions
  if (theirs.pressing === 'low' && theirs.mentality === 'defensive') {
    attack *= 0.92
    notes.push('Opponent is parking the bus')
  }
  if (theirs.tempo === 'fast' && theirs.passing === 'direct' && ours.defensiveLine === 'high') {
    defence *= 1.05
    notes.push('Their counters target our high line')
  }
  if (theirs.passing === 'short' && theirs.tempo === 'slow' && ours.pressing !== 'high') {
    attack *= 0.97
    notes.push('They keep the ball; we see less of it')
  }

  return { attack: round3(attack), defence: round3(defence), fatigue: Math.round(fatigue), notes }
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 70
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Formations AI clubs favour by style. */
export function formationForStyle(style: PlayStyle): string {
  switch (style) {
    case 'possession':
      return '4-3-3'
    case 'counter':
      return '4-2-3-1'
    case 'direct':
      return '4-4-2'
    case 'press':
      return '4-3-3'
    case 'defensive':
      return '5-3-2'
    default:
      return '4-2-3-1'
  }
}

export const MENTALITY_HELP = {
  defensive: 'Sit deeper, fewer risks. Cuts chances at both ends.',
  balanced: 'Play the game in front of you.',
  attacking: 'Commit bodies forward. More chances for everyone.',
}
export const PRESSING_HELP = {
  low: 'Stay compact, protect the box. Tiring for nobody.',
  mid: 'Press in the middle third when the moment is right.',
  high: 'Hunt the ball in their half. Punishes nervy sides, drains legs.',
}
export const TEMPO_HELP = {
  slow: 'Keep the ball, pick the moment.',
  standard: 'Mix it up.',
  fast: 'Move it quickly. More chances, more mistakes.',
}
export const WIDTH_HELP = {
  narrow: 'Play through the middle. Best with a diamond or no wingers.',
  standard: 'Use the whole pitch.',
  wide: 'Stretch them. Needs real wingers.',
}
export const LINE_HELP = {
  deep: 'Defend near your own box. Fewer chances conceded, fewer created.',
  standard: 'A sensible middle.',
  high: 'Squeeze the pitch. Needs quick centre-backs or you will be run in behind.',
}
export const PASSING_HELP = {
  short: 'Patient build-up. Needs technical midfielders.',
  mixed: 'Whatever the moment asks for.',
  direct: 'Get it forward early. Needs a physical striker.',
}
