/**
 * The office's actions for the screens (Football Manager depth, round 8): each runs one function of
 * `src/game/logic/office.ts` and its modules through the store's `runOffice`, like any store action. This module and
 * the office's logic ride in the Dugout's chunk, not the first download; importing it registers the office's tick.
 */
import { useStore, registerOfficeTick } from './store'
import type { OfficePromise } from './types'
import { officeTick, setListed } from './logic/office'
import { makePromise, type MinutesLevel } from './logic/promises'
import { answerRequest, type RequestAnswer } from './logic/transferRequests'
import { converse, type ConversationResult, type ConversationTone, type ConversationTopic } from './logic/conversations'
import { answerPress, type PressQuestion } from './logic/pressConference'
import { counterBid, offerTerms, proposeFee, walkAway, type FeeAnswer, type FeeDeal, type TermsOffer } from './logic/transferTalks'

registerOfficeTick(officeTick)

type Line = { ok: boolean; message: string }
const NO_GAME: Line = { ok: false, message: 'No game' }
const run = <T,>(fn: Parameters<ReturnType<typeof useStore.getState>['runOffice']>[0], fallback: T, opts?: { unlock?: boolean }): T => useStore.getState().runOffice(fn as never, fallback, opts) as T

export const officeActions = {
  makePromise: (id: string, kind: OfficePromise['kind'], level?: MinutesLevel): Line => run((g, u) => makePromise(g, u, id, kind, level), NO_GAME),
  answerRequest: (id: string, answer: RequestAnswer): Line => run((g, u) => answerRequest(g, u, id, answer), NO_GAME),
  converse: (id: string, topic: ConversationTopic, tone: ConversationTone): ConversationResult => run((g, u) => converse(g, u, id, topic, tone), NO_GAME),
  answerPress: (q: PressQuestion, answer: string): Line => run((g, u) => answerPress(g, u, q, answer), NO_GAME),
  proposeFee: (listingId: string, deal: FeeDeal): FeeAnswer => run((g, u) => proposeFee(g, u, listingId, deal), NO_GAME),
  walkAway: (listingId: string): void => run((g) => walkAway(g, listingId), undefined),
  offerTerms: (listingId: string, offer: TermsOffer): Line & { signed?: boolean } => run((g, u) => offerTerms(g, u, listingId, offer), NO_GAME, { unlock: true }),
  counterBid: (index: number, amount: number): Line & { sold?: boolean } => run((g, u) => counterBid(g, u, index, amount), NO_GAME),
  setListed: (id: string, on: boolean): Line => run((g, u) => setListed(g, u, id, on), NO_GAME),
}
