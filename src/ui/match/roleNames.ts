/**
 * Short role names for a small space (the pitch's slot labels): a word or two a manager would write on a team sheet,
 * never a clipped fragment. Presentation only: the ids and the full names in `@engine/roles` never change. Pure.
 */
import { ROLES, ROLE_BY_ID } from '@engine/roles'
import { ROLE_CODE } from './shirts'

/** The longest short name, in characters: a slot's label shows it before it falls back to the three-letter code. */
export const SHORT_ROLE_MAX = 11

/** One short name for every role id; a role whose full name is already short keeps it. */
export const ROLE_SHORT: Record<string, string> = {
  'gk-stopper': 'Stopper',
  'gk-sweeper': 'Sweeper',
  'cb-stopper': 'Stopper',
  'cb-cover': 'Cover',
  'cb-bpd': 'Ball-Play',
  'lb-fullback': 'Full-Back',
  'lb-wingback': 'Wing-Back',
  'lb-inverted': 'Inverted',
  'rb-fullback': 'Full-Back',
  'rb-wingback': 'Wing-Back',
  'rb-inverted': 'Inverted',
  'dm-anchor': 'Anchor',
  'dm-dlp': 'Deep-Lying',
  'dm-bwm': 'Ball-Winner',
  'cm-b2b': 'B2B',
  'cm-playmaker': 'Playmaker',
  'cm-mezzala': 'Mezzala',
  'cm-carrilero': 'Carrilero',
  'am-ap': 'Playmaker',
  'am-shadow': 'Shadow',
  'am-treq': 'Trequarti',
  'lw-winger': 'Winger',
  'lw-inside': 'Inside',
  'lw-wideplay': 'Wide PM',
  'lw-defwing': 'Def Wing',
  'rw-winger': 'Winger',
  'rw-inside': 'Inside',
  'rw-wideplay': 'Wide PM',
  'rw-defwing': 'Def Wing',
  'st-poacher': 'Poacher',
  'st-target': 'Target',
  'st-complete': 'Complete',
  'st-false9': 'False 9',
  'st-pressing': 'Pressing',
}

/** A role's short name by id (its full name for an id with no entry). */
export function shortRoleName(roleId: string): string {
  return ROLE_SHORT[roleId] ?? ROLE_BY_ID[roleId]?.name ?? roleId
}

const BY_NAME = new Map(ROLES.map((r) => [r.name, r.id]))

/** The id of the role with this full display name (the left and right sides share one name, and one short form). */
function idOfName(name: string): string | undefined {
  return BY_NAME.get(name)
}

/** The short name of a role given by its full display name; undefined for text that is not a role (a bare position). */
export function shortRoleByName(name: string): string | undefined {
  const id = idOfName(name)
  return id ? ROLE_SHORT[id] : undefined
}

/** The three-letter code of a role given by its full display name; undefined for text that is not a role. */
export function roleCodeByName(name: string): string | undefined {
  const id = idOfName(name)
  return id ? ROLE_CODE[id] : undefined
}

/**
 * What a slot's role line shows for the room it has: the full name when it fits, else the short name, else the code.
 * `width` is a function of the text so the caller owns the font's metrics; `suffix` (the fit note) is part of the line.
 */
export function roleLine(full: string, fits: (text: string) => boolean, suffix = '', code?: string): string {
  if (fits(full + suffix)) return full
  const short = shortRoleByName(full)
  if (short && short !== full && fits(short + suffix)) return short
  return code ?? roleCodeByName(full) ?? short ?? full
}
