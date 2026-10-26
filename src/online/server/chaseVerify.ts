/**
 * The verifier of the 38-0 chase: given the attempt the server issued (its code, league, shape, engine and data) and
 * a posted `ChallengePayload`, rebuild the attempt's settings with `chaseGameSettings`, replay the draft strictly and
 * the season exactly (`replayVerdict`, shared with the Daily and the weekly), and return the replay's figures. The
 * posted claim is only compared. Pure; bundled into the Edge Function with the rest of the verifier.
 */
import { isArenaPayload, type QuickChallengePayload } from '@engine/challenge'
import type { LoadedUniverse } from '@engine/universe'
import { ENGINE_VERSION } from '@engine/version'
import { chaseCodeOfSeed, chaseGameSettings } from '../chase'
import { parseRankedBody, puzzleOf, replayVerdict, type RankedBody, type Verdict } from './dailyVerify'

/** An attempt as `svc_chase_start` / `svc_chase_attempt` return it. */
export interface ChaseAttempt {
  code: string
  seed: string
  leagueId: string
  formationId: string
  /** Season or prime player ratings, and bench places (0 to 5), as chosen at issue. */
  ratings: 'season' | 'prime'
  benchPicks: number
  engineVersion: string
  dataVersion: string
  createdAt: string
  expiresAt: string
  submittedAt: string | null
}

/** Whether an attempt can still be posted at `now` (server time). */
export function attemptOpen(a: Pick<ChaseAttempt, 'expiresAt'>, now: Date): boolean {
  const t = Date.parse(a.expiresAt)
  return Number.isFinite(t) && now.getTime() < t
}

/**
 * Verify one posted chase run against its attempt. `dataAllowed(version)` says whether data other than the
 * attempt's may rank (a version the live site served after the attempt was issued); `u` is the universe of the
 * payload's data with the attempt's league loaded.
 */
export function verifyChase(u: LoadedUniverse, attempt: ChaseAttempt, body: RankedBody, now: Date, dataAllowed: (version: string) => boolean): Verdict {
  const parsed = parseRankedBody(body)
  if (!parsed.ok) return parsed
  const { decoded, team, short } = parsed
  if (isArenaPayload(decoded)) return { ok: false, status: 422, code: 'invalid_payload', reason: 'An arena run cannot go to the 38-0 chase' }
  const c: QuickChallengePayload = decoded
  const code = chaseCodeOfSeed(c.s.seed)
  if (!code) return { ok: false, status: 422, code: 'invalid_payload', reason: 'Not a 38-0 chase run' }
  if (code !== attempt.code) return { ok: false, status: 409, code: 'puzzle_mismatch', reason: 'Posted against another chase attempt' }
  if (!attemptOpen(attempt, now)) return { ok: false, status: 409, code: 'closed', reason: 'That chase run has closed' }
  if (c.engine !== ENGINE_VERSION || attempt.engineVersion !== ENGINE_VERSION) return { ok: false, status: 409, code: 'engine_mismatch', reason: `Played on engine ${c.engine}; the chase attempt runs on engine ${attempt.engineVersion}`, context: { pinnedEngine: attempt.engineVersion } }
  if (c.data !== attempt.dataVersion && !dataAllowed(c.data)) return { ok: false, status: 409, code: 'data_mismatch', reason: `Played on data from ${c.data}; the chase attempt uses ${attempt.dataVersion}`, context: { pinnedData: attempt.dataVersion } }
  if (u.generatedAt !== c.data) return { ok: false, status: 409, code: 'data_mismatch', reason: `The verifier holds data from ${u.generatedAt}, not ${c.data}`, context: { pinnedData: attempt.dataVersion } }
  const settings = chaseGameSettings(u, code, attempt.leagueId, attempt.formationId, 'Touchline XI', { ratings: attempt.ratings, benchPicks: attempt.benchPicks })
  if (!settings) return { ok: false, status: 409, code: 'puzzle_mismatch', reason: `This data has no complete ${attempt.leagueId} season` }
  return replayVerdict(u, puzzleOf(settings), c, team, short, code)
}
