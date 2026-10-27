/**
 * The Run-in of the week: one run-in job for everyone per ISO week (UTC, Monday to Sunday), seed `runin-YYYY-Www`,
 * and its ranked replay. The job is fixed by the week (the league, the brief and the club-season below), so the only
 * choices are the four reinforcements; after the draft the assistant plays every matchweek (Sim to end, Sim 5 or
 * Sim to the next big match: `playMatchweek(..., true)`, which picks the XI and answers every event). That run is a
 * pure function of the week, the data and the four picks, so a server can replay it from a short payload
 * (`RunInPayload`) and rank the replay's table. A run-in managed by hand (tactics, team talks, a watched match)
 * plays another season and does not rank: the device finds out by replaying it itself (`runInReplayProblem`).
 *
 * Pure and frozen like the Daily's mapping (CLAUDE.md invariant 4): `weeklyRunInPlan` and `weeklyRunInJob` decide
 * every week's job, so changing them changes the week's puzzle for everyone with the deploy.
 */
import { hashString, isoWeekOf, Rng } from '@engine/rng'
import { autoDraft, canSpin, isComplete, pick, picksMade, spin, type DraftState } from '@engine/draft'
import { cleanName, historyKey, type ChallengePick } from '@engine/challenge'
import { RUN_IN_LEAGUES, RUN_IN_TEMPLATES, runInCatalogue, type RunInJob, type RunInTemplate } from '@engine/scenario'
import { positionOf, seasonTable, USER_TEAM } from '@engine/season'
import type { LoadedUniverse } from '@engine/universe'
import { ENGINE_VERSION } from '@engine/version'
import type { Game, GameSettings } from '../types'
import { createGame } from './setup'
import { beginRunIn, runInGameSettings, seedRunInDraft } from './runin'
import { playMatchweek } from './week'

const WEEK_RE = /^runin-(\d{4})-W(\d{2})$/

/** This week's seed (UTC): `runin-2026-W44`. */
export function runInWeekSeed(date = new Date()): string {
  const { year, week } = isoWeekOf(date)
  return `runin-${year}-W${String(week).padStart(2, '0')}`
}

/** The week key of a Run-in of the week's seed (`2026-W44`), or null for any other seed. */
export function runInWeekKeyOfSeed(seed: string): string | null {
  const m = WEEK_RE.exec(seed)
  if (!m) return null
  const week = Number(m[2])
  return week >= 1 && week <= 53 ? `${m[1]}-W${m[2]}` : null
}

/** What the week is from its seed alone, before any pack loads: the league to load and the brief. */
export interface RunInWeekPlan {
  seed: string
  week: string
  leagueId: string
  template: RunInTemplate
}

/** With `n = year × 100 + week`: the league `RUN_IN_LEAGUES[n % 4]`, the brief `RUN_IN_TEMPLATES[(n × 5) % 3]`. Null for another seed. */
export function weeklyRunInPlan(seed: string): RunInWeekPlan | null {
  const week = runInWeekKeyOfSeed(seed)
  if (!week) return null
  const n = Number(week.slice(0, 4)) * 100 + Number(week.slice(6))
  return { seed, week, leagueId: RUN_IN_LEAGUES[n % RUN_IN_LEAGUES.length], template: RUN_IN_TEMPLATES[(n * 5) % RUN_IN_TEMPLATES.length] }
}

/**
 * The week's job: the plan's league and brief, then one job of that league's catalogue (sorted by season, then club
 * id, so the order never depends on what else is loaded) at `hashString(seed) % count`. Null while the league is not
 * loaded or it has no job of that brief.
 */
export function weeklyRunInJob(u: LoadedUniverse, seed: string): RunInJob | null {
  const plan = weeklyRunInPlan(seed)
  if (!plan || !u.leagues.some((l) => l.id === plan.leagueId)) return null
  const jobs = runInCatalogue(u, plan.template)
    .filter((j) => j.leagueId === plan.leagueId)
    .sort((a, b) => a.season - b.season || (a.clubId < b.clubId ? -1 : a.clubId > b.clubId ? 1 : 0))
  return jobs.length ? jobs[hashString(seed) % jobs.length] : null
}

/** The week's complete settings (`runInGameSettings` with the club's own shape), or null while its league loads. */
export function weeklyRunInSettings(u: LoadedUniverse, seed: string): GameSettings | null {
  const job = weeklyRunInJob(u, seed)
  return job ? runInGameSettings(u, job, { seed }) : null
}

/** Whether a game is the Run-in of the week, played as itself. */
export function isWeeklyRunIn(settings: Pick<GameSettings, 'mode' | 'seed' | 'challenge'>): boolean {
  return settings.mode === 'runin' && !settings.challenge && runInWeekKeyOfSeed(settings.seed) !== null
}

/** What a finished run-in claims: the final table row of the club, and whether the board sacked the manager. */
export interface RunInClaim {
  pts: number
  w: number
  d: number
  l: number
  gf: number
  ga: number
  pos: number
  sacked: boolean
}

/** A Run-in of the week as a payload: the week (its seed), the data and engine, the reinforcement rows, the claim. */
export interface RunInPayload {
  v: 1
  kind: 'runin'
  data: string
  engine: string
  name: string
  seed: string
  /** The shape played (the club's own, from the mapping). */
  f: string
  /** One row per spin of the reinforcement draft, as a challenge link carries them. */
  p: ChallengePick[]
  /** `historyKey` of the draft. */
  k: string
  c: RunInClaim
}

/** The claim of a run-in at its end (or where the board stopped it): the club's row of the final table. */
export function runInClaimOf(game: Game): RunInClaim | null {
  const season = game.season
  if (!season?.carryIn) return null
  const table = seasonTable(season)
  const pos = positionOf(table, USER_TEAM)
  const row = table[pos - 1]
  return { pts: row.points, w: row.won, d: row.drawn, l: row.lost, gf: row.goalsFor, ga: row.goalsAgainst, pos, sacked: season.sacked }
}

export const sameRunInClaim = (a: RunInClaim, b: RunInClaim): boolean => a.pts === b.pts && a.w === b.w && a.d === b.d && a.l === b.l && a.gf === b.gf && a.ga === b.ga && a.pos === b.pos && a.sacked === b.sacked

/** A finished Run-in of the week as its payload; null for any other game or before the end. */
export function runInPayloadFromGame(game: Game, u: LoadedUniverse, name: string): RunInPayload | null {
  const d = game.runInDraft
  const claim = runInClaimOf(game)
  if (!d || !claim || game.phase !== 'summary' || !isWeeklyRunIn(game.settings)) return null
  return { v: 1, kind: 'runin', data: u.generatedAt, engine: ENGINE_VERSION, name: cleanName(name), seed: game.settings.seed, f: game.settings.formationId, p: d.p, k: d.k, c: claim }
}

function toBase64Url(text: string): string {
  let bin = ''
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function encodeRunIn(p: RunInPayload): string {
  return toBase64Url(JSON.stringify({ ...p, name: cleanName(p.name) }))
}

/** Most spin rows a run-in draft can have: its four picks, one re-spin and one discarded spin, with room to spare. */
export const RUN_IN_ROWS_MAX = 12

const isInt = (x: unknown, lo: number, hi: number): x is number => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi
const isId = (x: unknown) => typeof x === 'string' && /^[A-Za-z0-9_.@-]{1,64}$/.test(x)

/** Decode a posted payload, checking its whole shape (its types are never trusted). Throws with the reason. */
export function decodeRunIn(text: string): RunInPayload {
  if (typeof text !== 'string' || text.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Not a run-in payload')
  let raw: unknown
  try {
    raw = JSON.parse(fromBase64Url(text))
  } catch {
    throw new Error('Not a run-in payload')
  }
  const o = raw as Record<string, unknown>
  if (!o || typeof o !== 'object' || o.v !== 1 || o.kind !== 'runin') throw new Error('Not a run-in payload')
  const allowed = ['v', 'kind', 'data', 'engine', 'name', 'seed', 'f', 'p', 'k', 'c']
  if (Object.keys(o).some((key) => !allowed.includes(key))) throw new Error('The payload has fields a run-in does not carry')
  if (typeof o.data !== 'string' || !/^[0-9A-Za-z._:-]{1,40}$/.test(o.data) || typeof o.engine !== 'string' || !/^[0-9A-Za-z.-]{1,16}$/.test(o.engine)) throw new Error('The payload names no data or engine')
  if (typeof o.name !== 'string' || typeof o.seed !== 'string' || !runInWeekKeyOfSeed(o.seed) || typeof o.f !== 'string' || !/^[0-9a-z-]{3,24}$/.test(o.f)) throw new Error('The payload names no Run-in of the week')
  if (typeof o.k !== 'string' || !/^[0-9a-z]{1,16}$/.test(o.k)) throw new Error('The payload has no draft key')
  if (!Array.isArray(o.p) || o.p.length < 1 || o.p.length > RUN_IN_ROWS_MAX || !o.p.every((r) => Array.isArray(r) && r.length === 2 && (r[0] === null || isId(r[0])) && (r[1] === null || isId(r[1])))) throw new Error('The draft rows are not a run-in draft')
  const c = o.c as Record<string, unknown>
  if (!c || typeof c !== 'object' || !isInt(c.pts, 0, 140) || !isInt(c.w, 0, 46) || !isInt(c.d, 0, 46) || !isInt(c.l, 0, 46) || !isInt(c.gf, 0, 200) || !isInt(c.ga, 0, 200) || !isInt(c.pos, 1, 24) || typeof c.sacked !== 'boolean') throw new Error('The claim is not a run-in result')
  return { v: 1, kind: 'runin', data: o.data, engine: o.engine, name: cleanName(o.name), seed: o.seed, f: o.f, p: o.p as ChallengePick[], k: o.k, c: { pts: c.pts, w: c.w, d: c.d, l: c.l, gf: c.gf, ga: c.ga, pos: c.pos, sacked: c.sacked } }
}

/**
 * The reinforcement draft replayed strictly on a game fresh from `seedRunInDraft`: every row is one `spin`; a null
 * row is the re-spin while it is left, else the spin the assistant discarded on Auto-complete, after which the rest
 * must be exactly what the assistant drafts. Throws with the spin number.
 */
function replayRunInDraft(u: LoadedUniverse, game: Game, rows: ChallengePick[], key: string): void {
  let d: DraftState | null = game.draft
  if (!d) throw new Error('The run-in has no draft')
  let rng = Rng.fromState(game.rngState)
  for (let i = 0; i < rows.length; i++) {
    const [playerId, slotId] = rows[i]
    const n = i + 1
    if (isComplete(d)) throw new Error(`Spin ${n} came after the squad was complete`)
    if (!canSpin(u, d)) throw new Error(`Spin ${n}: the wheel had run dry`)
    const cs = spin(u, d, rng)
    if (playerId === null) {
      if (slotId !== null) throw new Error(`Spin ${n}: a slot without a player`)
      const row = { clubId: cs.clubId, season: cs.season, pickedId: null, slotId: null }
      d.current = null
      d.twist = null
      if (d.respinsLeft > 0) {
        d.respinsLeft--
        d.history.push(row)
        continue
      }
      d.history.push({ ...row, skipped: true })
      const assisted: DraftState = structuredClone(d)
      const arng = Rng.fromState(rng.getState())
      autoDraft(u, assisted, arng)
      const expected = assisted.history.slice(d.history.length).map((h) => [h.pickedId ? (u.index[h.pickedId]?.playerId ?? null) : null, h.pickedId ? h.slotId : null])
      if (JSON.stringify(rows.slice(i + 1)) !== JSON.stringify(expected)) throw new Error(`Spin ${n + 1}: after an auto-complete the assistant drafts the rest`)
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
  if (!isComplete(d)) throw new Error(`The draft stopped after ${picksMade(d)} picks`)
  if (historyKey(d.history) !== key) throw new Error('The wheel did not land on the same club-seasons')
  game.rngState = rng.getState()
}

/** The assistant plays the run-in to its end, exactly as Sim to end does (`simWeeks` in the store). */
export function simRunIn(game: Game, u: LoadedUniverse): void {
  for (let i = 0; i < 60; i++) {
    if (game.phase === 'summary' || !game.season || game.season.sacked || game.season.matchweek >= game.season.matchweeks) break
    playMatchweek(game, u, true)
    if (game.phase === 'match') game.phase = 'week'
  }
}

/**
 * Replay a Run-in of the week from its settings and draft rows: the inherited squad, the draft strictly, the takeover,
 * then the assistant to the end. Returns the replayed game (its claim is `runInClaimOf`). Throws with the reason.
 */
export function replayRunIn(u: LoadedUniverse, settings: GameSettings, rows: ChallengePick[], key: string): Game {
  const game = createGame(settings)
  seedRunInDraft(game, u)
  replayRunInDraft(u, game, rows, key)
  beginRunIn(game, u)
  simRunIn(game, u)
  return game
}

/**
 * Why a finished Run-in of the week would not replay as played, or null when it does: the assistant's run from the
 * same draft must end on the same table row. A run-in managed by hand plays a different season, so it does not rank.
 */
export function runInReplayProblem(game: Game, u: LoadedUniverse): string | null {
  const payload = runInPayloadFromGame(game, u, 'check')
  if (!payload) return 'The run-in has not finished'
  const expected = weeklyRunInSettings(u, game.settings.seed)
  if (!expected) return "This week's job could not be found in this data"
  if (!sameRunInJob(game.settings, expected)) return "This run-in's settings are not this week's job"
  let replayed: Game
  try {
    replayed = replayRunIn(u, expected, payload.p, payload.k)
  } catch (e) {
    return `The draft does not replay: ${e instanceof Error ? e.message : String(e)}`
  }
  const claim = runInClaimOf(replayed)
  return claim && sameRunInClaim(claim, payload.c) ? null : 'Managed by hand: only a run-in the assistant plays from the draft (Sim to end) ranks'
}

/** The fields that make a run-in's job and draft: the week, the club-season, the brief, the shape, the rules, the opposition. */
export function sameRunInJob(a: GameSettings, b: GameSettings): boolean {
  const key = (s: GameSettings) => JSON.stringify([s.mode, s.seed, s.leagueId, s.wheelLeagues, s.hostClubId, s.leagueSeason, s.formationId, s.difficulty, s.jobSecurity, s.continental, s.runIn?.template, s.teamName, s.shortName, Object.entries(s.rules).filter(([, v]) => v !== undefined).sort(([x], [y]) => (x < y ? -1 : 1))])
  return key(a) === key(b)
}
