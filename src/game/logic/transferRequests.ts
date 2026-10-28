/**
 * Players who want out (Football Manager depth, round 8). A transfer request
 * comes two ways:
 *
 * - Always, when a promise to him is broken (`promises.ts`): the manager made it.
 * - With player power on (`GameSettings.playerPower`, a Season or Dynasty
 *   option, off by default), on his own: an unhappy man, one short of the
 *   football his status promised, one whose move you turned down, or an
 *   ambitious key man in a struggling side may ask to leave. Each week the
 *   office weighs every man and rolls for at most one new request, on a named
 *   fork of a copy of the stream (`officeRoll`), so the match, market and event
 *   draws never move.
 *
 * The manager answers: talk him round (his professionalism and the reason set
 * the odds), promise him football or a new contract, put him on the list (he
 * settles; offers come as for any listed man) or refuse (he drops 10 and his
 * group 2; a leader's refusal reaches the whole squad). Left unanswered for
 * three matchweeks, a request counts as refused.
 */
import type { Game, TransferRequest } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { EXPECTED_SHARE, STATUS_RANK } from '@engine/status'
import { positionOf, seasonTable, USER_TEAM } from '@engine/season'
import { playerLookup } from './players'
import { personalityOf } from './personality'
import { agentMood } from './contracts'
import { recentShare } from './week'
import { postNews } from './news'
import { makePromise, promiseProblem } from './promises'
import { dressingRoomRipple, lodgeRequest, officeOf, officeRoll, REQUEST_WHY, shiftMorale, squadIdOf, weekOf } from './officeCore'

/** Matchweeks an open request waits before it counts as refused. */
export const REQUEST_PATIENCE = 3
/** Failed talks before he will hear no more. */
export const MAX_REQUEST_TALKS = 2
/** No request in the season's first matchweeks: he gives the season a chance. */
export const SETTLE_IN_WEEKS = 3
/** Highest weekly chance any one man hands in a request. */
export const MAX_REQUEST_CHANCE = 0.4
/** Morale moves for each answer. */
export const LISTED_LIFT = 5
export const REFUSED_COST = -10
export const REFUSED_RIPPLE = -2
export const TALKED_ROUND_LIFT = 5
export const FAILED_TALK_COST = -3

export type RequestAnswer = 'talk' | 'promise-minutes' | 'promise-contract' | 'list' | 'refuse'

export interface RequestPressure {
  /** 0 and up: how hard he is pushing to go. */
  score: number
  reason: TransferRequest['reason']
  /** The parts, for the Office's view of who is restless. */
  parts: Array<{ reason: TransferRequest['reason']; weight: number }>
}

/** How much a squad man wants out now, and the main reason. Pure: no draws. */
export function requestPressure(game: Game, u: LoadedUniverse, playerSeasonId: string): RequestPressure | null {
  const p = playerLookup(game, u)(playerSeasonId)
  const s = game.squad[playerSeasonId]
  const c = game.contracts[playerSeasonId]
  const season = game.season
  if (!p || !s || !c || c.loan || !season) return null
  const parts: RequestPressure['parts'] = []
  const status = c.status ?? 'rotation'
  const share = recentShare(s)
  if (share !== null && (s.recentMinutes?.length ?? 0) >= 4 && share < EXPECTED_SHARE[status] - 0.3) parts.push({ reason: 'minutes', weight: 0.6 })
  if (s.morale < 35) parts.push({ reason: 'morale', weight: s.morale < 25 ? 0.8 : 0.5 })
  const turnedDown = (game.window?.offers ?? []).some((o) => o.playerSeasonId === playerSeasonId && o.status === 'rejected' && o.amount >= p.value * 0.8)
  if (turnedDown) parts.push({ reason: 'interest', weight: 0.6 })
  const personality = personalityOf(p).id
  const mood = agentMood(p.playerId)
  const ambitious = personality === 'driven' || personality === 'big-game' || mood === 'greedy'
  if (season.matchweek >= 8 && STATUS_RANK[status] >= STATUS_RANK['first-team'] && ambitious) {
    const pos = positionOf(seasonTable(season), USER_TEAM)
    const clubs = Object.keys(season.ai).length + 1
    if (pos > Math.ceil((clubs * 2) / 3)) parts.push({ reason: 'results', weight: 0.4 })
  }
  const broken = game.office?.broken?.[p.playerId] ?? 0
  if (broken) parts.push({ reason: 'promise', weight: 0.3 * broken })
  let score = parts.reduce((a, x) => a + x.weight, 0)
  if (ambitious) score *= 1.4
  if (personality === 'model') score *= 0.6
  if (mood === 'loyal') score *= 0.7
  const main = [...parts].sort((a, b) => b.weight - a.weight)[0]
  return { score: Math.round(score * 100) / 100, reason: main?.reason ?? 'morale', parts }
}

/** His weekly chance of handing in a request: nothing under 0.5 of pressure, then a fifth of it, at most 40%. */
export function requestChance(pressure: RequestPressure): number {
  return pressure.score >= 0.5 ? Math.min(MAX_REQUEST_CHANCE, pressure.score * 0.2) : 0
}

/** The requests waiting on the manager, oldest first. */
export function openRequests(game: Game): TransferRequest[] {
  return Object.values(game.office?.requests ?? {})
    .filter((r) => r.stage === 'open' && r.year === game.year)
    .sort((a, b) => a.at - b.at || a.playerId.localeCompare(b.playerId))
}

/**
 * The week's player power: with the option on, each man is weighed and at most one new request is lodged, the man
 * whose roll comes in lowest under his chance. Each roll is its own named fork of a copy of the stream.
 */
export function rollRequests(game: Game, u: LoadedUniverse): TransferRequest | null {
  const season = game.season
  if (!game.settings.playerPower || !season || season.sacked || season.matchweek < SETTLE_IN_WEEKS || season.matchweek >= season.matchweeks) return null
  if (game.settings.mode !== 'season' && game.settings.mode !== 'dynasty') return null
  const get = playerLookup(game, u)
  let best: { id: string; reason: TransferRequest['reason']; margin: number } | null = null
  for (const id of Object.keys(game.squad).sort()) {
    const pressure = requestPressure(game, u, id)
    if (!pressure) continue
    const chance = requestChance(pressure)
    if (chance <= 0) continue
    const pid = get(id)?.playerId ?? id
    const roll = officeRoll(game, `wantout-${game.year}-${season.matchweek}-${pid}`).next()
    if (roll >= chance) continue
    const margin = roll / chance
    if (!best || margin < best.margin) best = { id, reason: pressure.reason, margin }
  }
  return best ? lodgeRequest(game, u, best.id, best.reason) : null
}

/**
 * A request left unanswered too long counts as refused (half the cost: he was ignored, not told no). Only weeks the
 * manager was at the desk count: `sim` is set for the weeks inside a multi-week sim, which a request may arrive in.
 */
export function expireRequests(game: Game, u: LoadedUniverse, sim = false): void {
  if (sim) return
  const week = weekOf(game)
  for (const r of openRequests(game)) {
    if ((r.seen ?? r.at) >= week) continue
    r.seen = week
    r.waits = (r.waits ?? 0) + 1
    if (r.waits < REQUEST_PATIENCE) continue
    const id = squadIdOf(game, u, r.playerId)
    r.stage = 'refused'
    r.settledAt = week
    if (!id) continue
    shiftMorale(game.squad[id], week, REFUSED_COST / 2, 'Transfer request ignored')
    postNews(game, { matchweek: week, kind: 'event', title: `${r.name} feels ignored`, body: `Nobody answered his transfer request, so he takes it as a no.`, playerId: id })
  }
}

/** The odds a word changes his mind, by why he asked, his professionalism and the promises broken to him. */
export function talkOdds(game: Game, u: LoadedUniverse, req: TransferRequest, answer: 'talk' | 'promise-minutes' | 'promise-contract'): number {
  const id = squadIdOf(game, u, req.playerId)
  const p = id ? playerLookup(game, u)(id) : undefined
  if (!p) return 0
  const pro = Math.max(0, Math.min(1, p.traits.professionalism))
  const broken = game.office?.broken?.[req.playerId] ?? 0
  const base =
    answer === 'talk' ? { morale: 0.45, minutes: 0.3, results: 0.35, interest: 0.25, promise: 0.15 }[req.reason]
    : answer === 'promise-minutes' ? (req.reason === 'minutes' || req.reason === 'morale' ? 0.85 : 0.4)
    : req.reason === 'interest' || req.reason === 'results' || req.reason === 'morale' ? 0.7 : 0.4
  return Math.max(0.05, Math.min(0.95, base + 0.3 * (pro - 0.5) - 0.15 * broken))
}

/** Why an answer cannot be given now, or null. */
export function answerProblem(game: Game, u: LoadedUniverse, playerSeasonId: string, answer: RequestAnswer): string | null {
  const pid = playerLookup(game, u)(playerSeasonId)?.playerId
  const req = pid ? game.office?.requests?.[pid] : undefined
  if (!req || req.stage !== 'open') return 'He has no request waiting on you.'
  if (answer === 'talk' || answer === 'promise-minutes' || answer === 'promise-contract') {
    if ((req.failedTalks ?? 0) >= MAX_REQUEST_TALKS) return 'He has made up his mind: list him or refuse.'
    if (req.talkedAt === weekOf(game)) return 'You have already spoken to him this week.'
  }
  if (answer === 'promise-minutes') return promiseProblem(game, u, playerSeasonId, 'minutes')
  if (answer === 'promise-contract') return promiseProblem(game, u, playerSeasonId, 'contract')
  return null
}

/** Answer his transfer request. Returns the line to show. */
export function answerRequest(game: Game, u: LoadedUniverse, playerSeasonId: string, answer: RequestAnswer): { ok: boolean; message: string } {
  const problem = answerProblem(game, u, playerSeasonId, answer)
  if (problem) return { ok: false, message: problem }
  const p = playerLookup(game, u)(playerSeasonId)!
  const s = game.squad[playerSeasonId]
  const c = game.contracts[playerSeasonId]
  const req = officeOf(game).requests![p.playerId]
  const week = weekOf(game)
  if (answer === 'list') {
    c.listed = true
    req.stage = 'listed'
    req.settledAt = week
    shiftMorale(s, week, LISTED_LIFT, 'Transfer request accepted')
    postNews(game, { matchweek: week, kind: 'transfer', title: `${p.name} transfer-listed`, body: 'You accepted his request. Offers will come in the window.', playerId: playerSeasonId })
    return { ok: true, message: `${p.name} is on the list. He settles while he waits for a move.` }
  }
  if (answer === 'refuse') {
    req.stage = 'refused'
    req.settledAt = week
    shiftMorale(s, week, REFUSED_COST, 'Transfer request refused')
    const moved = dressingRoomRipple(game, u, playerSeasonId, REFUSED_RIPPLE, `A team-mate's request refused`)
    postNews(game, { matchweek: week, kind: 'event', title: `Request refused: ${p.name}`, body: `You told him he stays. ${moved.length ? 'The dressing room took his side.' : 'He sulks.'}`, playerId: playerSeasonId })
    return { ok: true, message: `${p.name} is told he stays. He is not happy${moved.length ? `, and ${moved.length} team-mate${moved.length === 1 ? '' : 's'} feel for him` : ''}.` }
  }
  const odds = talkOdds(game, u, req, answer)
  let promised = ''
  if (answer !== 'talk') {
    const made = makePromise(game, u, playerSeasonId, answer === 'promise-minutes' ? 'minutes' : 'contract')
    if (!made.ok) return made
    promised = answer === 'promise-minutes' ? 'football' : 'a new contract'
  }
  req.talkedAt = week
  const won = officeRoll(game, `wantout-talk-${game.year}-${week}-${p.playerId}-${req.failedTalks ?? 0}`).next() < odds
  if (won) {
    req.stage = 'withdrawn'
    req.settledAt = week
    shiftMorale(s, week, TALKED_ROUND_LIFT, 'Talked round')
    return { ok: true, message: promised ? `${p.name} withdraws his request on your promise of ${promised}. Keep it.` : `${p.name} hears you out and withdraws his request.` }
  }
  req.failedTalks = (req.failedTalks ?? 0) + 1
  shiftMorale(s, week, FAILED_TALK_COST, 'Talks about a move went nowhere')
  const last = req.failedTalks >= MAX_REQUEST_TALKS
  return { ok: true, message: `${p.name} is not convinced${promised ? `, though he holds you to the promise of ${promised}` : ''}.${last ? ' He will hear no more: list him or refuse.' : ''}` }
}

/** Why each restless man might ask to leave, for the Office (no rolls). */
export function restlessPlayers(game: Game, u: LoadedUniverse): Array<{ id: string; pressure: RequestPressure }> {
  return Object.keys(game.squad)
    .map((id) => ({ id, pressure: requestPressure(game, u, id) }))
    .filter((x): x is { id: string; pressure: RequestPressure } => !!x.pressure && x.pressure.score >= 0.3)
    .sort((a, b) => b.pressure.score - a.pressure.score || a.id.localeCompare(b.id))
}

export { REQUEST_WHY }
