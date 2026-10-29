/**
 * The assistant's briefing (`src/game/logic/briefing.ts`) in the viewer's language where its words are fixed: the
 * buttons, and the pre-season checklist's lines and notes. A line the logic builds from other facts (a lineup problem,
 * a tired starter) reads through the logic's mirror (`logicLine`, r10). `copyMirror.test.ts` holds the English equal. Display only, pure.
 */
import type { BriefingItem } from '@game/logic/briefing'
import { translator } from './i18n'
import { dugout } from './i18n/en/dugout'
import { logicLine } from './i18n/logicText'

const t = translator(dugout)

const ACTIONS: Record<string, () => string> = { 'Auto-pick': () => t('brActAutoPick'), Choose: () => t('brActChoose'), Club: () => t('brActClub'), Contracts: () => t('brActContracts'), Decide: () => t('brActDecide'), Market: () => t('brActMarket'), Medical: () => t('brActMedical'), Office: () => t('brActOffice'), 'Play friendly': () => t('brActFriendly'), Squad: () => t('brActSquad'), Tactics: () => t('brActTactics'), View: () => t('brActView') }

/** A briefing button's words. */
export function briefingActionText(label: string): string {
  return ACTIONS[label]?.() ?? logicLine(label)
}

/** A briefing line's words: the pre-season checklist's, else the logic's own. */
export function briefingLineText(item: Pick<BriefingItem, 'id' | 'text'>): string {
  let m: RegExpExecArray | null
  if (item.id === 'friendlies' && (m = /^Friendlies (\d+)\/(\d+)$/.exec(item.text))) return t('brFriendlies', { n: Number(m[1]), cap: Number(m[2]) })
  if (item.id === 'captain') return (m = /^Captain: (.+)$/.exec(item.text)) ? t('brCaptainNamed', { name: m[1] }) : item.text === 'Captain' ? t('brCaptain') : item.text
  if (item.id === 'roles' && item.text === 'Roles') return t('brRoles')
  if (item.id === 'staff' && (m = /^Staff (\d+)\/(\d+)$/.exec(item.text))) return t('brStaff', { n: Number(m[1]), cap: Number(m[2]) })
  if (item.id === 'set-pieces' && item.text === 'Set pieces') return t('brSetPieces')
  if (item.id === 'renewals' && (m = /^Contracts: (\d+) out$/.exec(item.text))) return t('brRenewals', { n: Number(m[1]) })
  return logicLine(item.text)
}

const HINTS: Record<string, [string, () => string]> = {
  friendlies: ['Each friendly builds sharpness and tactical familiarity, with a small injury risk.', () => t('brFriendliesHint')],
  captain: ['A leader with a strong mentality lifts the side in big matches.', () => t('brCaptainHint')],
  roles: ['Each player has a rating in his role, and the team rating follows.', () => t('brRolesHint')],
  'set-pieces': ['Penalties, free kicks and corners go to the men you choose.', () => t('brSetPiecesHint')],
  renewals: ['Offer terms or let them go. At the opener the assistant keeps the willing ones worth keeping; the rest leave on a free.', () => t('brRenewalsHint')],
}

/** A briefing line's note: the checklist's fixed ones in the viewer's language, else the logic's own. */
export function briefingHintText(item: Pick<BriefingItem, 'id' | 'hint'>): string | undefined {
  const h = HINTS[item.id]
  if (h && item.hint === h[0]) return h[1]()
  if (item.id === 'staff' && item.hint === 'Backroom staff are paid from the wage cap.') return t('brStaffHint')
  return logicLine(item.hint)
}
