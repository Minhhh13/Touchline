/**
 * Actions on an Inbox item: the buttons that take the manager from the news to
 * the screen where he can act on it ("Talk to him" opens the player, "Rest
 * him" the player with his bench button, "Offer a new contract" the pending
 * renewal, "Medical" the planner's medical box). They only open existing
 * screens and existing actions: no new game logic. Pure.
 */
import type { NewsItem } from '@engine/season'
import type { Game } from '../types'
import type { BriefingAction } from './briefing'

/** At most this many buttons on an item. */
export const INBOX_ACTIONS_CAP = 2
/** A player in the XI below this condition is offered a rest. */
export const REST_CONDITION = 70

/** Events about one player (the rest name a player only as colour, such as the star of a press conference). */
const PLAYER_EVENTS = new Set(['wants-minutes', 'bust-up', 'captain', 'contract', 'wantaway', 'rush'])

/** The player an event's Inbox item is about, if it is about one. */
export function eventPlayer(ev: { id: string; playerSeasonId?: string }): string | undefined {
  return PLAYER_EVENTS.has(ev.id) ? ev.playerSeasonId : undefined
}

export function inboxActions(item: NewsItem, game: Game): BriefingAction[] {
  const out: BriefingAction[] = []
  const id = item.playerId && game.squad[item.playerId] ? item.playerId : undefined
  const s = id ? game.squad[id] : undefined
  const inXI = !!id && Object.values(game.lineup).includes(id)
  const pending = game.pendingEvent
  if (id && s) {
    const c = game.contracts[id]
    if (pending?.id === 'contract' && pending.playerSeasonId === id) out.push({ label: 'Offer a new contract', op: 'event' })
    if (item.kind === 'injury') out.push({ label: s.injury ? 'Medical' : 'View him', tab: s.injury ? 'planner' : undefined, op: s.injury ? undefined : 'player', playerId: id })
    else if (item.kind === 'suspension') out.push({ label: 'Pick the XI', tab: 'squad' })
    else if (inXI && !s.injury && s.condition < REST_CONDITION) out.push({ label: 'Rest him', op: 'player', playerId: id })
    if (item.kind === 'event' || s.morale < 55) out.push({ label: 'Talk to him', op: 'player', playerId: id })
    if (!out.length && c && c.years <= 1 && !c.renewed && !c.declined && !c.loan) out.push({ label: 'Contracts', tab: 'planner' })
    if (!out.length) out.push({ label: 'View him', op: 'player', playerId: id })
  } else {
    switch (item.kind) {
      case 'transfer':
        if (game.window) out.push({ label: 'Market', tab: 'market' })
        break
      case 'cup':
        out.push({ label: 'Cup', tab: 'cup' })
        break
      case 'board':
        out.push({ label: 'Club', tab: 'club' })
        break
      case 'training':
        out.push({ label: 'Planner', tab: 'planner' })
        break
      case 'result':
        out.push({ label: 'Dressing room', tab: 'dressing' })
        break
      case 'event':
        if (pending) out.push({ label: 'Decide', op: 'event' })
        break
    }
  }
  // One button per destination
  const seen = new Set<string>()
  return out.filter((a) => {
    const key = `${a.op ?? ''}|${a.tab ?? ''}|${a.playerId ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, INBOX_ACTIONS_CAP)
}
