/**
 * The ranked-post outbox: a finished Daily or weekly challenge is filed here the moment it ends, signed in or not,
 * and sent to the Edge Function once a signed-in session and a connection exist. Each answer is final, retried
 * later or waited on (section 4.8 of the build plan); an entry whose day or week has closed is dropped. The queue
 * lives in `touchline-online-v1` (per device), so a Daily finished offline posts after sign-in on that device.
 */
import type { LoadedUniverse } from '@engine/universe'
import type { Game } from '@game/types'
import { buildRankedSubmission, rankedBoardOf } from './daily'
import { buildChaseSubmission, chaseCodeOfSeed, CHASE_ATTEMPT_HOURS } from './chase'
import { buildCasualSubmission, casualBoardOf, casualClosesAt, casualScoreOf, type CasualBoard } from './casual'
import type { OnlineRecord, OutboxEntry } from './localState'
import type { OnlineTransport } from './transport'
import { isTransient } from './transport'
import type { PostState } from './state'
import { CASUAL_POST_KINDS, postKey } from './state'
import { weekStartOf } from './weekly'
import { ENGINE_VERSION } from '@engine/version'
import { engineMismatchReason, entryEngine, olderEngine, retiredReason } from './engineRoute'

const DAY = 86400000
const MIN_BACKOFF = 5000
const MAX_BACKOFF = 600000

/** Delay before retry number `attempts` (1-based): 5 s doubling to 10 min, with up to 30 % jitter. */
export function backoffMs(attempts: number, random: number): number {
  const base = Math.min(MAX_BACKOFF, MIN_BACKOFF * 2 ** Math.max(0, attempts - 1))
  return Math.round(base * (1 + 0.3 * Math.min(1, Math.max(0, random))))
}

/** When nothing can be posted for an entry any more: 00:00 UTC two days after a Daily; the Tuesday after a week; a
 * chase run's attempt window (48 hours from when the game started, unless the entry says otherwise). */
export function closesAt(e: Pick<OutboxEntry, 'kind' | 'key'> & Partial<Pick<OutboxEntry, 'closes' | 'at'>>): number {
  if (isCasualKind(e.kind)) return casualClosesAt(e.kind, e.key)
  if (e.kind === 'chase') return e.closes ?? (Date.parse(e.at ?? '') || 0) + CHASE_ATTEMPT_HOURS * 3600000
  if (e.kind === 'daily') {
    const d = Date.parse(`${e.key}T00:00:00Z`)
    return Number.isFinite(d) ? d + 2 * DAY : 0
  }
  const start = weekStartOf(e.key)
  return start ? start.getTime() + 8 * DAY : 0
}

export type Outcome =
  | { kind: 'done'; post: PostState }
  | { kind: 'retry' }
  | { kind: 'wait_sign_in' }
  | { kind: 'drop'; post: PostState }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * What an Edge Function answer means for the entry (the table in the build plan, section 4.8). `engine` is the engine
 * the entry was played on (this build's when omitted): an older engine's function answering 404 has been retired, so
 * the run is told it cannot rank rather than retried until its board closes, and an `engine_mismatch` is worded for
 * the player.
 */
export function classify(status: number, body: Record<string, unknown>, points: number, engine: string = ENGINE_VERSION): Outcome {
  const code = typeof body.code === 'string' ? body.code : ''
  const reason = typeof body.reason === 'string' ? body.reason : ''
  if (status === 200) {
    const s = body.status
    if (s === 'ranked' || s === 'duplicate' || s === 'already_submitted') {
      const entry = (body.entry ?? {}) as Record<string, unknown>
      const official = (body.official ?? {}) as Record<string, unknown>
      return {
        kind: 'done',
        post: {
          state: 'posted',
          position: num(body.position) ?? 0,
          total: num(body.total) ?? 0,
          countryPosition: num(body.countryPosition),
          countryTotal: num(body.countryTotal),
          country: typeof body.country === 'string' ? body.country : null,
          points: num(entry.points) ?? num(official.points) ?? points,
          claimMatched: entry.claimMatched !== false && official.claimMatched !== false,
          already: s === 'already_submitted',
          // A 38-0 chase answer: the week's place and whether the season was flawless
          ...(num(body.weekPosition) !== null ? { weekPosition: num(body.weekPosition), weekTotal: num(body.weekTotal) } : {}),
          ...(typeof body.perfect === 'boolean' ? { perfect: body.perfect } : {}),
          // A casual board's answer: the result in words and whether it took the trophy
          ...(typeof entry.detail === 'string' ? { detail: entry.detail } : {}),
          ...(typeof entry.trophy === 'boolean' ? { trophy: entry.trophy } : {}),
        },
      }
    }
    return { kind: 'retry' }
  }
  if (status === 401) return { kind: 'wait_sign_in' }
  if (status === 403) return { kind: 'wait_sign_in' }
  if (status === 409 && code === 'closed') return { kind: 'drop', post: { state: 'closed' } }
  if (status === 409 && code === 'engine_mismatch') {
    const pinned = typeof body.pinnedEngine === 'string' ? body.pinnedEngine : typeof body.liveEngine === 'string' ? body.liveEngine : null
    return { kind: 'done', post: { state: 'unranked', code, reason: engineMismatchReason(engine, pinned) } }
  }
  if (status === 404 && olderEngine(engine)) return { kind: 'done', post: { state: 'unranked', code: 'engine_retired', reason: retiredReason(engine) } }
  if (status === 409) return { kind: 'done', post: { state: 'unranked', code: code || 'unranked', reason: reason || 'This run cannot rank on today’s board' } }
  // A function older than this build (deployed just after the site, as a loader must be) does not know the op yet: later
  if (status === 400 && reason === 'Unknown operation') return { kind: 'retry' }
  if (status === 400 || status === 413 || status === 422) return { kind: 'done', post: { state: 'rejected', code: code || String(status), reason: reason || 'The server refused this run' } }
  // 404 (the function for this engine is not deployed yet), 429, 5xx: later
  return { kind: 'retry' }
}

/** File a finished ranked run. Null when the game is not a finished Daily or weekly challenge, or it was filed already. */
export function captureEntry(game: Game, u: LoadedUniverse, name: string, now: Date, owner: string | null = null): OutboxEntry | null {
  const sub = buildRankedSubmission(game, u, name)
  if (!sub) return null
  const board = rankedBoardOf(game.settings)
  if (!board) return null
  const { kind, key } = board
  return { id: `${kind}:${key}:${game.id}`, kind, key, encoded: sub.encoded, teamName: sub.teamName, shortName: sub.shortName, points: game.quickResult?.points ?? 0, at: now.toISOString(), attempts: 0, nextAt: 0, owner, engine: ENGINE_VERSION }
}

/** Whether a post kind is one of the casual boards (posted as `casual.submit`). */
export const isCasualKind = (kind: OutboxEntry['kind']): kind is CasualBoard => CASUAL_POST_KINDS.includes(kind)

/**
 * File a finished casual run (the Daily Arena, the Weekly Challenge of mode weekly, the Run-in of the week), signed in
 * or not, the moment it ends. Null when it is not one of those boards' puzzles or cannot rank (the device runs the
 * verifier's own checks first, the run-in's replay included).
 */
export function captureCasualEntry(game: Game, u: LoadedUniverse, name: string, now: Date, owner: string | null = null): OutboxEntry | null {
  const board = casualBoardOf(game.settings)
  const sub = board ? buildCasualSubmission(game, u, name) : null
  if (!board || !sub) return null
  return { id: `${board.board}:${board.key}:${game.id}`, kind: board.board, key: board.key, encoded: sub.encoded, teamName: sub.teamName, shortName: sub.shortName, points: casualScoreOf(game), at: now.toISOString(), attempts: 0, nextAt: 0, owner, engine: ENGINE_VERSION }
}

/**
 * File a finished 38-0 chase run (the Summary's "Submit to the 38-0 chase"). Null when the game is not an eligible
 * chase run. Its window is the attempt's: 48 hours from when the game was created (just after the attempt was issued).
 */
export function captureChaseEntry(game: Game, u: LoadedUniverse, name: string, now: Date, owner: string | null = null): OutboxEntry | null {
  const sub = buildChaseSubmission(game, u, name)
  const code = chaseCodeOfSeed(game.settings.seed)
  if (!sub || !code) return null
  const created = Date.parse(game.createdAt)
  return { id: `chase:${code}:${game.id}`, kind: 'chase', key: code, encoded: sub.encoded, teamName: sub.teamName, shortName: sub.shortName, points: game.quickResult?.points ?? 0, at: now.toISOString(), attempts: 0, nextAt: 0, owner, closes: (Number.isFinite(created) ? created : now.getTime()) + CHASE_ATTEMPT_HOURS * 3600000, engine: ENGINE_VERSION }
}

/** Add a captured entry: one per board key and device (the server keeps the first post anyway). */
export function enqueue(r: OnlineRecord, e: OutboxEntry): OnlineRecord {
  const k = postKey(e.kind, e.key)
  if (r.captured.includes(k)) return r
  return { ...r, captured: [...r.captured, k], outbox: [...r.outbox, e], posts: { ...r.posts, [k]: { state: 'waiting', reason: 'sign_in', points: e.points } } }
}

export interface FlushDeps {
  transport: OnlineTransport
  signedIn: boolean
  /** The signed-in account; an entry another account filed waits for that account. */
  userId?: string | null
  now: () => number
  random: () => number
}

/**
 * Send every entry that is due. Returns the updated record; the caller stores it and mirrors `posts` and the
 * outbox count into the UI state. Never throws.
 */
export async function flushOutbox(r: OnlineRecord, deps: FlushDeps): Promise<OnlineRecord> {
  let rec = r
  const keep: OutboxEntry[] = []
  for (const e of r.outbox) {
    const k = postKey(e.kind, e.key)
    if (deps.now() >= closesAt(e)) {
      rec = { ...rec, posts: { ...rec.posts, [k]: { state: 'closed' } } }
      continue
    }
    // A run filed while another account was signed in on this device never posts under this one
    if (!deps.signedIn || (e.owner && e.owner !== deps.userId)) {
      rec = { ...rec, posts: { ...rec.posts, [k]: { state: 'waiting', reason: 'sign_in', points: e.points } } }
      keep.push(e)
      continue
    }
    if (e.nextAt > deps.now()) {
      keep.push(e)
      continue
    }
    let outcome: Outcome
    // A run played on an older engine goes to that engine's function (kept deployed after a release): this build's
    // function verifies only its own engine and would refuse it
    const engine = entryEngine(e)
    try {
      const body = isCasualKind(e.kind) ? { op: 'casual.submit', board: e.kind } : { op: e.kind === 'daily' ? 'daily.submit' : e.kind === 'weekly' ? 'weekly.submit' : 'chase.submit' }
      const reply = await deps.transport.invoke({ ...body, encoded: e.encoded, teamName: e.teamName, shortName: e.shortName }, engine === ENGINE_VERSION ? undefined : { engine })
      outcome = classify(reply.status, reply.body, e.points, engine)
    } catch (err) {
      outcome = isTransient(err) ? { kind: 'retry' } : { kind: 'done', post: { state: 'rejected', code: 'error', reason: err instanceof Error ? err.message : String(err) } }
    }
    if (outcome.kind === 'done' || outcome.kind === 'drop') {
      rec = { ...rec, posts: { ...rec.posts, [k]: outcome.post } }
    } else if (outcome.kind === 'wait_sign_in') {
      rec = { ...rec, posts: { ...rec.posts, [k]: { state: 'waiting', reason: 'sign_in', points: e.points } } }
      keep.push(e)
    } else {
      const attempts = e.attempts + 1
      rec = { ...rec, posts: { ...rec.posts, [k]: { state: 'waiting', reason: 'retry', points: e.points } } }
      keep.push({ ...e, attempts, nextAt: deps.now() + backoffMs(attempts, deps.random()) })
    }
  }
  return { ...rec, outbox: keep }
}

/** The soonest moment a kept entry is due again (null when nothing waits on time). */
export function nextDue(r: OnlineRecord): number | null {
  const due = r.outbox.map((e) => e.nextAt).filter((t) => t > 0)
  return due.length ? Math.min(...due) : null
}

/**
 * The game that has just finished as a ranked run, comparing two store states: the game this device was
 * playing moved into the summary. Quick Drafts, Seasons, ghosts and replays of a finished
 * game give null; `enqueue` keeps a second completion of the same board from being filed.
 */
export function rankedFinish(prev: { game: Game | null }, next: { game: Game | null }): Game | null {
  const g = next.game
  if (!g || g.phase !== 'summary' || !g.draft || g.settings.challenge) return null
  // Only a game this device was playing: a finished copy arriving from the cloud was filed by the device that played it
  if (!prev.game || prev.game.id !== g.id || prev.game.phase === 'summary') return null
  return rankedBoardOf(g.settings) ? g : null
}

/**
 * The casual game that has just finished, comparing two store states: the game this device was playing moved into
 * the summary, and it is the Daily Arena, the Weekly Challenge or the Run-in of the week played as itself (a raced
 * link or a Daily Arena practised again is not). A run-in keeps no draft at the summary, so none is needed here.
 */
export function casualFinish(prev: { game: Game | null }, next: { game: Game | null }): Game | null {
  const g = next.game
  if (!g || g.phase !== 'summary' || g.settings.challenge) return null
  if (!prev.game || prev.game.id !== g.id || prev.game.phase === 'summary') return null
  return casualBoardOf(g.settings) ? g : null
}
