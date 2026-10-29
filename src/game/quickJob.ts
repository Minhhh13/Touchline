/**
 * The quick season's kick-off, the close of its January window and a bench change, as jobs for the quick-season worker
 * (`quickWorker.ts`): the same `kickOff` or `closeJanuary` on a copy of the game, so the season played there is the
 * one the page would play (`quickWorker.test.ts`, 50 seeds). Pure:
 * no fetch, no Worker, no React and no store, so the worker's bundle carries the game logic only.
 */
import type { LoadedUniverse } from '@engine/universe'
import type { Game } from './types'
import { closeJanuary, closeJanuarySpin, kickOff, makeQuickChange, playbackResults } from './logic/quick'
import { quickSeasonStale } from './logic/quickSeam'

/** What the page asks: kick off `game` (a copy: the worker gets its own), on the universe `mark` names. */
export interface KickOffJob {
  op: 'kickOff'
  game: Game
  skip: boolean
}

/**
 * Close a quick season's January window and play the second half: the listing signed (`index`, or none), or the
 * January spin's man placed (`slotId`, or none). Each replays the whole season, about the kick-off's work.
 */
export type JanuaryJob = { op: 'closeJanuary'; game: Game; index: number | null } | { op: 'closeJanuarySpin'; game: Game; slotId: string | null }

/**
 * A bench change in the playback (`makeQuickChange` before game `revealed + 1`): it plays the season again. With
 * `check`, the season on show is first played again on a copy to see this engine plays it as shown
 * (`quickSeasonStale`); a stale one is refused, and the page then takes its own path (the note, the window drawn again).
 */
export interface ChangeJob {
  op: 'quickChange'
  game: Game
  revealed: number
  slotId: string
  inId: string
  check: boolean
}

/** Every job the worker runs. */
export type QuickJob = KickOffJob | JanuaryJob | ChangeJob

/** A message to the worker: build the universe ahead of a job (`warm`), or run one. */
export type QuickWorkerAsk = { type: 'warm'; leagues: string[]; classic: boolean } | { type: 'job'; id: number; leagues: string[]; classic: boolean; mark: string; job: QuickJob }

/** The worker's answer: the game after the job, or why it did not run it (the page then runs it itself). */
export type QuickWorkerAnswer = { id: number; game: Game } | { id: number; error: string }

/** Run a job on `u`: the game it was given, mutated exactly as the store's action mutates its draft. */
export function runQuickJob(job: QuickJob, u: LoadedUniverse): Game {
  const game = job.game
  if (job.op === 'kickOff') kickOff(game, u, job.skip)
  else if (job.op === 'closeJanuary') closeJanuary(game, u, job.index)
  else if (job.op === 'closeJanuarySpin') closeJanuarySpin(game, u, job.slotId)
  else {
    if (job.check && quickSeasonStale(game, u)) throw new Error('stale')
    makeQuickChange(game, u, playbackResults(game), job.revealed, job.slotId, job.inId)
  }
  return game
}

const marks = new WeakMap<LoadedUniverse, string>()

/**
 * A fingerprint of a loaded universe: the data stamp (a rebuild that changes any pack takes a new one, invariant 16),
 * the leagues, the counts and a checksum over every player-season's rating, id and name lengths. The worker loads
 * its own copy of the packs, so it runs a job only on a universe with the page's mark (a pack refreshed in between,
 * a classic pack only one side has, would differ). Cheap (no string is read), and cached per universe.
 */
export function universeMark(u: LoadedUniverse): string {
  const hit = marks.get(u)
  if (hit) return hit
  let h = 2166136261
  let n = 0
  for (const id in u.index) {
    const p = u.index[id]
    h = Math.imul(h ^ (p.overall | 0), 16777619)
    h = Math.imul(h ^ ((id.length << 8) | (p.name.length & 255)), 16777619)
    n++
  }
  const mark = [u.generatedAt, u.leagues.map((l) => l.id).join('+'), u.clubSeasons.length, n, u.classicFirstSeason ?? '', (h >>> 0).toString(36)].join('|')
  marks.set(u, mark)
  return mark
}
