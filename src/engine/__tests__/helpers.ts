import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildUniverse, type LoadedUniverse, type MetaFile, type PlayersFile } from '../universe'

let cached: LoadedUniverse | null = null

export function loadTestUniverse(): LoadedUniverse {
  if (cached) return cached
  const root = path.resolve(__dirname, '..', '..', '..')
  const players = JSON.parse(readFileSync(path.join(root, 'public', 'data', 'england', 'players.json'), 'utf8')) as PlayersFile
  const meta = JSON.parse(readFileSync(path.join(root, 'public', 'data', 'england', 'meta.json'), 'utf8')) as MetaFile
  cached = buildUniverse(players, meta)
  return cached
}
