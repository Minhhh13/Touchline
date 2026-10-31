/**
 * The manager's office, shared helpers (Football Manager depth, round 8). The
 * office's state is `Game.office`, absent until the manager first uses it, and
 * everything in it is keyed by real player id so a Dynasty summer, which gives
 * every man a new player-season id, needs no remap. Every roll it makes draws
 * from `Rng.fromState(game.rngState).fork(label)` of a copy and never writes the
 * state back, so no match, market day or event draw ever moves.
 *
 * None of the office modules is reached by the edge verifier's bundle: they are
 * called only from the store and the screens.
 */
import type { Game, OfficeState, TransferRequest } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { SquadPlayer } from '@engine/types'
import type { NewsItem } from '@engine/season'
import { Rng } from '@engine/rng'
import { playerLookup } from './players'
import { logMorale } from './happiness'
import { postNews } from './news'
import { hierarchy, squadGroups } from './dynamics'

/** The office's state, created on first use. */
export function officeOf(game: Game): OfficeState {
  return (game.office ??= {})
}

/** The matchweek now (0 in pre-season). */
export function weekOf(game: Game): number {
  return game.season?.matchweek ?? 0
}

/** The open window's key (`${year}:${kind}`), or null while none is open. */
export function windowKey(game: Game): string | null {
  return game.window ? `${game.year}:${game.window.kind}` : null
}

/** The squad's player-season id of a real player, if he is in the squad. */
export function squadIdOf(game: Game, u: LoadedUniverse, playerId: string): string | undefined {
  const get = playerLookup(game, u)
  return Object.keys(game.squad).find((id) => get(id)?.playerId === playerId)
}

/** The real player id behind a squad player-season id. */
export function realIdOf(game: Game, u: LoadedUniverse, playerSeasonId: string): string | undefined {
  return playerLookup(game, u)(playerSeasonId)?.playerId
}

/**
 * Move a squad player's morale by `delta` (kept within 10 and 100) and record it in his happiness
 * log as `note` (the Happiness view prints an event's note as it is). Returns the change applied.
 */
export function shiftMorale(s: SquadPlayer, week: number, delta: number, note: string, reason: 'event' | 'promise' = 'event'): number {
  const before = s.morale
  s.morale = Math.max(10, Math.min(100, s.morale + delta))
  logMorale(s, week, before, reason, reason === 'promise' ? (delta >= 0 ? 'kept' : 'broken') : note)
  return s.morale - before
}

/** A roll for the office: a named fork of a copy of the game's stream. The game's own state never moves. */
export function officeRoll(game: Game, label: string): Rng {
  return Rng.fromState(game.rngState).fork(`office-${label}`)
}

/** Post an Inbox item from the office, tagged so the Inbox's Office filter and the digest find it. */
export function postOfficeNews(game: Game, item: NewsItem): void {
  postNews(game, { ...item, office: true })
}

/** GBP millions to one decimal. */
export function roundM(v: number): number {
  return Math.round(v * 10) / 10
}

/** Matchweeks a settled request leaves before the same man may ask again. */
export const REQUEST_COOLDOWN = 8

/** Why a request was handed in, as the Inbox says it. */
export const REQUEST_WHY: Record<TransferRequest['reason'], string> = {
  minutes: 'he is not getting the football his status promised',
  morale: 'he is unhappy at the club',
  promise: 'you broke a promise to him',
  interest: 'a club came in for him and you turned them down',
  results: 'he wants to play for a side that wins',
}

/**
 * He hands in a transfer request (unless one is already open or he asked lately). Posts the news, costs a little
 * morale (going public is not a happy act) and returns the request, or null when none was lodged.
 */
export function lodgeRequest(game: Game, u: LoadedUniverse, playerSeasonId: string, reason: TransferRequest['reason']): TransferRequest | null {
  const p = playerLookup(game, u)(playerSeasonId)
  const s = game.squad[playerSeasonId]
  const c = game.contracts[playerSeasonId]
  if (!p || !s || !c || c.loan || !game.season) return null
  const o = officeOf(game)
  const requests = (o.requests ??= {})
  const old = requests[p.playerId]
  const week = weekOf(game)
  // One waiting this season blocks a second; one an earlier season left open was let go with that season (r9)
  if (old && old.year === game.year && (old.stage === 'open' || old.stage === 'listed')) return null
  if (old && old.year === game.year && week - (old.settledAt ?? old.at) < REQUEST_COOLDOWN && reason !== 'promise') return null
  const req: TransferRequest = { playerId: p.playerId, name: p.name, reason, year: game.year, at: week, stage: 'open' }
  requests[p.playerId] = req
  shiftMorale(s, week, -3, 'Handed in a transfer request')
  postOfficeNews(game, { matchweek: week, kind: 'event', title: `${p.name} hands in a transfer request`, body: `He wants to leave: ${REQUEST_WHY[reason]}. Talk him round, list him or refuse, in the Office.`, playerId: playerSeasonId })
  return req
}

/**
 * Who in the dressing room hears about it, and by how much: his group's other men take `delta`, and when he is one
 * of the squad's leaders (the top two tiers of the hierarchy) everyone else half of it. Pure: the Office previews a
 * refusal with it before the manager makes one.
 */
export function rippleTargets(game: Game, u: LoadedUniverse, playerSeasonId: string, delta: number): Array<{ id: string; delta: number }> {
  const group = squadGroups(game, u).find((g) => g.members.includes(playerSeasonId))
  const tier = hierarchy(game, u).find((r) => r.id === playerSeasonId)?.tier
  const big = tier === 'leader' || tier === 'high'
  const out: Array<{ id: string; delta: number }> = []
  for (const id of Object.keys(game.squad)) {
    if (id === playerSeasonId) continue
    const d = group?.members.includes(id) ? delta : big ? delta / 2 : 0
    if (d) out.push({ id, delta: d })
  }
  return out
}

/** The dressing room hears about it (`rippleTargets`), and each man's morale moves. Returns the men moved. */
export function dressingRoomRipple(game: Game, u: LoadedUniverse, playerSeasonId: string, delta: number, note: string): string[] {
  const week = weekOf(game)
  const targets = rippleTargets(game, u, playerSeasonId, delta)
  for (const { id, delta: d } of targets) shiftMorale(game.squad[id], week, d, note)
  return targets.map((x) => x.id)
}
