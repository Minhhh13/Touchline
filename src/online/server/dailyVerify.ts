/**
 * The verifier core of the ranked boards (the Daily and the weekly challenge): given the day's or week's pin and a
 * posted `ChallengePayload`, replay the draft strictly and the quick season exactly, and return the figures the
 * replay produced. A posted score is never trusted: the replay is the official result, and the claim is only
 * compared (`claimMatched`). Pure and DOM-free: the Edge Function runs it from the verifier bundle, the tests run it
 * on real packs. The engine is untouched: this only drives its primitives the way the store does.
 */
import { autoDraft, benchPlaces, canCloseBench, canSpin, isComplete, picksMade, pick, spin, type DraftState } from '@engine/draft'
import { decodeChallenge, encodeChallenge, historyKey, isArenaPayload, rulesDiff, sameClaim, type ChallengePayload, type ChallengeSeason, type QuickChallengePayload } from '@engine/challenge'
import { dailyDateOf, Rng } from '@engine/rng'
import type { SeasonTier } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { ENGINE_VERSION } from '@engine/version'
import type { Game, GameSettings } from '@game/types'
import { createGame } from '@game/logic/setup'
import { claimOf, playSeason } from '@game/logic/challenge'
import { quickBenchRule } from '@game/logic/quickBench'
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

/**
 * Why a decoded run is not a standard ranked run, or null when it is: an arena link (the boards rank Quick Draft
 * seasons only), or a draft or season that used something outside the puzzle's rules: the Player Upgrader's gamble
 * (`g`), tray power-ups (`w`), power-ups unpacked from the locker (`i`), the end-of-draft case's Icon (`x.ic`), or a
 * manager (`x.m`) on a puzzle whose rules have none. The ranked rules (`DAILY_RULES`, which the weekly takes too) have
 * no modes, tray, Upgrader, managers, case, classic seasons or Super League, and `samePuzzle` refuses any rules that
 * differ from the pin's; these extras are not rules, so they are refused here (the strict replay would drop them and
 * rank a different season from the one played).
 */
export function nonStandardRun(c: ChallengePayload, rules: GameSettings['rules']): string | null {
  if (isArenaPayload(c)) return 'An arena run cannot rank on the Daily or weekly boards'
  if (c.g) return 'The Player Upgrader is not part of the ranked puzzle'
  if (c.w?.length) return 'Power-ups are not part of the ranked puzzle'
  if (c.i?.length) return 'Power-ups from the locker are not part of the ranked puzzle'
  if (c.x?.ic) return "The case's Icon is not part of the ranked puzzle"
  if (c.x?.jg) return 'The January spin and Upgrader are not part of the ranked puzzle'
  if (c.x?.m && !rules.managers) return 'A manager is not part of the ranked puzzle'
  return null
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

/**
 * The most rows an honest draft can have: one per pick (the XI and any Quick Draft bench places), one per re-spin,
 * and one discarded spin before Auto-complete or closing the bench. Without a bench (the Daily, the weekly) this is
 * squad size + re-spins + 1, as it always was.
 */
export function maxDraftRows(d: DraftState): number {
  return d.rules.squadSize + benchPlaces(d.rules) + d.rules.respins + 1
}

/**
 * Replay a posted draft on `game` (fresh from the pin's settings) without the leniency of `replayDraft`, which
 * treats any null row as a free re-spin. Every row costs one `spin`. A null row is a re-spin while re-spins are
 * left; with none left it can only be the spin the assistant discarded on Auto-complete (the store logs it as
 * `skipped`), after which every remaining row must be exactly what the assistant drafts, or, as the last row of a
 * Quick Draft with a bench whose XI is full, the spin showing when the manager closed the bench. A draft with bench
 * places to spare at the end was closed (`closeBench`). A pick row must name a player of the club-season the wheel
 * landed on, in a slot `pick` accepts. Throws with the spin number. The bench rules only apply when the rules give
 * bench places, which the Daily and weekly never do.
 */
export function strictReplayDraft(u: LoadedUniverse, game: Game, c: Pick<ChallengePayload, 'p' | 'k'>): void {
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
      // No re-spin left, last row, the XI full and bench places to spare: the manager closed the bench with this
      // spin showing (`closeBench` logs it as skipped; no RNG)
      if (i === c.p.length - 1 && canCloseBench(d)) {
        d.history.push({ ...row, skipped: true })
        d.benchClosed = true
        break
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
  // A Quick Draft bench may be closed once the XI is full, with bench places to spare (never on the Daily or weekly)
  if (canCloseBench(d)) d.benchClosed = true
  if (!isComplete(d) && !(picksMade(d) >= 11 && !canSpin(u, d))) throw new Error(`The draft stopped after ${picksMade(d)} picks`)
  if (d.spins !== c.p.length || d.history.length !== c.p.length) throw new Error('The spins do not add up')
  if (historyKey(d.history) !== c.k) throw new Error('The wheel did not land on the same club-seasons')
  game.rngState = rng.getState()
}

/**
 * The season's own choices (`x`) checked before they are played, beyond the shape `decodeChallenge` already checks:
 * bench changes only on a puzzle whose rules draft a bench, and a captain or penalty taker only from the drafted
 * squad (a name from anywhere else would be carried as a player the season never had). The January deal and each
 * change are checked by the season itself, which throws when one was not on offer or does not fit.
 */
export function seasonProblem(game: Game, x: ChallengeSeason | undefined): void {
  if (!x) return
  if (x.s?.length && !quickBenchRule(game)) throw new Error('Bench changes on a puzzle without a bench')
  const d = game.draft
  const squad = new Set(d ? [...Object.values(d.lineup), ...d.bench] : [])
  for (const t of [x.t, x.t2]) {
    if (t?.captain && !squad.has(t.captain)) throw new Error('The captain is not in the drafted squad')
    if (t?.penalties && !squad.has(t.penalties)) throw new Error('The penalty taker is not in the drafted squad')
  }
}

/**
 * Characters a team name may not hold, the same set as `private.is_clean_name` in the database: controls, soft
 * hyphen, zero-width and bidi formatting characters, every space but U+0020, variation selectors, byte-order mark,
 * Hangul fillers and specials. They let a name pose as another on a board while comparing as different.
 */
export const HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u00a0\u00ad\u034f\u061c\u115f\u1160\u1680\u17b4\u17b5\u180b-\u180f\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff]/

/** A posted run as a board row stores it: the same draft and claim, named after the team instead of the device's manager name. */
export function publicPayload(c: ChallengePayload, teamName: string): string {
  return encodeChallenge({ ...c, name: [...teamName].slice(0, 24).join('') })
}

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

/** A ranked body's text fields, decoded: the payload and the names exactly as posted. */
export type ParsedBody = { ok: true; decoded: ChallengePayload; team: string; short: string } | Extract<Verdict, { ok: false }>

/** Decode a posted body (raw JSON from the Edge Function: its types are never trusted). */
export function parseRankedBody(body: RankedBody): ParsedBody {
  const raw: unknown = body
  if (!raw || typeof raw !== 'object') return fail(422, 'invalid_payload', 'The submission is not an object') as ParsedBody
  const { encoded: rawEncoded, teamName: rawTeam, shortName: rawShort } = raw as Record<string, unknown>
  if (typeof rawEncoded !== 'string') return fail(422, 'invalid_payload', 'The submission has no payload') as ParsedBody
  if (typeof rawTeam !== 'string' || typeof rawShort !== 'string') return fail(422, 'invalid_team', 'A team name and a short name are text') as ParsedBody
  const encoded = rawEncoded.trim().replace(/^#?c=/, '')
  if (encoded.length > 8000) return fail(422, 'invalid_payload', 'The submission is too long') as ParsedBody
  try {
    return { ok: true, decoded: decodeChallenge(encoded), team: rawTeam, short: rawShort }
  } catch (e) {
    return fail(422, 'invalid_payload', e instanceof Error ? e.message : String(e)) as ParsedBody
  }
}

/** Whether a payload's settings block (`s`) is exactly the puzzle `s`: shape, leagues, host, season, difficulty and rules. */
export function samePuzzle(cs: ChallengePayload['s'], s: PuzzleSettings): boolean {
  return cs.seed === s.seed && cs.f === s.formationId && cs.l === s.leagueId && canonicalJson(cs.wl) === canonicalJson(s.wheelLeagues) && cs.h === s.hostClubId && cs.ls === s.leagueSeason && cs.d === (s.difficulty ?? 'calibrated') && canonicalJson(cs.r) === canonicalJson(rulesDiff(s.rules))
}

/**
 * The checks every ranked board shares once its window, engine and data are settled, then the replay: the run is
 * the puzzle `s` (shape, leagues, host, season, difficulty, rules), uses nothing outside it, the host exists in this
 * data, the names are clean, the draft replays strictly and the season exactly. `key` is the board key the entry is
 * filed under.
 */
export function replayVerdict(u: LoadedUniverse, s: PuzzleSettings, c: QuickChallengePayload, rawTeam: string, rawShort: string, key: string): Verdict {
  if (!samePuzzle(c.s, s)) return fail(409, 'puzzle_mismatch', 'This run was played on a different puzzle from the ranked one')
  const extra = nonStandardRun(c, s.rules)
  if (extra) return fail(409, 'puzzle_mismatch', extra)
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
    seasonProblem(game, c.x)
    // The season exactly as a challenge link replays it: the first-half tactics, the bench changes, the January deal
    playSeason(game, u, c.x)
  } catch (e) {
    return fail(422, 'invalid_picks', `The season could not be replayed: ${e instanceof Error ? e.message : String(e)}`)
  }
  const q = game.quickResult
  const claim = claimOf(game)
  if (!q || !claim) return fail(422, 'invalid_picks', 'The season produced no result')
  return {
    ok: true,
    key,
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
      // The stored payload is public once the day or week closes ("Race this run"). Its `name` is whatever the
      // poster's device put there (the Profile screen's manager name, never chosen for a public board), so the
      // row files it under the team name, which the board already shows; the draft and the claim are unchanged.
      payload: publicPayload(c, rawTeam),
      xi: Object.values(game.lineup),
      history_key: c.k,
      draft_fingerprint: fingerprint(c.p),
      claim_matched: sameClaim(claim, c.c),
      engine_version: c.engine,
      data_version: c.data,
    },
  }
}

/**
 * Verify one posted run against its pin. `dataAllowed(version)` says whether a data version other than the pin's
 * may rank (one the live site served after the pin was made); `u` must be the universe of `payload.data`.
 */
export function verifyRanked(u: LoadedUniverse, pin: PuzzlePin, body: RankedBody, now: Date, dataAllowed: (version: string) => boolean): Verdict {
  const parsed = parseRankedBody(body)
  if (!parsed.ok) return parsed
  const { decoded, team: rawTeam, short: rawShort } = parsed
  if (isArenaPayload(decoded)) return fail(422, 'invalid_payload', nonStandardRun(decoded, pin.settings.rules)!)
  const c: QuickChallengePayload = decoded
  const window = seedWindow(pin.kind, c.s.seed, now)
  if (!window) return fail(422, 'invalid_payload', pin.kind === 'daily' ? 'Not a Daily' : 'Not a weekly challenge')
  if (!window.open) return fail(409, 'closed', pin.kind === 'daily' ? 'That Daily has closed' : 'That week has closed')
  if (window.key !== pin.key || c.s.seed !== pin.seed) return fail(409, 'puzzle_mismatch', 'Posted against another day or week', { pinned: pin.key })
  if (c.engine !== ENGINE_VERSION || pin.engineVersion !== ENGINE_VERSION) return fail(409, 'engine_mismatch', `Played on engine ${c.engine}; the ranked puzzle runs on engine ${pin.engineVersion}`, { pinnedEngine: pin.engineVersion })
  if (c.data !== pin.dataVersion && !dataAllowed(c.data)) return fail(409, 'data_mismatch', `Played on data from ${c.data}; the ranked puzzle uses ${pin.dataVersion}`, { pinnedData: pin.dataVersion })
  if (u.generatedAt !== c.data) return fail(409, 'data_mismatch', `The verifier holds data from ${u.generatedAt}, not ${c.data}`, { pinnedData: pin.dataVersion })
  return replayVerdict(u, pin.settings, c, rawTeam, rawShort, window.key)
}

/** The Daily: `pin.kind` is `'daily'` and `pin.key` its `YYYY-MM-DD`. */
export function verifyDaily(u: LoadedUniverse, pin: PuzzlePin, body: RankedBody, now: Date, dataAllowed: (version: string) => boolean): Verdict {
  return verifyRanked(u, { ...pin, kind: 'daily' }, body, now, dataAllowed)
}

/** The weekly challenge: `pin.kind` is `'weekly'` and `pin.key` its `YYYY-Www`. */
export function verifyWeekly(u: LoadedUniverse, pin: PuzzlePin, body: RankedBody, now: Date, dataAllowed: (version: string) => boolean): Verdict {
  return verifyRanked(u, { ...pin, kind: 'weekly' }, body, now, dataAllowed)
}
