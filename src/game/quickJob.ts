/**
 * The quick season's kick-off as a job for the quick-season worker (`quickWorker.ts`): the same `kickOff` on a copy
 * of the game, so the season played there is the one the page would play (`quickWorker.test.ts`, 50 seeds). Pure:
 * no fetch, no Worker, no React and no store, so the worker's bundle carries the game logic only.
 */
import type { LoadedUniverse } from '@engine/universe'
import type { Game } from './types'
import { kickOff } from './logic/quick'

/** What the page asks: kick off `game` (a copy: the worker gets its own), on the universe `mark` names. */
export interface KickOffJob {
  op: 'kickOff'
  game: Game
  skip: boolean
}

/** A message to the worker: build the universe ahead of a job (`warm`), or run one. */
export type QuickWorkerAsk = { type: 'warm'; leagues: string[]; classic: boolean } | { type: 'job'; id: number; leagues: string[]; classic: boolean; mark: string; job: KickOffJob }

/** The worker's answer: the game after the job, or why it did not run it (the page then runs it itself). */
export type QuickWorkerAnswer = { id: number; game: Game } | { id: number; error: string }

/** Run a job on `u`: the game it was given, mutated exactly as the store's `kickOff` mutates its draft. */
export function runQuickJob(job: KickOffJob, u: LoadedUniverse): Game {
  const game = job.game
  kickOff(game, u, job.skip)
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
