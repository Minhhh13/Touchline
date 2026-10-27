/**
 * Which engine a ranked post, a pin or a room belongs to, and the player's words when it is not this build's.
 *
 * One Edge Function serves each engine (`touchline-e4`, `touchline-e5`, CLAUDE.md invariant 15), and a function
 * verifies only its own engine's runs. A run filed in the outbox on an older build (finished offline, or signed out,
 * the evening before a release) is therefore sent to its own engine's function, kept deployed at least 7 days after
 * the next ships, rather than to this build's, which could only refuse it. Pure, no Supabase code; not part of the
 * verifier bundle.
 */
import { decodeChallenge } from '@engine/challenge'
import { ENGINE_VERSION } from '@engine/version'
import type { OutboxEntry } from './localState'
import type { PuzzlePin } from './server/dailyVerify'

/** An engine stamp that may name a function (`touchline-e<engine>`): digits only, so nothing else reaches the URL. */
export const isEngineStamp = (v: unknown): v is string => typeof v === 'string' && /^[0-9]{1,4}$/.test(v)

/** The engine a ghost-draft payload was played on, or null when it does not decode. */
export function payloadEngine(encoded: string): string | null {
  try {
    const engine = decodeChallenge(encoded.trim().replace(/^#?c=/, '')).engine
    return isEngineStamp(engine) ? engine : null
  } catch {
    return null
  }
}

/** The engine an outbox entry posts to: the one it was filed with, else its payload's (entries filed before the
 * field existed), else this build's. */
export function entryEngine(e: Pick<OutboxEntry, 'encoded'> & { engine?: string }): string {
  if (isEngineStamp(e.engine)) return e.engine
  return payloadEngine(e.encoded) ?? ENGINE_VERSION
}

/** Whether an engine stamp is older than this build's (numeric compare; anything unreadable is not). */
export function olderEngine(engine: string, than = ENGINE_VERSION): boolean {
  return isEngineStamp(engine) && isEngineStamp(than) && Number(engine) < Number(than)
}

/** A run on an older engine whose function has been retired (it answers 404): final, never retried. */
export function retiredReason(engine: string): string {
  return `it was played on an earlier version of the game (engine ${engine}), and that version's leaderboard has closed`
}

/** The words for an `engine_mismatch` answer to a ranked post: which side is older, and what the player can do. */
export function engineMismatchReason(played: string, pinned: string | null): string {
  if (pinned && olderEngine(pinned, played)) return `this board opened on an earlier version of the game (engine ${pinned}), so runs on engine ${played} cannot rank on it; the next one can`
  if (pinned && olderEngine(played, pinned)) return `it was played on an earlier version of the game (engine ${played}) and the board runs on engine ${pinned}`
  return `it was played on engine ${played}, which this board does not run`
}

export type PinStanding = 'ranked' | 'older_pin' | 'newer_pin' | 'missing_data'

/** Where this build stands against a board's pin: on it, on a newer engine than the pin, or older (a reload helps). */
export function pinStanding(pin: Pick<PuzzlePin, 'engineVersion'>, source: 'local' | 'pinned' | 'missing_data'): PinStanding {
  if (source === 'missing_data') return 'missing_data'
  if (pin.engineVersion === ENGINE_VERSION) return 'ranked'
  return olderEngine(pin.engineVersion) ? 'older_pin' : 'newer_pin'
}

/** Home's tag and the World board's line for each standing. */
export const PIN_TAG: Record<PinStanding, string> = {
  ranked: 'Ranked today',
  missing_data: 'Reload for the ranked puzzle',
  newer_pin: 'Unranked: reload to update',
  older_pin: 'Unranked today',
}

export const PIN_NOTE: Record<Exclude<PinStanding, 'ranked'>, string> = {
  missing_data: 'The ranked puzzle needs data this build does not have: reload the page.',
  newer_pin: 'A newer version of the game is live: reload the page to rank.',
  older_pin: 'This board opened on the previous version of the game, so runs on this version do not rank on it. The next board does.',
}

/**
 * Why a room cannot be played on this device, or null when it can: a room plays on the engine and data it started on.
 * A newer room needs a reload; an older one (started before a release or a data rebuild) cannot be finished here, and
 * reloading would not help, so the player is pointed to a new room instead.
 */
export function roomVersionNote(room: { engineVersion: string; dataVersion: string }, local: { engine: string; data: string }): { older: boolean; title: string; line: string } | null {
  if (room.engineVersion === local.engine && room.dataVersion === local.data) return null
  const older = room.engineVersion !== local.engine ? olderEngine(room.engineVersion, local.engine) : room.dataVersion < local.data
  return older
    ? { older, title: 'This room started on an earlier version of the game', line: 'A room plays on the version it started on, and this device now has a newer one. Make a new room to play on.' }
    : { older, title: 'This room plays on a newer version of the game', line: 'Reload the page to get the latest version, then open the room again.' }
}
