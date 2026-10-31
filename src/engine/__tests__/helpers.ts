import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { buildLeague, mergeUniverses, type LeaguesFile, type LoadedUniverse, type MetaFile, type PlayersFile } from '../universe'

const root = path.resolve(__dirname, '..', '..', '..')

// One test file runs in one module scope (Vitest's isolate), so these caches live for a file: a file that loads the
// same leagues in several tests parses and builds them once. The universe is read-only (CLAUDE.md invariant 7), so a
// shared copy is safe; a test that does mutate one (the name tidy) asks for its own with `freshTestUniverse`.
const files = new Map<string, unknown>()
const universes = new Map<string, LoadedUniverse>()

function readJson<T>(file: string): T {
  let out = files.get(file)
  if (out === undefined) {
    out = JSON.parse(readFileSync(file, 'utf8'))
    files.set(file, out)
  }
  return out as T
}

/** The leagues as the browser builds them, built afresh: for a test that changes the universe it is given. */
export function freshTestUniverse(leagues: string[] = ['england']): LoadedUniverse {
  const parts = leagues.map((id) => {
    const players = readJson<PlayersFile>(path.join(root, 'public', 'data', id, 'players.json'))
    const meta = readJson<MetaFile>(path.join(root, 'public', 'data', id, 'meta.json'))
    // The classic pack (1992-93 to 2007-08) loads as the browser loads it: when the league has one
    const classicFile = path.join(root, 'public', 'data', id, 'players-classic.json')
    const classic = existsSync(classicFile) ? readJson<PlayersFile>(classicFile) : undefined
    return buildLeague(players, meta, undefined, classic)
  })
  const index = readJson<LeaguesFile>(path.join(root, 'public', 'data', 'leagues.json'))
  return mergeUniverses(parts, index.leagues, index.generatedAt)
}

/** The leagues as the browser builds them, built once per test file for each list of leagues. */
export function loadTestUniverse(leagues: string[] = ['england']): LoadedUniverse {
  const key = leagues.join(',')
  let u = universes.get(key)
  if (!u) {
    u = freshTestUniverse(leagues)
    if (process.env.TL_FREEZE_UNIVERSE) deepFreeze(u)
    universes.set(key, u)
  }
  return u
}

// TL_FREEZE_UNIVERSE=1 freezes every shared universe, so a test that writes to one throws where it writes (an audit
// to rerun after adding a test that changes the universe; such a test takes `freshTestUniverse` instead)
function deepFreeze(o: unknown, seen = new Set<unknown>()): void {
  if (!o || typeof o !== 'object' || seen.has(o)) return
  seen.add(o)
  for (const v of Object.values(o as object)) deepFreeze(v, seen)
  Object.freeze(o)
}

/**
 * A new task, for a long synchronous sweep to call every few seeds: a minute of uninterrupted work starves the Vitest
 * worker's RPC ("Timeout calling onTaskUpdate", exit 1 with every test passing). Timing only; nothing it runs changes.
 */
export const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
