/**
 * The assistant's own changes for the user's side: the routine and injury substitutions the engine makes between the
 * stops (reasons `tired`, `tactical` and `injury`), told apart from the manager's (half time, the 70th minute, a change
 * in play) by the side's substitution list. The commentary words them as the assistant's and the dashboard toasts them
 * as they come up on the clock. Display only: nothing here decides when or whether a change happens. Pure.
 */
import type { MatchFeed } from '@engine/matchFeed'
import type { Substitution } from '@engine/match'
import type { MatchEvent } from '@engine/types'

/** The reasons the engine gives the changes it makes by itself. */
export const ASSISTANT_REASONS: ReadonlySet<string> = new Set(['tired', 'tactical', 'injury'])

/** Whether `e` is a change the engine made for `side` by itself (not one the manager asked for). */
export function isAssistantSub(e: MatchEvent, subs: Substitution[], side: 'home' | 'away'): boolean {
  if (e.type !== 'substitution' || e.side !== side || !e.playerId || !e.secondaryId) return false
  return subs.some((s) => s.off === e.playerId && s.on === e.secondaryId && ASSISTANT_REASONS.has(s.reason))
}

/** "Your assistant brings on F. Wirtz for A. Mac Allister." (for the injured man when he was hurt). */
export function assistantSubText(e: MatchEvent): string {
  const on = e.secondaryName ?? 'a substitute'
  const off = e.playerName ?? 'a team-mate'
  return /injured/.test(e.text) ? `Your assistant brings on ${on} for the injured ${off}.` : `Your assistant brings on ${on} for ${off}.`
}

/** The assistant's changes for `side` shown after minute `after`, up to and including `upTo`, in order. */
export function assistantSubsBetween(feed: MatchFeed, side: 'home' | 'away', after: number, upTo: number): MatchEvent[] {
  const subs = feed[side].subs
  return feed.events.filter((e) => e.minute > after && e.minute <= upTo && isAssistantSub(e, subs, side))
}

/** The toast for the changes that have just come up: one sentence for one, a short list for several; null for none. */
export function assistantSubToast(events: MatchEvent[]): string | null {
  if (!events.length) return null
  if (events.length === 1) return assistantSubText(events[0]).replace(/\.$/, '')
  return `Your assistant makes ${events.length} changes: ${events.map((e) => `${e.secondaryName ?? 'a substitute'} for ${e.playerName ?? 'a team-mate'}`).join(', ')}`
}
