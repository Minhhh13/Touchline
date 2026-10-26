/**
 * Online head-to-head rooms (docs/ONLINE.md section 5e): the hot-seat head-to-head played by two managers on two
 * devices. The draft is the engine's own (`newH2HDraft`, `h2hSpin`, `h2hPick`, the rules of `h2hRules`) and the season
 * is `runH2HSeason`, so a room replays exactly like a hot-seat game with the same seed, managers and picks.
 *
 * The server (the Edge Function) holds the seed and is the only writer. It replays the room from the seed on every
 * move (`replayRoom`), checks each spin it stored, applies the new pick with the engine's own checks, spins on until
 * someone must pick (`spinUntilPick`) and, once both squads are complete, plays the season. The public log it stores
 * holds the club-season each spin landed on and each pick, never the seed, so the clients rebuild the draft with no RNG
 * (`draftFromEvents`) and nobody can foresee the next spin; the seed is revealed with the result.
 *
 * Pure: no DOM, no fetch, no `Date`; bundled into the verifier.
 */
import { getFormation, FORMATION_BY_ID } from '@engine/formations'
import { h2hComplete, h2hLand, h2hPick, h2hSpin, newH2HDraft, type H2HDraft } from '@engine/h2h'
import { Rng } from '@engine/rng'
import { leagueSeasonClubs, poolClubSeasons, type LoadedUniverse } from '@engine/universe'
import { h2hRules, runH2HSeason, type H2HManager, type H2HResult } from './h2h'

/** What the room's creator chooses: the league season both sides enter, the wheel, the difficulty and hard mode. */
export interface RoomSettings {
  leagueId: string
  /** The leagues the wheel draws from: the league itself, or every league of the data index (index order). */
  wheelLeagues: string[]
  leagueSeason: number
  difficulty: 'calibrated' | 'realistic'
  hardMode: boolean
}

/** A manager as a player enters it: the short name is derived (`roomShortName`), never sent. */
export interface RoomManagerInput {
  name: string
  formationId: string
  hostClubId: string
}

/** One entry of a room's public log: a spin landing on `clubId@season`, or a seat's pick (`k` a slot id or `bench`). */
export type RoomEvent = { t: 's'; cs: string } | { t: 'p'; seat: 0 | 1; p: string; k: string }

/** Where a room is. `expired`: nobody joined in time; `timed_out`: idle too long while drafting; `left`: a manager left. */
export type RoomStatus = 'waiting' | 'drafting' | 'finished' | 'expired' | 'timed_out' | 'left'

/** A room as everyone with its code reads it (`public.h2h_peek`, and every op's answer). No token, no account id. */
export interface RoomView {
  code: string
  status: RoomStatus
  settings: RoomSettings
  managers: [H2HManager, H2HManager | null]
  events: RoomEvent[]
  /** Bumped by every write; a client's pick names the version it saw. */
  version: number
  /** The seat to pick next while drafting, else null. */
  turn: 0 | 1 | null
  result: H2HResult | null
  /** Null until the room is finished. */
  seed: string | null
  engineVersion: string
  dataVersion: string
  createdAt: string
  /** A waiting room closes at this time unless the second manager joins. */
  expiresAt: string
  /** A drafting room times out at this time unless someone moves. */
  idleAt: string | null
  endedAt: string | null
}

/** Minutes a room waits for its second manager, minutes a draft may sit idle, hours a room is kept after it ends. The
 * SQL (`private.h2h_room_*` in the h2h_rooms migration) uses the same figures; `retention.test.ts` pins them. */
export const ROOM_WAIT_MINUTES = 30
export const ROOM_IDLE_MINUTES = 15
export const ROOM_KEEP_HOURS = 24

/** Picks per manager (the Quick Draft's XI) and the most log entries a room can hold. */
export const ROOM_MAX_EVENTS = 160

/** A manager name: 1 to 24 visible characters (the same hidden-character rule as the boards), no angle brackets. */
export const ROOM_NAME_MAX = 24

const HIDDEN = /[\u0000-\u001f\u007f-\u00a0\u00ad\u034f\u061c\u115f\u1160\u1680\u17b4\u17b5\u180b-\u180f\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff]/

/** A typed name as a room stores it (spaces collapsed, trimmed), or null when it is not allowed. */
export function roomName(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\s+/g, ' ').trim()
  const len = [...name].length
  if (len < 1 || len > ROOM_NAME_MAX || HIDDEN.test(name) || /[<>]/.test(name)) return null
  return name
}

/** The three-letter code beside a manager's name, as the hot-seat setup derives it. */
export function roomShortName(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 3)
      .toUpperCase() || 'MGR'
  )
}

/** The seasons a room can be played in for a league (every standard season of the league, as the hot-seat setup lists). */
export function roomSeasons(u: LoadedUniverse, leagueId: string): number[] {
  return [...new Set(poolClubSeasons(u, false).filter((cs) => cs.leagueId === leagueId).map((cs) => cs.season))].sort((a, b) => a - b)
}

/** The clubs whose place a manager can take in the room's league season. */
export function roomClubs(u: LoadedUniverse, s: Pick<RoomSettings, 'leagueId' | 'leagueSeason'>): string[] {
  return leagueSeasonClubs(u, s.leagueId, s.leagueSeason)
    .filter((cs) => !cs.classic)
    .map((cs) => cs.clubId)
    .sort()
}

/** The leagues a room's universe needs, in the data index's order. */
export function roomLeagues(u: Pick<LoadedUniverse, 'available'>, s: Pick<RoomSettings, 'leagueId' | 'wheelLeagues'>): string[] {
  const need = new Set([s.leagueId, ...s.wheelLeagues])
  return u.available.map((l) => l.id).filter((id) => need.has(id))
}

/** The wheel of a scope: the league alone, or every league of the data index in its order. */
export function roomWheel(u: Pick<LoadedUniverse, 'available'>, leagueId: string, scope: 'league' | 'all'): string[] {
  return scope === 'all' ? u.available.map((l) => l.id) : [leagueId]
}

/** Why a room's settings cannot be played on this universe, or null. `u` must hold every league they name. */
export function settingsProblem(u: LoadedUniverse, s: RoomSettings): string | null {
  if (!s || typeof s !== 'object') return 'No settings'
  if (typeof s.leagueId !== 'string' || !u.available.some((l) => l.id === s.leagueId)) return 'Unknown league'
  if (!Array.isArray(s.wheelLeagues) || !s.wheelLeagues.every((x) => typeof x === 'string')) return 'The wheel is a list of leagues'
  const wheel = JSON.stringify(s.wheelLeagues)
  if (wheel !== JSON.stringify(roomWheel(u, s.leagueId, 'league')) && wheel !== JSON.stringify(roomWheel(u, s.leagueId, 'all'))) return 'The wheel is the league or every league'
  if (!Number.isInteger(s.leagueSeason) || !roomSeasons(u, s.leagueId).includes(s.leagueSeason)) return 'That season is not in the data'
  if (s.difficulty !== 'calibrated' && s.difficulty !== 'realistic') return 'Difficulty is calibrated or realistic'
  if (typeof s.hardMode !== 'boolean') return 'Hard mode is on or off'
  if (roomClubs(u, s).length < 4) return 'That league season has too few clubs'
  return null
}

/** The settings exactly as a room stores them (only the known keys, in a fixed order). */
export function cleanSettings(s: RoomSettings): RoomSettings {
  return { leagueId: s.leagueId, wheelLeagues: [...s.wheelLeagues], leagueSeason: s.leagueSeason, difficulty: s.difficulty, hardMode: s.hardMode }
}

/** A manager as the room stores it, or the reason it is refused. `other` is the seat already taken, if any. */
export function roomManager(u: LoadedUniverse, s: RoomSettings, m: RoomManagerInput, other: H2HManager | null): { ok: true; manager: H2HManager } | { ok: false; reason: string } {
  if (!m || typeof m !== 'object') return { ok: false, reason: 'No manager' }
  const name = roomName(m.name)
  if (!name) return { ok: false, reason: `A name is 1 to ${ROOM_NAME_MAX} visible characters` }
  if (other && other.name.toLowerCase() === name.toLowerCase()) return { ok: false, reason: `${other.name} is taken in this room: pick another name` }
  if (typeof m.formationId !== 'string' || !FORMATION_BY_ID[m.formationId]) return { ok: false, reason: 'Unknown formation' }
  if (typeof m.hostClubId !== 'string' || !roomClubs(u, s).includes(m.hostClubId)) return { ok: false, reason: 'That club is not in the league season' }
  if (other && other.hostClubId === m.hostClubId) return { ok: false, reason: 'The other manager already took that club' }
  return { ok: true, manager: { name, shortName: roomShortName(name), formationId: m.formationId, hostClubId: m.hostClubId } }
}

/** The empty draft of a room: the hot-seat's own, from the two managers' shapes and `h2hRules`. */
export function roomDraft(s: RoomSettings, managers: [H2HManager, H2HManager]): H2HDraft {
  return newH2HDraft([getFormation(managers[0].formationId), getFormation(managers[1].formationId)], h2hRules(s.wheelLeagues, s.hardMode))
}

const csKey = (c: { clubId: string; season: number }) => `${c.clubId}@${c.season}`

/** A stored log the engine does not replay (the room's own record is wrong: never the player's fault). */
export class RoomReplayError extends Error {}

/** A new pick the engine refuses (not that seat's turn, a player not on the wheel, a slot he cannot fill). */
export class RoomMoveError extends Error {}

function applyPick(u: LoadedUniverse, h: H2HDraft, e: Extract<RoomEvent, { t: 'p' }>, at: number, Err: typeof RoomReplayError = RoomReplayError): void {
  if (h.picking !== e.seat) throw new Err(`Entry ${at + 1}: it was not seat ${e.seat + 1}'s pick`)
  try {
    h2hPick(u, h, e.p, e.k)
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    throw new Err(Err === RoomReplayError ? `Entry ${at + 1}: ${why}` : why)
  }
}

/**
 * A room's draft rebuilt from its public log, with no RNG: each spin lands where the log says (`h2hLand`), each pick is
 * the engine's. What the clients show. Throws `RoomReplayError` on a log the engine refuses.
 */
export function draftFromEvents(u: LoadedUniverse, s: RoomSettings, managers: [H2HManager, H2HManager], events: RoomEvent[]): H2HDraft {
  const h = roomDraft(s, managers)
  events.forEach((e, i) => {
    if (e.t === 's') {
      const cs = u.clubSeasonByKey[e.cs]
      if (!cs) throw new RoomReplayError(`Entry ${i + 1}: unknown club-season ${e.cs}`)
      if (h.picking !== null || h2hComplete(h)) throw new RoomReplayError(`Entry ${i + 1}: a spin while a pick is due`)
      h2hLand(u, h, cs)
    } else applyPick(u, h, e, i)
  })
  return h
}

/**
 * The server's replay: the room from its seed, every stored spin recomputed with the room's RNG and checked against
 * the log, every pick applied. Returns the draft and the RNG where the log ends (the season draws from it next).
 */
export function replayRoom(u: LoadedUniverse, seed: string, s: RoomSettings, managers: [H2HManager, H2HManager], events: RoomEvent[]): { draft: H2HDraft; rng: Rng } {
  const h = roomDraft(s, managers)
  const rng = new Rng(seed)
  events.forEach((e, i) => {
    if (e.t === 's') {
      if (h.picking !== null || h2hComplete(h)) throw new RoomReplayError(`Entry ${i + 1}: a spin while a pick is due`)
      const landed = h2hSpin(u, h, rng)
      if (csKey(landed) !== e.cs) throw new RoomReplayError(`Entry ${i + 1}: the seed lands on ${csKey(landed)}, the log says ${e.cs}`)
    } else applyPick(u, h, e, i)
  })
  return { draft: h, rng }
}

/** Spin until someone has a pick to make or the draft is complete; the spins as log entries. */
export function spinUntilPick(u: LoadedUniverse, h: H2HDraft, rng: Rng): RoomEvent[] {
  const out: RoomEvent[] = []
  let guard = 0
  while (h.picking === null && !h2hComplete(h)) {
    if (guard++ > 60) throw new RoomReplayError('The wheel ran dry')
    out.push({ t: 's', cs: csKey(h2hSpin(u, h, rng)) })
  }
  return out
}

/** What a move adds to a room: the new log entries, whose pick is next, and the season once the draft is complete. */
export interface RoomStep {
  events: RoomEvent[]
  turn: 0 | 1 | null
  result: H2HResult | null
}

function stepAfter(u: LoadedUniverse, s: RoomSettings, managers: [H2HManager, H2HManager], h: H2HDraft, rng: Rng, added: RoomEvent[]): RoomStep {
  const events = [...added, ...spinUntilPick(u, h, rng)]
  if (!h2hComplete(h)) return { events, turn: h.picking, result: null }
  return { events, turn: null, result: runH2HSeason(u, rng, managers, h.drafts, s.leagueId, s.leagueSeason, s.difficulty) }
}

/** The second manager joined: the first spins, up to the first pick. */
export function roomStart(u: LoadedUniverse, seed: string, s: RoomSettings, managers: [H2HManager, H2HManager]): RoomStep {
  const { draft, rng } = replayRoom(u, seed, s, managers, [])
  return stepAfter(u, s, managers, draft, rng, [])
}

/**
 * A seat's pick, checked by replaying the whole room from its seed first (`RoomReplayError` when the stored log does
 * not replay): refused (`RoomMoveError`) when it is not that seat's turn or the engine refuses the pick. Then the spins up to the next pick, or the season.
 */
export function roomPick(u: LoadedUniverse, seed: string, s: RoomSettings, managers: [H2HManager, H2HManager], events: RoomEvent[], seat: 0 | 1, playerSeasonId: string, slotId: string): RoomStep {
  const { draft, rng } = replayRoom(u, seed, s, managers, events)
  if (h2hComplete(draft)) throw new RoomMoveError('The draft is complete')
  if (draft.picking !== seat) throw new RoomMoveError('It is not your pick')
  const e: RoomEvent = { t: 'p', seat, p: playerSeasonId, k: slotId }
  applyPick(u, draft, e, events.length, RoomMoveError)
  return stepAfter(u, s, managers, draft, rng, [e])
}

/** Whether a log is well formed (the server checks this before replaying anything a database row holds). */
export function isRoomLog(v: unknown): v is RoomEvent[] {
  if (!Array.isArray(v) || v.length > ROOM_MAX_EVENTS) return false
  return v.every((e) => {
    if (!e || typeof e !== 'object') return false
    const r = e as Record<string, unknown>
    if (r.t === 's') return typeof r.cs === 'string' && r.cs.length <= 80
    return r.t === 'p' && (r.seat === 0 || r.seat === 1) && typeof r.p === 'string' && r.p.length <= 120 && typeof r.k === 'string' && r.k.length <= 16
  })
}

/** The engine's log line with the managers' names in place of "Manager 1" and "Manager 2". */
export function roomLogLine(line: string, managers: [H2HManager, H2HManager | null]): string {
  return line.replace(/Manager ([12])/g, (all, n: string) => managers[Number(n) - 1]?.name ?? all)
}

/** Whether a room has ended (nothing more can change but its purge). */
export const roomEnded = (status: RoomStatus): boolean => status !== 'waiting' && status !== 'drafting'

/** A line for a room that ended without a result. */
export function roomEndLine(status: RoomStatus): string {
  if (status === 'expired') return `Nobody joined within ${ROOM_WAIT_MINUTES} minutes, so the room closed.`
  if (status === 'timed_out') return `Nobody picked for ${ROOM_IDLE_MINUTES} minutes, so the room timed out.`
  if (status === 'left') return 'A manager left the room.'
  return ''
}
