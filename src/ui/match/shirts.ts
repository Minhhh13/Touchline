/**
 * Shirts, numbers and codes for the match-day views: classic shirt numbers by
 * position, short role codes, Football Manager style position codes, surnames,
 * team codes and kit colours (our own: club colours, never real kits).
 * Pure: no React, no DOM.
 */
import type { Appearance } from '@engine/match'
import type { LoadedUniverse } from '@engine/universe'
import { USER_TEAM } from '@engine/season'
import { DEFAULT_ROLE } from '@engine/roles'
import type { Formation, Position, Tactics } from '@engine/types'
import { colourDistance, kitColour } from './pitchGeometry'

/** The numbers a position reaches for first, in order. */
const NUMBER_PREFERENCE: Record<Position, number[]> = {
  GK: [1],
  RB: [2],
  LB: [3],
  CB: [5, 4, 6],
  DM: [6, 4, 16],
  CM: [8, 4, 6, 14],
  AM: [10, 8],
  RW: [7, 11],
  LW: [11, 7],
  ST: [9, 10, 19, 11],
}

/**
 * Shirt numbers for one side in one match: starters in formation slot order
 * take the first free number of their position's list, else any free 2..11;
 * the bench takes 12 upwards in bench order; a man who came on without a
 * known bench (a replay) takes the next free number in the order he came on.
 * Unique within the side and stable through the match.
 */
export function shirtNumbers(formation: Formation, appearances: Appearance[], bench: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  const used = new Set<number>()
  const take = (id: string, n: number) => {
    out[id] = n
    used.add(n)
  }
  const nextFree = (from: number) => {
    let n = from
    while (used.has(n)) n++
    return n
  }
  const slotIndex = new Map(formation.slots.map((s, i) => [s.id, i]))
  const starters = appearances.filter((a) => a.onAt === 0).sort((a, b) => (slotIndex.get(a.slotId) ?? 99) - (slotIndex.get(b.slotId) ?? 99))
  const later: Appearance[] = []
  for (const a of starters) {
    const position = formation.slots.find((s) => s.id === a.slotId)?.position ?? a.position
    const n = NUMBER_PREFERENCE[position].find((x) => !used.has(x))
    if (n !== undefined) take(a.psId, n)
    else later.push(a)
  }
  for (const a of later) {
    const n = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].find((x) => !used.has(x))
    take(a.psId, n ?? nextFree(12))
  }
  for (const id of bench) if (out[id] === undefined) take(id, nextFree(12))
  for (const a of appearances.filter((x) => x.onAt > 0).sort((x, y) => x.onAt - y.onAt)) if (out[a.psId] === undefined) take(a.psId, nextFree(12))
  return out
}

/** Short role codes, at most three letters, unique within a position. */
export const ROLE_CODE: Record<string, string> = {
  'gk-stopper': 'GK',
  'gk-sweeper': 'SK',
  'cb-stopper': 'SCB',
  'cb-cover': 'CD',
  'cb-bpd': 'BPD',
  'lb-fullback': 'FB',
  'lb-wingback': 'WB',
  'lb-inverted': 'IFB',
  'rb-fullback': 'FB',
  'rb-wingback': 'WB',
  'rb-inverted': 'IFB',
  'dm-anchor': 'A',
  'dm-dlp': 'DLP',
  'dm-bwm': 'BWM',
  'cm-b2b': 'BBM',
  'cm-playmaker': 'CPM',
  'cm-mezzala': 'MEZ',
  'cm-carrilero': 'CAR',
  'am-ap': 'AP',
  'am-shadow': 'SS',
  'am-treq': 'T',
  'lw-winger': 'W',
  'lw-inside': 'IF',
  'lw-wideplay': 'WP',
  'lw-defwing': 'DW',
  'rw-winger': 'W',
  'rw-inside': 'IF',
  'rw-wideplay': 'WP',
  'rw-defwing': 'DW',
  'st-poacher': 'P',
  'st-target': 'TM',
  'st-complete': 'CF',
  'st-false9': 'F9',
  'st-pressing': 'PF',
}

/** The role code a slot plays in these tactics (the position's default role when none is set). */
export function roleCode(tactics: Tactics, slotId: string, position: Position): string {
  return ROLE_CODE[tactics.roles[slotId] ?? DEFAULT_ROLE[position]] ?? ROLE_CODE[DEFAULT_ROLE[position]]
}

/**
 * The Football Manager position code of a slot: GK, DC, DL / DR (WBL / WBR in
 * a back three), DM, MC, AMC, ML / MR for a wide man in midfield, AML / AMR for
 * a wide forward, STC.
 */
export function positionCode(formation: Formation, slotId: string): string {
  const slot = formation.slots.find((s) => s.id === slotId)
  if (!slot) return '?'
  const backThree = formation.slots.filter((s) => s.position === 'CB').length >= 3
  switch (slot.position) {
    case 'GK':
      return 'GK'
    case 'CB':
      return 'DC'
    case 'LB':
      return backThree || slot.id === 'lwb' ? 'WBL' : 'DL'
    case 'RB':
      return backThree || slot.id === 'rwb' ? 'WBR' : 'DR'
    case 'DM':
      return 'DM'
    case 'CM':
      return 'MC'
    case 'AM':
      return 'AMC'
    case 'LW':
      return slot.y < 62 ? 'ML' : 'AML'
    case 'RW':
      return slot.y < 62 ? 'MR' : 'AMR'
    case 'ST':
      return 'STC'
  }
}

const PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'da', 'di', 'du', 'del', 'della', 'dos', 'das', 'la', 'le', 'ter', 'ten', 'mac', 'st.'])

/** The name on the back of the shirt: the last word, keeping a "van" or "de" with it. */
export function surname(name: string | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return parts[0] ?? '?'
  let i = parts.length - 1
  while (i > 1 && PARTICLES.has(parts[i - 1].toLowerCase())) i--
  if (i === 1 && PARTICLES.has(parts[0].toLowerCase())) i = 0
  return parts.slice(i).join(' ')
}

function clubFor(u: LoadedUniverse, hostClubId: string, teamId: string) {
  return u.clubById[teamId === USER_TEAM ? hostClubId : teamId.replace(/^friendly-/, '')]
}

/** A team's code for the scoreboard: the user's own initials, a club's three-letter code, else its short name. */
export function teamCode(u: LoadedUniverse, teamId: string, fallback: string, userShortName?: string): string {
  if (teamId === USER_TEAM && userShortName) return userShortName.toUpperCase().slice(0, 4)
  const club = u.clubById[teamId.replace(/^friendly-/, '')]
  return (club?.code ?? fallback).toUpperCase().slice(0, 4)
}

/** Kit colours for the two sides: the user wears the host club's colours, an AI club its own; a clash falls back to the second colour. */
export function kitColours(u: LoadedUniverse, hostClubId: string, homeTeamId: string, awayTeamId: string): { home: string; away: string } {
  const h = clubFor(u, hostClubId, homeTeamId)
  const a = clubFor(u, hostClubId, awayTeamId)
  const home = kitColour(h?.colours, a?.colours.primary ?? '#888888', '#3ddc84')
  const away = kitColour(a?.colours, home, '#5ec2ff')
  return { home, away }
}

/** Goalkeeper shirts in order of preference: gold, purple, black, orange. */
export const KEEPER_KITS = ['#e8b923', '#7b3fa0', '#151515', '#f07c1a']

/** A goalkeeper's shirt that stands apart from both outfield kits: the first of gold, purple, black and orange at least 120 away from both. */
export function keeperKit(home: string, away: string): string {
  const far = KEEPER_KITS.find((k) => colourDistance(k, home) >= 120 && colourDistance(k, away) >= 120)
  if (far) return far
  return [...KEEPER_KITS].sort((x, y) => Math.min(colourDistance(y, home), colourDistance(y, away)) - Math.min(colourDistance(x, home), colourDistance(x, away)))[0]
}
