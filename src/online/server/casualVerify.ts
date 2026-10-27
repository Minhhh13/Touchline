/**
 * The verifier of the casual modes' boards (docs/ONLINE.md section 5f): the Daily Arena (`arena`), the themed Weekly
 * Challenge (`themed`, mode `weekly`) and the Run-in of the week (`runin`). Each is one fixed puzzle for everyone in
 * its day or week, pinned by the Edge Function from the live data like the Daily, and every post is replayed:
 *
 * - `arena`: the arena link (`ArenaChallengePayload`) replayed strictly: every draft row is one spin (a null row is a
 *   re-spin while one is left, else the spin the assistant discarded on Auto-complete), then each step as the
 *   assistant plays it, with the link's training letters and lifeline. Only a run the assistant played (`auto`, the
 *   `arena.handManaged` rule) can be replayed, so only such runs rank.
 * - `themed`: the quick payload replayed by `replayVerdict`, the Daily's own replay, against the week's
 *   `weeklyGameSettings` (src/game/logic/weekly.ts), its theme's rules included.
 * - `runin`: the run-in payload replayed by `replayRunIn`: the inherited squad, the four picks, then the assistant
 *   to the end. A run-in managed by hand replays to another table and is refused.
 *
 * The replay is the official result; the posted claim is only compared (`claim_matched`). Pure and DOM-free: bundled
 * into the Edge Function with the rest of the verifier.
 */
import { decodeChallenge, draftClosed, historyKey, isArenaPayload, replayRow, trainingOfCode, type ArenaChallengePayload, type ChallengePayload, type ChallengePick } from '@engine/challenge'
import { autoDraft, canSpin, isComplete, type DraftState } from '@engine/draft'
import { arenaDailyDateOf, Rng } from '@engine/rng'
import type { LoadedUniverse } from '@engine/universe'
import { ENGINE_VERSION } from '@engine/version'
import type { Game, GameSettings } from '@game/types'
import { createGame, shortNameFor } from '@game/logic/setup'
import { arenaBanner, beginArena, changeTheDraw, closeArenaMatch, playArenaStep, stepWon } from '@game/logic/arena'
import { arenaClaimOf } from '@game/logic/arenaClaim'
import { dailyArenaGameSettings } from '@game/logic/arenaDaily'
import { weeklyGameSettings, weeklyPlan } from '@game/logic/weekly'
import { decodeRunIn, encodeRunIn, replayRunIn, runInClaimOf, runInWeekKeyOfSeed, sameRunInClaim, weeklyRunInPlan, weeklyRunInSettings } from '@game/logic/runinWeekly'
import { fingerprint } from '../core/canonical'
import { weekKeyOfSeed, weeklyIsOpen, weekStartOf } from '../weekly'
import { HIDDEN_CHARS, publicPayload, replayVerdict, samePuzzle, type PuzzleSettings, type VerifyCode } from './dailyVerify'

/** The casual boards. */
export type CasualBoard = 'arena' | 'themed' | 'runin'
export const CASUAL_BOARDS: readonly CasualBoard[] = ['arena', 'themed', 'runin']

const DAY = 86400000

/** The board key of a seed: the Daily Arena's `YYYY-MM-DD`, the week's `YYYY-Www`; null for a seed of another board. */
export function casualKeyOfSeed(board: CasualBoard, seed: string): string | null {
  if (board === 'arena') {
    const d = arenaDailyDateOf(seed)
    return d ? d.toISOString().slice(0, 10) : null
  }
  return board === 'themed' ? weekKeyOfSeed(seed) : runInWeekKeyOfSeed(seed)
}

/** The seed of a board key. */
export function casualSeedOf(board: CasualBoard, key: string): string {
  return board === 'arena' ? `arena-${key}` : board === 'themed' ? `weekly-${key}` : `runin-${key}`
}

/** When nothing can be posted to a board key any more (epoch ms): 00:00 UTC two days after a Daily Arena (today or
 * yesterday, as the Daily); the Tuesday after a week (one day of grace). 0 for a key that is not one. */
export function casualClosesAt(board: CasualBoard, key: string): number {
  if (board === 'arena') {
    const d = arenaDailyDateOf(`arena-${key}`)
    return d ? d.getTime() + 2 * DAY : 0
  }
  const start = weekStartOf(key)
  return start ? start.getTime() + 8 * DAY : 0
}

/** Whether a board key still takes posts at `now` (server time). */
export function casualIsOpen(board: CasualBoard, key: string, now: Date): boolean {
  if (board === 'arena') {
    const d = arenaDailyDateOf(`arena-${key}`)
    if (!d) return false
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    return d.getTime() === today || d.getTime() === today - DAY
  }
  return weeklyIsOpen(key, now)
}

/** The leagues a board's puzzle needs loaded, from the data index's league ids (in their order). */
export function casualLeagues(board: CasualBoard, seed: string, available: readonly string[]): string[] {
  if (board === 'arena') return ['england']
  if (board === 'runin') {
    const plan = weeklyRunInPlan(seed)
    return plan ? [plan.leagueId] : []
  }
  const plan = weeklyPlan({ available: available.map((id) => ({ id })) as LoadedUniverse['available'] }, seed)
  const wanted = new Set([plan.leagueId, ...plan.wheelLeagues])
  return available.filter((id) => wanted.has(id))
}

/** The full settings of a board's puzzle on this universe (the mapping each mode ships with), or null while it cannot be built. */
export function casualSettings(u: LoadedUniverse, board: CasualBoard, seed: string): GameSettings | null {
  if (board === 'arena') return arenaDailyDateOf(seed) ? dailyArenaGameSettings(u, seed) : null
  if (board === 'themed') return weekKeyOfSeed(seed) ? weeklyGameSettings(u, seed) : null
  return weeklyRunInSettings(u, seed)
}

/** A pinned casual puzzle as `private.casual_puzzles` holds it. */
export interface CasualPin {
  board: CasualBoard
  key: string
  seed: string
  settings: PuzzleSettings
  settingsHash: string
  engineVersion: string
  dataVersion: string
}

/** The row `svc_casual_submit` inserts, in its jsonb shape. `score` orders the board first (points, or arena steps won). */
export interface CasualEntry {
  team_name: string
  score: number
  won: number
  drawn: number
  lost: number
  goals_for: number
  goals_against: number
  /** The final league place (the themed Weekly, the run-in); null for an arena run. */
  league_position: number | null
  /** The trophy: the arena's top of the ladder or the cup, the league won, the run-in's brief met. */
  trophy: boolean
  /** The result in a few words: `9 rungs`, `Cup winners`, `CHAMPIONS`, `SURVIVED`. */
  detail: string
  payload: string
  xi: string[]
  history_key: string
  draft_fingerprint: string
  claim_matched: boolean
  engine_version: string
  data_version: string
}

export type CasualCode = VerifyCode | 'hand_managed'

export type CasualVerdict = { ok: true; key: string; entry: CasualEntry } | { ok: false; status: 409 | 422; code: CasualCode; reason: string; context?: Record<string, string> }

const fail = (status: 409 | 422, code: CasualCode, reason: string, context?: Record<string, string>): CasualVerdict => ({ ok: false, status, code, reason, ...(context ? { context } : {}) })

/** The reason a hand-managed arena run never ranks. */
export const ARENA_HAND_REASON = 'Managed by hand: only a Daily Arena run the assistant played ranks (its matches replay exactly)'

/**
 * Whether an arena payload is the Daily Arena `s` exactly: the settings block and the arena block (format, size,
 * field, decade, day). Null when it is, else why not.
 */
export function arenaPuzzleProblem(c: ArenaChallengePayload, s: PuzzleSettings): string | null {
  const a = s.arena
  if (!a?.daily) return 'Not a Daily Arena'
  if (!samePuzzle(c.s, s)) return 'This run was played on a different puzzle from the ranked one'
  const want = { f: a.format, n: a.format === 'cup' ? (a.size ?? 2) : undefined, fd: a.format === 'cup' ? a.field : undefined, dc: a.field === 'decade' ? a.decade : undefined, dl: s.seed.replace('arena-', '') }
  const got = { f: c.arena.f, n: c.arena.n, fd: c.arena.fd, dc: c.arena.dc, dl: c.arena.dl }
  return JSON.stringify(want) === JSON.stringify(got) ? null : 'This run was played on a different arena from the ranked one'
}

/** Names as the boards take them: a team name of 1 to 28 visible characters, a short name of 2 or 3 capitals or digits. */
function namesProblem(team: string, short: string): string | null {
  if (team.trim() !== team || [...team].length < 1 || [...team].length > 28 || HIDDEN_CHARS.test(team)) return 'A team name is 1 to 28 visible characters'
  if (!/^[A-Z0-9]{2,3}$/.test(short)) return 'A short name is 2 or 3 capital letters or digits'
  return null
}

/**
 * The rows of one draft window replayed strictly, from row `from` until the draft may close: a null row is a re-spin
 * while one is left, else the spin the assistant discarded on Auto-complete, after which the window's next rows must
 * be exactly what the assistant drafts. Returns the next row. Throws with the spin number.
 */
function strictWindow(u: LoadedUniverse, game: Game, c: ArenaChallengePayload, from: number): number {
  let i = from
  let rng = Rng.fromState(game.rngState)
  while (!draftClosed(u, game.draft!)) {
    const d: DraftState = game.draft!
    if (i >= c.p.length) throw new Error(`The draft stopped after ${d.history.filter((h) => h.pickedId).length} picks`)
    const row = c.p[i]
    if (row[0] === null && d.respinsLeft === 0) {
      // Auto-complete: the showing spin discarded (logged as skipped), then the assistant drafts the window's rest
      if (isComplete(d) || !canSpin(u, d)) throw new Error(`Spin ${i + 1}: no spin to discard`)
      if (row[1] !== null) throw new Error(`Spin ${i + 1}: a slot without a player`)
      replayRow(u, d, rng, row, i + 1)
      d.history[d.history.length - 1].skipped = true
      const assisted: DraftState = structuredClone(d)
      const arng = Rng.fromState(rng.getState())
      autoDraft(u, assisted, arng)
      const expected: ChallengePick[] = assisted.history.slice(d.history.length).map((h) => [h.pickedId ? (u.index[h.pickedId]?.playerId ?? null) : null, h.pickedId ? h.slotId : null])
      const rest = c.p.slice(i + 1, i + 1 + expected.length)
      if (JSON.stringify(rest) !== JSON.stringify(expected)) throw new Error(`Spin ${i + 2}: after an auto-complete the assistant drafts the rest`)
      game.draft = assisted
      rng = arng
      i += 1 + expected.length
      continue
    }
    replayRow(u, d, rng, row, i + 1)
    i++
  }
  game.rngState = rng.getState()
  return i
}

/** Replay a Daily Arena run on `game` (fresh from the pin's settings): the draft, then step by step as the assistant plays it. */
function replayArena(u: LoadedUniverse, game: Game, c: ArenaChallengePayload): void {
  let row = strictWindow(u, game, c, 0)
  beginArena(game, u)
  const a = game.arena!
  for (let i = 0; game.phase !== 'summary'; i++) {
    if (i >= c.t.length) throw new Error(`The run goes on past step ${c.t.length}`)
    const training = trainingOfCode(c.t[i])
    if (!training) throw new Error(`Step ${i + 1}: an unknown training letter`)
    game.training = training
    if (c.lf === i + 1 && !changeTheDraw(game, u).ok) throw new Error(`The lifeline could not be used at rung ${c.lf}`)
    playArenaStep(game, u, false)
    if (a.pending || !a.log[i]) throw new Error(`Step ${i + 1} could not be played`)
    closeArenaMatch(game)
    if (game.phase === 'draft') {
      row = strictWindow(u, game, c, row)
      beginArena(game, u)
    }
  }
  if (a.log.length !== c.t.length) throw new Error(`The run ends after step ${a.log.length}, not ${c.t.length}`)
  if (c.lf !== undefined && a.lifelineUsed !== c.lf) throw new Error(`The lifeline was not used at rung ${c.lf}`)
  if (row !== c.p.length) throw new Error(`The draft has ${c.p.length - row} rows the run never spun`)
  if (historyKey(game.draft?.history ?? []) !== c.k) throw new Error('The wheel did not land on the same club-seasons')
}

function engineDataProblem(c: { engine: string; data: string }, pin: CasualPin, u: LoadedUniverse, dataAllowed: (version: string) => boolean): CasualVerdict | null {
  if (c.engine !== ENGINE_VERSION || pin.engineVersion !== ENGINE_VERSION) return fail(409, 'engine_mismatch', `Played on engine ${c.engine}; the ranked puzzle runs on engine ${pin.engineVersion}`, { pinnedEngine: pin.engineVersion })
  if (c.data !== pin.dataVersion && !dataAllowed(c.data)) return fail(409, 'data_mismatch', `Played on data from ${c.data}; the ranked puzzle uses ${pin.dataVersion}`, { pinnedData: pin.dataVersion })
  if (u.generatedAt !== c.data) return fail(409, 'data_mismatch', `The verifier holds data from ${u.generatedAt}, not ${c.data}`, { pinnedData: pin.dataVersion })
  return null
}

export interface CasualBody {
  encoded: string
  teamName: string
  shortName: string
}

/** The board key a posted body is for (read from its seed), without replaying it; null when it names no puzzle of the board. */
export function casualKeyOfBody(board: CasualBoard, encoded: string): string | null {
  try {
    const text = encoded.trim().replace(/^#?c=/, '')
    if (board === 'runin') return runInWeekKeyOfSeed(decodeRunIn(text).seed)
    const c = decodeChallenge(text)
    return casualKeyOfSeed(board, c.s.seed)
  } catch {
    return null
  }
}

/**
 * Verify one post against its board's pin. `dataAllowed(version)` says whether data other than the pin's may rank (a
 * version the live site served after the pin was made); `u` is the universe of the payload's data with the puzzle's
 * leagues loaded.
 */
export function verifyCasual(u: LoadedUniverse, pin: CasualPin, body: CasualBody, now: Date, dataAllowed: (version: string) => boolean): CasualVerdict {
  const raw = body as unknown as Record<string, unknown>
  if (!raw || typeof raw !== 'object' || typeof raw.encoded !== 'string') return fail(422, 'invalid_payload', 'The submission has no payload')
  if (typeof raw.teamName !== 'string' || typeof raw.shortName !== 'string') return fail(422, 'invalid_team', 'A team name and a short name are text')
  const encoded = raw.encoded.trim().replace(/^#?c=/, '')
  if (encoded.length > 8000) return fail(422, 'invalid_payload', 'The submission is too long')
  const team = raw.teamName
  const short = raw.shortName
  if (!casualIsOpen(pin.board, pin.key, now)) return fail(409, 'closed', 'That board has closed')
  if (pin.board === 'runin') return verifyRunIn(u, pin, encoded, dataAllowed)
  let c: ChallengePayload
  try {
    c = decodeChallenge(encoded)
  } catch (e) {
    return fail(422, 'invalid_payload', e instanceof Error ? e.message : String(e))
  }
  const key = casualKeyOfSeed(pin.board, c.s.seed)
  if (!key) return fail(422, 'invalid_payload', pin.board === 'arena' ? 'Not a Daily Arena' : 'Not a Weekly Challenge')
  if (key !== pin.key || c.s.seed !== pin.seed) return fail(409, 'puzzle_mismatch', 'Posted against another day or week', { pinned: pin.key })
  const ed = engineDataProblem(c, pin, u, dataAllowed)
  if (ed) return ed
  if (pin.board === 'themed') {
    if (isArenaPayload(c)) return fail(422, 'invalid_payload', 'An arena run cannot go to the Weekly Challenge')
    const v = replayVerdict(u, pin.settings, c, team, short, key)
    if (!v.ok) return v
    const e = v.entry
    return { ok: true, key, entry: { team_name: e.team_name, score: e.points, won: e.won, drawn: e.drawn, lost: e.lost, goals_for: e.goals_for, goals_against: e.goals_against, league_position: e.league_position, trophy: e.league_position === 1, detail: e.tier, payload: e.payload, xi: e.xi, history_key: e.history_key, draft_fingerprint: e.draft_fingerprint, claim_matched: e.claim_matched, engine_version: e.engine_version, data_version: e.data_version } }
  }
  if (!isArenaPayload(c)) return fail(422, 'invalid_payload', 'Not an arena run')
  const problem = arenaPuzzleProblem(c, pin.settings)
  if (problem) return fail(409, 'puzzle_mismatch', problem)
  if (!c.auto) return fail(409, 'hand_managed', ARENA_HAND_REASON)
  const names = namesProblem(team, short)
  if (names) return fail(422, 'invalid_team', names)
  const game = createGame({ ...pin.settings, teamName: team, shortName: short })
  try {
    replayArena(u, game, c)
  } catch (e) {
    return fail(422, 'invalid_picks', e instanceof Error ? e.message : String(e))
  }
  const a = game.arena!
  const claim = arenaClaimOf(a)
  const won = a.log.filter(stepWon).length
  return {
    ok: true,
    key,
    entry: {
      team_name: team,
      score: won,
      won,
      drawn: 0,
      lost: a.log.length - won,
      goals_for: a.log.reduce((t, s) => t + s.gf, 0),
      goals_against: a.log.reduce((t, s) => t + s.ga, 0),
      league_position: null,
      trophy: a.won,
      detail: arenaBanner(a).slice(0, 40),
      payload: publicPayload(c, team),
      xi: Object.values(game.lineup).slice(0, 18),
      history_key: c.k,
      draft_fingerprint: fingerprint(c.p),
      claim_matched: JSON.stringify(claim) === JSON.stringify(c.ac),
      engine_version: c.engine,
      data_version: c.data,
    },
  }
}

/** The names a run-in plays under: the club's own (as `runInGameSettings` gives them). */
function runInNames(u: LoadedUniverse, s: PuzzleSettings): { teamName: string; shortName: string } {
  const club = u.clubById[s.hostClubId]
  const name = club?.name ?? s.hostClubId
  return { teamName: name, shortName: club?.code ?? name.slice(0, 3).toUpperCase() }
}

function verifyRunIn(u: LoadedUniverse, pin: CasualPin, encoded: string, dataAllowed: (version: string) => boolean): CasualVerdict {
  let c
  try {
    c = decodeRunIn(encoded)
  } catch (e) {
    return fail(422, 'invalid_payload', e instanceof Error ? e.message : String(e))
  }
  const key = runInWeekKeyOfSeed(c.seed)
  if (!key) return fail(422, 'invalid_payload', 'Not a Run-in of the week')
  if (key !== pin.key || c.seed !== pin.seed) return fail(409, 'puzzle_mismatch', 'Posted against another week', { pinned: pin.key })
  const ed = engineDataProblem(c, pin, u, dataAllowed)
  if (ed) return ed
  if (c.f !== pin.settings.formationId) return fail(409, 'puzzle_mismatch', "This run-in was played in another shape from the week's")
  const names = runInNames(u, pin.settings)
  let game: Game
  try {
    game = replayRunIn(u, { ...pin.settings, ...names }, c.p, c.k)
  } catch (e) {
    return fail(422, 'invalid_picks', e instanceof Error ? e.message : String(e))
  }
  const claim = runInClaimOf(game)
  const season = game.season
  if (!claim || !season) return fail(422, 'invalid_picks', 'The run-in produced no result')
  const met = !claim.sacked && claim.pos <= season.boardTarget
  const template = pin.settings.runIn?.template ?? 'survival'
  return {
    ok: true,
    key,
    entry: {
      team_name: names.teamName.slice(0, 28),
      score: claim.pts,
      won: claim.w,
      drawn: claim.d,
      lost: claim.l,
      goals_for: claim.gf,
      goals_against: claim.ga,
      league_position: claim.pos,
      trophy: met,
      detail: claim.sacked ? 'SACKED' : met ? (template === 'title' ? 'TITLE WON' : template === 'europe' ? 'TOP FOUR' : 'SURVIVED') : 'MISSED',
      payload: encodeRunIn({ ...c, name: names.teamName }),
      xi: Object.values(game.lineup).slice(0, 18),
      history_key: c.k,
      draft_fingerprint: fingerprint(c.p),
      claim_matched: sameRunInClaim(claim, c.c),
      engine_version: c.engine,
      data_version: c.data,
    },
  }
}

/** The short name a board post sends for a game: the settings' own, or one made from the team name. */
export function casualShortName(s: Pick<GameSettings, 'shortName' | 'teamName'>): string {
  return /^[A-Z0-9]{2,3}$/.test(s.shortName) ? s.shortName : shortNameFor(s.teamName)
}
