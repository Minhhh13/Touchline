/**
 * Promises (Football Manager depth, round 8). The manager promises a player
 * football, a new contract or a signing to strengthen the squad; the office
 * tracks each over the weeks it runs and settles it once, kept or broken.
 *
 * - Football: a share of the minutes on offer over the next six matchweeks
 *   (a regular place 55%, more football 30%), counted from his season minutes.
 * - A new contract within eight matchweeks: kept once his contract runs longer
 *   than when it was made (contract talks or a renewal).
 * - A signing: a man who plays his position and rates at least the target, in
 *   by the end of the next window to close.
 *
 * Kept, he is lifted (+6) and trusts the next promise more; broken, he drops 14,
 * his group feels it, he believes the next promise less, and he hands in a
 * transfer request. Deterministic: no draws at all.
 */
import type { Game, OfficePromise } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { Position } from '@engine/types'
import { getFormation } from '@engine/formations'
import { MINUTES_PER_WEEK } from '@engine/status'
import { playerLookup, squadPlayers } from './players'
import { contractDemand } from './contracts'
import { postNews } from './news'
import { dressingRoomRipple, lodgeRequest, officeOf, realIdOf, shiftMorale, squadIdOf, weekOf } from './officeCore'

/** Open promises the squad can hold at once, and the list's length with the settled ones kept for the record. */
export const MAX_OPEN_PROMISES = 4
export const PROMISE_LIST_CAP = 12
/** Matchweeks a football promise runs, and the shares it names. */
export const MINUTES_WEEKS = 6
export const MINUTES_SHARE = { regular: 0.55, more: 0.3 } as const
export type MinutesLevel = keyof typeof MINUTES_SHARE
/** Matchweeks a contract promise gives the manager. */
export const CONTRACT_WEEKS = 8
/** Morale a promise lifts when made (less for each one broken to him), when kept, and costs when broken. */
export const MADE_LIFT: Record<OfficePromise['kind'], number> = { minutes: 5, contract: 4, signing: 3 }
export const KEPT_LIFT = 6
export const BROKEN_COST = -14
/** Morale his group loses when a promise to him is broken. */
export const BROKEN_RIPPLE = -2
/** Slack on a football promise: a share within this of the target still counts as kept. */
export const SHARE_SLACK = 0.05

const KIND_WORD: Record<OfficePromise['kind'], string> = { minutes: 'football', contract: 'a new contract', signing: 'a signing' }

/** The open promises, newest first. */
export function openPromises(game: Game): OfficePromise[] {
  return (game.office?.promises ?? []).filter((p) => p.state === 'open' && p.year === game.year).reverse()
}

/** The position a signing promise would strengthen: the formation's slot whose best natural man rates lowest. */
export function weakestPosition(game: Game, u: LoadedUniverse): { position: Position; best: number } {
  const players = squadPlayers(game, u)
  const slots = getFormation(game.tactics.formationId).slots
  let out: { position: Position; best: number } | null = null
  for (const slot of slots) {
    const pos = slot.position
    const best = Math.max(0, ...players.filter((x) => x.p.positions[0] === pos).map((x) => x.p.overall))
    if (!out || best < out.best) out = { position: pos, best }
  }
  return out ?? { position: 'CM', best: 0 }
}

/** Whether a window is still to come this season (a signing promise needs one to be kept in). */
function windowAhead(game: Game): boolean {
  const s = game.season
  if (!s) return false
  if (game.window) return true
  return s.matchweek < Math.floor(s.matchweeks / 2)
}

/** Why a promise of this kind cannot be made to him now, or null when it can. */
export function promiseProblem(game: Game, u: LoadedUniverse, playerSeasonId: string, kind: OfficePromise['kind']): string | null {
  const s = game.season
  const p = playerLookup(game, u)(playerSeasonId)
  const c = game.contracts[playerSeasonId]
  if (!s || !p || !c || !game.squad[playerSeasonId]) return 'He is not in your squad.'
  if (s.sacked || s.matchweek >= s.matchweeks) return 'The season is over: no promise can run now.'
  const open = openPromises(game)
  if (open.length >= MAX_OPEN_PROMISES) return `You already have ${MAX_OPEN_PROMISES} promises running. Keep those first.`
  if (open.some((x) => x.playerId === p.playerId && x.kind === kind)) return `You have already promised ${p.name} ${KIND_WORD[kind]}.`
  if (kind === 'contract' && c.loan) return `${p.name} is on loan: his contract is his parent club's.`
  if (kind === 'contract') {
    // Kept only by a longer deal or a renewal (`verdict`): one he has already agreed, or one he could never be given, is no promise
    if (c.renewed) return `${p.name} has already agreed to stay: his renewal is done.`
    const longest = contractDemand(game, u, playerSeasonId, c.status ?? 'rotation')?.maxYears
    if (longest !== undefined && c.years >= longest) return `${p.name} is already on the longest deal he would sign (${longest} seasons).`
  }
  if (kind === 'signing' && !windowAhead(game)) return 'No transfer window is left this season to keep it in.'
  return null
}

/**
 * Promise him `kind` (for football, `level`). He takes it at face value, less so for every promise broken to him
 * before. Returns the line to show.
 */
export function makePromise(game: Game, u: LoadedUniverse, playerSeasonId: string, kind: OfficePromise['kind'], level: MinutesLevel = 'regular'): { ok: boolean; message: string } {
  const problem = promiseProblem(game, u, playerSeasonId, kind)
  if (problem) return { ok: false, message: problem }
  const season = game.season!
  const p = playerLookup(game, u)(playerSeasonId)!
  const s = game.squad[playerSeasonId]
  const week = weekOf(game)
  const o = officeOf(game)
  const promise: OfficePromise = { kind, playerId: p.playerId, name: p.name, year: game.year, madeAt: week, due: season.matchweeks, state: 'open' }
  let what = ''
  if (kind === 'minutes') {
    promise.share = MINUTES_SHARE[level]
    promise.minutesAt = s.seasonStats.minutes
    promise.due = Math.min(season.matchweeks, week + MINUTES_WEEKS)
    what = `${Math.round(promise.share * 100)}% of the minutes over the next ${promise.due - week} matchweeks`
  } else if (kind === 'contract') {
    promise.yearsAt = game.contracts[playerSeasonId].years
    promise.due = Math.min(season.matchweeks, week + CONTRACT_WEEKS)
    what = `a new contract by matchweek ${promise.due}`
  } else {
    const weak = weakestPosition(game, u)
    promise.position = weak.position
    promise.overall = Math.max(weak.best + 2, 60)
    promise.squadAt = squadPlayers(game, u).map((x) => x.p.playerId)
    promise.windowSeen = !!game.window
    what = `a ${weak.position} rated ${promise.overall} or better by the end of the ${game.window ? 'window' : 'next window'}`
  }
  const list = (o.promises ??= [])
  list.push(promise)
  trimPromises(list)
  const broken = o.broken?.[p.playerId] ?? 0
  const lift = Math.round(MADE_LIFT[kind] * Math.max(0, 1 - 0.4 * broken))
  if (lift) shiftMorale(s, week, lift, `Promised ${KIND_WORD[kind]}`)
  return { ok: true, message: broken ? `${p.name} hears you: ${what}. After last time, he will believe it when he sees it.` : `${p.name} takes you at your word: ${what}.` }
}

function trimPromises(list: OfficePromise[]): void {
  while (list.length > PROMISE_LIST_CAP) {
    const i = list.findIndex((x) => x.state !== 'open')
    list.splice(i < 0 ? 0 : i, 1)
  }
}

export interface PromiseProgress {
  promise: OfficePromise
  /** Where it stands, in words. */
  line: string
  /** 0 to 1: how far along it is to being kept. */
  progress: number
}

/** How each open promise stands now, for the Office. */
export function promiseProgress(game: Game, u: LoadedUniverse): PromiseProgress[] {
  const week = weekOf(game)
  return openPromises(game).map((promise) => {
    const id = squadIdOf(game, u, promise.playerId)
    const s = id ? game.squad[id] : undefined
    if (promise.kind === 'minutes') {
      const weeks = Math.max(0, week - promise.madeAt)
      const got = s && weeks ? (s.seasonStats.minutes - (promise.minutesAt ?? 0)) / (MINUTES_PER_WEEK * weeks) : 0
      const target = promise.share ?? 0.5
      return { promise, line: weeks ? `${Math.round(Math.min(1, got) * 100)}% of the minutes so far (promised ${Math.round(target * 100)}%), until matchweek ${promise.due}` : `Promised ${Math.round(target * 100)}% of the minutes until matchweek ${promise.due}`, progress: Math.max(0, Math.min(1, got / target)) }
    }
    if (promise.kind === 'contract') return { promise, line: `A new contract by matchweek ${promise.due}: open contract talks with him.`, progress: Math.max(0, Math.min(1, (week - promise.madeAt) / Math.max(1, promise.due - promise.madeAt))) }
    return { promise, line: `A ${promise.position} rated ${promise.overall}+ by the end of the ${promise.windowSeen ? 'window' : 'next window'}.`, progress: game.window ? 0.5 : 0 }
  })
}

/** Whether an open promise is kept now (true), broken now (false) or still running (null). */
function verdict(game: Game, u: LoadedUniverse, promise: OfficePromise, id: string): boolean | null {
  const season = game.season!
  const week = season.matchweek
  const over = week >= season.matchweeks || !!season.sacked
  if (promise.kind === 'minutes') {
    if (week < promise.due && !over) return null
    const weeks = Math.max(1, Math.min(week, promise.due) - promise.madeAt)
    const got = (game.squad[id].seasonStats.minutes - (promise.minutesAt ?? 0)) / (MINUTES_PER_WEEK * weeks)
    return got >= (promise.share ?? 0.5) - SHARE_SLACK
  }
  if (promise.kind === 'contract') {
    const c = game.contracts[id]
    if (c && (c.years > (promise.yearsAt ?? 0) || c.renewed)) return true
    return week >= promise.due || over ? false : null
  }
  const before = new Set(promise.squadAt ?? [])
  const get = playerLookup(game, u)
  const signed = Object.keys(game.squad).some((sid) => {
    const p = get(sid)
    return !!p && !before.has(p.playerId) && p.positions.includes(promise.position ?? 'CM') && p.overall >= (promise.overall ?? 0)
  })
  if (signed) return true
  if (game.window) promise.windowSeen = true
  else if (promise.windowSeen) return false
  return over ? false : null
}

/**
 * Settle every open promise that is due (called by the office's weekly tick and after each office action). A promise
 * to a man who has left is dropped; one from an earlier season is dropped too (the summer wipes the slate).
 */
export function settlePromises(game: Game, u: LoadedUniverse): void {
  const list = game.office?.promises
  if (!list?.length || !game.season) return
  const week = weekOf(game)
  for (let i = list.length - 1; i >= 0; i--) {
    const promise = list[i]
    if (promise.state !== 'open') continue
    const id = squadIdOf(game, u, promise.playerId)
    if (!id || promise.year !== game.year) {
      list.splice(i, 1)
      continue
    }
    const v = verdict(game, u, promise, id)
    if (v === null) continue
    promise.state = v ? 'kept' : 'broken'
    promise.settledAt = week
    const s = game.squad[id]
    const o = officeOf(game)
    if (v) {
      shiftMorale(s, week, KEPT_LIFT, 'kept', 'promise')
      if (o.broken?.[promise.playerId]) o.broken[promise.playerId] -= 1
      postNews(game, { matchweek: week, kind: 'event', title: `Promise kept: ${promise.name}`, body: `You promised him ${KIND_WORD[promise.kind]} and delivered. He trusts you more for it.`, playerId: id })
    } else {
      shiftMorale(s, week, BROKEN_COST, 'broken', 'promise')
      const broken = (o.broken ??= {})
      broken[promise.playerId] = (broken[promise.playerId] ?? 0) + 1
      dressingRoomRipple(game, u, id, BROKEN_RIPPLE, `A team-mate's broken promise`)
      postNews(game, { matchweek: week, kind: 'event', title: `Promise broken: ${promise.name}`, body: `You promised him ${KIND_WORD[promise.kind]} and did not deliver. His team-mates noticed.`, playerId: id })
      lodgeRequest(game, u, id, 'promise')
    }
  }
}

/** Promises broken to this squad player, this game. */
export function brokenTo(game: Game, u: LoadedUniverse, playerSeasonId: string): number {
  const pid = realIdOf(game, u, playerSeasonId)
  return pid ? game.office?.broken?.[pid] ?? 0 : 0
}
