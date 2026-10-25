/**
 * The verifier core of the ranked boards (the Daily and the weekly challenge): given the day's or week's pin and a
 * posted `ChallengePayload`, replay the draft strictly and the quick season exactly, and return the figures the
 * replay produced. A posted score is never trusted: the replay is the official result, and the claim is only
 * compared (`claimMatched`). Pure and DOM-free: the Edge Function runs it from the verifier bundle, the tests run it
 * on real packs. The engine is untouched: this only drives its primitives the way the store does.
 */
import { autoDraft, canSpin, isComplete, picksMade, pick, spin, type DraftState } from '@engine/draft'
import { decodeChallenge, historyKey, rulesDiff, sameClaim, type ChallengePayload } from '@engine/challenge'
import { dailyDateOf, Rng } from '@engine/rng'
import type { SeasonTier } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { ENGINE_VERSION } from '@engine/version'
import type { Game, GameSettings } from '@game/types'
import { createGame } from '@game/logic/setup'
import { runQuickSeason } from '@game/logic/quick'
import { claimOf } from '@game/logic/challenge'
import { canonicalJson, fingerprint } from '../core/canonical'
import { weekKeyOfSeed, weeklyIsOpen } from '../weekly'

/** The settings a puzzle fixes for everyone: a game's settings without the player's names or a ghost. */
export type PuzzleSettings = Omit<GameSettings, 'teamName' | 'shortName' | 'challenge'>

export function puzzleOf(settings: GameSettings | PuzzleSettings): PuzzleSettings {
  const rest: Partial<GameSettings> = { ...settings }
  delete rest.teamName
  delete rest.shortName
  delete rest.challenge
  return rest as PuzzleSettings
}

/** `daily_puzzles.settings_hash` / `weekly_puzzles.settings_hash`. */
export function settingsHash(settings: GameSettings | PuzzleSettings): string {
  return fingerprint(puzzleOf(settings))
}

/** A pinned puzzle as the board's tables hold it. */
export interface PuzzlePin {
  kind: 'daily' | 'weekly'
  /** `YYYY-MM-DD` of the Daily, or the week key `YYYY-Www`. */
  key: string
  seed: string
  settings: PuzzleSettings
  settingsHash: string
  engineVersion: string
  dataVersion: string
}

export interface RankedBody {
  encoded: string
  teamName: string
  shortName: string
}

/** The row `svc_daily_submit` / `svc_weekly_submit` inserts, in its jsonb shape. */
export interface RankedEntry {
  team_name: string
  points: number
  won: number
  drawn: number
  lost: number
  goals_for: number
  goals_against: number
  league_position: number
  tier: SeasonTier
  payload: string
  xi: string[]
  history_key: string
  draft_fingerprint: string
  claim_matched: boolean
  engine_version: string
  data_version: string
}

export type VerifyCode = 'invalid_payload' | 'closed' | 'engine_mismatch' | 'data_mismatch' | 'puzzle_mismatch' | 'invalid_team' | 'invalid_picks'

export type Verdict = { ok: true; key: string; entry: RankedEntry } | { ok: false; status: 409 | 422; code: VerifyCode; reason: string; context?: Record<string, string> }

const fail = (status: 409 | 422, code: VerifyCode, reason: string, context?: Record<string, string>): Verdict => ({ ok: false, status, code, reason, ...(context ? { context } : {}) })

/** The most rows an honest draft can have: one per pick, one per re-spin, and one discarded spin before Auto-complete. */
export function maxDraftRows(d: DraftState): number {
  return d.rules.squadSize + d.rules.respins + 1
}

/**
 * Replay a posted draft on `game` (fresh from the pin's settings) without the leniency of `replayDraft`, which
 * treats any null row as a free re-spin. Every row costs one `spin`. A null row is a re-spin while re-spins are
 * left; with none left it can only be the spin the assistant discarded on Auto-complete (the store logs it as
 * `skipped`), after which every remaining row must be exactly what the assistant drafts. A pick row must name a
 * player of the club-season the wheel landed on, in a slot `pick` accepts. Throws with the spin number.
 */
export function strictReplayDraft(u: LoadedUniverse, game: Game, c: ChallengePayload): void {
  let d = game.draft
  if (!d) throw new Error('The game has no draft')
  let rng = Rng.fromState(game.rngState)
  const cap = maxDraftRows(d)
  if (c.p.length > cap) throw new Error(`The draft has ${c.p.length} spins; at most ${cap} are possible`)
  for (let i = 0; i < c.p.length; i++) {
    const [playerId, slotId] = c.p[i]
    const n = i + 1
    if (isComplete(d)) throw new Error(`Spin ${n} came after the squad was complete`)
    if (!canSpin(u, d)) throw new Error(`Spin ${n}: the wheel had run dry`)
    const cs = spin(u, d, rng)
    if (playerId === null) {
      if (slotId !== null) throw new Error(`Spin ${n}: a slot without a player`)
      const row = { clubId: cs.clubId, season: cs.season, pickedId: null, slotId: null, ...(d.twist ? { twist: d.twist } : {}) }
      d.current = null
      d.twist = null
      if (d.respinsLeft > 0) {
        d.respinsLeft--
        d.history.push(row)
        continue
      }
      // No re-spin left: the assistant's Auto-complete discarding this spin, then drafting the rest itself
      d.history.push({ ...row, skipped: true })
      const assisted: DraftState = structuredClone(d)
      const arng = Rng.fromState(rng.getState())
      autoDraft(u, assisted, arng)
      const expected = assisted.history.slice(d.history.length).map((h) => [h.pickedId ? (u.index[h.pickedId]?.playerId ?? null) : null, h.pickedId ? h.slotId : null])
      const rest = c.p.slice(i + 1)
      if (canonicalJson(rest) !== canonicalJson(expected)) throw new Error(`Spin ${n + 1}: after an auto-complete the assistant drafts the rest`)
      d = assisted
      game.draft = assisted
      rng = arng
      break
    }
    const id = `${playerId}@${cs.season}@${cs.clubId}`
    if (!u.index[id]) throw new Error(`Spin ${n}: no player ${playerId} in the ${cs.clubId} ${cs.season} squad`)
    try {
      pick(u, d, id, slotId ?? 'bench')
    } catch (e) {
      throw new Error(`Spin ${n}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (!isComplete(d) && !(picksMade(d) >= 11 && !canSpin(u, d))) throw new Error(`The draft stopped after ${picksMade(d)} picks`)
  if (d.spins !== c.p.length || d.history.length !== c.p.length) throw new Error('The spins do not add up')
  if (historyKey(d.history) !== c.k) throw new Error('The wheel did not land on the same club-seasons')
  game.rngState = rng.getState()
}

/**
 * Characters a team name may not hold, the same set as `private.is_clean_name` in the database: controls, soft
 * hyphen, zero-width and bidi formatting characters, every space but U+0020, variation selectors, byte-order mark,
 * Hangul fillers and specials. They let a name pose as another on a board while comparing as different.
 */
export const HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u00a0\u00ad\u034f\u061c\u115f\u1160\u1680\u17b4\u17b5\u180b-\u180f\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff]/

/** The window a ranked seed may be posted in, by server time. */
function seedWindow(kind: PuzzlePin['kind'], seed: string, now: Date): { key: string; open: boolean } | null {
  if (kind === 'daily') {
    const d = dailyDateOf(seed)
    if (!d) return null
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    return { key: d.toISOString().slice(0, 10), open: d.getTime() === today || d.getTime() === today - 86400000 }
  }
  const key = weekKeyOfSeed(seed)
  return key ? { key, open: weeklyIsOpen(key, now) } : null
}

/**
 * Verify one posted run against its pin. `dataAllowed(version)` says whether a data version other than the pin's
 * may rank (one the live site served after the pin was made); `u` must be the universe of `payload.data`.
 */
export function verifyRanked(u: LoadedUniverse, pin: PuzzlePin, body: RankedBody, now: Date, dataAllowed: (version: string) => boolean): Verdict {
  // The body arrives as raw JSON from the Edge Function: never trust its types
  const raw: unknown = body
  if (!raw || typeof raw !== 'object') return fail(422, 'invalid_payload', 'The submission is not an object')
  const { encoded: rawEncoded, teamName: rawTeam, shortName: rawShort } = raw as Record<string, unknown>
  if (typeof rawEncoded !== 'string') return fail(422, 'invalid_payload', 'The submission has no payload')
  if (typeof rawTeam !== 'string' || typeof rawShort !== 'string') return fail(422, 'invalid_team', 'A team name and a short name are text')
  let c: ChallengePayload
  const encoded = rawEncoded.trim().replace(/^#?c=/, '')
  if (encoded.length > 8000) return fail(422, 'invalid_payload', 'The submission is too long')
  try {
    c = decodeChallenge(encoded)
  } catch (e) {
    return fail(422, 'invalid_payload', e instanceof Error ? e.message : String(e))
  }
  const window = seedWindow(pin.kind, c.s.seed, now)
  if (!window) return fail(422, 'invalid_payload', pin.kind === 'daily' ? 'Not a Daily' : 'Not a weekly challenge')
  if (!window.open) return fail(409, 'closed', pin.kind === 'daily' ? 'That Daily has closed' : 'That week has closed')
  if (window.key !== pin.key || c.s.seed !== pin.seed) return fail(409, 'puzzle_mismatch', 'Posted against another day or week', { pinned: pin.key })
  if (c.engine !== ENGINE_VERSION || pin.engineVersion !== ENGINE_VERSION) return fail(409, 'engine_mismatch', `Played on engine ${c.engine}; the ranked puzzle runs on engine ${pin.engineVersion}`, { pinnedEngine: pin.engineVersion })
  if (c.data !== pin.dataVersion && !dataAllowed(c.data)) return fail(409, 'data_mismatch', `Played on data from ${c.data}; the ranked puzzle uses ${pin.dataVersion}`, { pinnedData: pin.dataVersion })
  if (u.generatedAt !== c.data) return fail(409, 'data_mismatch', `The verifier holds data from ${u.generatedAt}, not ${c.data}`, { pinnedData: pin.dataVersion })
  const s = pin.settings
  const samePuzzle = c.s.f === s.formationId && c.s.l === s.leagueId && canonicalJson(c.s.wl) === canonicalJson(s.wheelLeagues) && c.s.h === s.hostClubId && c.s.ls === s.leagueSeason && c.s.d === (s.difficulty ?? 'calibrated') && canonicalJson(c.s.r) === canonicalJson(rulesDiff(s.rules))
  if (!samePuzzle) return fail(409, 'puzzle_mismatch', 'This run was played on a different puzzle from the ranked one')
  const host = u.clubSeasonByKey[`${s.hostClubId}@${s.leagueSeason}`]
  if (!host || host.leagueId !== s.leagueId) return fail(409, 'puzzle_mismatch', `This data has no ${s.hostClubId} ${s.leagueSeason}`)
  if (rawTeam.trim() !== rawTeam || [...rawTeam].length < 1 || [...rawTeam].length > 28 || HIDDEN_CHARS.test(rawTeam)) return fail(422, 'invalid_team', 'A team name is 1 to 28 visible characters')
  if (!/^[A-Z0-9]{2,3}$/.test(rawShort)) return fail(422, 'invalid_team', 'A short name is 2 or 3 capital letters or digits')
  // Exactly the names the player played with: they are part of the game that was replayed
  const game = createGame({ ...s, teamName: rawTeam, shortName: rawShort })
  try {
    strictReplayDraft(u, game, c)
  } catch (e) {
    return fail(422, 'invalid_picks', e instanceof Error ? e.message : String(e))
  }
  try {
    runQuickSeason(game, u)
  } catch (e) {
    return fail(422, 'invalid_picks', `The season could not be replayed: ${e instanceof Error ? e.message : String(e)}`)
  }
  const q = game.quickResult
  const claim = claimOf(game)
  if (!q || !claim) return fail(422, 'invalid_picks', 'The season produced no result')
  return {
    ok: true,
    key: window.key,
    entry: {
      team_name: rawTeam,
      points: q.points,
      won: q.won,
      drawn: q.drawn,
      lost: q.lost,
      goals_for: q.goalsFor,
      goals_against: q.goalsAgainst,
      league_position: q.position,
      tier: q.tier,
      payload: encoded,
      xi: Object.values(game.lineup),
      history_key: c.k,
      draft_fingerprint: fingerprint(c.p),
      claim_matched: sameClaim(claim, c.c),
      engine_version: c.engine,
      data_version: c.data,
    },
  }
}

/** The Daily: `pin.kind` is `'daily'` and `pin.key` its `YYYY-MM-DD`. */
export function verifyDaily(u: LoadedUniverse, pin: PuzzlePin, body: RankedBody, now: Date, dataAllowed: (version: string) => boolean): Verdict {
  return verifyRanked(u, { ...pin, kind: 'daily' }, body, now, dataAllowed)
}

/** The weekly challenge: `pin.kind` is `'weekly'` and `pin.key` its `YYYY-Www`. */
export function verifyWeekly(u: LoadedUniverse, pin: PuzzlePin, body: RankedBody, now: Date, dataAllowed: (version: string) => boolean): Verdict {
  return verifyRanked(u, { ...pin, kind: 'weekly' }, body, now, dataAllowed)
}
