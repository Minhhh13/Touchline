/**
 * The Office at a glance (round 9, display only): what each answer to a transfer request risks, how long each
 * promise has left and whether it is on course, what a player thinks of the manager, and the office's items in the
 * Inbox, the digest and the Happiness view. Pure reads of the game: nothing here writes to it (not even
 * `officeOf`), draws or hashes anything new, so a game whose Office is only looked at plays as before
 * (`src/game/__tests__/officeView.test.ts`). Never in the edge verifier's bundle.
 */
import type { Game, OfficePromise, TransferRequest } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { NewsItem } from '@engine/season'
import { MINUTES_PER_WEEK } from '@engine/status'
import { playerLookup } from './players'
import { personalityOf, type PersonalityId } from './personality'
import { agentMood, type AgentMood } from './contracts'
import { HARD_WORD } from './conversations'
import { rippleTargets, squadIdOf, weekOf } from './officeCore'
import { BROKEN_COST, BROKEN_RIPPLE, KEPT_LIFT, MADE_LIFT, MINUTES_SHARE, MINUTES_WEEKS, openPromises, SHARE_SLACK } from './promises'
import { answerProblem, FAILED_TALK_COST, LISTED_LIFT, REFUSED_COST, REFUSED_RIPPLE, REQUEST_PATIENCE, requestPressure, talkOdds, TALKED_ROUND_LIFT, type RequestAnswer } from './transferRequests'

export type Urgency = 'calm' | 'soon' | 'due'
/** on: heading to be kept; behind: can still be kept with more; lost: can no longer be kept; waiting: up to you (a contract, a signing). */
export type PromiseTrack = 'on' | 'behind' | 'lost' | 'waiting'

export interface PromiseClock {
  promise: OfficePromise
  /** Matchweeks until it is judged (a signing: until the window it waits on shuts, so unknown). */
  weeksLeft: number | null
  urgency: Urgency
  track: PromiseTrack
  /** A football promise: minutes a match he still needs, on average, to keep it; his share so far and the target. */
  needPerMatch?: number
  share?: number
  target?: number
  /** 0 to 1. */
  progress: number
}

function urgencyOf(weeksLeft: number | null, windowOpen: boolean): Urgency {
  if (weeksLeft === null) return windowOpen ? 'soon' : 'calm'
  return weeksLeft <= 1 ? 'due' : weeksLeft <= 2 ? 'soon' : 'calm'
}

/** How one open promise stands. */
export function promiseClock(game: Game, u: LoadedUniverse, promise: OfficePromise): PromiseClock {
  const week = weekOf(game)
  const id = squadIdOf(game, u, promise.playerId)
  const s = id ? game.squad[id] : undefined
  if (promise.kind === 'minutes') {
    const weeksLeft = Math.max(0, promise.due - week)
    const span = Math.max(1, promise.due - promise.madeAt)
    const elapsed = Math.max(0, week - promise.madeAt)
    const got = s ? Math.max(0, s.seasonStats.minutes - (promise.minutesAt ?? 0)) : 0
    const target = promise.share ?? 0.5
    const needed = (target - SHARE_SLACK) * MINUTES_PER_WEEK * span - got
    const share = elapsed ? got / (MINUTES_PER_WEEK * elapsed) : undefined
    const track: PromiseTrack = needed <= 0 ? 'on' : needed > weeksLeft * MINUTES_PER_WEEK ? 'lost' : share === undefined || share >= target - SHARE_SLACK ? 'on' : 'behind'
    const needPerMatch = needed > 0 && weeksLeft > 0 ? Math.min(MINUTES_PER_WEEK, Math.ceil(needed / weeksLeft)) : undefined
    const progress = Math.max(0, Math.min(1, got / Math.max(1, (target - SHARE_SLACK) * MINUTES_PER_WEEK * span)))
    return { promise, weeksLeft, urgency: urgencyOf(weeksLeft, false), track, ...(needPerMatch !== undefined ? { needPerMatch } : {}), ...(share !== undefined ? { share } : {}), target, progress }
  }
  if (promise.kind === 'contract') {
    const weeksLeft = Math.max(0, promise.due - week)
    return { promise, weeksLeft, urgency: urgencyOf(weeksLeft, false), track: 'waiting', progress: Math.max(0, Math.min(1, (week - promise.madeAt) / Math.max(1, promise.due - promise.madeAt))) }
  }
  return { promise, weeksLeft: null, urgency: urgencyOf(null, !!game.window), track: 'waiting', progress: game.window ? 0.5 : 0 }
}

/** Every open promise's clock, the most urgent first. */
export function promiseClocks(game: Game, u: LoadedUniverse): PromiseClock[] {
  const rank: Record<Urgency, number> = { due: 0, soon: 1, calm: 2 }
  return openPromises(game)
    .map((p) => promiseClock(game, u, p))
    .sort((a, b) => rank[a.urgency] - rank[b.urgency] || (a.weeksLeft ?? 99) - (b.weeksLeft ?? 99))
}

/** The promises made to one squad player this season, open first, then the settled ones newest first. */
export function promisesTo(game: Game, u: LoadedUniverse, playerSeasonId: string): OfficePromise[] {
  const pid = playerLookup(game, u)(playerSeasonId)?.playerId
  if (!pid) return []
  const mine = (game.office?.promises ?? []).filter((p) => p.playerId === pid && p.year === game.year)
  return [...mine.filter((p) => p.state === 'open'), ...mine.filter((p) => p.state !== 'open').reverse()]
}

export interface AnswerRisk {
  answer: RequestAnswer
  /** Why it cannot be given now. */
  problem: string | null
  /** The chance a word or a promise talks him round. */
  odds?: number
  /** His morale if it works, and if it does not (a talk); his morale for a list or a refusal. */
  win?: number
  lose?: number
  /** A promise it makes: the kind, and its lift now. */
  promise?: OfficePromise['kind']
  promiseLift?: number
  /** Team-mates who would feel it, and by how much each (a refusal). */
  ripple?: { men: number; each: number; squadWide: boolean }
}

/** What each answer to his request risks, the way `answerRequest` would play it. Pure. */
export function requestRisks(game: Game, u: LoadedUniverse, playerSeasonId: string, req: TransferRequest): AnswerRisk[] {
  const broken = game.office?.broken?.[req.playerId] ?? 0
  const lift = (kind: OfficePromise['kind']) => Math.round(MADE_LIFT[kind] * Math.max(0, 1 - 0.4 * broken))
  const answers: RequestAnswer[] = ['talk', 'promise-minutes', 'promise-contract', 'list', 'refuse']
  return answers.map((answer) => {
    const problem = answerProblem(game, u, playerSeasonId, answer)
    if (answer === 'list') return { answer, problem, win: LISTED_LIFT }
    if (answer === 'refuse') {
      const targets = rippleTargets(game, u, playerSeasonId, REFUSED_RIPPLE)
      const squadWide = targets.some((x) => x.delta !== REFUSED_RIPPLE)
      return { answer, problem, lose: REFUSED_COST, ...(targets.length ? { ripple: { men: targets.length, each: REFUSED_RIPPLE, squadWide } } : {}) }
    }
    const odds = talkOdds(game, u, req, answer)
    const kind = answer === 'promise-minutes' ? 'minutes' : answer === 'promise-contract' ? 'contract' : undefined
    return { answer, problem, odds, win: TALKED_ROUND_LIFT, lose: FAILED_TALK_COST, ...(kind ? { promise: kind, promiseLift: lift(kind) } : {}) }
  })
}

/** Matchweeks at the desk before an unanswered request counts as refused, and what that costs him. */
export function requestDeadline(req: TransferRequest): { weeksLeft: number; cost: number } {
  return { weeksLeft: Math.max(0, REQUEST_PATIENCE - (req.waits ?? 0)), cost: REFUSED_COST / 2 }
}

export type Trust = 'trusts' | 'neutral' | 'wary'

export interface PlayerRead {
  morale: number
  personality: PersonalityId
  /** How he takes a hard word: 1 well, −1 badly. */
  skin: number
  agent: AgentMood
  trust: Trust
  kept: number
  broken: number
  /** What a broken promise would cost him, and a kept one lift. */
  stakes: { kept: number; broken: number; ripple: number }
  /** The reason he would give for wanting out, when he is restless (0.3 of pressure and up). */
  restless?: TransferRequest['reason']
}

/** What a squad player thinks of the manager now: his mood, his personality, his agent and whether he believes promises. Pure. */
export function playerRead(game: Game, u: LoadedUniverse, playerSeasonId: string): PlayerRead | null {
  const p = playerLookup(game, u)(playerSeasonId)
  const s = game.squad[playerSeasonId]
  if (!p || !s) return null
  const personality = personalityOf(p).id
  const promises = (game.office?.promises ?? []).filter((x) => x.playerId === p.playerId)
  const kept = promises.filter((x) => x.state === 'kept').length
  const broken = game.office?.broken?.[p.playerId] ?? 0
  const pressure = requestPressure(game, u, playerSeasonId)
  return {
    morale: Math.round(s.morale),
    personality,
    skin: HARD_WORD[personality],
    agent: agentMood(p.playerId),
    trust: broken > 0 ? 'wary' : kept > 0 ? 'trusts' : 'neutral',
    kept,
    broken,
    stakes: { kept: KEPT_LIFT, broken: BROKEN_COST, ripple: BROKEN_RIPPLE },
    ...(pressure && pressure.score >= 0.3 ? { restless: pressure.reason } : {}),
  }
}

/** A football promise's terms, for the answer's line: the share and the matchweeks it runs. */
export function minutesTerms(game: Game): { pct: number; weeks: number } {
  const s = game.season
  const week = weekOf(game)
  return { pct: Math.round(MINUTES_SHARE.regular * 100), weeks: s ? Math.max(0, Math.min(s.matchweeks, week + MINUTES_WEEKS) - week) : MINUTES_WEEKS }
}

/** The board's mood in a word, from its confidence. */
export function boardMood(confidence: number): 'delighted' | 'pleased' | 'patient' | 'uneasy' | 'alarmed' {
  return confidence >= 80 ? 'delighted' : confidence >= 60 ? 'pleased' : confidence >= 45 ? 'patient' : confidence >= 25 ? 'uneasy' : 'alarmed'
}

/** An Inbox item the office posted (older saves carry no mark, so they read as ordinary news). */
export function isOfficeNews(n: Pick<NewsItem, 'office'>): boolean {
  return n.office === true
}

/**
 * The Happiness view's line for a promise kept or broken, with what was promised: the settled promise to him of the
 * same week and verdict. `null` when there is none (an event's promise of a start, an older save).
 */
export function promiseLineKind(promises: OfficePromise[], week: number, kept: boolean): OfficePromise['kind'] | null {
  const hit = promises.find((p) => p.settledAt === week && p.state === (kept ? 'kept' : 'broken'))
  return hit?.kind ?? null
}
