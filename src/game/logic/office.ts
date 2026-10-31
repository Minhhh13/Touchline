/**
 * The manager's office (Football Manager depth, round 8): the weekly tick that
 * keeps promises, transfer requests, instalments and transfer talks up to date,
 * the transfer list, and what the Inbox and the Office tab show as waiting on
 * the manager.
 *
 * The store runs `officeTick` after every game action and at the end of every
 * simulated week. A game with no office state and player power off returns at
 * once and writes nothing, so a game nobody manages through the office plays
 * byte for byte as before (`src/game/__tests__/office.test.ts`).
 */
import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { playerLookup } from './players'
import { officeOf, postOfficeNews, shiftMorale, squadIdOf, weekOf } from './officeCore'
import { openPromises, settlePromises } from './promises'
import { expireRequests, openRequests, rollRequests } from './transferRequests'
import { closeStaleTalks, feeTalkOf, payInstalments } from './transferTalks'
import { settleBoast } from './pressConference'

/** Morale a man who asked to go loses when he is taken off the list again. */
export const UNLISTED_COST = -6

/** Catch the office up: due promises, requests, instalments, the window's talks; `sim` for a week inside a multi-week sim. A no-op for a game that never used it. */
export function officeTick(game: Game, u: LoadedUniverse, sim = false): void {
  if (!game.office && !game.settings.playerPower) return
  closeStaleTalks(game)
  payInstalments(game)
  const season = game.season
  if (!season) return
  pruneRequests(game, u)
  settlePromises(game, u)
  settleBoast(game)
  expireRequests(game, u, sim)
  const key = `${game.year}:${season.matchweek}`
  if (game.office?.tick === key) return
  officeOf(game).tick = key
  rollRequests(game, u)
}

/** Requests of men who have gone are dropped; a listed man taken off the list counts as refused. */
function pruneRequests(game: Game, u: LoadedUniverse): void {
  const requests = game.office?.requests
  if (!requests) return
  const week = weekOf(game)
  for (const [pid, r] of Object.entries(requests)) {
    const id = squadIdOf(game, u, pid)
    // An earlier season's request still waiting is let go with it, as its promises are (r9: it hid and blocked his next)
    if (!id || (r.stage === 'open' && r.year !== game.year)) {
      delete requests[pid]
      continue
    }
    if (r.stage === 'listed' && !game.contracts[id]?.listed) {
      r.stage = 'refused'
      r.settledAt = week
      shiftMorale(game.squad[id], week, UNLISTED_COST, 'Taken off the transfer list')
    }
  }
}

/** Put a man on the transfer list, or take him off it. Offers come in the window as for any listed player. */
export function setListed(game: Game, u: LoadedUniverse, id: string, on: boolean): { ok: boolean; message: string } {
  const p = playerLookup(game, u)(id)
  const c = game.contracts[id]
  const s = game.squad[id]
  if (!p || !c || !s) return { ok: false, message: 'He is not in your squad.' }
  if (c.loan) return { ok: false, message: `${p.name} is on loan: he is not yours to sell.` }
  // Only this season's request: one refused last season (a Dynasty) is not what he is asking now
  const req = game.office?.requests?.[p.playerId]?.year === game.year ? game.office.requests[p.playerId] : undefined
  const week = weekOf(game)
  if (on) {
    if (c.listed) return { ok: false, message: `${p.name} is already listed.` }
    c.listed = true
    // A man who asked to go is glad; one who did not wonders why
    if (req?.stage === 'open' || req?.stage === 'refused') {
      req.stage = 'listed'
      req.settledAt = week
      shiftMorale(s, week, 5, 'Transfer request accepted')
    } else shiftMorale(s, week, -4, 'Put on the transfer list')
    if (game.season) postOfficeNews(game, { matchweek: week, kind: 'transfer', title: `${p.name} transfer-listed`, body: 'Offers will come in the window.', playerId: id })
    return { ok: true, message: `${p.name} is on the transfer list.` }
  }
  if (!c.listed) return { ok: false, message: `${p.name} is not listed.` }
  delete c.listed
  if (req?.stage === 'listed') pruneRequests(game, u)
  return { ok: true, message: `${p.name} is off the transfer list.` }
}

export interface OfficeItem {
  kind: 'request' | 'terms' | 'promise'
  /** The squad player it is about (a request or a promise), or the listing (terms). */
  id?: string
  name?: string
  /** Matchweeks left (a promise). */
  weeks?: number
}

/** What is waiting on the manager in the office, most urgent first, for the Inbox and the tab's alert. */
export function officeItems(game: Game, u: LoadedUniverse): OfficeItem[] {
  const out: OfficeItem[] = []
  for (const r of openRequests(game)) out.push({ kind: 'request', id: squadIdOf(game, u, r.playerId), name: r.name })
  for (const [listingId, t] of Object.entries(game.office?.feeTalks ?? {})) {
    if (t.agreed && feeTalkOf(game, listingId)) out.push({ kind: 'terms', id: listingId, name: u.index[listingId]?.name })
  }
  const week = weekOf(game)
  for (const p of openPromises(game)) if (p.due - week <= 2) out.push({ kind: 'promise', id: squadIdOf(game, u, p.playerId), name: p.name, weeks: Math.max(0, p.due - week) })
  return out
}
